import Decimal from 'decimal.js';
import type {AccountState, Post} from '../shared/types';
import type {AttendanceResult, ExchangeRates, ExtensionId, ExtensionsState, KeywordHit, RankingItem, RankingPeriod, RankingResult, RemainingValueInput, RulingRecord, RulingsResult} from '../shared/parity';
import {FORUM_ORIGIN, normalizePostUrl, parseRss, RSS_URL} from './forum';
import {calculateRemaining, supportedCurrencies} from './value-calculator';

export const extensionIds: ExtensionId[] = ['hot','attendance','office','value','block','authorOnly','keywords','rulings'];
type PersistentState = ExtensionsState & {watchHistory?: {terms:string[];ids:string[]}; attendanceOwner?:number};
export function defaultExtensions(): ExtensionsState {
  return {installed:['hot'],enabled:['hot'],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作计划',officeButton:'切换办公视图',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0};
}
const normalized = (text: string) => text.normalize('NFKC').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase().trim();
export function keywordGroups(words: string): string[][] {
  const groups = words.slice(0,10000).split(/[,，、;；\n]/).map(group => [...new Set(group.split(/[+＋]/).map(normalized).filter(Boolean))].sort()).filter(group => group.length);
  return [...new Map(groups.map(group => [group.join('+'),group])).values()].sort((a,b) => a.join('+').localeCompare(b.join('+'))).slice(0,25);
}
export function matchingWords(post: Post, groups: string[][]): string[] {
  const haystack = normalized(`${post.title}\n${post.summary.replace(/<[^>]*>/g,' ')}`);
  return [...new Set(groups.filter(group => group.every(word => haystack.includes(word))).flat())];
}
export function isBlocked(state: ExtensionsState, authorId: number | undefined, name: string): boolean {
  if (!state.enabled.includes('block')) return false;
  return state.blocked.some(block => authorId && block.memberId ? authorId === block.memberId : !!normalized(name) && normalized(block.name) === normalized(name));
}
export function sanitizeExtensions(input: Partial<PersistentState> | undefined): PersistentState {
  const defaults=defaultExtensions(), source=input || defaults;
  const installed=extensionIds.filter(id => (Array.isArray(source.installed)?source.installed:defaults.installed).includes(id));
  const enabled=installed.filter(id => (Array.isArray(source.enabled)?source.enabled:defaults.enabled).includes(id));
  return {...defaults,...source,installed,enabled,attendanceMode:source.attendanceMode==='random'?'random':'fixed',
    hotDefaultPeriod:['realtime','daily','weekly'].includes(String(source.hotDefaultPeriod))?source.hotDefaultPeriod!:defaults.hotDefaultPeriod,
    hotSidebarCount:Number.isInteger(source.hotSidebarCount)?Math.min(30,Math.max(5,source.hotSidebarCount!)):defaults.hotSidebarCount,
    hotRefreshSeconds:Number.isInteger(source.hotRefreshSeconds)?Math.min(1800,Math.max(60,source.hotRefreshSeconds!)):defaults.hotRefreshSeconds,
    hotShowScore:typeof source.hotShowScore==='boolean'?source.hotShowScore:defaults.hotShowScore,
    autoAttendance:!!source.autoAttendance && enabled.includes('attendance'),
    officeTitle:typeof source.officeTitle==='string'?source.officeTitle.trim().slice(0,60)||defaults.officeTitle:defaults.officeTitle,
    officeButton:typeof source.officeButton==='string'?source.officeButton.trim().slice(0,60)||defaults.officeButton:defaults.officeButton,
    officeKey:typeof source.officeKey==='string' && /^[a-z0-9]$/i.test(source.officeKey)?source.officeKey.toUpperCase():'9',
    watchWords:typeof source.watchWords==='string'?source.watchWords.slice(0,10000):'',watchNote:typeof source.watchNote==='string'?source.watchNote.slice(0,500):'',
    watchSystemNotifications:!!source.watchSystemNotifications && enabled.includes('keywords'),authorOnly:!!source.authorOnly && enabled.includes('authorOnly'),
    blocked:Array.isArray(source.blocked)?source.blocked.filter(b => b && typeof b.name==='string' && b.name.trim()).map(b => ({name:b.name.trim().slice(0,200),...(Number.isSafeInteger(b.memberId) && b.memberId!>0?{memberId:b.memberId}:{})})).slice(0,1000):[],
    hits:Array.isArray(source.hits)?source.hits.filter(hit=>hit?.post?.id && Array.isArray(hit.words)).slice(0,60):[],unread:Math.min(60,Math.max(0,Number(source.unread)||0)),
    ...(source.watchHistory && Array.isArray(source.watchHistory.terms) && Array.isArray(source.watchHistory.ids)?{watchHistory:{terms:source.watchHistory.terms.slice(0,25),ids:source.watchHistory.ids.filter(id=>typeof id==='string').slice(-1000)}}:{}),
  };
}
export function beijingDay(now: number): string {return new Date(now+8*3600000).toISOString().slice(0,10);}
export function nextBeijingMidnight(now: number): number {return Date.parse(beijingDay(now)+'T00:00:00+08:00')+86400000;}
export function retryAfter(value: string | null, now: number, fallback = 60000): number {
  if (!value) return fallback;
  const seconds=Number(value), delay=Number.isFinite(seconds)?seconds*1000:Date.parse(value)-now;
  return Number.isFinite(delay)?Math.min(86400000,Math.max(1000,delay)):fallback;
}
export interface ExtensionHooks {
  fetchPublic?:(url:string,init?:RequestInit)=>Promise<Response>;
  readAttendance?:()=>Promise<AttendanceResult>;
  performAttendance?:(mode:'fixed'|'random')=>Promise<AttendanceResult>;
  getAccount?:()=>AccountState;
  onChange?:(state:ExtensionsState)=>void;
  onMatch?:(hit:KeywordHit)=>void;
  onBossKey?:(enabled:boolean,state:ExtensionsState)=>void;
  now?:()=>number;
  setTimeout?:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;
  clearTimeout?:(timer:ReturnType<typeof setTimeout>)=>void;
}
interface RateSnapshot {rates:Record<string,Decimal>;time:number;source:string;url:string}

export class ExtensionsService {
  private state:PersistentState;
  private disposed=false;
  private epoch=0;
  private watchTimer?:ReturnType<typeof setTimeout>;
  private attendanceTimer?:ReturnType<typeof setTimeout>;
  private watchPending=false;
  private attendancePending?:Promise<AttendanceResult>;
  private etag=''; private modified=''; private watchFailures=0;
  private rankingCache=new Map<RankingPeriod,RankingResult>();
  private rankingPending=new Map<RankingPeriod,Promise<RankingResult>>();
  private rulingCache=new Map<string,{at:number;value:RulingsResult}>();
  private rulingPending=new Map<string,Promise<RulingsResult>>();
  private rulingCooldown=0;
  private market?:RateSnapshot; private hourly?:RateSnapshot;
  private marketAttempts:number[]=[]; private hourlyAttempt=-Infinity;
  private ratesPending?:Promise<void>;
  constructor(initial:ExtensionsState=defaultExtensions(),private hooks:ExtensionHooks={}) {
    this.state=sanitizeExtensions(initial); this.restart();
  }
  private now=()=>this.hooks.now?.()??Date.now();
  private schedule(fn:()=>void,ms:number) {const timer=(this.hooks.setTimeout||setTimeout)(fn,Math.min(2147483647,Math.max(1000,ms)));timer.unref?.();return timer;}
  private clear(timer:ReturnType<typeof setTimeout>|undefined) {if(timer)(this.hooks.clearTimeout||clearTimeout)(timer);}
  private emit() {if(!this.disposed)this.hooks.onChange?.(this.getState());}
  getState():ExtensionsState {return structuredClone(this.state);}
  update(input:ExtensionsState):ExtensionsState {
    const previous=this.state, next=sanitizeExtensions(input);
    // Hits and dedupe history are owned by the poller. The UI may acknowledge unread.
    next.hits=previous.hits;next.watchHistory=previous.watchHistory;
    next.unread=input.unread===0?0:previous.unread;
    next.lastCheck=previous.lastCheck;next.watchError=previous.watchError;
    next.attendance=previous.attendance;next.attendanceOwner=previous.attendanceOwner;
    const changed=JSON.stringify(keywordGroups(next.watchWords))!==JSON.stringify(keywordGroups(previous.watchWords));
    if(changed){next.watchHistory=undefined;next.hits=[];next.unread=0;this.etag='';this.modified='';}
    this.state=next;this.restart();this.emit();return this.getState();
  }
  private active(id:ExtensionId) {return this.state.installed.includes(id)&&this.state.enabled.includes(id);}
  private restart() {
    this.epoch++;this.clear(this.watchTimer);this.clear(this.attendanceTimer);
    this.hooks.onBossKey?.(this.active('office'),this.getState());
    if(this.active('keywords')&&keywordGroups(this.state.watchWords).length)this.watchTimer=this.schedule(()=>void this.pollKeywords(),1000);
    if(this.active('attendance')&&this.state.autoAttendance)this.attendanceTimer=this.schedule(()=>void this.attend(this.state.attendanceMode,true).catch(()=>{}),1000);
  }
  accountChanged() {this.clear(this.attendanceTimer);if(this.active('attendance')&&this.state.autoAttendance)this.attendanceTimer=this.schedule(()=>void this.attend(this.state.attendanceMode,true).catch(()=>{}),1000);}
  dispose() {this.disposed=true;this.epoch++;this.clear(this.watchTimer);this.clear(this.attendanceTimer);this.hooks.onBossKey?.(false,this.getState());}
  private async request(url:string,init:RequestInit={}):Promise<Response> {
    if(this.disposed)throw new Error('扩展已停止。');
    return (this.hooks.fetchPublic||fetch)(url,{...init,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)});
  }
  private async body(response:Response,max=524288):Promise<string> {
    if(Number(response.headers.get('content-length'))>max)throw new Error('扩展服务响应超过大小限制。');
    if(!response.body)return '';
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];let length=0;
    try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max)throw new Error('扩展服务响应超过大小限制。');chunks.push(value);}}
    finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    return Buffer.concat(chunks).toString('utf8');
  }
  async rankings(period:RankingPeriod,force=false):Promise<RankingResult> {
    if(!['realtime','daily','weekly'].includes(period))throw new Error('热榜周期无效。');
    const cached=this.rankingCache.get(period),interval=this.state.hotRefreshSeconds*1000;
    if(!force&&cached&&this.now()-Date.parse(cached.fetchedAt)<interval)return this.filteredRanking(cached);
    const pending=this.rankingPending.get(period);if(pending)return pending;
    const task=(async()=>{
      try {
        const response=await this.request(`https://api.bimg.eu.org/${period==='realtime'?'hot':period}.json`);
        if(!response.ok)throw new Error(`热榜服务返回 HTTP ${response.status}。`);
        const json=JSON.parse(await this.body(response));if(!Array.isArray(json.posts))throw new Error('热榜数据格式无效。');
        const seen=new Set<string>(),items:RankingItem[]=[];
        for(const [index,row] of json.posts.slice(0,500).entries()) {
          const post=row?.post,id=String(post?.id??'');if(!/^[1-9]\d{0,14}$/.test(id)||typeof post.title!=='string'||seen.has(id))continue;
          seen.add(id);items.push({id,url:`${FORUM_ORIGIN}/post-${id}-1`,title:post.title.slice(0,1000),author:String(post.author||'').slice(0,200),category:String(post.category||''),position:index+1,
            ...(Number.isFinite(Number(row.score))?{score:Number(row.score)}:{}),...(Number.isFinite(Number(post.views))?{views:Number(post.views)}:{}),...(Number.isFinite(Number(post.comments))?{comments:Number(post.comments)}:{}),...(Number.isSafeInteger(post.author_id)?{authorId:post.author_id}:{})});
        }
        const value={period,items,fetchedAt:new Date(this.now()).toISOString(),nextRefresh:new Date(this.now()+interval).toISOString()};this.rankingCache.set(period,value);return this.filteredRanking(value);
      }catch(error){if(cached)return {...this.filteredRanking(cached),error:error instanceof Error?error.message:String(error)};throw error;}
    })().finally(()=>this.rankingPending.delete(period));this.rankingPending.set(period,task);return task;
  }
  private filteredRanking(result:RankingResult):RankingResult {return {...result,items:result.items.filter(item=>!isBlocked(this.state,(item as RankingItem&{authorId?:number}).authorId,item.author))};}
  async pollKeywords():Promise<void> {
    if(this.disposed||this.watchPending||!this.active('keywords'))return;
    const groups=keywordGroups(this.state.watchWords);if(!groups.length)return;
    this.clear(this.watchTimer);this.watchTimer=undefined;
    const epoch=this.epoch,terms=groups.map(group=>group.join('+'));this.watchPending=true;let delay=10000;
    try {
      const headers:Record<string,string>={};if(this.etag)headers['If-None-Match']=this.etag;if(this.modified)headers['If-Modified-Since']=this.modified;
      const response=await this.request(RSS_URL,{headers});
      if(response.status===429||response.status===503){delay=retryAfter(response.headers.get('retry-after'),this.now());throw new Error(`RSS 暂时限流，${Math.ceil(delay/1000)} 秒后重试。`);}
      if(response.status!==304&&!response.ok)throw new Error(`RSS 返回 HTTP ${response.status}。`);
      const posts=response.status===304?[]:parseRss(await this.body(response,2000000));
      if(this.disposed||epoch!==this.epoch)return;
      this.etag=response.headers.get('etag')||this.etag;this.modified=response.headers.get('last-modified')||this.modified;
      const history=this.state.watchHistory&&JSON.stringify(this.state.watchHistory.terms)===JSON.stringify(terms)?this.state.watchHistory:{terms,ids:[]};
      const seen=new Set(history.ids),hits:KeywordHit[]=[];
      for(const post of posts){if(seen.has(post.id))continue;seen.add(post.id);if(isBlocked(this.state,post.authorId,post.author))continue;const words=matchingWords(post,groups);if(words.length)hits.push({post,words,date:new Date(this.now()).toISOString()});}
      this.state.watchHistory={terms,ids:[...seen].slice(-1000)};this.state.hits=[...hits,...this.state.hits].slice(0,60);this.state.unread=Math.min(60,this.state.unread+hits.length);
      this.state.lastCheck=new Date(this.now()).toISOString();this.state.watchError=undefined;this.watchFailures=0;
      this.emit();for(const hit of hits)this.hooks.onMatch?.(hit);
    }catch(error){if(epoch===this.epoch&&!this.disposed){this.state.watchError=error instanceof Error?error.message:String(error);this.emit();if(delay===10000)delay=Math.min(120000,10000*2**Math.min(4,++this.watchFailures));}}
    finally {this.watchPending=false;if(!this.disposed&&epoch===this.epoch&&this.active('keywords')&&keywordGroups(this.state.watchWords).length)this.watchTimer=this.schedule(()=>void this.pollKeywords(),delay);}
  }
  async attend(mode:'fixed'|'random'=this.state.attendanceMode,automatic=false):Promise<AttendanceResult> {
    if(this.attendancePending)return this.attendancePending;
    this.clear(this.attendanceTimer);this.attendanceTimer=undefined;
    const account=this.hooks.getAccount?.(), owner=account?.id, day=beijingDay(this.now()),configuredMode=this.state.attendanceMode;
    if(account?.status!=='signed-in'||!owner){const result:AttendanceResult=account?.status==='verification'?{kind:'verification',message:'请先在官方窗口完成站点验证。'}:{kind:'signedOut',message:'请先通过官方窗口登录。'};this.scheduleAttendance(result);return result;}
    if(!this.active('attendance'))throw new Error('请先安装并启用签到扩展。');
    if(this.state.attendanceOwner===owner&&this.state.attendance?.date===day&&['completed','alreadyCompleted'].includes(this.state.attendance.kind)){this.scheduleAttendance(this.state.attendance);return this.state.attendance;}
    const current=()=>{const latest=this.hooks.getAccount?.();return !this.disposed&&this.active('attendance')&&(!automatic||this.state.autoAttendance)&&latest?.status==='signed-in'&&latest.id===owner&&beijingDay(this.now())===day&&this.state.attendanceMode===configuredMode;};
    const task=(async():Promise<AttendanceResult>=>{
      let result:AttendanceResult|undefined;
      try {result=await this.hooks.readAttendance?.()||{kind:'ready'};if(!current())return {kind:'failed',message:'账号、日期或签到设置已改变，请重新检查。'};
        if(result.kind==='ready')result=await this.hooks.performAttendance?.(mode)||{kind:'failed',message:'签到服务不可用。'};
        if(!current())return {kind:'failed',message:'账号、日期或签到设置已改变，请重新检查。'};
        this.state.attendance={...result,date:day};this.state.attendanceOwner=owner;this.emit();return this.state.attendance;
      }catch(error){const message=error instanceof Error?error.message:String(error);result={kind:/验证|challenge/i.test(message)?'verification':/未登录|请.{0,8}登录|登录.{0,8}失效/i.test(message)?'signedOut':'failed',message};if(current()){this.state.attendance=result;this.emit();}return result;}
      finally {this.scheduleAttendance(current()?result:undefined);}
    })().finally(()=>{this.attendancePending=undefined;});this.attendancePending=task;return task;
  }
  private scheduleAttendance(result:AttendanceResult|undefined) {
    if(this.disposed||!this.state.autoAttendance||!this.active('attendance'))return;
    const delay=result&&['completed','alreadyCompleted'].includes(result.kind)?nextBeijingMidnight(this.now())-this.now():result?.kind==='verification'?1800000:result?600000:3000;
    this.clear(this.attendanceTimer);this.attendanceTimer=this.schedule(()=>void this.attend(this.state.attendanceMode,true).catch(()=>{}),delay);
  }
  async rulings(memberId:number,username:string):Promise<RulingsResult> {
    const name=username?.trim();if(!name||Buffer.byteLength(name,'utf8')>256)throw new Error('查询裁决记录需要有效用户名。');
    const cached=this.rulingCache.get(name);if(cached&&this.now()-cached.at<120000)return {...cached.value,memberId};
    const pending=this.rulingPending.get(name);if(pending)return pending;
    if(this.now()<this.rulingCooldown)throw new Error(`裁决服务限流，请 ${Math.ceil((this.rulingCooldown-this.now())/1000)} 秒后重试。`);
    const task=(async()=>{
      const url=`https://api.xxboxx.de/api/seek?username=${encodeURIComponent(name)}&limit=200`,response=await this.request(url);
      const raw=await this.body(response);let json:any;try{json=JSON.parse(raw);}catch{if(response.status!==429)throw new Error('裁决服务返回了无法识别的数据。');json={};}
      if(response.status===429||json.error==='rate_limited'){this.rulingCooldown=this.now()+retryAfter(json.retry_after!=null?String(json.retry_after):response.headers.get('retry-after'),this.now());throw new Error('裁决服务请求过于频繁，请稍后重试。');}
      if(!response.ok||json.ok!==true||!Array.isArray(json.rows))throw new Error(typeof json.error==='string'?json.error:'裁决记录获取失败。');
      const records:RulingRecord[]=json.rows.slice(0,200).flatMap((row:any)=>{
        if(row?.record_id==null)return [];
        const action=convertRulingTimes(String(row.actions_text||'')),points=Number(row.action_points_delta),category=row.action_category==='punish'||points<0?'处罚':row.action_category==='reward'||points>0?'奖励':'管理';
        let postUrl:string|undefined;try{postUrl=normalizePostUrl(new URL(String(row.post_url||''),FORUM_ORIGIN).href);}catch{}
        return [{id:String(row.record_id),date:action.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)?.[0]||'',action:`${category}${action?' · '+action:''}`,reason:String(row.reason_text||''),...(postUrl?{url:postUrl}:{})}];
      });
      const value={memberId,records,source:url,fetchedAt:new Date(this.now()).toISOString()};this.rulingCache.delete(name);this.rulingCache.set(name,{at:this.now(),value});while(this.rulingCache.size>32)this.rulingCache.delete(this.rulingCache.keys().next().value!);return value;
    })().finally(()=>this.rulingPending.delete(name));this.rulingPending.set(name,task);return task;
  }
  calculate(input:RemainingValueInput) {return calculateRemaining(input);}
  async exchangeRates(base:string,force=false):Promise<ExchangeRates> {
    base=base.toUpperCase();if(!supportedCurrencies.has(base))throw new Error('不支持该币种。');
    if(!this.ratesPending)this.ratesPending=this.refreshRates(force,base).finally(()=>{this.ratesPending=undefined;});await this.ratesPending;
    // A simultaneous request may have refreshed a currency absent from this request's pair.
    if(!this.market?.rates[base]&&!this.hourly?.rates[base]){if(!this.ratesPending)this.ratesPending=this.refreshRates(force,base).finally(()=>{this.ratesPending=undefined;});await this.ratesPending;}
    const now=this.now(),valid=(s:RateSnapshot|undefined)=>s&&now-s.time<=7*86400000&&s.time<=now+300000&&s.rates[base];
    const candidates=[this.market,this.hourly].filter(valid) as RateSnapshot[];
    const best=this.market&&valid(this.market)&&now-this.market.time<=300000?this.market:candidates.sort((a,b)=>b.time-a.time)[0];
    if(!best)throw new Error('当前无法获取有效汇率，请填写手动汇率。');
    const rates:Record<string,number>={};for(const [currency,rate] of Object.entries(best.rates))rates[currency]=rate.div(best.rates[base]).toNumber();
    return {base,rates,fetchedAt:new Date(best.time).toISOString(),source:best.source};
  }
  private async refreshRates(force:boolean,base:string) {
    const now=this.now();this.marketAttempts=this.marketAttempts.filter(at=>now-at<3600000);
    if(this.marketAttempts.length<3&&(!this.marketAttempts.length||now-this.marketAttempts.at(-1)!>=(force?20000:300000))){
      this.marketAttempts.push(now);
      try{const response=await this.request('https://www.live-rates.com/rates');if(!response.ok)throw new Error();const json=JSON.parse(await this.body(response));this.market=parseMarketRates(json,now);}catch{/* Retain a still-valid quote before trying the hourly source. */}
    }
    if(this.market?.rates[base]&&now-this.market.time<=300000)return;
    if(now-this.hourlyAttempt>=(force?60000:1200000)){
      this.hourlyAttempt=now;
      try{const response=await this.request('https://api.exchangerate.fun/latest?base=USD');if(!response.ok)throw new Error();this.hourly=parseHourlyRates(JSON.parse(await this.body(response)),now);}catch{/* A stale but valid quote remains usable for seven days. */}
    }
  }
}
export function convertRulingTimes(input:string):string {
  return input.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)\b/gi,(all,month,day,year,hour,minute,second,ap)=>{
    const h=Number(hour);if(h<1||h>12)return all;const utc=Date.UTC(Number(year),Number(month)-1,Number(day),(h%12)+(ap.toUpperCase()==='PM'?12:0),Number(minute),Number(second));
    if(!Number.isFinite(utc))return all;return new Date(utc+28800000).toISOString().slice(0,19).replace('T',' ')+'（北京时间）';
  });
}
function validQuoteTime(time:number,now:number) {return Number.isFinite(time)&&time<=now+300000&&now-time<=7*86400000;}
export function parseMarketRates(json:unknown,now:number):RateSnapshot {
  if(!Array.isArray(json))throw new Error('市场汇率格式无效。');
  const graph=new Map<string,{to:string;rate:Decimal;time:number}[]>();
  for(const row of json){const pair=String(row?.currency||'').toUpperCase().split('/');if(pair.length!==2||!pair.every(code=>supportedCurrencies.has(code)))continue;
    try{const bid=new Decimal(row.bid),ask=new Decimal(row.ask),time=Number(row.timestamp);if(!bid.isFinite()||!ask.isFinite()||!bid.isPositive()||ask.lt(bid)||!validQuoteTime(time,now))continue;
      const rate=bid.plus(ask).div(2);graph.set(pair[0],[...(graph.get(pair[0])||[]),{to:pair[1],rate,time}]);graph.set(pair[1],[...(graph.get(pair[1])||[]),{to:pair[0],rate:new Decimal(1).div(rate),time}]);
    }catch{}}
  const rates:Record<string,Decimal>={USD:new Decimal(1)},times:Record<string,number>={USD:now},queue=['USD'];
  while(queue.length){const from=queue.shift()!;for(const edge of graph.get(from)||[]){if(rates[edge.to])continue;rates[edge.to]=rates[from].mul(edge.rate);times[edge.to]=Math.min(times[from],edge.time);queue.push(edge.to);}}
  if(Object.keys(rates).length<2)throw new Error('市场没有有效的美元交叉汇率。');
  return {rates,time:Math.min(...Object.values(times)),source:'Live-Rates 市场中间价',url:'https://www.live-rates.com/rates'};
}
export function parseHourlyRates(json:any,now:number):RateSnapshot {
  const time=Number(json?.timestamp)*1000;if(json?.base!=='USD'||!validQuoteTime(time,now)||!json.rates||typeof json.rates!=='object')throw new Error('小时汇率格式无效。');
  const rates:Record<string,Decimal>={USD:new Decimal(1)};
  for(const [code,value] of Object.entries(json.rates)){if(!supportedCurrencies.has(code))continue;try{const rate=new Decimal(String(value));if(rate.isFinite()&&rate.isPositive())rates[code]=rate;}catch{}}
  if(Object.keys(rates).length<2)throw new Error('没有可用汇率。');return {rates,time,source:'ExchangeRate.fun 小时参考汇率',url:'https://api.exchangerate.fun/latest?base=USD'};
}
