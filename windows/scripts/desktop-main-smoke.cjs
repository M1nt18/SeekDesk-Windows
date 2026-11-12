/* Real main-process/window regression. Only the native dialog result and network
   responses are fixtures. Every launch owns a fresh, explicitly isolated profile. */
const {_electron}=require('playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

const project=path.resolve(__dirname,'..');
const output=path.join(project,'verification');
const profile=path.join(project,'.test-data',`desktop-main-${Date.now()}-${process.pid}`);
const report={testedAt:new Date().toISOString(),scope:'Real compiled Electron main, preload, controller and IPC; isolated test profile; synthetic RSS/HTTPS and native-dialog choices; no installs, live forum writes, publishing or existing profiles.',checks:[],errors:[],launches:[],screenshots:[]};
let instance,page,instanceClosed=true,phase=0;
const check=(name,detail)=>{report.checks.push({name,status:'pass',...(detail===undefined?{}:{detail})});console.log('PASS',name);};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message,timeout=10000) {
  const deadline=Date.now()+timeout;
  for (;;) {
    const result=await check();
    if(result)return result;
    if(Date.now()>=deadline)throw new Error(message);
    await delay(35);
  }
}
async function bounded(promise,ms,message) {
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms);})]);}
  finally{clearTimeout(timer);}
}
const readState=()=>fs.readFile(path.join(profile,'desktop-window.json'),'utf8').then(JSON.parse);
const sameBounds=(a,b)=>['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<=2);

// Serialized into the private launch entry; requires the actual compiled main.
function fixtureEntry(fixture) {
  const {app,session,dialog}=require('electron');
  const fs=require('node:fs');
  const state=globalThis.__desktopMain={dialogs:[],dialogMode:'choice',nextChoice:{response:2,checkboxChecked:false},pending:false,aborts:0,beforeQuitCount:0,requests:[],blockedFetches:0};
  dialog.showMessageBox=async(_window,options)=>{
    const row={buttons:options.buttons,checkboxLabel:options.checkboxLabel,cancelId:options.cancelId};
    state.dialogs.push(row);
    return new Promise(resolve=>{
      let done=false;
      const abort=()=>{state.aborts++;finish({response:2,checkboxChecked:false});};
      const finish=choice=>{
        if(done)return;done=true;state.pending=false;state.respond=undefined;
        options.signal?.removeEventListener('abort',abort);
        row.response=choice.response;row.checkboxChecked=choice.checkboxChecked;resolve(choice);
      };
      if(state.dialogMode==='hold'){
        state.pending=true;state.respond=finish;
        options.signal?.addEventListener('abort',abort,{once:true});
        if(options.signal?.aborted)abort();
      }else finish({...state.nextChoice});
    });
  };
  const rss='<rss><channel><item><title>桌面生命周期测试帖子</title><link>https://www.nodeseek.com/post-740001-1</link><description>隔离公开摘要</description><pubDate>Thu, 12 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>';
  const route=async request=>{
    const url=new URL(request.url);
    state.requests.push({host:url.hostname,method:request.method});
    if(request.method!=='GET')return new Response('Fixture rejects writes',{status:405});
    if(url.hostname==='rss.nodeseek.com')return new Response(rss,{headers:{'content-type':'application/rss+xml'}});
    if(['www.nodeseek.com','nodeseek.com'].includes(url.hostname)){
      if(url.pathname.startsWith('/api/'))return new Response(JSON.stringify({success:true,data:[],unreadCount:{atMe:0,reply:0,message:0}}),{headers:{'content-type':'application/json'}});
      return new Response('<!doctype html><meta charset="utf-8"><script>window.__config__={user:null}</script><div id="nsk-head"></div><div id="nsk-body-left"></div>',{headers:{'content-type':'text/html; charset=utf-8'}});
    }
    return new Response('No network is enabled in this test',{status:404});
  };
  app.whenReady().then(()=>{
    for(const partition of [undefined,'persist:nodeseek','persist:calculator','public-rss']){
      const current=partition?session.fromPartition(partition):session.defaultSession;
      current.protocol.handle('https',route);
      current.protocol.handle('http',route);
    }
  });
  globalThis.fetch=async()=>{state.blockedFetches++;throw new Error('Main-process network disabled by desktop smoke fixture');};
  app.on('before-quit',()=>{state.beforeQuitCount++;});
  app.on('will-quit',()=>{
    fs.writeFileSync(fixture.observations,JSON.stringify({dialogs:state.dialogs,pending:state.pending,aborts:state.aborts,beforeQuitCount:state.beforeQuitCount,requests:state.requests,blockedFetches:state.blockedFetches}));
  });
  require(fixture.main);
}

async function launch() {
  phase++;
  const observations=path.join(profile,`observations-${phase}.json`);
  const entry=path.join(profile,`entry-${phase}.cjs`);
  await fs.writeFile(entry,`(${fixtureEntry.toString()})(${JSON.stringify({main:path.join(project,'dist-electron','electron','main.js'),observations})});\n`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};
  delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  instance=await _electron.launch({executablePath:require('electron'),args:[entry],env,timeout:45000});
  instanceClosed=false;
  instance.on('close',()=>{instanceClosed=true;});
  page=await instance.firstWindow();
  page.on('pageerror',error=>report.errors.push({phase,message:error.message}));
  await page.waitForSelector('.workspace',{timeout:30000});
  await page.getByTestId('post-row').first().waitFor({timeout:15000});
  await until(async()=>Boolean((await windowState())?.visible),'Main window did not finish ready-to-show');
  const details=await instance.evaluate(({app,BrowserWindow})=>({profile:app.getPath('userData'),windowCount:BrowserWindow.getAllWindows().filter(window=>window.webContents.getURL().startsWith('file:')).length}));
  assert.equal(path.resolve(details.profile),path.resolve(profile));assert.equal(details.windowCount,1);
  report.launches.push({phase,isolatedProfile:true,mainWindows:details.windowCount});
  return observations;
}
async function windowState() {
  return instance.evaluate(({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file:'));
    if(!window)return null;
    return {id:window.id,contentsId:window.webContents.id,visible:window.isVisible(),minimized:window.isMinimized(),maximized:window.isMaximized(),bounds:window.getBounds(),normalBounds:window.getNormalBounds()};
  });
}
async function configureDialog(response,checkboxChecked=false,hold=false) {
  await instance.evaluate((_electron,value)=>{const state=globalThis.__desktopMain;state.dialogMode=value.hold?'hold':'choice';state.nextChoice={response:value.response,checkboxChecked:value.checkboxChecked};},{response,checkboxChecked,hold});
}
const dialogCount=()=>instance.evaluate(()=>globalThis.__desktopMain.dialogs.length);
async function nativeClose() {
  // BrowserWindow.close() enters Electron's native close event, as Windows Alt+F4 does.
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file:')).close());
}
async function restoreFromSecondInstance() {
  await instance.evaluate(({app})=>{app.emit('second-instance',{},[],app.getPath('userData'));});
  await until(async()=>{const current=await windowState();return current?.visible&&!current.minimized;},'Second-instance handler did not restore the main window');
}
async function closeViaPlaywright() {
  const began=Date.now();
  await bounded(instance.close(),10000,'Playwright shutdown remained blocked by a close dialog');
  await until(()=>instanceClosed,'Electron process did not finish shutdown',5000);
  return Date.now()-began;
}
async function exitFromCloseButton() {
  const closed=new Promise(resolve=>instance.once('close',resolve));
  const began=Date.now();
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click({noWaitAfter:true}).catch(error=>{if(!/closed|destroyed|Target/i.test(error.message))throw error;});
  await bounded(closed,10000,'Confirmed window exit did not terminate the isolated Electron instance');
  return Date.now()-began;
}
async function observations(filename) {
  const value=JSON.parse(await fs.readFile(filename,'utf8'));
  assert.equal(value.pending,false);
  assert.equal(value.requests.filter(request=>request.method!=='GET').length,0);
  assert.equal(value.blockedFetches,0);
  return value;
}

(async()=>{
  await fs.mkdir(output,{recursive:true});await fs.mkdir(profile,{recursive:true});
  await fs.access(path.join(project,'dist-electron','electron','desktop-window.js'));
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings:{theme:'light',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'rss'},workspace:{tabs:[],activeId:null,overviewOpen:true},blockedUsers:[]}));
  await fs.writeFile(path.join(profile,'workspace-features.json'),JSON.stringify({extensions:{installed:[],enabled:[],autoAttendance:false},appearance:{notificationPolling:false,autoRefresh:false,autoLoadOlder:false},drafts:{},history:[]}));

  const firstObservations=await launch();
  assert.deepEqual(await page.evaluate(()=>window.seekdesk.getDesktopPreferences()),{closeBehavior:'ask'});
  const update=await page.evaluate(()=>window.seekdesk.getUpdateState());
  assert.equal(update.status,'unsupported');assert.equal(update.installable,false);
  check('Source launch exposes desktop preferences and manual-only updater state',{closeBehavior:'ask',updateStatus:update.status});

  const initial=await windowState();
  await configureDialog(2,true);
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await until(async()=>(await dialogCount())===1,'Close button did not reach the native choice dialog');
  assert.equal((await windowState()).id,initial.id);assert.equal((await windowState()).visible,true);
  assert.deepEqual(await page.evaluate(()=>window.seekdesk.getDesktopPreferences()),{closeBehavior:'ask'});
  check('Titlebar X cancellation keeps the real main window and does not remember Cancel');

  await configureDialog(2,false,true);
  await nativeClose();await nativeClose();await nativeClose();
  assert.equal(await dialogCount(),2);
  assert.equal(await instance.evaluate(()=>globalThis.__desktopMain.pending),true);
  await instance.evaluate(()=>globalThis.__desktopMain.respond({response:2,checkboxChecked:false}));
  await until(async()=>!(await instance.evaluate(()=>globalThis.__desktopMain.pending)),'Held close dialog did not cancel');
  assert.equal((await windowState()).id,initial.id);
  check('Repeated native closes share one dialog and preserve the window',{trigger:'Electron native close path shared by Windows Alt+F4; no physical key injection'});

  await configureDialog(0,true);
  await page.getByRole('button',{name:'关闭窗口',exact:true}).click();
  await until(async()=>!(await windowState()).visible,'Tray choice destroyed or failed to hide the main window');
  const traySaved=await readState();assert.equal(traySaved.closeBehavior,'tray');
  assert.deepEqual(await page.evaluate(()=>window.seekdesk.getDesktopPreferences()),{closeBehavior:'tray'});
  const rememberedDialogs=await dialogCount();
  await restoreFromSecondInstance();
  const restored=await windowState();assert.equal(restored.id,initial.id);assert.equal(restored.contentsId,initial.contentsId);
  await nativeClose();await until(async()=>!(await windowState()).visible,'Remembered tray behavior did not hide the main window');
  assert.equal(await dialogCount(),rememberedDialogs);
  await restoreFromSecondInstance();
  check('Remembered tray choice persists and second-instance restore reuses the existing window',{closeBehavior:traySaved.closeBehavior,dialogCount:rememberedDialogs});

  await page.getByTestId('settings-button').click();await page.getByTestId('settings-panel').waitFor();
  const closeSelect=page.getByRole('combobox',{name:'关闭主窗口',exact:true});
  await until(async()=>!(await closeSelect.isDisabled()),'Desktop close selector did not load');
  assert.equal(await closeSelect.inputValue(),'tray');
  await closeSelect.selectOption('ask');
  await until(async()=>(await page.evaluate(()=>window.seekdesk.getDesktopPreferences())).closeBehavior==='ask','Settings did not save the close behavior');
  await page.screenshot({path:path.join(output,'desktop-main-settings.png')});report.screenshots.push('desktop-main-settings.png');
  check('General settings reads and changes the real persisted close preference');

  const geometry=await instance.evaluate(({BrowserWindow,screen})=>{
    const window=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file:'));
    if(window.isMaximized())window.unmaximize();
    const area=screen.getDisplayMatching(window.getBounds()).workArea;
    const width=Math.min(area.width,Math.max(Math.min(960,area.width),1140));
    const height=Math.min(area.height,Math.max(Math.min(680,area.height),780));
    const target={x:area.x+Math.min(24,area.width-width),y:area.y+Math.min(32,area.height-height),width,height};
    window.setBounds(target);return {workArea:area,target};
  });
  const normal=(await windowState()).normalBounds;
  assert.ok(sameBounds(normal,geometry.target),JSON.stringify({normal,target:geometry.target}));
  await until(async()=>{try{const saved=await readState();return saved.bounds&&sameBounds(saved.bounds,normal)&&!saved.maximized;}catch{return false;}},'Move/resize debounce did not persist normal bounds');
  await page.getByRole('button',{name:'最大化或还原',exact:true}).click();
  await until(async()=>Boolean((await windowState()).maximized),'Window did not maximize');
  await until(async()=>{const saved=await readState();return saved.maximized&&sameBounds(saved.bounds,normal);},'Maximized save did not retain normal bounds');
  check('Real resize/move debounce and maximize retain normal bounds',{normalBounds:normal,workArea:geometry.workArea});

  await configureDialog(2,false,true);await nativeClose();
  assert.equal(await instance.evaluate(()=>globalThis.__desktopMain.pending),true);
  const closeMs=await closeViaPlaywright();
  const beforeRestart=await readState();assert.equal(beforeRestart.maximized,true);assert.ok(sameBounds(beforeRestart.bounds,normal));
  const first=await observations(firstObservations);
  assert.equal(first.aborts,1);assert.ok(first.beforeQuitCount>=2);
  check('Playwright app.close aborts an unanswered dialog and flushes before quitting',{durationMs:closeMs,dialogAborts:first.aborts,beforeQuitCount:first.beforeQuitCount});

  const secondObservations=await launch();
  await until(async()=>Boolean((await windowState())?.maximized),'Restart did not restore maximized state',4000);
  const restart=await windowState();assert.equal(restart.maximized,true);assert.ok(sameBounds(restart.normalBounds,normal));
  assert.equal(await dialogCount(),0);
  assert.deepEqual(await page.evaluate(()=>window.seekdesk.getDesktopPreferences()),{closeBehavior:'ask'});
  await page.getByRole('button',{name:'最大化或还原',exact:true}).click();
  await until(async()=>!(await windowState()).maximized,'Restarted window did not unmaximize');
  assert.ok(sameBounds((await windowState()).normalBounds,normal));
  check('Restart restores maximized state and unmaximize returns to remembered dimensions');

  await configureDialog(1,true);
  const confirmedExitMs=await exitFromCloseButton();
  const confirmed=await readState();assert.equal(confirmed.closeBehavior,'quit');assert.equal(confirmed.maximized,false);assert.ok(sameBounds(confirmed.bounds,normal));
  const second=await observations(secondObservations);assert.equal(second.dialogs.length,1);assert.equal(second.dialogs[0].response,1);assert.equal(second.dialogs[0].checkboxChecked,true);
  check('Native dialog Exit saves remembered choice and bounds before actual termination',{durationMs:confirmedExitMs,closeBehavior:confirmed.closeBehavior});

  const thirdObservations=await launch();
  assert.deepEqual(await page.evaluate(()=>window.seekdesk.getDesktopPreferences()),{closeBehavior:'quit'});
  const finalWindow=await windowState();assert.equal(finalWindow.maximized,false);assert.ok(sameBounds(finalWindow.normalBounds,normal));
  const rememberedExitMs=await exitFromCloseButton();
  const third=await observations(thirdObservations);assert.equal(third.dialogs.length,0);
  check('Remembered Exit closes a restarted application without another dialog',{durationMs:rememberedExitMs});
  assert.deepEqual(report.errors,[]);
  check('All three launches stay isolated, use fixture GETs and have no renderer exceptions');
  report.status='pass';
})().catch(async error=>{
  report.status='fail';report.failure=error.stack;process.exitCode=1;console.error(error);
  if(page&&!instanceClosed)await page.screenshot({path:path.join(output,'desktop-main-failure.png')}).then(()=>report.screenshots.push('desktop-main-failure.png')).catch(()=>{});
}).finally(async()=>{
  if(instance&&!instanceClosed){
    try{await bounded(instance.close(),6000,'Private smoke instance did not close during cleanup');}
    catch(error){
      report.cleanupFallback='app.exit(1) in this script\'s isolated Electron instance only';
      await instance.evaluate(({app})=>app.exit(1)).catch(()=>{});
    }
  }
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'desktop-main-report.json'),JSON.stringify(report,null,2)+'\n');
});
