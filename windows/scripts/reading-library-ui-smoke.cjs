// Production React and sandboxed preload, with account-scoped synthetic library data.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification','reading-library-ui');
const report={checks:[],errors:[],scope:'Isolated test profile and in-memory IPC fixtures; no user library, browser state, credentials, or forum writes.'};
let app,page;
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function until(predicate,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,35));}throw Error(message);}
const barrier=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const dialog=()=>page.getByRole('dialog',{name:'阅读资料库',exact:true});
async function openLibrary(){await page.keyboard.press('Control+Shift+L');await dialog().waitFor();await until(async()=>!(await dialog().locator('.reading-library-list').getAttribute('aria-busy')==='true'),'Library read did not settle');}
async function mode(label){await dialog().getByRole('button',{name:label,exact:true}).click();await barrier();}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(project,'.test-data','reading-library-ui-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project,'--host-resolver-rules=MAP * ~NOTFOUND'],env});page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await app.evaluate(({ipcMain,BrowserWindow})=>{
    const now='2026-11-14T02:00:00.000Z',account={id:42,name:'合成资料库账号',status:'signed-in',level:4};
    const settings={theme:'light',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const appearance={brand:'blue',readerGradient:false,sidebarWidth:228,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'edit',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
    const extensions={installed:[],enabled:[],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作台',officeButton:'返回',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0};
    const post=(id,title,author='合成作者',pageNumber=1)=>({id,url:'https://www.nodeseek.com/post-'+id+'-'+pageNumber,title,author,authorId:100,category:'tech',published:now,summary:''});
    const posts=[post('810001','相同标题'),post('810002','相同标题','另一作者'),post('810003','ＣＡＦÉ project node'),post('810004','当前阅读主题')];
    const entry=post=>({post,visitedAt:now});
    const libraries={42:{bookmarks:posts.slice(0,3).map((item,index)=>entry(index===1?{...item,url:'https://www.nodeseek.com/post-810002-2'}:item)),history:posts.slice(0,2).map(entry)},43:{bookmarks:[entry(post('819999','另一个账号的本地记录'))],history:[]},public:{bookmarks:[],history:[]}};
    const state=global.__readingLibraryUi={account,settings,posts,libraries,listReads:0,threadReads:[],official:[],copied:[],mutations:[],forumWrites:[],workspace:{tabs:[],activeId:null,overviewOpen:true},defer42:false,failMutation:false};
    const clone=value=>JSON.parse(JSON.stringify(value));
    const own=owner=>{if(owner!==state.account.id)throw Error('The synthetic owner changed');return libraries[owner||'public'];};
    const mock=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
    mock('app:bootstrap',()=>({account,settings,workspace:state.workspace,version:'0.1.1',official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[]}));
    mock('parity:bootstrap',()=>({appearance,extensions,media:{hasApiKey:false,defaultImageWidth:0},stickers:[],searchHistory:[]}));
    mock('forum:list',()=>{state.listReads++;return {posts,source:'web',fetchedAt:now,nextPage:null};});
    mock('forum:thread',(_event,p,pageNumber=1)=>{state.threadReads.push({id:p.id,page:pageNumber});return {id:p.id,url:'https://www.nodeseek.com/post-'+p.id+'-'+pageNumber,title:p.title||'Synthetic post',source:'web',page:pageNumber,nextPage:null,comments:[{id:'0',author:p.author||'合成作者',authorId:100,date:now,floor:'楼主',html:'<p>资料库打开的原生阅读正文。</p>',isAuthor:true,sourcePage:pageNumber}]};});
    mock('forum:profiles',(_event,request)=>({complete:true,outcomes:request.memberIds.map(memberId=>({memberId,status:'ready',profile:{memberId,level:4}}))}));
    mock('forum:avatar',()=>null);mock('forum:open',(_event,url)=>{state.official.push(url);});
    mock('forum:action',(_event,request)=>{state.forumWrites.push(request);throw Error('No forum writes permitted');});
    mock('parity:query',(_event,request)=>request.kind==='account'?{profile:{id:account.id,name:account.name,coin:0},unread:{mentions:0,replies:0,messages:0}}:{});
    mock('parity:draft-load',()=>null);mock('parity:draft-save',()=>{});mock('media:stickers',()=>[]);mock('media:prepare',(_event,value)=>value);
    mock('app:workspace',(_event,value)=>{state.workspace=value;});
    mock('app:clipboard',(_event,value)=>{state.copied.push(value);});
    mock('library:read',(_event,owner)=>{const result=clone(own(owner));if(owner===42&&state.defer42){state.defer42=false;return new Promise(resolve=>{state.release42=()=>resolve(result);});}return result;});
    mock('library:mutate',async(_event,request,owner)=>{
      const library=own(owner);state.mutations.push({owner,request});if(state.failMutation){state.failMutation=false;throw Error('Synthetic local write failure');}
      if(request.kind==='visit'&&state.holdNextVisit){state.holdNextVisit=false;await new Promise(resolve=>{state.releaseVisit=resolve;});}
      if(request.kind==='visit'){library.history=[entry(request.post),...library.history.filter(item=>item.post.id!==request.post.id)].slice(0,200);}
      else if(request.kind==='bookmark-add'){if(!library.bookmarks.some(item=>item.post.id===request.post.id))library.bookmarks.unshift(entry(request.post));}
      else if(request.kind==='bookmark-toggle'){const found=library.bookmarks.some(item=>item.post.id===request.post.id);library.bookmarks=found?library.bookmarks.filter(item=>item.post.id!==request.post.id):[entry(request.post),...library.bookmarks];}
      else if(request.kind==='bookmark-remove')library.bookmarks=library.bookmarks.filter(item=>item.post.id!==request.postId);
      else if(request.kind==='history-remove')library.history=library.history.filter(item=>item.post.id!==request.postId);
      else if(request.kind==='clear-bookmarks')library.bookmarks=[];
      else if(request.kind==='clear-history')library.history=[];
      return clone(library);
    });
    const main=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')),send=main.webContents.send.bind(main.webContents);main.webContents.send=(channel,...args)=>{if(channel!=='forum:account-change')send(channel,...args);};state.accountEvent=value=>send('forum:account-change',value);main.setSize(1440,960);
  });
  await page.reload();await page.getByTestId('post-row').last().waitFor();await page.getByTestId('post-row').nth(1).click();await page.getByTestId('reader-content').first().waitFor();await until(()=>app.evaluate(()=>global.__readingLibraryUi.threadReads.some(item=>item.id==='810002'&&item.page===1)),'Existing page-one tab did not open');await page.getByTestId('post-row').last().click();await page.getByTestId('reader-content').first().waitFor();
  await openLibrary();assert.equal(await dialog().locator('.reading-library-row').count(),3);assert.equal(await dialog().locator('.reading-library-open strong').filter({hasText:'相同标题'}).count(),2);
  const input=dialog().getByRole('textbox',{name:'搜索资料库',exact:true});await input.fill('cafe');assert.equal(await dialog().locator('.reading-library-row').count(),1);assert.match(await dialog().locator('.reading-library-open strong').innerText(),/ＣＡＦÉ/);await input.fill('810002');assert.equal(await dialog().locator('.reading-library-row').count(),1);assert.equal(await dialog().locator('.reading-library-row').getAttribute('data-post-id'),'810002');
  check('The library keeps same-title post IDs distinct and uses the existing normalized title/author/ID search');
  await input.press('ArrowDown');assert.equal(await dialog().locator('.reading-library-open').evaluate(node=>node===document.activeElement),true);await page.keyboard.press('ArrowUp');assert.equal(await input.evaluate(node=>node===document.activeElement),true);await input.press('Enter');await dialog().waitFor({state:'hidden'});await until(()=>app.evaluate(()=>global.__readingLibraryUi.threadReads.some(item=>item.id==='810002'&&item.page===2)),'A stored page did not open in the native reader');assert.equal((await app.evaluate(()=>global.__readingLibraryUi.official)).length,0);
  check('A record opens its official URL in native reading instead of guessing a title or opening a web view');

  await openLibrary();await dialog().getByRole('button',{name:'移除 相同标题',exact:true}).first().click();await until(async()=>await dialog().locator('.reading-library-row').count()===2,'Bookmark removal did not update the list');
  await dialog().getByRole('button',{name:'复制资料库 JSON',exact:true}).click();await until(()=>app.evaluate(()=>global.__readingLibraryUi.copied.length===1),'JSON copy did not finish');const exported=JSON.parse((await app.evaluate(()=>global.__readingLibraryUi.copied))[0]);assert.equal(exported.bookmarks.length,2);assert.ok(Array.isArray(exported.history));assert.ok(!JSON.stringify(exported).includes('另一个账号的本地记录'));
  await mode('阅读历史');assert.ok(await dialog().locator('.reading-library-row').count()>0);await dialog().getByRole('button',{name:'清空当前列表',exact:true}).click();await dialog().getByRole('alertdialog',{name:'清空阅读历史',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await dialog().getByRole('alertdialog').count(),0);assert.ok(await dialog().locator('.reading-library-row').count()>0);
  await dialog().getByRole('button',{name:'清空当前列表',exact:true}).click();await dialog().getByRole('button',{name:'确认清空',exact:true}).click();await dialog().getByText('还没有阅读记录',{exact:true}).waitFor();assert.equal((await app.evaluate(()=>global.__readingLibraryUi.libraries[42].bookmarks)).length,2);
  await page.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});await openLibrary();await mode('阅读历史');await dialog().getByText('还没有阅读记录',{exact:true}).waitFor();assert.equal((await app.evaluate(()=>global.__readingLibraryUi.libraries[42].history)).length,0);
  await mode('快捷操作');const beforeRefresh=await app.evaluate(()=>global.__readingLibraryUi.threadReads.length);await dialog().getByRole('textbox',{name:'搜索快捷操作',exact:true}).fill('刷新当前帖子');await dialog().getByRole('textbox',{name:'搜索快捷操作',exact:true}).press('Enter');await until(()=>app.evaluate((_electron,before)=>global.__readingLibraryUi.threadReads.length>before,beforeRefresh),'Explicit native refresh did not complete');await until(()=>app.evaluate(()=>global.__readingLibraryUi.libraries[42].history.some(item=>item.post.id==='810002')),'A completed explicit reading visit was not recorded');await openLibrary();await mode('阅读历史');await dialog().locator('.reading-library-row[data-post-id="810002"]').waitFor();assert.equal((await app.evaluate(()=>global.__readingLibraryUi.libraries[42].bookmarks.find(item=>item.post.id==='810002').post.url)),'https://www.nodeseek.com/post-810002-2');
  check('Explicit removal, current-account JSON copy and cancelable history clearing leave bookmarks intact');

  await mode('本地书签');const before=await dialog().locator('.reading-library-row').count();await app.evaluate(()=>{global.__readingLibraryUi.failMutation=true;});await dialog().getByRole('button',{name:'移除 相同标题',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.equal(await dialog().locator('.reading-library-row').count(),before);await dialog().getByRole('button',{name:'移除 相同标题',exact:true}).click();await until(async()=>await dialog().locator('.reading-library-row').count()===before-1,'Failed local mutation was not retryable');
  check('A failed local mutation preserves the visible record and supports a deliberate retry');

  await mode('快捷操作');const reads=await app.evaluate(()=>global.__readingLibraryUi.listReads);await dialog().getByRole('textbox',{name:'搜索快捷操作',exact:true}).fill('刷新帖子列表');await dialog().getByRole('textbox',{name:'搜索快捷操作',exact:true}).press('Enter');await dialog().waitFor({state:'hidden'});await until(async()=>await app.evaluate(()=>global.__readingLibraryUi.listReads)>reads,'Refresh command did not reach the list handler');
  await page.keyboard.press('Control+Shift+P');await dialog().getByRole('textbox',{name:'搜索快捷操作',exact:true}).waitFor();await dialog().locator('.reading-command-row').filter({hasText:'全局搜索'}).click();await page.getByRole('dialog',{name:/搜索/}).waitFor();assert.equal(await dialog().count(),0);await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+B');await until(()=>app.evaluate(()=>global.__readingLibraryUi.mutations.some(item=>item.request.kind==='bookmark-add'&&item.request.post.id==='810002')),'Bookmark shortcut did not reach the authoritative current post');
  await until(()=>app.evaluate(()=>global.__readingLibraryUi.libraries[42].bookmarks.some(item=>item.post.id==='810002')),'The initial bookmark did not commit');
  const pinned=await app.evaluate(()=>global.__readingLibraryUi.libraries[42].bookmarks.find(item=>item.post.id==='810002'));
  await app.evaluate(()=>{global.__readingLibraryUi.holdNextVisit=true;global.__readingLibraryUi.releaseVisit=undefined;});await page.reload();await page.getByTestId('reader-content').first().waitFor();await until(()=>app.evaluate(()=>typeof global.__readingLibraryUi.releaseVisit==='function'),'Startup history write did not reach its gate');
  const addCount=await app.evaluate(()=>global.__readingLibraryUi.mutations.filter(item=>item.request.kind==='bookmark-add').length);await page.keyboard.press('Control+Shift+B');await barrier();await app.evaluate(()=>global.__readingLibraryUi.releaseVisit());await until(()=>app.evaluate((_electron,before)=>global.__readingLibraryUi.mutations.filter(item=>item.request.kind==='bookmark-add').length>before,addCount),'An immediate startup bookmark did not reach the idempotent add');assert.deepEqual(await app.evaluate(()=>global.__readingLibraryUi.libraries[42].bookmarks.find(item=>item.post.id==='810002')),pinned);
  check('Command and bookmark shortcuts invoke actual React actions without DOM selector injection');

  await openLibrary();await mode('更新内容');await dialog().getByRole('heading',{name:'本地阅读资料库',exact:true}).waitFor();assert.ok(!(await dialog().innerText()).includes('未改动您桌面上的原始压缩包'));await mode('本地书签');
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await barrier();await page.screenshot({path:path.join(output,'library-'+theme+'.png')});
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).setSize(980,760));await page.waitForFunction(()=>innerWidth<=980);await barrier();const geometry=await dialog().evaluate(node=>({left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,width:innerWidth,body:document.documentElement.scrollWidth}));assert.ok(geometry.left>=0&&geometry.right<=geometry.width+1&&geometry.body<=geometry.width);await page.screenshot({path:path.join(output,'library-narrow.png')});
  await page.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});assert.equal(await page.locator('.reading-panel .thread-heading').count(),1);
  check('Updated change notes, light/dark rendering, narrow layout and Escape keep native reading intact');

  await app.evaluate(()=>{global.__readingLibraryUi.defer42=true;});await page.keyboard.press('Control+Shift+L');await dialog().waitFor();await until(()=>app.evaluate(()=>typeof global.__readingLibraryUi.release42==='function'),'Deferred account read did not start');await app.evaluate(()=>{const state=global.__readingLibraryUi;state.account.id=43;state.account.name='另一合成账号';state.accountEvent({...state.account});});await barrier();if(await dialog().count())await page.keyboard.press('Escape');await openLibrary();await dialog().getByText('另一个账号的本地记录',{exact:true}).waitFor();await app.evaluate(()=>global.__readingLibraryUi.release42());await barrier();assert.equal(await dialog().getByText('相同标题',{exact:true}).count(),0);assert.equal(await dialog().getByText('ＣＡＦÉ project node',{exact:true}).count(),0);assert.equal(await dialog().locator('.reading-library-row').count(),1);
  check('A late old-account library read cannot refill another account’s records');
  assert.equal((await app.evaluate(()=>global.__readingLibraryUi.forumWrites)).length,0);assert.deepEqual(report.errors,[]);check('No renderer exception, real forum write, private profile, credential or installation was used');report.status='pass';
})().catch(async error=>{report.status='fail';report.failure=error.stack;console.error(error);if(app)report.fixture=await app.evaluate(()=>({reads:global.__readingLibraryUi?.threadReads,mutations:global.__readingLibraryUi?.mutations,forumWrites:global.__readingLibraryUi?.forumWrites})).catch(()=>undefined);if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close();await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
