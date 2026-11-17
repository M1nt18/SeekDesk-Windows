/* Timed production IPC with isolated synthetic pages; no login or live writes. */
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const profile=path.join(project,'.test-data','reading-performance-'+Date.now());
const record=process.argv.includes('--record');
const report={testedAt:new Date().toISOString(),scope:'Compiled main and real sandboxed preload; delayed synthetic images and account APIs, isolated userData, no live requests or writes.',timings:{},checks:[]};
let app,page;
async function measure(name,fn){const start=performance.now();const result=await fn();report.timings[name]=Math.round(performance.now()-start);return result;}
const post=id=>({id:String(id),url:'https://www.nodeseek.com/post-'+id+'-1',title:'Performance fixture',author:'',category:'',published:'',summary:''});
(async()=>{
  await fs.mkdir(profile,{recursive:true});
  const entry=path.join(profile,'entry.cjs');
  await fs.writeFile(entry,`
const {app,session}=require('electron');
const state=globalThis.__performanceFixture={owner:42,revision:1,imageDelay:2200,cssDelay:0,apiDelay:0,apiStarted:false,apiFailure:false,writes:0,loads:[],requests:[]};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
function html(url){const id=Number(new URL(url).pathname.match(/post-(\\d+)-/)?.[1]);return '<!doctype html><meta charset=utf-8><title>Performance fixture</title><script>window.__config__='+JSON.stringify({user:{member_id:state.owner,member_name:'Synthetic owner'},commmentPerPage:20})+'</script><link rel=stylesheet href=/fixture.css><div id=nsk-head></div><div id=nsk-body-left>'+(id?'<div class=nsk-post-wrapper><h1><a class=post-title-link>Performance fixture</a></h1><div class=content-item id=0><div class=nsk-content-meta-info><a class=author-name href=/space/42>Synthetic owner</a></div><div class=post-content><p>Fresh body '+id+' revision '+state.revision+'</p><p class=restricted>HIDDEN_SENTINEL</p><img src=/slow-image.png></div></div></div>':'<ul class=post-list><li class=post-list-item><div class=post-title><a href=/post-123-1>Performance fixture</a></div></li></ul>')+'</div>';}
app.on('web-contents-created',(_event,contents)=>{let current;contents.on('did-start-navigation',(_e,url,_inPlace,isMainFrame)=>{if(isMainFrame&&url.startsWith('https:')){current={path:new URL(url).pathname,start:Date.now()};state.loads.push(current);}});contents.on('dom-ready',()=>{if(current)current.domMs=Date.now()-current.start;});contents.on('did-finish-load',()=>{if(current)current.loadMs=Date.now()-current.start;});});
app.whenReady().then(()=>{
session.defaultSession.protocol.handle('file',()=>new Response('<!doctype html><title>Performance IPC fixture</title>',{headers:{'content-type':'text/html'}}));
session.fromPartition('persist:nodeseek').protocol.handle('https',async request=>{
const url=new URL(request.url);state.requests.push(url.pathname);if(request.method!=='GET'){state.writes++;return new Response('Forbidden',{status:405});}
if(!['www.nodeseek.com','nodeseek.com'].includes(url.hostname))return new Response('No live requests',{status:404});
if(url.pathname==='/slow-image.png'){await pause(state.imageDelay);return new Response(png,{headers:{'content-type':'image/png'}});}
if(url.pathname==='/fixture.css'){await pause(state.cssDelay);return new Response('.restricted{display:none}',{headers:{'content-type':'text/css'}});}
if(url.pathname.startsWith('/api/account/getInfo/')){state.apiStarted=true;await pause(state.apiDelay);if(state.apiFailure)return json({success:false,message:'暂时无法连接 NodeSeek，请稍后重试'});const id=Number(url.pathname.split('/').pop());return json({success:true,detail:{member_id:id,member_name:'Synthetic '+id,rank:3,coin:20,roles:[]}});}
if(url.pathname==='/api/notification/unread-count')return json({success:true,unreadCount:{atMe:0,reply:0,message:0}});
return new Response(html(url.href),{headers:{'content-type':'text/html; charset=utf-8'}});
});});
require(${JSON.stringify(path.join(project,'dist-electron/electron/main.js'))});
`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[entry],env,timeout:45000});
  page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.seekdesk?.readThread));
  const account=await page.evaluate(()=>window.seekdesk.checkAccount());assert.equal(account.id,42);
  for(const id of [123,124]){
    const result=await measure('slowImageThread'+id,()=>page.evaluate(post=>window.seekdesk.readThread(post),post(id)));
    assert.equal(result.source,'web');assert.match(result.comments[0].html,new RegExp('Fresh body '+id));assert.doesNotMatch(result.comments[0].html,/HIDDEN_SENTINEL/);assert.match(result.comments[0].html,/slow-image\.png/);
  }
  await app.evaluate(()=>{globalThis.__performanceFixture.revision=2;});
  const refreshed=await measure('sameUrlRefresh',()=>page.evaluate(post=>window.seekdesk.readThread(post),post(124)));
  assert.equal(refreshed.source,'web');assert.match(refreshed.comments[0].html,/revision 2/);
  report.checks.push('Refreshing the same URL during unfinished image loads fetches a new document');
  await app.evaluate(()=>{globalThis.__performanceFixture.imageDelay=0;globalThis.__performanceFixture.apiDelay=1800;globalThis.__performanceFixture.apiStarted=false;});
  const background=page.evaluate(()=>window.seekdesk.queryForum({kind:'account'}));
  for(let i=0;i<100;i++){if(await app.evaluate(()=>globalThis.__performanceFixture.apiStarted))break;await page.waitForTimeout(20);}
  assert.ok(await app.evaluate(()=>globalThis.__performanceFixture.apiStarted));
  const foreground=await measure('threadDuringBackgroundAccount',()=>page.evaluate(post=>window.seekdesk.readThread(post),post(125)));
  assert.equal(foreground.source,'web');assert.match(foreground.comments[0].html,/Fresh body 125/);
  assert.equal((await background).profile.id,42);
  await app.evaluate(()=>{globalThis.__performanceFixture.apiDelay=0;globalThis.__performanceFixture.apiFailure=true;});
  await assert.rejects(page.evaluate(()=>window.seekdesk.queryForum({kind:'account'})),/连接/);
  await app.evaluate(()=>{globalThis.__performanceFixture.apiFailure=false;});
  const retry=await page.evaluate(post=>window.seekdesk.readThread(post),post(126));assert.equal(retry.source,'web');
  report.checks.push('A transient API connection error does not impose a global 60 second cooldown');
  const beforeProfiles=await app.evaluate(()=>globalThis.__performanceFixture.loads.filter(row=>row.path.startsWith('/post-')).length);
  const profiles=await page.evaluate(()=>window.seekdesk.readUserProfiles({memberIds:[77,88]}));
  assert.equal(profiles.outcomes.length,2);assert.ok(profiles.outcomes.every(row=>row.status==='ready'&&row.profile.level===3));
  assert.equal(await app.evaluate(()=>globalThis.__performanceFixture.loads.filter(row=>row.path.startsWith('/post-')).length),beforeProfiles);
  report.checks.push('Author levels reuse the serialized API context without loading another copy of the article');
  await app.evaluate(()=>{globalThis.__performanceFixture.cssDelay=350;});
  const styled=await measure('delayedStylesThread',()=>page.evaluate(post=>window.seekdesk.readThread(post),post(127)));
  assert.equal(styled.source,'web');assert.doesNotMatch(styled.comments[0].html,/HIDDEN_SENTINEL/);
  assert.ok(report.timings.delayedStylesThread>=300);
  report.checks.push('Extraction waits for late stylesheet visibility rules even when DOM-ready has already fired');
  await app.evaluate(()=>{globalThis.__performanceFixture.cssDelay=0;});
  await app.evaluate(()=>{globalThis.__performanceFixture.owner=84;});
  await assert.rejects(page.evaluate(()=>window.seekdesk.queryForum({kind:'account'})),/会话已变更/);
  assert.equal((await page.evaluate(()=>window.seekdesk.checkAccount())).id,84);
  assert.equal((await page.evaluate(()=>window.seekdesk.queryForum({kind:'account'}))).profile.id,84);
  report.checks.push('A fresh identity check rejects the previous owner before returning any account data');
  report.fixture=await app.evaluate(()=>globalThis.__performanceFixture);
  assert.equal(report.fixture.writes,0);
  report.checks.push('Correct fresh post, media URL, stylesheet-hidden restrictions, account owner, no writes');
  if(!record){for(const name of ['slowImageThread123','slowImageThread124','threadDuringBackgroundAccount'])assert.ok(report.timings[name]<1200,name+' must not wait for unrelated 1.8–2.2 second work: '+report.timings[name]+'ms');}
  report.status='pass';console.log(JSON.stringify(report,null,2));
})().catch(error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{
  if(app)await app.close().catch(()=>{});
  const output=path.join(project,'verification');await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'reading-performance'+(record?'-baseline':'')+'.json'),JSON.stringify(report,null,2));
});
