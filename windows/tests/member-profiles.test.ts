import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {MemberProfilesService,createUserProfileScript,type ProfileFetchResult} from '../electron/member-profiles';

const ready=(memberId:number,level=4):ProfileFetchResult=>({ok:true,profile:{memberId,level,levelSource:'rank',following:false}});
const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
function deferred<T>() {let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

test('all twelve authors finish with a global limit of three and duplicate UID reads share work',async()=>{
  let active=0,maxActive=0;const calls:number[]=[];
  const service=new MemberProfilesService(async memberId=>{
    calls.push(memberId);active++;maxActive=Math.max(maxActive,active);
    await new Promise(resolve=>setTimeout(resolve,4));active--;return ready(memberId);
  });
  try {
    const [all,duplicate]=await Promise.all([service.read({memberIds:Array.from({length:12},(_,i)=>i+1)}),service.read({memberIds:[1,1,2]})]);
    assert.equal(all.complete,true);assert.equal(all.outcomes.length,12);
    assert.ok(all.outcomes.every(outcome=>outcome.status==='ready' && outcome.profile?.level===4));
    assert.deepEqual(calls.sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i+1));
    assert.equal(maxActive,3);assert.deepEqual(duplicate.outcomes.map(outcome=>outcome.memberId),[1,1,2]);
  } finally {service.dispose();}
});

test('a valid profile remains eligible after the old 1.5 second deadline',async()=>{
  const service=new MemberProfilesService(async memberId=>{await new Promise(resolve=>setTimeout(resolve,1550));return ready(memberId,6);});
  try {const result=await service.read({memberIds:[77]});assert.equal(result.outcomes[0].status,'ready');assert.equal(result.outcomes[0].profile?.level,6);} finally {service.dispose();}
});

test('oversized or invalid input is rejected without silently dropping any requested author',async()=>{
  let calls=0;const service=new MemberProfilesService(async memberId=>{calls++;return ready(memberId);});
  try {
    await assert.rejects(service.read({memberIds:Array.from({length:33},(_,i)=>i+1)}),/32/);
    for(const memberIds of [[0],[-1],[1.5],[NaN]]) await assert.rejects(service.read({memberIds}),/ID/);
    assert.equal(calls,0);assert.deepEqual(await service.read({memberIds:[]}),{outcomes:[],complete:true});
  } finally {service.dispose();}
});

test('success cache lasts three minutes, expires, and returned objects cannot mutate the cache',async()=>{
  let now=1_000,calls=0;const service=new MemberProfilesService(async memberId=>ready(memberId,++calls),{now:()=>now});
  try {
    const first=await service.read({memberIds:[1]});first.outcomes[0].profile!.level=99;
    now+=179_999;assert.equal((await service.read({memberIds:[1]})).outcomes[0].profile?.level,1);assert.equal(calls,1);
    now++;assert.equal((await service.read({memberIds:[1]})).outcomes[0].profile?.level,2);assert.equal(calls,2);
    const copy=service.get(1)!;copy.following=true;assert.equal(service.get(1)?.following,false);
  } finally {service.dispose();}
});

test('successful profile LRU retains only 240 and refreshes recency on cache reads',async()=>{
  const calls=new Map<number,number>();const service=new MemberProfilesService(async memberId=>{calls.set(memberId,(calls.get(memberId)??0)+1);return ready(memberId);});
  try {
    for(let start=1;start<=240;start+=30) await service.read({memberIds:Array.from({length:30},(_,i)=>i+start)});
    await service.read({memberIds:[1]});await service.read({memberIds:[241]});
    assert.equal(service.get(2),undefined);assert.equal(service.get(1)?.level,4);
    await service.read({memberIds:[2]});assert.equal(calls.get(2),2);
  } finally {service.dispose();}
});

test('transient network, timeout and server failures retry once; other failures do not',async()=>{
  for(const reason of ['network','timeout','http','verification','signed-out','invalid-response'] as const) {
    let calls=0;const service=new MemberProfilesService(async memberId=>{calls++;return calls===1?{ok:false,reason,...(reason==='http'?{httpStatus:503}:{})}:ready(memberId);},{retryDelayMs:0});
    try {
      const outcome=(await service.read({memberIds:[1]})).outcomes[0];
      const transient=['network','timeout','http'].includes(reason);
      assert.equal(calls,transient?2:1);assert.equal(outcome.status,transient?'ready':'failed');
    } finally {service.dispose();}
  }
  let calls=0;const service=new MemberProfilesService(async()=>{calls++;return {ok:false,reason:'http',httpStatus:404};},{retryDelayMs:0});
  try {await service.read({memberIds:[1]});assert.equal(calls,1);} finally {service.dispose();}
});

test('failure has a short negative cache and force explicitly retries it',async()=>{
  let now=0,calls=0;const service=new MemberProfilesService(async memberId=>{calls++;return calls<3?{ok:false,reason:'verification'}:ready(memberId);},{now:()=>now});
  try {
    assert.equal((await service.read({memberIds:[1]})).outcomes[0].status,'failed');
    now=9_999;await service.read({memberIds:[1]});assert.equal(calls,1);
    await service.read({memberIds:[1],force:true});assert.equal(calls,2);
    now+=10_000;assert.equal((await service.read({memberIds:[1]})).outcomes[0].status,'ready');assert.equal(calls,3);
  } finally {service.dispose();}
});

test('failed refresh preserves a stale known profile while force also bypasses fresh success',async()=>{
  let now=100,calls=0;const service=new MemberProfilesService(async memberId=>{calls++;return calls===2?{ok:false,reason:'verification'}:ready(memberId,calls);},{now:()=>now});
  try {
    const first=(await service.read({memberIds:[7]})).outcomes[0];
    const stale=(await service.read({memberIds:[7],force:true})).outcomes[0];
    assert.equal(stale.status,'stale');assert.equal(stale.reason,'verification');assert.equal(stale.profile?.level,1);assert.equal(stale.fetchedAt,first.fetchedAt);
    assert.equal((await service.read({memberIds:[7]})).outcomes[0].status,'stale');assert.equal(calls,2);
    now+=180_001;await service.read({memberIds:[7]});assert.equal(calls,3);
  } finally {service.dispose();}
});

test('scope change resolves old active and queued callers, aborts transports and discards late responses',async()=>{
  const old=deferred<ProfileFetchResult>();const signals:AbortSignal[]=[];const calls:number[]=[];
  const service=new MemberProfilesService(async(memberId,signal)=>{calls.push(memberId);signals.push(signal);return memberId<=4?old.promise:ready(memberId);});
  try {
    service.resetScope(1);const before=service.read({memberIds:[1,2,3,4]});await tick();
    service.resetScope(2);const cancelled=await before;
    assert.ok(cancelled.outcomes.every(outcome=>outcome.status==='failed' && outcome.reason==='session-changed'));
    assert.ok(signals.every(signal=>signal.aborted));assert.deepEqual(calls,[1,2,3]);
    const next=await service.read({memberIds:[5]});assert.equal(next.outcomes[0].status,'ready');
    old.resolve(ready(1,99));await tick();assert.equal(service.get(1),undefined);assert.equal(service.get(5)?.level,4);
  } finally {old.resolve(ready(1));service.dispose();}
});

test('account changes clear cached profiles, negative cache and optimistic following state',async()=>{
  let calls=0;const service=new MemberProfilesService(async memberId=>{calls++;return memberId===2?{ok:false,reason:'signed-out'}:ready(memberId);});
  try {
    service.resetScope(1);await service.read({memberIds:[1,2]});service.updateFollowing(1,true);
    assert.equal(service.get(1)?.following,true);service.resetScope(2);assert.equal(service.get(1),undefined);
    const outcome=(await service.read({memberIds:[1,2]})).outcomes[0];assert.equal(outcome.profile?.following,false);assert.equal(calls,4);
  } finally {service.dispose();}
});

test('a profile request started before a successful following write cannot undo the write',async()=>{
  const response=deferred<ProfileFetchResult>();const service=new MemberProfilesService(()=>response.promise);
  try {
    const pending=service.read({memberIds:[9]});await tick();service.updateFollowing(9,true);response.resolve(ready(9));
    assert.equal((await pending).outcomes[0].profile?.following,true);assert.equal(service.get(9)?.following,true);
    service.updateFollowing(9,false);assert.equal(service.get(9)?.following,false);
  } finally {service.dispose();}
});

test('a failed transport is never exposed as a ready empty profile and invalid IDs are not cached',async()=>{
  let calls=0;const service=new MemberProfilesService(async()=>{calls++;return calls===1?{ok:true,profile:{memberId:999,level:9}}:{ok:false,reason:'invalid-response'};});
  try {
    const result=await service.read({memberIds:[1]});assert.equal(result.outcomes[0].status,'failed');assert.equal(result.outcomes[0].reason,'invalid-response');assert.equal(result.outcomes[0].profile,undefined);assert.equal(service.get(1),undefined);
  } finally {service.dispose();}
});

test('an unstructured transport response fails cleanly instead of stranding the queued read',async()=>{
  const service=new MemberProfilesService(async()=>undefined as unknown as ProfileFetchResult);
  try {const outcome=(await service.read({memberIds:[1]})).outcomes[0];assert.equal(outcome.status,'failed');assert.equal(outcome.reason,'invalid-response');} finally {service.dispose();}
});

function fixture(detail:unknown,owner:number|null=42) {
  const page=new JSDOM('<title>NodeSeek</title>',{url:'https://www.nodeseek.com/',runScripts:'outside-only'});
  const win=page.window as unknown as Window & {__config__:unknown;fetch:typeof fetch};
  win.__config__={user:owner===null?null:{member_id:owner}};
  (win as unknown as {AbortController:typeof AbortController}).AbortController=AbortController;
  const calls:{url:string;options:RequestInit}[]=[];
  win.fetch=async(url,options)=>{calls.push({url:String(url),options:options??{}});return {ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({success:true,detail})} as unknown as Response;};
  return {page,win,calls,read:()=>page.window.eval(createUserProfileScript(7,owner===null?undefined:owner)) as Promise<ProfileFetchResult>};
}

test('browser fetch uses a fixed same-origin GET, copies only required profile fields and prefers true rank',async()=>{
  const f=fixture({member_id:7,rank:4,coin:999999,roles:[{display_text:' 管理员 '},{display_text:'贡献者'},{display_text:123}],followed:true,created_at:'2020-01-01T00:00:00Z',cookie:'secret',bio:'Public signature'});
  try {
    const result=await f.read();assert.equal(result.ok,true);if(!result.ok) return;
    assert.equal(result.profile.level,4);assert.equal(result.profile.levelSource,'rank');assert.equal(result.profile.role,'管理员 · 贡献者');assert.equal(result.profile.following,true);assert.ok(result.profile.joinedDays!>2000);
    assert.deepEqual(Object.keys(result.profile).sort(),['following','joinedAt','joinedDays','level','levelSource','memberId','role','signature'].sort());
    assert.equal(result.profile.signature,'Public signature');
    assert.equal(f.calls[0].url,'/api/account/getInfo/7');assert.equal(f.calls[0].options.method,undefined);
    assert.equal(f.calls[0].options.credentials,'same-origin');assert.equal(f.calls[0].options.redirect,'error');assert.equal(f.calls[0].options.cache,'no-store');
  } finally {f.page.window.close();}
});

test('points fallback follows Pro formula, respects the level cap, and never invents missing zero points',async()=>{
  for(const [detail,level,source] of [
    [{rank:null,coin:2500},5,'points'],[{coin:1_000_000},6,'points'],[{coin:0},0,'points'],
    [{coin:null},undefined,undefined],[{},undefined,undefined],[{rank:'',coin:''},undefined,undefined],
    [{rank:3.5,coin:900},3,'points'],[{rank:0,coin:10000},0,'rank'],[{coin:-1},undefined,undefined],
  ] as const) {
    const f=fixture(detail);try {const result=await f.read();assert.equal(result.ok,true);if(result.ok){assert.equal(result.profile.level,level);assert.equal(result.profile.levelSource,source);}} finally {f.page.window.close();}
  }
});

test('public profile signatures prefer dedicated markdown, fall back to bio, and remain bounded',async()=>{
  for(const [detail,expected] of [
    [{signature_markdown:' [Website](https://example.com) ',bio:'old'},'[Website](https://example.com)'],
    [{signature_markdown:'  ',bio:' Plain signature '},'Plain signature'],
    [{signature_markdown:'x'.repeat(11000)},'x'.repeat(10000)],
    [{bio:null},undefined],
  ] as const){const f=fixture(detail);try{const result=await f.read();assert.equal(result.ok,true);if(result.ok)assert.equal(result.profile.signature,expected);}finally{f.page.window.close();}}
});

test('browser profile read rejects owner changes before fetching and after JSON completion',async()=>{
  const before=fixture({rank:4});try {
    before.win.__config__={user:{member_id:99}};assert.deepEqual(JSON.parse(JSON.stringify(await before.read())),{ok:false,reason:'session-changed'});assert.equal(before.calls.length,0);
  } finally {before.page.window.close();}
  const after=fixture({rank:4});try {
    after.win.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>{after.win.__config__={user:{member_id:99}};return {success:true,detail:{rank:4}};}} as unknown as Response);
    const result=await after.read();assert.equal(result.ok,false);if(!result.ok) assert.equal(result.reason,'session-changed');
  } finally {after.page.window.close();}
});

test('browser read accepts a stable signed-out owner and omits invalid registration timestamps',async()=>{
  const f=fixture({rank:2,created_at:'not a timestamp'},null);
  try {const result=await f.read();assert.equal(result.ok,true);if(result.ok){assert.equal(result.profile.level,2);assert.equal(result.profile.joinedAt,undefined);assert.equal(result.profile.joinedDays,undefined);}} finally {f.page.window.close();}
});

test('browser read classifies login, verification, bad JSON, wrong user and HTTP failures',async()=>{
  for(const [status,contentType,body,reason] of [
    [401,'application/json',{},'signed-out'],[403,'text/html',{},'verification'],[503,'application/json',{},'http'],
    [200,'text/html',{},'verification'],[200,'application/json',{success:true,detail:{member_id:99}},'invalid-response'],
    [200,'application/json',{success:false,detail:{}},'invalid-response'],
  ] as const) {
    const f=fixture({});try {
      f.win.fetch=async()=>({ok:status===200,status,headers:{get:()=>contentType},json:async()=>body} as unknown as Response);
      const result=await f.read();assert.equal(result.ok,false);if(!result.ok) assert.equal(result.reason,reason);
    } finally {f.page.window.close();}
  }
  const f=fixture({});try {f.win.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},json:async()=>{throw new SyntaxError('bad json');}} as unknown as Response);const result=await f.read();assert.equal(result.ok,false);if(!result.ok) assert.equal(result.reason,'invalid-response');} finally {f.page.window.close();}
});

test('the ten second deadline covers JSON decoding as well as the fetch request',async()=>{
  const f=fixture({});let aborted=false,deadlineMs=0;
  try {
    (f.win as unknown as {setTimeout:typeof setTimeout}).setTimeout=((handler:()=>void,ms:number)=>{deadlineMs=ms;return setTimeout(handler,5);}) as typeof setTimeout;
    f.win.fetch=async(_url,options)=>{options?.signal?.addEventListener('abort',()=>{aborted=true;});return {ok:true,status:200,headers:{get:()=>null},json:()=>new Promise(()=>{})} as unknown as Response;};
    const result=await f.read();assert.equal(result.ok,false);if(!result.ok) assert.equal(result.reason,'timeout');assert.equal(deadlineMs,10000);assert.equal(aborted,true);
  } finally {f.page.window.close();}
});
