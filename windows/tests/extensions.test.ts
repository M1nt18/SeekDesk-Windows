import test from 'node:test';
import assert from 'node:assert/strict';
import type {AccountState,Post} from '../shared/types';
import type {AttendanceResult} from '../shared/parity';
import {beijingDay,convertRulingTimes,defaultExtensions,ExtensionsService,isBlocked,keywordGroups,matchingWords,nextBeijingMidnight,parseHourlyRates,parseMarketRates,retryAfter,sanitizeExtensions} from '../electron/extensions';

const now=Date.parse('2026-11-11T00:00:00Z');
function timers(){const pending=new Map<number,{fn:()=>void,ms:number}>();let id=0;return {pending,setTimeout:(fn:()=>void,ms:number)=>{pending.set(++id,{fn,ms});return id as unknown as ReturnType<typeof setTimeout>;},clearTimeout:(timer:ReturnType<typeof setTimeout>)=>{pending.delete(timer as unknown as number);}};}
function enabledState(ids:('keywords'|'attendance'|'office'|'block')[]) {const state=defaultExtensions();state.installed.push(...ids);state.enabled.push(...ids);return state;}
function rss(ids:string[],title='便宜 VPS'){return `<?xml version="1.0"?><rss version="2.0"><channel><title>NodeSeek</title>${ids.map(id=>`<item><title>${title}</title><link>https://www.nodeseek.com/post-${id}-1</link><author>Alice</author><description>东京 机房</description></item>`).join('')}</channel></rss>`;}
const json=(value:unknown,init?:ResponseInit)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'},...init});

test('all eight extensions have original defaults; disabled block does not hide members',()=>{
  assert.deepEqual(defaultExtensions().installed,['hot']);assert.deepEqual(sanitizeExtensions(undefined).enabled,['hot']);
  const state=enabledState(['block']);state.blocked=[{memberId:12,name:'Alice'}];
  assert.equal(isBlocked(state,12,'changed'),true);assert.equal(isBlocked(state,13,'Alice'),false);assert.equal(isBlocked(state,undefined,'ＡＬＩＣＥ'),true);
  state.enabled=[];assert.equal(isBlocked(state,12,'Alice'),false);
});
test('keyword rules use normalized AND groups and OR alternatives, deduplicate groups',()=>{
  const groups=keywordGroups('ＶＰＳ＋东京， cheap + US; VPS+东京\n日本');
  assert.equal(groups.length,3);
  const post:Post={id:'1',url:'',title:'日本 VPS',author:'',category:'',published:'',summary:'<p>东京 机房</p>'};
  assert.deepEqual(matchingWords(post,keywordGroups('vps+东京,不存在')),['vps','东京']);
  assert.equal(keywordGroups(Array.from({length:40},(_,i)=>'word'+i).join(',')).length,25);
});
test('RSS monitor uses conditional requests, persisted dedupe, unread acknowledgement and stops on disable',async()=>{
  const clock=timers(),state=enabledState(['keywords']);state.watchWords='VPS+东京';
  const requests:RequestInit[]=[],hits:string[]=[];let calls=0;
  const service=new ExtensionsService(state,{...clock,now:()=>now,fetchPublic:async(_url,init)=>{requests.push(init!);calls++;return calls===2?new Response(null,{status:304}):new Response(rss(['101','102']),{headers:{etag:'"rss-1"','last-modified':'Wed, 11 Nov 2026 00:00:00 GMT'}});},onMatch:hit=>hits.push(hit.post.id)});
  await service.pollKeywords();assert.deepEqual(hits,['101','102']);assert.equal(service.getState().unread,2);
  await service.pollKeywords();assert.equal(requests[1].credentials,'omit');assert.equal((requests[1].headers as Record<string,string>)['If-None-Match'],'"rss-1"');
  const saved=service.getState();saved.unread=0;service.update(saved);assert.equal(service.getState().unread,0);
  await service.pollKeywords();assert.deepEqual(hits,['101','102']);
  const disabled=service.getState();disabled.enabled=[];service.update(disabled);assert.equal(clock.pending.size,0);
  await service.pollKeywords();assert.equal(calls,3);service.dispose();
});
test('RSS monitor honors Retry-After and does not publish stale pending results after uninstall',async()=>{
  const clock=timers(),state=enabledState(['keywords']);state.watchWords='VPS';
  let resolve!:(value:Response)=>void;
  const service=new ExtensionsService(state,{...clock,now:()=>now,fetchPublic:()=>new Promise<Response>(done=>resolve=done)});
  const pending=service.pollKeywords();const disabled=service.getState();disabled.installed=['hot'];disabled.enabled=['hot'];service.update(disabled);
  resolve(new Response(rss(['100'])));await pending;assert.equal(service.getState().hits.length,0);assert.equal(clock.pending.size,0);service.dispose();
  const rateLimited=new ExtensionsService(state,{...clock,now:()=>now,fetchPublic:async()=>new Response('',{status:429,headers:{'retry-after':'90'}})});
  await rateLimited.pollKeywords();assert.ok([...clock.pending.values()].some(timer=>timer.ms===90000));rateLimited.dispose();
  assert.equal(retryAfter('Wed, 11 Nov 2026 00:02:00 GMT',now),120000);
});
test('ranking requests deduplicate, preserve original position, filter blocked users and keep stale data on failure',async()=>{
  const state=enabledState(['block']);state.blocked=[{name:'blocked'}];let at=now,calls=0;
  const service=new ExtensionsService(state,{now:()=>at,fetchPublic:async url=>{calls++;assert.match(url,/\/hot\.json$/);if(calls>1)throw new Error('offline');return json({posts:[{post:{id:1,title:'First',author:'blocked'}},{post:{id:2,title:'Second',author:'Alice'},score:42},{post:{id:2,title:'duplicate'}}]});}});
  const [a,b]=await Promise.all([service.rankings('realtime'),service.rankings('realtime')]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.items.length,1);assert.equal(a.items[0].position,2);
  at+=state.hotRefreshSeconds*1000+1;const stale=await service.rankings('realtime');assert.equal(stale.items[0].title,'Second');assert.equal(stale.error,'offline');service.dispose();
});
test('ranking refresh follows saved interval while explicit refresh bypasses the snapshot',async()=>{
  const state=enabledState([]);let at=now,calls=0;
  const service=new ExtensionsService(state,{now:()=>at,fetchPublic:async()=>json({posts:[{post:{id:1,title:'Snapshot '+(++calls),author:'Alice'}}]})});
  await service.rankings('daily');at+=61000;assert.equal((await service.rankings('daily')).items[0].title,'Snapshot 1');
  service.update({...service.getState(),hotRefreshSeconds:60,hotDefaultPeriod:'weekly',hotSidebarCount:20,hotShowScore:true});
  assert.equal((await service.rankings('daily')).items[0].title,'Snapshot 2');
  assert.equal((await service.rankings('daily',true)).items[0].title,'Snapshot 3');
  service.dispose();
});
test('attendance Beijing boundary, duplicate write lock, completed cache and account ownership',async()=>{
  assert.equal(beijingDay(Date.parse('2026-11-10T16:00:00Z')),'2026-11-11');assert.equal(nextBeijingMidnight(now),Date.parse('2026-11-11T16:00:00Z'));
  const state=enabledState(['attendance']);let account:AccountState={status:'signed-in',id:1};let writes=0,resolve!:(value:AttendanceResult)=>void;
  const service=new ExtensionsService(state,{...timers(),now:()=>now,getAccount:()=>account,readAttendance:async()=>({kind:'ready'}),performAttendance:()=>{writes++;return new Promise(done=>resolve=done);}});
  const a=service.attend(),b=service.attend();await Promise.resolve();assert.equal(writes,1);resolve({kind:'completed',gain:5});assert.equal((await a).kind,'completed');assert.equal((await b).kind,'completed');
  await service.attend();assert.equal(writes,1);
  account={status:'signed-in',id:2};const changed=service.attend();await Promise.resolve();account={status:'signed-in',id:3};resolve({kind:'completed',gain:10});assert.equal((await changed).kind,'failed');
  assert.equal(service.getState().attendance?.gain,5);service.dispose();
});
test('attendance checks status before writing and leaves verification to the official window',async()=>{
  let writes=0;const service=new ExtensionsService(enabledState(['attendance']),{...timers(),getAccount:()=>({status:'signed-in',id:1}),readAttendance:async()=>({kind:'verification'}),performAttendance:async()=>{writes++;return {kind:'completed'};}});
  assert.equal((await service.attend()).kind,'verification');assert.equal(writes,0);service.dispose();
});
test('automatic attendance retains the midnight schedule after a manual cached check',async()=>{
  const clock=timers(),state=enabledState(['attendance']);state.autoAttendance=true;
  const service=new ExtensionsService(state,{...clock,now:()=>now,getAccount:()=>({status:'signed-in',id:1}),readAttendance:async()=>({kind:'alreadyCompleted'})});
  await service.attend();assert.equal([...clock.pending.values()][0].ms,nextBeijingMidnight(now)-now);
  await service.attend();assert.equal(clock.pending.size,1);assert.equal([...clock.pending.values()][0].ms,nextBeijingMidnight(now)-now);service.dispose();
});
test('manual attendance uses the selected mode before configuration is saved',async()=>{
  let selected='';const service=new ExtensionsService(enabledState(['attendance']),{...timers(),getAccount:()=>({status:'signed-in',id:1}),readAttendance:async()=>({kind:'ready'}),performAttendance:async mode=>{selected=mode;return {kind:'completed'};}});
  assert.equal((await service.attend('random')).kind,'completed');assert.equal(selected,'random');assert.equal(service.getState().attendanceMode,'fixed');service.dispose();
});
test('turning automatic attendance off during the status read prevents its pending write',async()=>{
  const state=enabledState(['attendance']);state.autoAttendance=true;let writes=0,resolve!:(result:AttendanceResult)=>void;
  const service=new ExtensionsService(state,{...timers(),getAccount:()=>({status:'signed-in',id:1}),readAttendance:()=>new Promise(done=>resolve=done),performAttendance:async()=>{writes++;return {kind:'completed'};}});
  const pending=service.attend('fixed',true),disabled=service.getState();disabled.autoAttendance=false;service.update(disabled);resolve({kind:'ready'});await pending;assert.equal(writes,0);service.dispose();
});
test('official verification errors keep the verification result and thirty-minute retry',async()=>{
  const state=enabledState(['attendance']);state.autoAttendance=true;const clock=timers();
  const service=new ExtensionsService(state,{...clock,getAccount:()=>({status:'signed-in',id:1}),readAttendance:async()=>{throw new Error('官网需要人工验证');}});
  assert.equal((await service.attend()).kind,'verification');assert.equal([...clock.pending.values()][0].ms,1800000);service.dispose();
});
test('rulings use encoded username, restrict post links, convert UTC timestamps and honor global cooldown',async()=>{
  let calls=0;const service=new ExtensionsService(defaultExtensions(),{now:()=>now,fetchPublic:async url=>{calls++;assert.match(url,/username=A%2BB/);return json({ok:true,rows:[{record_id:1,actions_text:'11/10/2026, 8:01:02 PM',reason_text:'test',action_points_delta:-2,post_url:'/post-12-1'},{record_id:2,post_url:'https://evil.example/post-12-1'}]});}});
  const records=(await service.rulings(12,'A+B')).records;assert.match(records[0].action,/处罚.*2026-11-11 04:01:02/);assert.equal(records[1].url,undefined);await service.rulings(12,'A+B');assert.equal(calls,1);service.dispose();
  assert.equal(convertRulingTimes('1/1/2026, 12:00:00 AM'),'2026-01-01 08:00:00（北京时间）');
  const limited=new ExtensionsService(defaultExtensions(),{now:()=>now,fetchPublic:async()=>json({error:'rate_limited',retry_after:60},{status:429})});
  await assert.rejects(limited.rulings(1,'Alice'),/频繁/);await assert.rejects(limited.rulings(2,'Bob'),/60 秒/);limited.dispose();
});
test('exchange quotes validate timestamp and derive inverses and USD cross rates',()=>{
  const market=parseMarketRates([{currency:'USD/CNY',bid:'7.1',ask:'7.3',timestamp:String(now)},{currency:'EUR/USD',bid:'1.1',ask:'1.1',timestamp:String(now-1000)},{currency:'USD/JPY',bid:'-1',ask:'100',timestamp:String(now)}],now);
  assert.equal(market.rates.CNY.toString(),'7.2');assert.equal(market.rates.EUR.toSignificantDigits(10).toString(),'0.9090909091');assert.equal(market.rates.JPY,undefined);assert.equal(market.time,now-1000);
  assert.throws(()=>parseMarketRates([{currency:'USD/CNY',bid:'7',ask:'6',timestamp:now}],now));
  assert.throws(()=>parseHourlyRates({base:'USD',timestamp:(now-8*86400000)/1000,rates:{CNY:7}},now));
});
test('exchange source falls back after market failure and shares quote request limits across currencies',async()=>{
  let marketCalls=0,hourlyCalls=0;
  const service=new ExtensionsService(defaultExtensions(),{now:()=>now,fetchPublic:async url=>{if(url.includes('live-rates')){marketCalls++;throw new Error('offline');}hourlyCalls++;return json({base:'USD',timestamp:now/1000,rates:{USD:1,CNY:'7.2',EUR:'0.9'}});}});
  assert.equal((await service.exchangeRates('EUR')).rates.CNY,8);assert.equal((await service.exchangeRates('CNY')).rates.USD,1/7.2);assert.equal(marketCalls,1);assert.equal(hourlyCalls,1);service.dispose();
});
