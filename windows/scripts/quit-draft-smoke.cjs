'use strict';
// Real quit controller + renderer, synthetic identity, temporary on-disk draft store.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {_electron}=require('playwright-core');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification','quit-draft');
const report={testedAt:new Date().toISOString(),scope:'Isolated Electron profiles and synthetic forum IPC; real local draft persistence and native quit handshake; DNS blocked.',checks:[],errors:[]};
const check=(name,detail)=>{report.checks.push({name,detail});console.log('PASS',name);};
async function until(predicate,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(message);}
async function run(mode){
  const directory=path.join(project,'.test-data','quit-draft-'+mode+'-'+Date.now()),baseline='saved-before-quit',latest=baseline+' + LAST_CHARACTER';
  const callsFile=path.join(directory,'draft-calls.json'),eventsFile=path.join(directory,'quit-events.json');
  await fs.mkdir(directory,{recursive:true});
  const entry=path.join(directory,'entry.cjs');
  await fs.writeFile(entry,'global.__quitDraftRequire=require;const {ParityStore}=require('+JSON.stringify(path.join(project,'dist-electron/electron/parity-store.js'))+');const load=ParityStore.prototype.load;ParityStore.prototype.load=async function(...args){const result=await load.apply(this,args);global.__quitDraftFeatures=this;global.__quitDraftFeaturesReady=true;return result;};require('+JSON.stringify(path.join(project,'dist-electron/electron/main.js'))+');');
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:directory};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  let app,page,closed=false;
  try{
    app=await _electron.launch({executablePath:require('electron'),args:[entry,'--host-resolver-rules=MAP * ~NOTFOUND'],env,timeout:45000});
    app.on('close',()=>{closed=true;});page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.locator('.workspace').waitFor();
    await until(()=>app.evaluate(()=>Boolean(global.__quitDraftFeaturesReady&&global.__quitDraftFeatures)),'The real application features store did not finish loading');
    await app.evaluate(({ipcMain,BrowserWindow,dialog},{directory,callsFile,eventsFile})=>{
      const fs=global.__quitDraftRequire('node:fs');
      const now=new Date().toISOString(),post={id:'100001',url:'https://www.nodeseek.com/post-100001-1',title:'Synthetic quit draft',author:'Fixture',category:'daily',published:'',summary:''};
      const settings={theme:'light',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
      const appearance={brand:'blue',readerGradient:true,sidebarWidth:250,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'edit',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
      const extensions={installed:[],enabled:[],blocked:[],hits:[],unread:0,hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'Fixture',officeButton:'Back',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false};
      const state=global.__quitDraftFixture={calls:[],events:[],pending:[],saveMode:'success',dialogs:[],forumWrites:[]};
      const writeEvents=()=>fs.writeFileSync(eventsFile,JSON.stringify({events:state.events,dialogs:state.dialogs,forumWrites:state.forumWrites}));fs.writeFileSync(callsFile,'[]');writeEvents();
      const mock=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
      const win=BrowserWindow.getAllWindows().find(item=>item.webContents.getURL().startsWith('file:'));win.setSize(1440,960);
      const send=win.webContents.send.bind(win.webContents);win.webContents.send=(channel,...args)=>{
        if(channel==='app:update-prepare'||channel==='app:save-cancelled'){state.events.push({channel,args,time:Date.now()});writeEvents();}
        if(channel!=='forum:account-change')send(channel,...args);
      };
      dialog.showMessageBox=async(_window,options)=>{state.dialogs.push({title:options.title,message:options.message,response:1,checkboxChecked:true});writeEvents();return {response:1,checkboxChecked:true};};
      mock('app:bootstrap',()=>({settings,workspace:{tabs:[post],activeId:post.id,overviewOpen:false},account:{status:'signed-in',id:4242,name:'Synthetic fixture',level:6},official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[],version:'fixture'}));
      mock('parity:bootstrap',()=>({appearance,extensions,stickers:[],searchHistory:[],media:{hasApiKey:false,defaultImageWidth:0}}));
      mock('forum:list',()=>({posts:[post],source:'web',nextPage:null,fetchedAt:now}));
      mock('forum:thread',()=>({id:post.id,url:post.url,title:post.title,source:'web',page:1,nextPage:null,comments:[{id:'0',author:'Fixture',authorId:77,date:'',floor:'楼主',html:'<p>Synthetic body</p>'}]}));
      mock('forum:avatar',()=>null);mock('forum:profiles',()=>({outcomes:[],complete:true}));mock('parity:query',()=>({unread:{mentions:0,replies:0,messages:0}}));
      mock('library:read',()=>({bookmarks:[],history:[]}));mock('library:mutate',()=>({bookmarks:[],history:[]}));
      mock('parity:draft-load',(_event,key,owner)=>global.__quitDraftFeatures.loadDraft(owner,key));
      mock('parity:draft-save',async(_event,key,value,owner)=>{
        if(owner!==4242)throw Error('Wrong synthetic owner');
        state.calls.push({key,value,mode:state.saveMode,time:Date.now()});fs.writeFileSync(callsFile,JSON.stringify(state.calls));
        if(state.saveMode==='reject')throw Error('Synthetic draft persistence rejection');
        if(state.saveMode==='pending')await new Promise(resolve=>state.pending.push({content:value?.content,resolve}));
        await global.__quitDraftFeatures.saveDraft(owner,key,value);
      });
      mock('forum:action',(_event,value)=>{state.forumWrites.push(value);writeEvents();throw Error('Forum writes are forbidden');});
      mock('parity:write',(_event,value)=>{state.forumWrites.push(value);writeEvents();throw Error('Forum writes are forbidden');});
      mock('app:external',()=>{});mock('forum:open',()=>{});
    },{directory,callsFile,eventsFile});
    await app.evaluate(async(_electron,content)=>{await global.__quitDraftFeatures.saveDraft(4242,'reply:100001',{content,imageWidths:{}});},baseline);
    await page.reload();await page.locator('.workspace').waitFor();await page.getByRole('button',{name:'写回复',exact:true}).click();
    const editor=page.getByRole('textbox',{name:'回复帖子',exact:true});await until(async()=>await editor.inputValue()===baseline,'The baseline local draft did not load');
    if(mode!=='remembered-choice')await page.evaluate(()=>window.seekdesk.setCloseBehavior('quit'));
    if(mode==='reject-retry'||mode==='timeout-retry')await app.evaluate((_electron,mode)=>{global.__quitDraftFixture.saveMode=mode==='reject-retry'?'reject':'pending';},mode);
    if(mode==='update-event'){
      await page.evaluate(()=>{window.seekdesk.onBeforeUpdateInstall(async reason=>{if(reason==='quit')throw new Error('An update must not request ordinary quit preparation again');});});
      await editor.fill(latest);
      await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).webContents.send('app:update-prepare',999999,'update'));
      await until(async()=>{try{const state=JSON.parse(await fs.readFile(path.join(directory,'workspace-features.json'),'utf8'));return state.drafts['4242']['reply:100001'].content===latest;}catch{return false;}},'The synthetic update preparation did not save its draft');
      await app.evaluate(({app,autoUpdater})=>{autoUpdater.emit('before-quit-for-update');app.quit();}).catch(()=>{});
      await until(()=>closed,'The update exit requested an ordinary quit handshake again',5000);
      const state=JSON.parse(await fs.readFile(path.join(directory,'workspace-features.json'),'utf8')),events=JSON.parse(await fs.readFile(eventsFile,'utf8'));
      assert.equal(state.drafts['4242']['reply:100001'].content,latest);assert.equal(events.events.filter(event=>event.channel==='app:update-prepare'&&event.args[1]==='quit').length,0);assert.equal(events.forumWrites.length,0);
      check('A prepared update quits through the real Electron updater event without a second ordinary-quit save or executing an installer');return;
    }
    const editedAt=Date.now();await editor.fill(latest);await page.evaluate(()=>window.seekdesk.windowAction('close'));
    const requestDelay=Date.now()-editedAt;assert.ok(requestDelay<500,'Quit must be requested before the 500 ms draft debounce: '+requestDelay);
    let expected=latest;
    if(mode==='reject-retry'||mode==='timeout-retry'){
      await until(async()=>closed||await app.evaluate(()=>global.__quitDraftFixture.events.some(item=>item.channel==='app:save-cancelled')),'Quit did not cancel after rejected or timed-out persistence',22000);
      assert.equal(closed,false,'A failed draft save must keep the application open');
      await until(async()=>await page.locator('.app-shell').getAttribute('inert')===null,'Canceled quit left the renderer inert');
      assert.equal(await editor.isEditable(),true);assert.equal(await editor.inputValue(),latest);
      const beforeDisk=JSON.parse(await fs.readFile(path.join(directory,'workspace-features.json'),'utf8'));
      assert.equal(beforeDisk.drafts['4242']['reply:100001'].content,baseline);
      const cancellation=await app.evaluate(()=>global.__quitDraftFixture.events.filter(item=>item.channel==='app:save-cancelled'));
      assert.ok(cancellation.length>0);
      if(mode==='reject-retry')await app.evaluate(()=>{global.__quitDraftFixture.saveMode='success';});
      expected=latest+' + RETRY_LAST_CHARACTER';const retryAt=Date.now();await editor.fill(expected);await page.evaluate(()=>window.seekdesk.windowAction('close'));
      assert.ok(Date.now()-retryAt<500,'Retry must also beat the draft debounce');
      if(mode==='timeout-retry'){
        await until(async()=>closed||await app.evaluate(()=>global.__quitDraftFixture.events.filter(item=>item.channel==='app:update-prepare').length===2),'A fresh native quit preparation did not start');
        assert.equal(closed,false,'The retry must wait for the still-pending old save');
        assert.ok(await app.evaluate((_electron,latest)=>global.__quitDraftFixture.pending.some(item=>item.content===latest),latest),'The old save must still be pending when exit is retried');
        await app.evaluate((_electron,latest)=>{
          const state=global.__quitDraftFixture,old=state.pending.filter(item=>item.content===latest);
          state.pending=state.pending.filter(item=>item.content!==latest);for(const item of old)item.resolve();
        },latest);
        await until(async()=>closed||await app.evaluate((_electron,expected)=>global.__quitDraftFixture.pending.some(item=>item.content===expected),expected),'The fresh quit round did not save the newly edited text');
        assert.equal(closed,false,'A late old ACK must not complete the new quit round');
        assert.notEqual(await page.locator('.app-shell').getAttribute('inert'),null,'Old completion must not unlock the active save preparation');
        const fresh=await app.evaluate((_electron,expected)=>global.__quitDraftFixture.calls.find(item=>item.value?.content===expected),expected);
        assert.ok(fresh.time-retryAt<500,'Fresh exit must request the latest snapshot before automatic draft debounce');
        await app.evaluate(()=>{const state=global.__quitDraftFixture;state.saveMode='success';for(const item of state.pending.splice(0))item.resolve();});
      }
      check(mode==='reject-retry'?'Rejected draft saves keep the window open, unlock editing and allow retry':'Timed-out draft saves keep the window open, ignore stale completion and allow retry',{requestDelayMs:requestDelay,cancellations:cancellation.length});
    }
    await until(()=>closed,'Successful quit did not close the isolated application',22000);
    const features=JSON.parse(await fs.readFile(path.join(directory,'workspace-features.json'),'utf8'));
    assert.equal(features.drafts['4242']['reply:100001'].content,expected,'The last character must reach disk before process exit');
    const calls=JSON.parse(await fs.readFile(callsFile,'utf8')),events=JSON.parse(await fs.readFile(eventsFile,'utf8'));
    assert.ok(calls.some(call=>call.value?.content===expected));assert.ok(events.events.some(item=>item.channel==='app:update-prepare'));assert.equal(events.forumWrites.length,0);
    if(mode==='remembered-choice'){
      assert.ok(events.dialogs.some(item=>item.title==='关闭 SeekDesk Windows'&&item.response===1&&item.checkboxChecked));
      const desktop=JSON.parse(await fs.readFile(path.join(directory,'desktop-window.json'),'utf8'));assert.equal(desktop.closeBehavior,'quit');
    }
    check(mode==='remembered-choice'?'Remembered ask-to-exit flushes the last draft character and persists the exit preference':mode==='direct'?'Direct exit flushes a draft edited less than 500 ms before closing':'Retry exits only after the final edited character reaches disk',{mode,requestDelayMs:requestDelay,draftSaveCalls:calls.length});
  }catch(error){
    if(page&&!closed)await page.screenshot({path:path.join(output,mode+'-failure.png')}).catch(()=>{});throw error;
  }finally{
    // Only this fixture's isolated process is terminated if a regression prevents cleanup.
    if(app&&!closed)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
    if(app)await app.close().catch(()=>{});
  }
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  for(const mode of process.argv.includes('--update-only')?['update-event']:['direct','remembered-choice','reject-retry','timeout-retry','update-event'])await run(mode);
  assert.deepEqual(report.errors,[]);report.status='pass';
})().catch(error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
