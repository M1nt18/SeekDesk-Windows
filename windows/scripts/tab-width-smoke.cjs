'use strict';

// Synthetic public posts and an isolated application profile. No real forum
// requests, credentials, account writes, browser launch, or installation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {_electron: electron} = require('playwright-core');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'verification', 'tab-width');
const titles = ['短标题', '这是中等长度的帖子标题', '这是一个很长的帖子标题，用来验证所有已打开标签都保持相同宽度，文字省略显示但完整标题仍可查看。'.repeat(2)];
const report = {checks:[], measurements:[], errors:[], scope:'Actual renderer with isolated IPC fixtures'};
let app, page;
const check = name => {report.checks.push(name); console.log('PASS', name);};
const tabOrder = () => page.locator('.reading-tab > button[role="tab"]').evaluateAll(buttons=>buttons.map(button=>button.title));

(async()=>{
  await fs.mkdir(output,{recursive:true});
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(project,'.test-data','tab-width-'+Date.now())};
  delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await electron.launch({executablePath:require('electron'),args:[project,'--host-resolver-rules=MAP * ~NOTFOUND'],env});
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await app.evaluate(({ipcMain,BrowserWindow},{titles,version})=>{
    const settings={theme:'light',uiFontSize:16,fontSize:18,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const appearance={brand:'blue',readerGradient:true,sidebarWidth:250,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'split',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
    const extensions={installed:[],enabled:[],blocked:[],hits:[],unread:0,hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,watchWords:'',watchNote:''};
    const posts=titles.map((title,index)=>({id:String(920101+index),url:'https://www.nodeseek.com/post-'+(920101+index)+'-1',title,author:'示例作者',authorId:42,category:'tech',published:'2026-11-13T00:00:00Z',summary:''}));
    const mock=(name,handler)=>{ipcMain.removeHandler(name);ipcMain.handle(name,handler);};
    mock('app:bootstrap',()=>({settings,workspace:{tabs:[],activeId:null,overviewOpen:true},account:{status:'signed-out'},official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[],version}));
    mock('parity:bootstrap',()=>({appearance,extensions,stickers:[],searchHistory:[],media:{hasApiKey:false,defaultImageWidth:0}}));
    mock('forum:list',()=>({posts,nextPage:null,source:'web',fetchedAt:new Date().toISOString()}));
    mock('forum:thread',(_event,post,page=1)=>({id:post.id,url:post.url,title:post.title,page,nextPage:null,source:'web',comments:[{id:'0',floor:'楼主',author:'示例作者',authorId:42,level:1,isAuthor:true,date:'2026-11-13T00:00:00Z',html:'<p>用于标签布局检查的固定公开内容。</p>'}]}));
    mock('forum:profiles',()=>({outcomes:[{memberId:42,status:'ready',profile:{memberId:42,level:1}}],complete:true}));
    mock('forum:avatar',()=>null);mock('parity:query',()=>({}));mock('app:workspace',()=>{});
    mock('extensions:get',()=>extensions);mock('extensions:ranking',()=>({period:'realtime',items:[],fetchedAt:new Date().toISOString()}));
    mock('app:external',()=>{throw Error('No browser or external links in tab QA');});
    BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).setSize(1600,960);
  },{titles,version:require('../package.json').version});
  await page.reload();await page.getByTestId('post-row').nth(2).waitFor();
  await page.getByTestId('post-row').nth(0).click();
  await page.getByTestId('reader-content').first().waitFor();
  await page.getByTestId('post-row').nth(1).click({modifiers:['Control']});
  await page.getByTestId('post-row').nth(2).click({modifiers:['Control']});
  await page.waitForFunction(()=>document.querySelectorAll('.reading-tab').length===3);
  assert.deepEqual(await tabOrder(),titles);
  assert.equal(await page.locator('.reading-tab.current').count(),1);
  check('Short, medium and long topic titles open as active and background tabs with their full tooltip titles');

  for(const size of [1600,980])for(const theme of ['light','dark'])for(const fontSize of [14,16,28]){
    await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).setSize(size,900),size);
    await page.evaluate(({theme,fontSize})=>{document.documentElement.dataset.theme=theme;document.documentElement.style.setProperty('--ui-font-size',fontSize+'px');}, {theme,fontSize});
    const metrics=await page.locator('.reading-tab').evaluateAll(tabs=>tabs.map(tab=>{
      const text=tab.querySelector('button[role=tab] span'),close=tab.querySelector('.icon-button'),button=tab.querySelector('button[role=tab]'),rect=tab.getBoundingClientRect(),closeRect=close.getBoundingClientRect();
      return {width:rect.width,closeWidth:closeRect.width,closeInside:closeRect.left>=rect.left&&closeRect.right<=rect.right+1,title:button.title,ellipsis:getComputedStyle(text).textOverflow,clipped:text.scrollWidth>text.clientWidth};
    }));
    assert.equal(metrics.length,3);assert.ok(Math.max(...metrics.map(x=>x.width))-Math.min(...metrics.map(x=>x.width))<0.5);
    assert.ok(metrics.every(row=>Math.abs(row.width-fontSize*13)<0.5&&row.closeWidth>=21&&row.closeInside));
    assert.ok(metrics.every(row=>row.ellipsis==='ellipsis'));assert.equal(metrics[2].clipped,true);
    assert.deepEqual(metrics.map(row=>row.title),titles);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    report.measurements.push({size,theme,fontSize,width:metrics[0].width});
    if(size===1600&&theme==='light'&&fontSize===16||size===980&&theme==='dark'&&fontSize===28)await page.screenshot({path:path.join(output,`tabs-${theme}-${size}-${fontSize}.png`)});
  }
  const scroll=await page.locator('.tabs').evaluate(node=>{node.scrollLeft=0;const overflow=node.scrollWidth>node.clientWidth;node.scrollLeft=node.scrollWidth;return {overflow,moved:node.scrollLeft>0};});
  assert.deepEqual(scroll,{overflow:true,moved:true});
  check('All topic tabs have equal 13rem widths across light/dark, 14/16/28px and wide/narrow windows; overflow scrolls instead of shrinking tabs');

  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).setSize(1600,960));
  await page.evaluate(()=>document.documentElement.style.setProperty('--ui-font-size','16px'));
  await page.locator('.tabs').evaluate(node=>node.scrollLeft=0);
  await page.locator('.reading-tab').nth(0).dragTo(page.locator('.reading-tab').nth(2));
  await page.waitForFunction(first=>document.querySelector('.reading-tab button[role=tab]')?.title===first,titles[1]);
  assert.deepEqual(await tabOrder(),[titles[1],titles[2],titles[0]]);
  await page.getByRole('button',{name:'关闭标签：'+titles[0],exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.reading-tab').length===2);
  assert.deepEqual(await tabOrder(),[titles[1],titles[2]]);
  assert.deepEqual(await page.locator('.reading-tab').evaluateAll(tabs=>tabs.map(tab=>Math.round(tab.getBoundingClientRect().width))),[208,208]);
  check('Dragging and closing tabs retain their existing behavior and the remaining labels stay the same width');
  assert.deepEqual(report.errors,[]);check('No renderer exceptions, real forum requests or user profile data were used');report.status='pass';
})().catch(error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{
  if(app)await app.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
});
