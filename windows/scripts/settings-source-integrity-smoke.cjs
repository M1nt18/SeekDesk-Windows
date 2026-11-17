'use strict';
// Regression protection for transactional settings saves and the current listing route.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {_electron}=require('playwright-core');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification','settings-source-integrity');
const report={testedAt:new Date().toISOString(),scope:'Transaction regression protection; isolated profile; synthetic settings/forum IPC; blocked network DNS.',checks:[],errors:[]};
let app,page;
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function until(predicate,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(message);}
const barrier=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const sourceSelect=()=>page.locator('.setting-row').filter({hasText:'内容来源'}).locator('select');
const fixture=()=>app.evaluate(()=>({source:global.__settingsSourceIntegrity.settings.defaultSource,reads:global.__settingsSourceIntegrity.reads,saves:global.__settingsSourceIntegrity.saves.map(save=>({value:save.value,status:save.status})),writes:global.__settingsSourceIntegrity.writes}));
async function board(name){await page.getByRole('button',{name:'返回论坛',exact:true}).click();await page.getByRole('button',{name:'论坛版块',exact:true}).click();await page.locator('.board-nav').getByRole('button',{name,exact:true}).click();}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(project,'.test-data','settings-source-integrity-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project,'--host-resolver-rules=MAP * ~NOTFOUND'],env,timeout:45000});
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.locator('.workspace').waitFor();
  await app.evaluate(({ipcMain,BrowserWindow})=>{
    const settings={theme:'light',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const account={status:'signed-out'},extensions={installed:[],enabled:[],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'Work',officeButton:'Return',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0};
    const state=global.__settingsSourceIntegrity={settings,reads:[],saves:[],writes:[]};
    const mock=(name,handler)=>{ipcMain.removeHandler(name);ipcMain.handle(name,handler);};
    mock('app:bootstrap',()=>({account,settings,workspace:{tabs:[],activeId:null,overviewOpen:true},official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[],version:'0.1.2'}));
    mock('parity:bootstrap',()=>({extensions,appearance:{brand:'blue',notificationPolling:false,autoRefresh:false,autoLoadOlder:false},media:{hasApiKey:false,defaultImageWidth:0},stickers:[],searchHistory:[]}));
    mock('forum:list',(_event,request)=>{
      const category=request.category||'',source=settings.defaultSource;state.reads.push({category,source,page:request.page||1});
      return {posts:[{id:'890001',url:'https://www.nodeseek.com/post-890001-1',title:'Synthetic '+(category||'home')+' from '+source,author:'Synthetic author',category:category||'daily',published:new Date().toISOString(),summary:''}],source:source==='rss'?'rss':'web',fetchedAt:new Date().toISOString(),nextPage:null};
    });
    mock('app:settings',(_event,value)=>new Promise((resolve,reject)=>{
      const requested={...value},save={value:requested,status:'pending'};state.saves.push(save);
      save.succeed=()=>{Object.assign(settings,requested);save.status='committed';resolve({...settings});};
      save.fail=()=>{save.status='rejected';reject(Error('Synthetic transactional save failure'));};
    }));
    mock('app:workspace',()=>{});mock('forum:avatar',()=>null);mock('parity:query',()=>({}));mock('app:desktop-preferences',()=>({closeBehavior:'ask'}));
    mock('forum:action',(_event,value)=>{state.writes.push(value);throw Error('Forum writes are forbidden in this fixture');});
    mock('parity:write',(_event,value)=>{state.writes.push(value);throw Error('Forum writes are forbidden in this fixture');});
    mock('media:stickers',()=>[]);mock('library:read',()=>({bookmarks:[],history:[]}));mock('library:mutate',()=>({bookmarks:[],history:[]}));
    const main=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')),send=main.webContents.send.bind(main.webContents);
    main.webContents.send=(channel,...args)=>{if(channel!=='forum:account-change')send(channel,...args);};main.setSize(1440,960);
  });
  await page.reload();await page.getByTestId('post-row').waitFor();
  await page.getByTestId('settings-button').click();await sourceSelect().waitFor();
  assert.equal(await sourceSelect().inputValue(),'auto');
  const beforePending=(await fixture()).reads.length;
  await sourceSelect().selectOption('rss');
  await until(async()=>(await fixture()).saves.length===1,'Deferred source save did not start');await barrier();await barrier();
  assert.equal(await sourceSelect().inputValue(),'rss');
  assert.equal((await fixture()).source,'auto');assert.equal((await fixture()).reads.length,beforePending);
  check('An optimistic source selection does not refresh before the main-process transaction commits');

  await board('技术');
  await until(async()=>(await fixture()).reads.at(-1)?.category==='tech','Pending-save navigation did not load the selected board');
  assert.equal((await fixture()).reads.at(-1).source,'auto');
  const beforeCommit=(await fixture()).reads.length;
  await app.evaluate(()=>global.__settingsSourceIntegrity.saves[0].succeed());
  await until(async()=>(await fixture()).reads.length>beforeCommit,'Committed source save did not refresh the current board');await barrier();
  const afterCommit=await fixture();
  assert.equal(afterCommit.source,'rss');assert.deepEqual(afterCommit.reads.slice(beforeCommit),[{category:'tech',source:'rss',page:1}]);
  assert.equal(await page.locator('.list-heading h1').innerText(),'技术');
  assert.match(await page.getByTestId('post-row').innerText(),/Synthetic tech from rss/);
  assert.equal(await page.getByTestId('list-source').innerText(),'公开 RSS');
  check('A completed source save refreshes the current board instead of its earlier navigation closure');

  await page.getByTestId('settings-button').click();await sourceSelect().waitFor();assert.equal(await sourceSelect().inputValue(),'rss');
  const beforeFailure=(await fixture()).reads.length;
  await sourceSelect().selectOption('auto');
  await until(async()=>(await fixture()).saves.length===2,'Failing source save did not start');await barrier();await barrier();
  assert.equal(await sourceSelect().inputValue(),'auto');assert.equal((await fixture()).source,'rss');assert.equal((await fixture()).reads.length,beforeFailure);
  await app.evaluate(()=>global.__settingsSourceIntegrity.saves[1].fail());
  await until(async()=>await sourceSelect().inputValue()==='rss','Failed source save did not restore the committed UI value');await barrier();
  assert.equal((await fixture()).source,'rss');assert.equal((await fixture()).reads.length,beforeFailure);
  assert.equal((await fixture()).saves[1].status,'rejected');
  await page.getByRole('button',{name:'返回论坛',exact:true}).click();
  await page.locator('.board-nav').getByRole('button',{name:'日常',exact:true}).click();
  await until(async()=>(await fixture()).reads.at(-1)?.category==='daily','Post-failure navigation did not load the next board');
  assert.equal((await fixture()).reads.at(-1).source,'rss');
  await until(async()=>(await page.getByTestId('post-row').innerText()).includes('Synthetic daily from rss'),'Daily board response did not commit to the DOM');
  assert.match(await page.getByTestId('post-row').innerText(),/Synthetic daily from rss/);
  check('A rejected save rolls back the control without reading or committing the failed source');

  assert.equal((await fixture()).writes.length,0);assert.deepEqual(report.errors,[]);report.status='pass';
})().catch(async error=>{
  report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;
  if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
}).finally(async()=>{
  if(app){report.fixture=await fixture().catch(()=>undefined);await app.close();}
  await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
});
