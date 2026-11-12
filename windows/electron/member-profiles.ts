import type {UserProfileFailure,UserProfileMetadata,UserProfileOutcome,UserProfilesRequest,UserProfilesResult} from '../shared/profiles';

export type ProfileFetchResult =
  | {ok:true;profile:UserProfileMetadata}
  | {ok:false;reason:UserProfileFailure;httpStatus?:number};
export type ProfileFetcher=(memberId:number,signal:AbortSignal)=>Promise<ProfileFetchResult>;
export interface MemberProfilesOptions {now?:()=>number;retryDelayMs?:number}

interface CachedProfile {profile:UserProfileMetadata;fetchedAt:number}
interface CachedFailure {reason:UserProfileFailure;at:number}
interface PendingProfile {
  memberId:number;
  epoch:number;
  followingVersion:number;
  controller:AbortController;
  promise:Promise<UserProfileOutcome>;
  resolve:(outcome:UserProfileOutcome)=>void;
}

const concurrency=3,successTtl=180_000,failureTtl=10_000,cacheLimit=240;
const validMemberId=(value:unknown):value is number=>Number.isSafeInteger(value)&&Number(value)>0;

/** Account-scoped profile queue. A body read never needs to wait for this queue. */
export class MemberProfilesService {
  private readonly now:()=>number;
  private readonly retryDelayMs:number;
  private scope=0;
  private epoch=0;
  private disposed=false;
  private active=0;
  private readonly cache=new Map<number,CachedProfile>();
  private readonly failures=new Map<number,CachedFailure>();
  private readonly pending=new Map<number,PendingProfile>();
  private queue:PendingProfile[]=[];
  private readonly following=new Map<number,{version:number;value:boolean}>();

  constructor(private readonly fetchOne:ProfileFetcher,options:MemberProfilesOptions={}) {
    this.now=options.now??Date.now;
    this.retryDelayMs=options.retryDelayMs??150;
  }

  async read(request:UserProfilesRequest):Promise<UserProfilesResult> {
    if(!request || !Array.isArray(request.memberIds) || request.memberIds.length>32 || request.memberIds.some(id=>!validMemberId(id)) || (request.force!==undefined && typeof request.force!=='boolean')) {
      throw new Error('用户资料请求必须包含至多 32 个有效用户 ID');
    }
    const outcomes=await Promise.all(request.memberIds.map(memberId=>this.readOne(memberId,request.force===true)));
    return {outcomes,complete:true};
  }

  /** Returns a copy, including an expired snapshot if one is available. */
  get(memberId:number):UserProfileMetadata|undefined {
    const cached=this.cached(memberId);
    return cached?{...cached.profile}:undefined;
  }

  /** Called only after a confirmed follow/unfollow write for the current account. */
  updateFollowing(memberId:number,value:boolean):void {
    if(!validMemberId(memberId) || typeof value!=='boolean') throw new Error('无效的关注状态');
    this.following.set(memberId,{version:(this.following.get(memberId)?.version??0)+1,value});
    const cached=this.cached(memberId);
    if(cached) cached.profile={...cached.profile,following:value};
  }

  resetScope(scope:number):void {
    if(scope===this.scope) return;
    this.scope=scope;
    this.clearScope();
  }

  dispose():void {
    this.disposed=true;
    this.clearScope();
  }

  private clearScope():void {
    this.epoch++;
    this.cache.clear();
    this.failures.clear();
    this.following.clear();
    const jobs=[...this.pending.values()];
    this.pending.clear();
    this.queue=[];
    for(const job of jobs) {
      job.controller.abort();
      job.resolve({memberId:job.memberId,status:'failed',reason:'session-changed'});
    }
  }

  private cached(memberId:number):CachedProfile|undefined {
    const cached=this.cache.get(memberId);
    if(cached) {this.cache.delete(memberId);this.cache.set(memberId,cached);}
    return cached;
  }

  private readOne(memberId:number,force:boolean):Promise<UserProfileOutcome> {
    if(this.disposed) return Promise.resolve({memberId,status:'failed',reason:'session-changed'});
    const cached=this.cached(memberId);
    const pending=this.pending.get(memberId);
    if(pending) return pending.promise;
    const failure=this.failures.get(memberId);
    if(!force && failure && this.now()-failure.at<failureTtl) return Promise.resolve(this.failure(memberId,failure.reason,cached));
    if(!force && cached && this.now()-cached.fetchedAt<successTtl) return Promise.resolve(this.success(cached));
    let resolve!:(outcome:UserProfileOutcome)=>void;
    const promise=new Promise<UserProfileOutcome>(done=>{resolve=done;});
    const job:PendingProfile={memberId,epoch:this.epoch,followingVersion:this.following.get(memberId)?.version??0,controller:new AbortController(),promise,resolve};
    this.pending.set(memberId,job);
    this.queue.push(job);
    this.pump();
    return promise;
  }

  private pump():void {
    while(!this.disposed && this.active<concurrency && this.queue.length) {
      const job=this.queue.shift()!;
      if(job.epoch!==this.epoch) continue;
      this.active++;
      void this.run(job).finally(()=>{this.active--;this.pump();});
    }
  }

  private async run(job:PendingProfile):Promise<void> {
    let result=await this.fetch(job);
    if(!result.ok && this.retryable(result) && !job.controller.signal.aborted) {
      await this.backoff(job.controller.signal);
      if(!job.controller.signal.aborted) result=await this.fetch(job);
    }
    if(job.epoch!==this.epoch || job.controller.signal.aborted) return;
    if(this.pending.get(job.memberId)===job) this.pending.delete(job.memberId);
    if(result.ok) {
      const profile=this.copyProfile(result.profile,job.memberId);
      if(profile) {
        const following=this.following.get(job.memberId);
        if(following && following.version!==job.followingVersion) profile.following=following.value;
        const cached={profile,fetchedAt:this.now()};
        this.cache.delete(job.memberId);
        this.cache.set(job.memberId,cached);
        this.trim(this.cache);
        this.failures.delete(job.memberId);
        job.resolve(this.success(cached));
        return;
      }
      result={ok:false,reason:'invalid-response'};
    }
    if(result.reason!=='session-changed') {
      this.failures.delete(job.memberId);
      this.failures.set(job.memberId,{reason:result.reason,at:this.now()});
      this.trim(this.failures);
    }
    job.resolve(this.failure(job.memberId,result.reason,this.cached(job.memberId)));
  }

  private async fetch(job:PendingProfile):Promise<ProfileFetchResult> {
    const signal=job.controller.signal;
    if(signal.aborted) return {ok:false,reason:'session-changed'};
    let onAbort!:()=>void;
    const cancelled=new Promise<ProfileFetchResult>(resolve=>{onAbort=()=>resolve({ok:false,reason:'session-changed'});signal.addEventListener('abort',onAbort,{once:true});});
    try {
      const result=await Promise.race([Promise.resolve().then(()=>this.fetchOne(job.memberId,signal)),cancelled]);
      if(!result || typeof result!=='object' || typeof result.ok!=='boolean') return {ok:false,reason:'invalid-response'};
      if(!result.ok && !['timeout','network','http','verification','signed-out','invalid-response','session-changed'].includes(result.reason)) return {ok:false,reason:'invalid-response'};
      return result;
    } catch {
      return {ok:false,reason:signal.aborted?'session-changed':'network'};
    } finally {signal.removeEventListener('abort',onAbort);}
  }

  private retryable(result:Extract<ProfileFetchResult,{ok:false}>):boolean {
    return result.reason==='network' || result.reason==='timeout' || (result.reason==='http' && (result.httpStatus??0)>=500 && (result.httpStatus??0)<=599);
  }

  private backoff(signal:AbortSignal):Promise<void> {
    if(signal.aborted) return Promise.resolve();
    return new Promise(resolve=>{
      const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
      const timer=setTimeout(finish,this.retryDelayMs);
      signal.addEventListener('abort',finish,{once:true});
    });
  }

  private success(cached:CachedProfile):UserProfileOutcome {
    return {memberId:cached.profile.memberId,status:'ready',profile:{...cached.profile},fetchedAt:new Date(cached.fetchedAt).toISOString()};
  }

  private failure(memberId:number,reason:UserProfileFailure,cached?:CachedProfile):UserProfileOutcome {
    return cached?{memberId,status:'stale',profile:{...cached.profile},reason,fetchedAt:new Date(cached.fetchedAt).toISOString()}:{memberId,status:'failed',reason};
  }

  private trim<T>(cache:Map<number,T>):void {
    while(cache.size>cacheLimit) cache.delete(cache.keys().next().value!);
  }

  private copyProfile(profile:UserProfileMetadata,memberId:number):UserProfileMetadata|undefined {
    if(!profile || profile.memberId!==memberId) return undefined;
    const copy:UserProfileMetadata={memberId};
    if(Number.isSafeInteger(profile.level) && Number(profile.level)>=0) {
      copy.level=profile.level;
      if(profile.levelSource==='rank' || profile.levelSource==='points') copy.levelSource=profile.levelSource;
    }
    if(typeof profile.role==='string' && profile.role.trim()) copy.role=profile.role.trim();
    if(typeof profile.signature==='string' && profile.signature.trim()) copy.signature=profile.signature.trim().slice(0,10000);
    if(typeof profile.following==='boolean') copy.following=profile.following;
    if(typeof profile.joinedAt==='string' && Number.isFinite(Date.parse(profile.joinedAt))) copy.joinedAt=profile.joinedAt;
    if(Number.isSafeInteger(profile.joinedDays) && Number(profile.joinedDays)>=0) copy.joinedDays=profile.joinedDays;
    return copy;
  }
}

/** Keep this browser program standalone, including when the host is bundled. */
const fetchProfileInPage=String.raw`async (memberId,expectedUid)=>{
  const fail=(reason,httpStatus)=>({ok:false,reason,...(httpStatus===undefined?{}:{httpStatus})});
  const ownerCheck=()=>{
    if(location.protocol!=='https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) return 'invalid-response';
    if(/just a moment|attention required|cloudflare/i.test(document.title) || document.querySelector('#challenge-form, #cf-challenge-running, .cf-browser-verification')) return 'verification';
    const config=globalThis.__config__;
    if(!config || !Object.prototype.hasOwnProperty.call(config,'user')) return 'invalid-response';
    const user=config.user;
    let owner;
    if(user!==null) {
      const raw=user?.member_id;
      if((typeof raw!=='number' && typeof raw!=='string') || String(raw).trim()==='' || !Number.isSafeInteger(Number(raw)) || Number(raw)<=0) return 'invalid-response';
      owner=Number(raw);
    }
    if(expectedUid!==undefined && owner===undefined) return 'signed-out';
    if(owner!==expectedUid) return 'session-changed';
    return undefined;
  };
  const before=ownerCheck();
  if(before) return fail(before);
  const controller=new AbortController();
  let timer;
  try {
    const request=(async()=>{
      const response=await fetch('/api/account/getInfo/'+memberId,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
      const after=ownerCheck();
      if(after) return fail(after);
      if(response.status===401) return fail('signed-out',401);
      if(response.status===403 || /text\/html/i.test(response.headers.get('content-type')??'')) return fail('verification',response.status);
      if(!response.ok) return fail('http',response.status);
      let body;
      try {body=await response.json();} catch {return fail('invalid-response');}
      const afterJson=ownerCheck();
      if(afterJson) return fail(afterJson);
      if(!body || typeof body!=='object') return fail('invalid-response');
      const result=body;
      if(result.success!==true || !result.detail || typeof result.detail!=='object' || Array.isArray(result.detail)) return fail('invalid-response');
      const detail=result.detail;
      if(detail.member_id!==undefined && Number(detail.member_id)!==memberId) return fail('invalid-response');
      const profile={memberId};
      const numeric=(value)=>{
        if((typeof value!=='number' && typeof value!=='string') || String(value).trim()==='') return undefined;
        const number=Number(value);
        return Number.isFinite(number) && number>=0?number:undefined;
      };
      const rank=numeric(detail.rank),coin=numeric(detail.coin);
      if(rank!==undefined && Number.isSafeInteger(rank)) {profile.level=rank;profile.levelSource='rank';}
      else if(coin!==undefined) {profile.level=Math.min(6,Math.floor(Math.sqrt(coin)/10));profile.levelSource='points';}
      if(Array.isArray(detail.roles)) {
        const role=detail.roles.map(value=>value && typeof value==='object' && typeof value.display_text==='string' ? value.display_text.trim():'').filter(Boolean).join(' · ');
        if(role) profile.role=role;
      }
      if(typeof detail.followed==='boolean') profile.following=detail.followed;
      const signature=typeof detail.signature_markdown==='string'&&detail.signature_markdown.trim()?detail.signature_markdown:detail.bio;
      if(typeof signature==='string'&&signature.trim())profile.signature=signature.trim().slice(0,10000);
      if((typeof detail.created_at==='string' && detail.created_at.trim()) || (typeof detail.created_at==='number' && Number.isFinite(detail.created_at))) {
        const joined=new Date(detail.created_at).getTime();
        if(Number.isFinite(joined)) {profile.joinedAt=new Date(joined).toISOString();profile.joinedDays=Math.max(0,Math.floor((Date.now()-joined)/86_400_000));}
      }
      return {ok:true,profile};
    })();
    const deadline=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve(fail('timeout'));},10_000);});
    const result=await Promise.race([request,deadline]);
    const after=ownerCheck();
    return after?fail(after):result;
  } catch {
    const after=ownerCheck();
    return fail(after??(controller.signal.aborted?'timeout':'network'));
  } finally {if(timer!==undefined) clearTimeout(timer);}
}`;

export function createUserProfileScript(memberId:number,expectedUid?:number):string {
  if(!validMemberId(memberId) || (expectedUid!==undefined && !validMemberId(expectedUid))) throw new Error('无效的用户 ID');
  return `(${fetchProfileInPage})(${memberId},${expectedUid===undefined?'undefined':expectedUid})`;
}
