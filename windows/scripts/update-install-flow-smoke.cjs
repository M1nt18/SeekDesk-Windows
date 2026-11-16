'use strict';

// Real main/preload/React and local draft storage. Only remote responses and the
// native updater are fixtures; the inert payload is never executed or installed.
const {_electron}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

const project=path.resolve(__dirname,'..');
const profile=path.join(project,'.test-data',`update-install-flow-${Date.now()}-${process.pid}`);
const output=path.join(project,'verification','update-install-flow');
const version=require('../package.json').version;
const nextVersion=version.split('.').map((value,index)=>index===2?Number(value)+1:Number(value)).join('.');
const report={scope:'Real Electron main, sandboxed preload, React, updater SHA-512 and local draft persistence; fresh test userData; fixture HTTP(S); no installer, real account, forum write or registry access.',checks:[],errors:[]};
const check=name=>{report.checks.push(name);console.log('PASS',name);};
let instance,page;

function fixtureEntry(fixture){
  const {app,session,BrowserWindow}=require('electron');
  const {EventEmitter}=require('node:events');
  const fs=require('node:fs');
  const fsp=require('node:fs/promises');
  const path=require('node:path');
  const {createHash}=require('node:crypto');
  app.getVersion=()=>fixture.version;
  const state=globalThis.__updateFlow={requests:[],writes:0,downloads:0,installCalls:[],snapshots:[],prepareCalls:0,prepareAcks:0,holdDownload:true,failInstall:true,releaseDownload:undefined,holdReplyLoad:false,pendingReplyLoads:[]};
  const payload=Buffer.from('An inert SeekDesk update test payload. This is not executable.');
  const fileName=`SeekDesk-Windows-${fixture.nextVersion}-x64-Setup.exe`;
  const info={version:fixture.nextVersion,files:[{url:fileName,sha512:createHash('sha512').update(payload).digest('base64'),size:payload.length}]};
  class FixtureNative extends EventEmitter{
    autoDownload=true;autoInstallOnAppQuit=true;allowPrerelease=true;allowDowngrade=true;
    disableWebInstaller=false;disableDifferentialDownload=false;
    constructor(cache){super();this.cache=cache;}
    setFeedURL(){}
    async checkForUpdates(){return {updateInfo:info,isUpdateAvailable:true};}
    async downloadUpdate(token){
      state.downloads++;
      this.emit('download-progress',{percent:40,transferred:40,total:100,bytesPerSecond:100});
      if(state.holdDownload)await new Promise(resolve=>{state.releaseDownload=resolve;});
      state.releaseDownload=undefined;
      if(token.cancelled)throw Object.assign(new Error('Fixture download cancelled'),{code:'CANCELLED'});
      const destination=path.join(this.cache,'pending',fileName);
      await fsp.mkdir(path.dirname(destination),{recursive:true});await fsp.writeFile(destination,payload);
      return [destination];
    }
    async restoreVerifiedDownload(){}
    resetAfterInstallError(){}
    quitAndInstall(...args){
      state.installCalls.push(args);
      const snapshot={drafts:JSON.parse(fs.readFileSync(path.join(fixture.profile,'workspace-features.json'),'utf8')).drafts,workspace:JSON.parse(fs.readFileSync(path.join(fixture.profile,'preferences.json'),'utf8')).workspace};
      state.snapshots.push(snapshot);
      const contents=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).webContents;
      void contents.executeJavaScript('({inert:document.querySelector(".app-shell")?.inert===true,overlay:!!document.querySelector(".update-install-overlay")})').then(dom=>{
        snapshot.dom=dom;
        if(state.failInstall)this.emit('error',new Error('Synthetic installer refusal; no executable was launched'));
      });
    }
  }
  const updater=require(fixture.updater),ActualUpdater=updater.UpdaterService;
  updater.UpdaterService=class extends ActualUpdater{
    constructor(options){
      const before=options.beforeInstall;
      super({...options,currentVersion:fixture.version,isPackaged:true,isInstalled:true,automaticCheckDelayMs:3_600_000,installerBusy:async()=>false,nativeFactory:cache=>new FixtureNative(cache),beforeInstall:async()=>{state.prepareCalls++;await before();state.prepareAcks++;}});
      state.service=this;
    }
  };
  const store=require(fixture.store),originalLoad=store.ParityStore.prototype.loadDraft;
  store.ParityStore.prototype.loadDraft=function(owner,key){
    const value=originalLoad.call(this,owner,key);
    if(state.holdReplyLoad&&key==='reply:730002')return new Promise(resolve=>state.pendingReplyLoads.push(()=>resolve(value)));
    return value;
  };
  const owner=42;
  const listing='<ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-730001-1">更新前本地草稿验证</a></div><div class="info-author"><a href="/space/77">合成作者</a></div><a class="post-category" href="/categories/tech">技术</a></li><li class="post-list-item"><div class="post-title"><a href="/post-730002-1">延迟读取草稿验证</a></div><div class="info-author"><a href="/space/77">合成作者</a></div><a class="post-category" href="/categories/tech">技术</a></li></ul>';
  const thread='<div class="nsk-post-wrapper"><h1><a class="post-title-link">更新前本地草稿验证</a></h1><div class="content-item" id="0"><div class="nsk-content-meta-info"><a class="author-name" href="/space/77">合成作者</a><time datetime="2026-11-13T00:00:00Z"></time></div><article class="post-content"><p>这是离线读取夹具，没有向真实论坛发送任何内容。</p></article></div></div>';
  const document=body=>'<!doctype html><meta charset="utf-8"><title>更新流程夹具</title><script>window.__config__='+JSON.stringify({user:{member_id:owner,member_name:'合成更新账号',rank:3},commmentPerPage:20,postData:{postId:730001,comments:[{floorIndex:0,commentId:9000,poster:{uid:77,name:'合成作者',isOp:true,isMe:false}}]}})+';</script><div id="nsk-head"></div><div id="nsk-body-left">'+body+'</div>';
  const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  const route=async request=>{
    const url=new URL(request.url);state.requests.push({host:url.hostname,path:url.pathname,method:request.method});
    if(!['GET','HEAD'].includes(request.method)){state.writes++;return new Response('All writes forbidden in this fixture',{status:405});}
    if(url.hostname==='rss.nodeseek.com')return new Response('<rss><channel/></rss>',{headers:{'content-type':'application/rss+xml'}});
    if(['www.nodeseek.com','nodeseek.com'].includes(url.hostname)){
      if(url.pathname.startsWith('/avatar/'))return new Response(Buffer.from(fixture.png,'base64'),{headers:{'content-type':'image/png'}});
      if(url.pathname.startsWith('/api/account/getInfo/')){const id=Number(url.pathname.split('/').pop());return json({success:true,detail:{member_id:id,member_name:id===owner?'合成更新账号':'合成作者',rank:3,coin:20,nPost:1,nComment:0,roles:[],followed:false}});}
      if(url.pathname==='/api/notification/unread-count')return json({success:true,unreadCount:{atMe:0,reply:0,message:0}});
      if(url.pathname.startsWith('/api/'))return json({success:true,data:[],items:[]});
      return new Response(document(url.pathname.startsWith('/post-')?thread:listing),{headers:{'content-type':'text/html; charset=utf-8'}});
    }
    return new Response('External network disabled',{status:404});
  };
  app.whenReady().then(()=>{for(const partition of [undefined,'persist:nodeseek','public-rss','persist:calculator']){const target=partition?session.fromPartition(partition):session.defaultSession;target.protocol.handle('https',route);target.protocol.handle('http',route);}});
  globalThis.fetch=async()=>{throw new Error('Main-process external network disabled');};
  require(fixture.main);
}

const nativeState=()=>instance.evaluate(()=>{const s=globalThis.__updateFlow;return {downloads:s.downloads,installCalls:s.installCalls,snapshots:s.snapshots,prepareCalls:s.prepareCalls,prepareAcks:s.prepareAcks,writes:s.writes};});
async function until(predicate,message,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){const value=await predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,25));}throw new Error(message);}
async function openAbout(){await page.getByTestId('settings-button').click();await page.getByRole('button',{name:'关于',exact:true}).click();}
async function readDraft(){const value=JSON.parse(await fs.readFile(path.join(profile,'workspace-features.json'),'utf8'));return value.drafts?.['42']?.['reply:730001'];}

(async()=>{
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings:{theme:'light',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'},workspace:{tabs:[],activeId:null,overviewOpen:true},blockedUsers:[]}));
  await fs.writeFile(path.join(profile,'workspace-features.json'),JSON.stringify({appearance:{notificationPolling:false,autoRefresh:false,autoLoadOlder:false},extensions:{installed:[],enabled:[],autoAttendance:false},drafts:{'42':{'reply:730001':{content:'已保存的开头',imageWidths:{}},'reply:730002':{content:'延迟读取前的旧草稿',imageWidths:{}}}},history:[]}));
  const entry=path.join(profile,'entry.cjs');await fs.writeFile(entry,`(${fixtureEntry.toString()})(${JSON.stringify({main:path.join(project,'dist-electron/electron/main.js'),updater:path.join(project,'dist-electron/electron/updater.js'),store:path.join(project,'dist-electron/electron/parity-store.js'),profile,version,nextVersion,png:(await fs.readFile(path.join(project,'build/icon.png'))).toString('base64')})});\n`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  instance=await _electron.launch({executablePath:require('electron'),args:[entry,'--host-resolver-rules=MAP * ~NOTFOUND'],env,timeout:45000});
  page=await instance.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await until(async()=>(await page.evaluate(()=>window.seekdesk.bootstrap())).account.id===42,'Synthetic account was not recognized');
  await page.getByTestId('post-row').first().click();await page.getByTestId('reader-content').first().waitFor();
  await page.getByRole('button',{name:'写回复',exact:true}).click();
  await until(async()=>await page.getByRole('textbox',{name:'回复帖子',exact:true}).inputValue()==='已保存的开头','Reply draft did not load');
  // Keep the normal 500ms renderer debounce from being the reason for success.
  await page.evaluate(()=>{const original=window.setTimeout.bind(window);window.setTimeout=((handler,delay,...args)=>original(handler,delay===500?60000:delay,...args));});
  await page.evaluate(()=>window.seekdesk.checkUpdates());await openAbout();
  await page.getByRole('button',{name:'立即更新',exact:true}).click();
  await until(async()=>(await nativeState()).downloads===1,'First download did not begin');
  await page.getByRole('button',{name:'取消下载',exact:true}).click();
  await instance.evaluate(()=>globalThis.__updateFlow.releaseDownload());
  await until(async()=>(await page.evaluate(()=>window.seekdesk.getUpdateState())).status==='cancelled','Cancelled task did not settle');
  assert.equal((await nativeState()).installCalls.length,0);assert.equal((await nativeState()).prepareCalls,0);
  check('Cancelling the real main-process apply task never prepares or starts an installer');

  await page.getByRole('button',{name:'立即更新',exact:true}).click();await until(async()=>(await nativeState()).downloads===2,'Retry download did not begin');
  await page.getByRole('button',{name:'返回论坛',exact:true}).click();
  await until(async()=>await page.getByRole('textbox',{name:'回复帖子',exact:true}).inputValue()==='已保存的开头','Reply draft did not restore after leaving settings');
  const latest='已保存的开头，未等自动保存的最后一字：叶';
  await page.getByRole('textbox',{name:'回复帖子',exact:true}).fill(latest);
  assert.notEqual((await readDraft()).content,latest);
  await instance.evaluate(()=>globalThis.__updateFlow.releaseDownload());
  await until(async()=>(await nativeState()).snapshots[0]?.dom,'Installer observation did not finish');
  await until(async()=>(await page.evaluate(()=>window.seekdesk.getUpdateState())).errorCode==='install','Synthetic installer refusal was not reported');
  const first=await nativeState();
  assert.deepEqual(first.installCalls,[[true,true]]);assert.equal(first.prepareAcks,1);
  assert.equal(first.snapshots[0].drafts['42']['reply:730001'].content,latest);
  assert.equal(first.snapshots[0].workspace.activeId,'730001');
  assert.deepEqual(first.snapshots[0].dom,{inert:true,overlay:true});
  await until(async()=>await page.locator('.app-shell').evaluate(node=>!node.inert),'Installer failure did not restore interaction');
  assert.equal((await readDraft()).content,latest);
  check('Leaving settings continues the update; renderer acknowledgement saves the final character and workspace before native installation');
  check('Installation preparation makes the application inert; a native launch failure keeps the verified package and unlocks the UI');

  await page.evaluate(()=>{window.__updateFailureOff=window.seekdesk.onBeforeUpdateInstall(async()=>{throw new Error('Synthetic renderer save refusal');});});
  const blocked=await page.evaluate(()=>window.seekdesk.applyUpdate());
  assert.equal(blocked.status,'downloaded');assert.equal(blocked.errorCode,'prepare');
  assert.equal((await nativeState()).installCalls.length,1);assert.equal((await nativeState()).downloads,2);
  await until(async()=>await page.locator('.app-shell').evaluate(node=>!node.inert),'Save failure did not restore interaction');
  await page.evaluate(()=>{window.__updateFailureOff();delete window.__updateFailureOff;});
  check('A renderer preparation failure rejects the real IPC acknowledgement and never runs the cached installer');

  await instance.evaluate(()=>{globalThis.__updateFlow.holdReplyLoad=true;});
  await page.getByTestId('post-row').nth(1).click();await page.getByTestId('reader-content').first().waitFor();
  await page.getByRole('button',{name:'写回复',exact:true}).click();
  await until(async()=>await instance.evaluate(()=>globalThis.__updateFlow.pendingReplyLoads.length>0),'Delayed draft load did not begin');
  const pendingInput='草稿还未读取完成，用户刚输入的末字：晚';
  await page.getByRole('textbox',{name:'回复帖子',exact:true}).fill(pendingInput);
  const notReadyStarted=Date.now();
  const notReady=await page.evaluate(()=>window.seekdesk.applyUpdate());
  assert.ok(Date.now()-notReadyStarted<5000,'An unready nonempty draft should explicitly reject preparation, not wait for the 15-second renderer timeout');
  assert.equal(notReady.status,'downloaded');assert.equal(notReady.errorCode,'prepare');
  assert.equal((await nativeState()).installCalls.length,1);
  await until(async()=>await page.locator('.app-shell').evaluate(node=>!node.inert),'Unready draft did not restore interaction');
  assert.equal(await page.getByRole('textbox',{name:'回复帖子',exact:true}).inputValue(),pendingInput);
  await instance.evaluate(()=>{const state=globalThis.__updateFlow;state.holdReplyLoad=false;for(const resolve of state.pendingReplyLoads.splice(0))resolve();});
  await page.evaluate(()=>window.seekdesk.loadDraft('reply:730002',42));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.getByRole('textbox',{name:'回复帖子',exact:true}).inputValue(),pendingInput,'A late saved draft must not replace text typed while its load was pending');
  assert.equal((await nativeState()).installCalls.length,1);
  check('A nonempty reply whose draft is still loading blocks installation; its late saved value never replaces the newly typed text');

  const final='草稿还未读取完成，用户刚输入的末字：晚，读取完成后新末字：青';
  await page.getByRole('textbox',{name:'回复帖子',exact:true}).fill(final);
  await instance.evaluate(()=>{globalThis.__updateFlow.failInstall=false;});
  const applied=await page.evaluate(()=>window.seekdesk.applyUpdate());assert.equal(applied.status,'installing');
  await until(async()=>(await nativeState()).snapshots[1]?.dom,'Cached installer observation did not finish');
  const last=await nativeState();assert.equal(last.downloads,2);assert.equal(last.installCalls.length,2);
  assert.equal(last.snapshots[1].drafts['42']['reply:730002'].content,final);assert.deepEqual(last.snapshots[1].dom,{inert:true,overlay:true});
  assert.equal(await page.locator('.update-install-overlay').count(),1);await page.screenshot({path:path.join(output,'preparing-local-update.png')});
  assert.equal(last.writes,0);assert.deepEqual(report.errors,[]);
  check('Explicit retry reuses the verified package, flushes the newest cached-update draft, and performs zero real installs or forum writes');
  report.status='pass';report.observations={downloads:last.downloads,installRequests:last.installCalls.length,prepareAcks:last.prepareAcks,forumWrites:last.writes};
})().catch(async error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});}).finally(async()=>{if(instance)await instance.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
