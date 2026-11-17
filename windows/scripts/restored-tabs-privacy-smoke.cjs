// Restored reading metadata stays private until the current session reads the thread.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification','restored-tabs-privacy');
const secret={title:'OLD_PRIVATE_TITLE_SENTINEL',author:'OLD_PRIVATE_AUTHOR_SENTINEL',category:'OLD_PRIVATE_CATEGORY_SENTINEL',published:'2001-02-03T04:05:06.000Z',summary:'OLD_PRIVATE_SUMMARY_SENTINEL'};
const restoredUrl='https://www.nodeseek.com/post-880001-3#comment-17',newTitle='CURRENT_SESSION_TITLE_SENTINEL';
const report={testedAt:new Date().toISOString(),scope:'Isolated Electron profile; all forum IPC synthetic; network DNS blocked; no real account data.',checks:[],errors:[]};
let app,page;
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function until(predicate,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(message);}
const barrier=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
async function noPrivateMetadata(label){
  await barrier();
  const markup=await page.locator('body').evaluate(node=>node.outerHTML);
  for(const value of Object.values(secret))assert.ok(!markup.includes(value),label+' leaked '+value);
  assert.equal(await page.locator('.thread-heading h1').innerText(),'帖子 #880001');
  assert.equal(await page.locator('.reading-tab button[role=tab]').getAttribute('title'),'帖子 #880001');
  await page.locator('.tab-menu summary').click();
  assert.equal(await page.locator('.tab-menu .user-menu-items button').innerText(),'帖子 #880001');
  await page.locator('.thread-heading h1').click();
}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(project,'.test-data','restored-tabs-privacy-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project,'--host-resolver-rules=MAP * ~NOTFOUND'],env});
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.locator('.workspace').waitFor();
  await app.evaluate(({ipcMain,BrowserWindow},{secret,restoredUrl})=>{
    const account={status:'unknown'},settings={theme:'dark',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const extensions={installed:[],enabled:[],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作台',officeButton:'返回',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0};
    const restored={id:'880001',url:restoredUrl,...secret};
    const state=global.__restoredTabsPrivacy={account,reads:[],pending:[],writes:[],workspaceWrites:[],savedDrafts:[]};
    const mock=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
    mock('app:bootstrap',()=>({account,settings,workspace:{tabs:[restored],activeId:restored.id,overviewOpen:true,readingAnchors:{880001:{floor:'17',page:3,offset:80}}},version:'0.1.2',official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[]}));
    mock('parity:bootstrap',()=>({appearance:{brand:'blue',notificationPolling:false,autoRefresh:false,autoLoadOlder:false},extensions,media:{hasApiKey:false,defaultImageWidth:0},stickers:[],searchHistory:[]}));
    mock('forum:list',()=>({posts:[],source:'web',fetchedAt:new Date().toISOString(),nextPage:null}));
    mock('forum:thread',(_event,post,pageNumber)=>new Promise((resolve,reject)=>{state.reads.push({post,page:pageNumber,status:account.status,owner:account.id});state.pending.push({resolve,reject});}));
    mock('forum:profiles',(_event,request)=>({complete:true,outcomes:request.memberIds.map(memberId=>({memberId,status:'ready',profile:{memberId,level:2}}))}));
    mock('parity:query',(_event,request)=>request.kind==='account'?{profile:{id:account.id,name:account.name,coin:0},unread:{mentions:0,replies:0,messages:0}}:{});
    mock('forum:avatar',()=>null);mock('forum:open',()=>{});mock('app:external',()=>{});
    mock('forum:action',(_event,request)=>{state.writes.push(request);throw Error('Forum mutations are forbidden in this fixture');});
    mock('parity:write',(_event,request)=>{state.writes.push(request);throw Error('Forum writes are forbidden in this fixture');});
    mock('parity:draft-load',()=>null);mock('parity:draft-save',(_event,key,value,owner)=>{state.savedDrafts.push({key,value,owner});});
    mock('app:workspace',(_event,value)=>{state.workspaceWrites.push(value);});
    mock('media:stickers',()=>[]);mock('library:read',()=>({bookmarks:[],history:[]}));mock('library:mutate',()=>({bookmarks:[],history:[]}));
    const main=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:'));
    const send=main.webContents.send.bind(main.webContents);main.webContents.send=(channel,...args)=>{if(channel!=='forum:account-change')send(channel,...args);};
    state.changeAccount=value=>{for(const key of Object.keys(account))delete account[key];Object.assign(account,value);send('forum:account-change',{...account});};main.setSize(1440,960);
  },{secret,restoredUrl});
  await page.reload();await page.locator('.reading-tab').waitFor();
  await until(()=>app.evaluate(()=>global.__restoredTabsPrivacy.reads.length===1),'Unknown-session thread read did not start');
  await noPrivateMetadata('Unknown session with pending read');
  const first=await app.evaluate(()=>global.__restoredTabsPrivacy.reads[0]);
  assert.equal(first.post.id,'880001');assert.equal(first.post.url,restoredUrl);assert.equal(first.page,3);
  for(const key of ['author','category','published','summary'])assert.equal(first.post[key]||'','');
  assert.equal(first.post.title,'帖子 #880001');
  check('Unknown startup restores only a safe title and reading location in the reader, tab and tab list');

  await app.evaluate(()=>global.__restoredTabsPrivacy.pending[0].reject(Error('Synthetic session cannot read this thread')));
  await page.locator('.reader-error').waitFor();await noPrivateMetadata('Unknown session after failed read');
  await until(()=>app.evaluate(()=>global.__restoredTabsPrivacy.workspaceWrites.length>0),'Sanitized workspace was not saved');
  const saved=await app.evaluate(()=>global.__restoredTabsPrivacy.workspaceWrites.at(-1).tabs[0]);
  assert.equal(saved.id,'880001');assert.equal(saved.url,restoredUrl);assert.equal(saved.title,'帖子 #880001');
  for(const key of ['author','category','published','summary'])assert.equal(saved[key]||'','');
  check('Failed startup reads and workspace persistence cannot revive old metadata');

  await app.evaluate(()=>global.__restoredTabsPrivacy.changeAccount({status:'signed-out'}));
  await noPrivateMetadata('First signed-out confirmation');
  check('The first signed-out confirmation still hides restored private metadata');

  await app.evaluate(()=>global.__restoredTabsPrivacy.changeAccount({status:'signed-in',id:43,name:'Different synthetic account',level:2}));
  await until(()=>app.evaluate(()=>global.__restoredTabsPrivacy.reads.length===2),'New-account thread read did not start');
  await noPrivateMetadata('Different account with pending read');
  assert.ok(!(await page.locator('body').innerText()).includes(newTitle));
  assert.equal(await app.evaluate(()=>global.__restoredTabsPrivacy.reads[1].owner),43);
  check('A different signed-in account sees no old title while its own read is pending');

  await app.evaluate((_electron,{restoredUrl,newTitle})=>{
    global.__restoredTabsPrivacy.pending[1].resolve({id:'880001',url:restoredUrl,title:newTitle,category:'tech',source:'web',page:3,nextPage:null,pages:[{number:3,url:restoredUrl}],rootAuthorId:43,comments:[{id:'0',author:'Current session author',authorId:43,date:'2026-11-17T00:00:00.000Z',floor:'楼主',html:'<p>Current session content</p>',isAuthor:true,sourcePage:3},{id:'17',author:'Current session author',authorId:43,date:'2026-11-17T00:00:00.000Z',floor:'#17',html:'<p>Current session floor</p>',sourcePage:3}]});
  },{restoredUrl,newTitle});
  await until(async()=>await page.locator('.thread-heading h1').innerText()===newTitle,'Fresh session title did not appear');
  assert.equal(await page.locator('.reading-tab button[role=tab]').getAttribute('title'),newTitle);
  await page.locator('.tab-menu summary').click();assert.equal(await page.locator('.tab-menu .user-menu-items button').innerText(),newTitle);
  const finalMarkup=await page.locator('body').evaluate(node=>node.outerHTML);
  for(const value of Object.values(secret))assert.ok(!finalMarkup.includes(value));
  assert.equal(await app.evaluate(()=>global.__restoredTabsPrivacy.writes.length),0);assert.deepEqual(report.errors,[]);
  check('Only a successful read in the current session can expose the newly returned title');report.status='pass';
})().catch(async error=>{
  report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;
  if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
}).finally(async()=>{
  if(app)await app.close();await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
});
