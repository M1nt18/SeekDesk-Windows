'use strict';

// Real library IPC and atomic storage, real renderer preparation, inert updater.
// The only held/failing write is this test profile's reading-library.json rename.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..');
const profile=path.join(project,'.test-data',`library-update-flush-${Date.now()}-${process.pid}`);
const output=path.join(project,'verification','library-update-flush');
const version=require('../package.json').version;
const nextVersion=version.split('.').map((part,index)=>Number(part)+(index===2?1:0)).join('.');
const report={scope:'Real main/preload/React, reading-library.json atomic rename and renderer install acknowledgement; independent synthetic profile; inert update bytes; fixture GETs only; no installation, registry or real user data.',checks:[],errors:[]};
let instance,page;
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function until(predicate,message,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(message);}

function fixtureEntry(fixture){
  const {app,session,net,BrowserWindow}=require('electron');
  const {EventEmitter}=require('node:events');
  const fs=require('node:fs');
  const io=require('node:fs/promises');
  const path=require('node:path');
  const {createHash}=require('node:crypto');
  app.getVersion=()=>fixture.version;
  const state=globalThis.__libraryUpdate={owner:42,downloads:0,installs:[],snapshots:[],prepareCalls:0,prepareAcks:0,events:[],forumWrites:0,renameCount:0,renameFailures:0,renameHeld:false,renameMode:null,releaseRename:undefined,mutations:[]};
  const target=path.join(fixture.profile,'reading-library.json');
  const rename=io.rename.bind(io);
  io.rename=async(from,to)=>{
    if(path.resolve(String(to))!==target)return rename(from,to);
    state.renameCount++;
    const mode=state.renameMode;state.renameMode=null;
    if(mode){
      state.events.push({event:'rename-start',label:mode.label});
      if(mode.hold){state.renameHeld=true;await new Promise(resolve=>{state.releaseRename=()=>{state.renameHeld=false;state.releaseRename=undefined;resolve();};});}
      if(mode.fail){state.renameFailures++;state.events.push({event:'rename-failed',label:mode.label});throw Object.assign(new Error('Synthetic test-only library rename failure'),{code:'EACCES'});}
    }
    await rename(from,to);
    state.events.push({event:'rename-saved',label:mode?.label||'ordinary'});
  };
  const library=require(fixture.library),mutate=library.ReadingLibraryStore.prototype.mutate;
  library.ReadingLibraryStore.prototype.mutate=async function(owner,request){
    const record={owner,kind:request?.kind,settled:false};state.mutations.push(record);
    try{return await mutate.call(this,owner,request);}finally{record.settled=true;}
  };
  const payload=Buffer.from('A library-update test payload. It is not an executable.');
  const filename=`SeekDesk-Windows-${fixture.nextVersion}-x64-Setup.exe`;
  const info={version:fixture.nextVersion,files:[{url:filename,sha512:createHash('sha512').update(payload).digest('base64'),size:payload.length}]};
  class NativeFixture extends EventEmitter{
    autoDownload=true;autoInstallOnAppQuit=true;allowPrerelease=true;allowDowngrade=true;disableWebInstaller=false;disableDifferentialDownload=false;
    constructor(cache){super();this.cache=cache;}
    setFeedURL(){}
    async checkForUpdates(){return {updateInfo:info,isUpdateAvailable:true};}
    async downloadUpdate(){state.downloads++;const file=path.join(this.cache,'pending',filename);await io.mkdir(path.dirname(file),{recursive:true});await io.writeFile(file,payload);return [file];}
    async restoreVerifiedDownload(){}
    resetAfterInstallError(){}
    quitAndInstall(...args){
      state.events.push({event:'install',number:state.installs.length+1});state.installs.push(args);
      const snapshot={library:JSON.parse(fs.readFileSync(target,'utf8')),eventIndex:state.events.length-1};state.snapshots.push(snapshot);
      const contents=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).webContents;
      void contents.executeJavaScript('({inert:document.querySelector(".app-shell")?.inert===true,overlay:!!document.querySelector(".update-install-overlay")})').then(dom=>{snapshot.dom=dom;this.emit('error',new Error('Synthetic installer refusal; nothing is launched'));});
    }
  }
  const updater=require(fixture.updater),ActualUpdater=updater.UpdaterService;
  updater.UpdaterService=class extends ActualUpdater{
    constructor(options){const before=options.beforeInstall;super({...options,currentVersion:fixture.version,isPackaged:true,isInstalled:true,automaticCheckDelayMs:3_600_000,installerBusy:async()=>false,nativeFactory:cache=>new NativeFixture(cache),beforeInstall:async()=>{state.prepareCalls++;await before();state.prepareAcks++;}});}
  };
  const listing='<ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-730001-1">资料库更新保存验证</a></div><div class="info-author"><a href="/space/77">合成作者</a></div><a class="post-category" href="/categories/tech">技术</a></li></ul>';
  const thread='<div class="nsk-post-wrapper"><h1><a class="post-title-link">资料库更新保存验证</a></h1><div class="content-item" id="0"><div class="nsk-content-meta-info"><a class="author-name" href="/space/77">合成作者</a></div><article class="post-content"><p>隔离的公开读取夹具，没有真实论坛操作。</p></article></div></div>';
  const document=body=>'<!doctype html><meta charset="utf-8"><title>资料库更新夹具</title><script>window.__config__='+JSON.stringify({user:{member_id:state.owner,member_name:'合成资料库账号',rank:3},postData:{postId:730001,comments:[]}})+';</script><div id="nsk-head"></div><div id="nsk-body-left">'+body+'</div>';
  const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  const route=async request=>{
    const url=new URL(request.url);
    if(!['GET','HEAD'].includes(request.method)){state.forumWrites++;return new Response('All writes forbidden',{status:405});}
    if(url.hostname==='rss.nodeseek.com')return new Response('<rss><channel/></rss>',{headers:{'content-type':'application/rss+xml'}});
    if(['nodeseek.com','www.nodeseek.com'].includes(url.hostname)){
      if(url.pathname.startsWith('/avatar/'))return new Response(Buffer.from(fixture.png,'base64'),{headers:{'content-type':'image/png'}});
      if(url.pathname.startsWith('/api/account/getInfo/'))return json({success:true,detail:{member_id:Number(url.pathname.split('/').pop()),member_name:'合成资料库账号',rank:3,coin:10,nPost:1,nComment:0,roles:[],followed:false}});
      if(url.pathname==='/api/notification/unread-count')return json({success:true,unreadCount:{atMe:0,reply:0,message:0}});
      if(url.pathname.startsWith('/api/'))return json({success:true,data:[],items:[]});
      return new Response(document(url.pathname.startsWith('/post-')?thread:listing),{headers:{'content-type':'text/html; charset=utf-8'}});
    }
    if(url.hostname==='api.bimg.eu.org')return json({posts:[]});
    return new Response('No external network in fixture',{status:404});
  };
  app.whenReady().then(()=>{for(const partition of [undefined,'persist:nodeseek','public-rss','persist:calculator']){const target=partition?session.fromPartition(partition):session.defaultSession;target.protocol.handle('https',route);target.protocol.handle('http',route);}});
  globalThis.fetch=(input,options)=>net.fetch(input,options);
  require(fixture.main);
}

const nativeState=()=>instance.evaluate(()=>{const s=globalThis.__libraryUpdate;return {owner:s.owner,downloads:s.downloads,installs:s.installs,snapshots:s.snapshots,prepareCalls:s.prepareCalls,prepareAcks:s.prepareAcks,events:s.events,forumWrites:s.forumWrites,renameHeld:s.renameHeld,renameFailures:s.renameFailures,mutations:s.mutations};});
const bookmark=(id,title)=>({id:String(id),url:`https://www.nodeseek.com/post-${id}-2#7`,title,author:'合成作者',category:'tech',published:'',summary:''});
const seed=(post,owner=42)=>page.evaluate(({post,owner})=>window.seekdesk.mutateReadingLibrary({kind:'bookmark-add',post},owner),{post,owner});
async function openLibrary(){await page.getByRole('button',{name:'阅读资料库',exact:true}).click();await page.getByTestId('reading-library-panel').waitFor();await page.getByTestId('reading-library-panel').getByRole('button',{name:'本地书签',exact:true}).click();}
async function openAbout(){await page.keyboard.press('Control+,');await page.getByTestId('settings-panel').waitFor();await page.getByRole('button',{name:'关于',exact:true}).click();await page.getByRole('button',{name:'重启更新',exact:true}).waitFor();}
async function backToReader(){const back=page.getByRole('button',{name:'返回论坛',exact:true});if(await back.count())await back.click();await page.getByTestId('post-row').first().waitFor();}
async function arm(mode){await instance.evaluate((_electron,mode)=>{globalThis.__libraryUpdate.renameMode=mode;},mode);}
async function release(){await instance.evaluate(()=>{const s=globalThis.__libraryUpdate;if(!s.releaseRename)throw Error('No held rename');s.releaseRename();});}
async function waitRefusal(installs){await until(async()=>(await nativeState()).snapshots[installs-1]?.dom,'Native observation did not finish');await until(async()=>(await page.evaluate(()=>window.seekdesk.getUpdateState())).errorCode==='install','Synthetic install refusal did not restore retry state');await until(async()=>await page.locator('.app-shell').evaluate(node=>!node.inert),'UI did not unlock');}
async function applyHeld(expectedPrepares,expectedInstalls){const task=page.evaluate(()=>window.seekdesk.applyUpdate());await until(async()=>(await nativeState()).prepareCalls>=expectedPrepares,'Installation preparation did not begin');await until(async()=>await page.locator('.app-shell').evaluate(node=>node.inert),'Preparation did not lock editing');assert.equal((await nativeState()).installs.length,expectedInstalls,'Installer must wait for the pending library write');return {task};}

(async()=>{
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings:{theme:'light',uiFontSize:16,fontSize:18,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'},workspace:{tabs:[],activeId:null,overviewOpen:true}}));
  await fs.writeFile(path.join(profile,'workspace-features.json'),JSON.stringify({appearance:{notificationPolling:false,autoRefresh:false,autoLoadOlder:false},extensions:{installed:[],enabled:[],autoAttendance:false},drafts:{},history:[]}));
  const entry=path.join(profile,'entry.cjs');await fs.writeFile(entry,`(${fixtureEntry.toString()})(${JSON.stringify({main:path.join(project,'dist-electron/electron/main.js'),updater:path.join(project,'dist-electron/electron/updater.js'),library:path.join(project,'dist-electron/electron/reading-library.js'),profile,version,nextVersion,png:(await fs.readFile(path.join(project,'build/icon.png'))).toString('base64')})});\n`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  instance=await _electron.launch({executablePath:require('electron'),args:[entry,'--host-resolver-rules=MAP * ~NOTFOUND'],env,timeout:45000});
  page=await instance.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.locator('.workspace').waitFor();
  await until(async()=>(await page.evaluate(()=>window.seekdesk.bootstrap())).account.id===42,'Fixture identity was not established');
  await page.getByTestId('post-row').first().click();await page.getByTestId('reader-content').first().waitFor();
  await until(async()=>(await page.evaluate(()=>window.seekdesk.readReadingLibrary(42))).history.some(row=>row.post.id==='730001'),'Initial optional reading visit did not settle');
  await seed(bookmark(730011,'等待更新保存的书签'));
  await page.evaluate(async()=>{await window.seekdesk.checkUpdates();await window.seekdesk.downloadUpdate();});
  assert.equal((await page.evaluate(()=>window.seekdesk.getUpdateState())).status,'downloaded');
  assert.equal((await nativeState()).downloads,1);

  await openLibrary();await page.locator('.reading-library-row[data-post-id="730011"]').waitFor();
  await arm({label:'clear-before-update',hold:true,fail:false});
  await page.getByTestId('reading-library-panel').getByRole('button',{name:'清空当前列表',exact:true}).click();
  await page.getByRole('button',{name:'确认清空',exact:true}).click();
  await until(async()=>(await nativeState()).renameHeld,'The real library rename was not held');
  await openAbout();const first=await applyHeld(1,0);
  const before=JSON.parse(await fs.readFile(path.join(profile,'reading-library.json'),'utf8'));assert.equal(before.libraries['user:42'].bookmarks.length,1);
  await release();await first.task;await waitRefusal(1);
  const state1=await nativeState();assert.deepEqual(state1.installs,[[true,true]]);assert.equal(state1.snapshots[0].library.libraries['user:42'].bookmarks.length,0);assert.deepEqual(state1.snapshots[0].dom,{inert:true,overlay:true});
  assert.ok(state1.events.findIndex(row=>row.event==='rename-saved'&&row.label==='clear-before-update')<state1.events.findIndex(row=>row.event==='install'));
  check('An explicit library clear may leave its panel, but its actual atomic rename completes before cached update installation');

  await seed(bookmark(730012,'保存失败时保留的书签'));await backToReader();await openLibrary();
  await page.locator('.reading-library-row[data-post-id="730012"]').waitFor();await arm({label:'failed-remove',hold:true,fail:true});
  await page.locator('.reading-library-row[data-post-id="730012"]').getByRole('button',{name:'移除 保存失败时保留的书签',exact:true}).click();
  await until(async()=>(await nativeState()).renameHeld,'The failing explicit rename was not held');
  await openAbout();const failed=await applyHeld(2,1);await release();const blocked=await failed.task;
  assert.equal(blocked.status,'downloaded');assert.equal(blocked.errorCode,'prepare');assert.equal((await nativeState()).installs.length,1);
  await until(async()=>await page.locator('.app-shell').evaluate(node=>!node.inert),'Explicit save failure did not unlock the UI');
  assert.equal((await page.evaluate(()=>window.seekdesk.readReadingLibrary(42))).bookmarks[0].post.id,'730012');
  check('A pending explicit library failure blocks this installation, preserves records and keeps the verified package retryable');

  await backToReader();await openLibrary();await page.locator('.reading-library-row[data-post-id="730012"]').getByRole('button',{name:'移除 保存失败时保留的书签',exact:true}).click();
  await until(async()=>(await page.evaluate(()=>window.seekdesk.readReadingLibrary(42))).bookmarks.length===0,'Explicit library retry did not save');
  await openAbout();await page.evaluate(()=>window.seekdesk.applyUpdate());await waitRefusal(2);
  assert.equal((await nativeState()).downloads,1);assert.equal((await nativeState()).snapshots[1].library.libraries['user:42'].bookmarks.length,0);
  check('A successful explicit retry saves the intended state and reuses the already verified update bytes');

  await backToReader();const failureCount=(await nativeState()).renameFailures;await arm({label:'optional-history',hold:false,fail:true});
  await page.getByRole('button',{name:'刷新当前帖子',exact:true}).click();
  await until(async()=>(await nativeState()).renameFailures>failureCount,'The optional history write did not fail');
  await until(async()=>(await nativeState()).mutations.every(row=>row.settled),'The optional local mutation has not settled');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await openAbout();await page.evaluate(()=>window.seekdesk.applyUpdate());await waitRefusal(3);assert.equal((await nativeState()).downloads,1);
  check('An optional automatic-history failure cannot permanently block the next explicit application update');

  await seed(bookmark(730013,'旧账号正在保存的书签'));await backToReader();await openLibrary();await page.locator('.reading-library-row[data-post-id="730013"]').waitFor();
  await arm({label:'old-owner-completion',hold:true,fail:false});await page.locator('.reading-library-row[data-post-id="730013"]').getByRole('button',{name:'移除 旧账号正在保存的书签',exact:true}).click();
  await until(async()=>(await nativeState()).renameHeld,'Old-owner local write was not held');
  await instance.evaluate(()=>{globalThis.__libraryUpdate.owner=84;});
  await page.evaluate(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/?library-owner=84'));
  await until(async()=>(await page.evaluate(()=>window.seekdesk.checkAccount())).id===84,'Synthetic owner B was not established');await page.evaluate(()=>window.seekdesk.closeOfficial());
  assert.deepEqual(await page.evaluate(()=>window.seekdesk.readReadingLibrary(84)),{bookmarks:[],history:[]});
  await openAbout();const next=await applyHeld(5,3);await release();await next.task;await waitRefusal(4);
  assert.equal((await nativeState()).downloads,1);assert.equal((await nativeState()).snapshots[3].library.libraries['user:42'].bookmarks.length,0);
  assert.equal((await nativeState()).forumWrites,0);assert.deepEqual(report.errors,[]);
  check('A completed old-owner write stays in its own library; its stale response cannot block a new owner or execute a real installer');
  report.status='pass';report.observations={downloads:1,simulatedInstallCalls:4,forumWrites:0};await page.screenshot({path:path.join(output,'library-update-unlocked.png')});
})().catch(async error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}).finally(async()=>{if(instance)await instance.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
