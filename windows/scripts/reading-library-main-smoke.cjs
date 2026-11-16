'use strict';

// Production main/preload/storage with inert HTTPS fixtures. No library IPC or
// account guard is replaced, and no real forum request or user profile is used.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const output=path.join(project,'verification','reading-library-main');
const profile=path.join(project,'.test-data',`reading-library-main-${Date.now()}-${process.pid}`);
const report={scope:'Real compiled Electron main, sandboxed preload, owner checks and reading-library.json; isolated synthetic users; fixture HTTP(S) only.',checks:[],errors:[]};
let instance,page;
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function until(predicate,message){const end=Date.now()+12000;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,40));}throw Error(message);}

function entryProgram(fixture){
  const {app,session,net}=require('electron');
  globalThis.fetch=(input,options)=>net.fetch(input,options);
  const state={identity:'unknown',requests:0,writes:0};globalThis.__libraryFixture=state;
  const library=require(fixture.library),originalMutation=library.ReadingLibraryStore.prototype.mutate;
  library.ReadingLibraryStore.prototype.mutate=async function(owner,request){
    const result=await originalMutation.call(this,owner,request);
    if(state.holdNextLibraryReturn&&request?.kind==='visit'){
      state.holdNextLibraryReturn=false;state.libraryReturnHeld=true;
      await new Promise(resolve=>{state.releaseLibraryReturn=()=>{state.libraryReturnHeld=false;resolve();};});
    }
    return result;
  };
  const rss='<?xml version="1.0"?><rss><channel><title>Fixture RSS</title><item><title>Public RSS title</title><link>https://www.nodeseek.com/post-910001-1</link><author>Public author</author><category>技术</category><pubDate>Fri, 13 Nov 2026 00:00:00 GMT</pubDate><description>Public summary</description></item></channel></rss>';
  const html=()=>{
    const user=typeof state.identity==='number'?{member_id:state.identity,member_name:'Synthetic '+state.identity,rank:2}:null;
    const config=state.identity==='unknown'?'':'<script>window.__config__='+JSON.stringify({user})+'</script><div id="nsk-head"></div>';
    return '<!doctype html><meta charset="utf-8"><title>'+(state.identity==='verification'?'Just a moment':'Library fixture')+'</title>'+config+'<div id="nsk-body-left"><ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-910001-1">Public RSS title</a></div><div class="info-author"><a href="/space/77">Public author</a></div><a class="post-category" href="/categories/tech">技术</a></li></ul></div>';
  };
  app.whenReady().then(()=>{
    session.defaultSession.protocol.handle('file',()=>new Response('<!doctype html><meta charset="utf-8"><title>Library boundary QA</title><main>Library boundary QA</main>',{headers:{'content-type':'text/html'}}));
    const route=request=>{
      state.requests++;
      if(!['GET','HEAD'].includes(request.method)){state.writes++;return new Response('Fixture disallows writes',{status:405});}
      const url=new URL(request.url);
      if(url.hostname==='rss.nodeseek.com')return new Response(state.rssId?rss.replaceAll('910001',String(state.rssId)):rss,{headers:{'content-type':'application/rss+xml'}});
      if(['www.nodeseek.com','nodeseek.com'].includes(url.hostname)){
        if(url.pathname.startsWith('/avatar/'))return new Response(Buffer.from(fixture.png,'base64'),{headers:{'content-type':'image/png'}});
        return new Response(html(),{headers:{'content-type':'text/html; charset=utf-8'}});
      }
      return new Response('No remote network in library QA',{status:404});
    };
    for(const partition of [undefined,'persist:nodeseek','public-rss','persist:calculator']){
      const current=partition?session.fromPartition(partition):session.defaultSession;current.protocol.handle('https',route);current.protocol.handle('http',route);
    }
  });
  require(fixture.main);
}

async function launch(){
  const entry=path.join(profile,'entry.cjs');
  await fs.writeFile(entry,`(${entryProgram.toString()})(${JSON.stringify({main:path.join(project,'dist-electron/electron/main.js'),library:path.join(project,'dist-electron/electron/reading-library.js'),png:(await fs.readFile(path.join(project,'build/icon.png'))).toString('base64')})});\n`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  instance=await _electron.launch({executablePath:require('electron'),args:[entry,'--host-resolver-rules=MAP * ~NOTFOUND'],env,timeout:45000});
  page=await instance.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForFunction(()=>Boolean(window.seekdesk?.readReadingLibrary));
}
async function identify(value){
  await instance.evaluate((_electron,value)=>{globalThis.__libraryFixture.identity=value;},value);
  await page.evaluate(url=>window.seekdesk.openOfficial(url),'https://www.nodeseek.com/?fixture='+Date.now());
  await until(async()=>{const account=await page.evaluate(()=>window.seekdesk.checkAccount());return value===null?account.status==='signed-out':value==='verification'?account.status==='verification':account.status==='signed-in'&&account.id===value;},'Synthetic identity did not settle');
  await page.evaluate(()=>window.seekdesk.closeOfficial());
}
const read=owner=>page.evaluate(owner=>window.seekdesk.readReadingLibrary(owner),owner);
const mutate=(request,owner)=>page.evaluate(({request,owner})=>window.seekdesk.mutateReadingLibrary(request,owner),{request,owner});
const post=(id,title='Same private title',pageNumber=1)=>({id:String(id),url:`https://www.nodeseek.com/post-${id}-${pageNumber}#7`,title,author:'Synthetic author',category:'tech',published:'2026-11-14T00:00:00Z',summary:'DO_NOT_RETAIN_BODY',apiKey:'DO_NOT_RETAIN_KEY',avatar:'https://example.invalid/avatar'});

(async()=>{
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings:{theme:'light',uiFontSize:16,fontSize:18,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'rss'},workspace:{tabs:[],activeId:null}}));
  await launch();
  assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).account.status,'unknown');
  assert.deepEqual(await read(),{bookmarks:[],history:[]});
  await page.evaluate(()=>window.seekdesk.listPosts({}));
  const publicResult=await mutate({kind:'bookmark-add',post:post(910001,'FORGED_PRIVATE_TITLE',2)});
  assert.equal(publicResult.bookmarks[0].post.title,'Public RSS title');
  assert.equal(publicResult.bookmarks[0].post.category,'技术');
  assert.equal(publicResult.bookmarks[0].post.url,'https://www.nodeseek.com/post-910001-2#7');
  assert.equal(publicResult.bookmarks[0].post.summary,'');
  assert.equal(publicResult.bookmarks[0].post.apiKey,undefined);
  const publicAgain=await mutate({kind:'bookmark-add',post:post(910001,'FORGED_PRIVATE_TITLE_AGAIN',1)});
  assert.equal(publicAgain.bookmarks.length,1);assert.equal(publicAgain.bookmarks[0].post.url,'https://www.nodeseek.com/post-910001-2#7');
  await instance.evaluate(()=>{const state=globalThis.__libraryFixture;state.rssId=910002;state.realNow=Date.now;Date.now=()=>state.realNow()+120000;});
  try{assert.equal((await page.evaluate(()=>window.seekdesk.listPosts({}))).posts[0].id,'910002');}
  finally{await instance.evaluate(()=>{Date.now=globalThis.__libraryFixture.realNow;delete globalThis.__libraryFixture.realNow;});}
  const retainedPublic=await mutate({kind:'bookmark-add',post:post(910001,'FORGED_AFTER_FEED_REFRESH',4)});
  assert.equal(retainedPublic.bookmarks.length,1);assert.equal(retainedPublic.bookmarks[0].post.url,'https://www.nodeseek.com/post-910001-2#7');
  await assert.rejects(mutate({kind:'visit',post:post(999999,'UNKNOWN_PRIVATE_TITLE')}),/会话尚未确认/);
  await assert.rejects(mutate({kind:'bookmark-add',post:post(999999,'UNKNOWN_PRIVATE_TITLE')}),/会话尚未确认/);
  await assert.rejects(read(42),/会话尚未确认|会话已变化/);
  check('An unconfirmed RSS guest can use public records but cannot forge private metadata or access a user scope');
  await identify('verification');
  assert.equal((await read()).bookmarks[0].post.title,'Public RSS title');
  await assert.rejects(mutate({kind:'bookmark-add',post:post(999999,'VERIFICATION_PRIVATE_TITLE')}),/会话尚未确认/);
  await assert.rejects(read(42),/会话尚未确认|会话已变化/);

  await identify(42);
  await mutate({kind:'bookmark-add',post:post(930001,'PRIVATE_OWNER_A',2)},42);
  await mutate({kind:'bookmark-add',post:post(930002,'PRIVATE_OWNER_A',3)},42);
  await mutate({kind:'visit',post:post(930001,'PRIVATE_OWNER_A',1)},42);
  await mutate({kind:'bookmark-add',post:post(930001,'PRIVATE_OWNER_A',1)},42);
  const a=await read(42);assert.equal(a.bookmarks.length,2);assert.equal(a.history.length,1);
  assert.deepEqual(a.bookmarks.map(entry=>entry.post.id).sort(),['930001','930002']);
  assert.equal(a.bookmarks.find(entry=>entry.post.id==='930001').post.url,'https://www.nodeseek.com/post-930001-2#7');
  assert.equal(a.history[0].post.url,'https://www.nodeseek.com/post-930001-1#7');
  assert.ok(a.bookmarks.every(entry=>entry.post.summary===''&&entry.post.apiKey===undefined&&entry.post.avatar===undefined));
  await assert.rejects(read(84),/会话尚未确认|会话已变化/);
  await assert.rejects(mutate({kind:'clear-bookmarks'},84),/会话尚未确认|会话已变化/);
  assert.equal((await read(42)).bookmarks.length,2);
  check('Authoritative user scopes retain same-title different IDs and fixed bookmark positions despite later visits or repeated add, while rejecting a forged owner');

  await instance.evaluate(()=>{globalThis.__libraryFixture.holdNextLibraryReturn=true;});
  const late=mutate({kind:'visit',post:post(930001,'PRIVATE_OWNER_A',1)},42).then(value=>({value}),error=>({error}));
  await until(()=>instance.evaluate(()=>globalThis.__libraryFixture.libraryReturnHeld===true),'The local mutation response was not held');
  await identify(84);
  await instance.evaluate(()=>globalThis.__libraryFixture.releaseLibraryReturn());
  const discarded=await late;assert.match(discarded.error?.message||'',/会话已变化/);
  assert.deepEqual(await read(84),{bookmarks:[],history:[]});
  await assert.rejects(read(42),/会话尚未确认|会话已变化/);
  await mutate({kind:'bookmark-toggle',post:post(940001,'PRIVATE_OWNER_B')},84);
  assert.ok(!JSON.stringify(await read(84)).includes('PRIVATE_OWNER_A'));
  await identify(null);const guest=await read();assert.equal(guest.bookmarks.length,1);assert.equal(guest.bookmarks[0].post.id,'910001');assert.ok(!JSON.stringify(guest).includes('PRIVATE_OWNER_'));
  await assert.rejects(read(42),/会话尚未确认|会话已变化/);
  check('Switching from user A to B and public mode discards late old-owner results and never exposes another account’s records');

  assert.equal((await instance.evaluate(()=>globalThis.__libraryFixture.writes)),0);
  await instance.close();instance=undefined;await launch();
  assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).account.status,'unknown');
  await assert.rejects(read(42),/会话尚未确认|会话已变化/);
  assert.ok(!JSON.stringify(await read()).includes('PRIVATE_OWNER_'));
  await identify(42);const restored=await read(42);assert.equal(restored.bookmarks.length,2);assert.equal(restored.history.length,1);
  assert.equal(restored.bookmarks.find(entry=>entry.post.id==='930001').post.url,'https://www.nodeseek.com/post-930001-2#7');
  check('A restart restores local records only after the matching synthetic identity is established');
  assert.equal((await instance.evaluate(()=>globalThis.__libraryFixture.writes)),0);assert.deepEqual(report.errors,[]);
  check('The real sandboxed bridge and local storage use no real forum writes or renderer exceptions');
  report.status='pass';
})().catch(error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{if(instance)await instance.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
