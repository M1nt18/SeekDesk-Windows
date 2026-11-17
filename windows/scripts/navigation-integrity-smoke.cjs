// Original-reader layout and click-path checks with synthetic accounts and IPC only.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification','navigation-integrity');
const report={testedAt:new Date().toISOString(),checks:[],errors:[],scope:'Production React and sandboxed preload; isolated profile; all forum requests are synthetic.'};
let app,page;
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function until(predicate,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(message);}
const barrier=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const rows=()=>page.getByTestId('post-row');
async function open(index){await rows().nth(index).click();await page.locator('.comment[data-floor="0"]').waitFor();await barrier();}
async function capture(name){await page.screenshot({path:path.join(output,name)});}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(project,'.test-data','navigation-integrity-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project,'--host-resolver-rules=MAP * ~NOTFOUND'],env});page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await app.evaluate(({ipcMain,BrowserWindow})=>{
    const now=new Date().toISOString(),account={id:42,name:'Synthetic reader',status:'signed-in',level:4};
    const settings={theme:'dark',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const appearance={brand:'blue',readerGradient:false,sidebarWidth:250,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'edit',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
    const extensions={installed:['block','authorOnly','rulings'],enabled:['block','authorOnly','rulings'],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作台',officeButton:'返回',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0};
    const posts=Array.from({length:12},(_,index)=>({id:String(710001+index),url:'https://www.nodeseek.com/post-'+(710001+index)+'-1',title:['单层主题','单页多楼层主题','私有精品锁定主题'][index]||'等宽及键盘切换测试主题 '+(index+1),author:'Author '+(100+index),authorId:100+index,category:'daily',published:now,summary:'',...(index===2?{readingRank:255,featured:true}:{})}));
    const state=global.__navigationIntegrity={account,settings,appearance,extensions,posts,official:[],external:[],writes:[],reads:[],drafts:{},drag:[],historyWrites:[],workspace:{tabs:[],activeId:null,overviewOpen:true}};
    const mock=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
    mock('app:bootstrap',()=>({account,settings,workspace:state.workspace,version:'0.1.1',official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[]}));
    mock('parity:bootstrap',()=>({appearance,extensions,media:{hasApiKey:false,defaultImageWidth:0},stickers:[],searchHistory:[]}));
    mock('forum:list',()=>{state.listReads=(state.listReads||0)+1;return {posts,source:'web',fetchedAt:now,nextPage:null};});
    mock('forum:thread',(_event,post,pageNumber=1)=>{
      state.reads.push({id:post.id,page:pageNumber});
      const index=posts.findIndex(item=>item.id===post.id),postInfo=posts[index]||post;
      const long=index===2?Array.from({length:65},(_,i)=>'<p>分页长正文段落 '+i+'</p>').join(''):'<p>原帖正文</p>';
      const op={id:'0',author:postInfo.author,authorId:postInfo.authorId,date:now,floor:'楼主',html:long,isAuthor:true,sourcePage:1,actionUrl:postInfo.url+'#0'};
      const replies=index===0?[]:[{id:'1',author:'Other author',authorId:900,date:now,floor:'#1',html:'<p>普通楼层回复</p>',sourcePage:pageNumber,actionUrl:'https://www.nodeseek.com/post-'+post.id+'-'+pageNumber+'#1',likes:0,chicken:0,dislikes:0}];
      return {id:post.id,url:'https://www.nodeseek.com/post-'+post.id+'-'+pageNumber,title:postInfo.title,category:'tech',source:'web',page:pageNumber,nextPage:index===2&&pageNumber===1?2:null,pages:index===2?[{number:1,url:postInfo.url},{number:2,url:'https://www.nodeseek.com/post-'+post.id+'-2'}]:[{number:1,url:postInfo.url}],rootAuthorId:postInfo.authorId,replyRestriction:index===2?'已锁定':undefined,comments:[op,...replies]};
    });
    mock('forum:profiles',(_event,request)=>({complete:true,outcomes:request.memberIds.map(memberId=>({memberId,status:'ready',profile:{memberId,level:4,role:memberId===100?'认证成员 · 管理员':undefined}}))}));
    mock('forum:open',(_event,url)=>{state.official.push(url||'https://www.nodeseek.com/signIn.html');});
    mock('extensions:rulings',()=>({records:[]}));mock('forum:avatar',()=>null);mock('app:external',(_event,url)=>{state.external.push(url);});
    mock('forum:action',(_event,request,owner)=>{state.writes.push({request,owner});return {message:'Synthetic action accepted'};});
    mock('parity:query',(_event,request)=>request.kind==='account'?{profile:{id:42,name:account.name,coin:10},unread:{mentions:0,replies:0,messages:0}}:{});
    mock('parity:draft-load',(_event,key,owner)=>owner===42?state.drafts[key]||null:null);
    mock('parity:draft-save',(_event,key,value,owner)=>{if(owner!==42)throw Error('Wrong synthetic owner');if(value)state.drafts[key]=value;else delete state.drafts[key];});
    mock('extensions:save',(_event,value)=>{Object.assign(extensions,value);return extensions;});
    mock('app:blocked-users',(_event,value)=>value);
    mock('app:workspace',(_event,value)=>{state.workspace=value;});
    mock('parity:history',(_event,value)=>{state.historyWrites.push(value);});
    mock('media:prepare',(_event,content)=>content);mock('media:stickers',()=>[]);
    const main=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:'));const send=main.webContents.send.bind(main.webContents);main.webContents.send=(channel,...args)=>{if(channel!=='forum:account-change')send(channel,...args);};state.accountEvent=value=>send('forum:account-change',value);main.setSize(1440,960);
  });
  await page.reload();await rows().first().waitFor();
  const activeTab=()=>page.locator('.reading-tab.current').getAttribute('data-tab-id');
  const order=()=>page.locator('.reading-tab').evaluateAll(nodes=>nodes.map(node=>node.dataset.tabId));

  await rows().nth(0).focus();await page.keyboard.press('ArrowDown');
  assert.equal(await rows().nth(1).evaluate(node=>node===document.activeElement),true);
  assert.equal(await rows().nth(1).evaluate(node=>node.classList.contains('keyboard-selected')),true);
  await page.keyboard.press('ArrowUp');assert.equal(await rows().nth(0).evaluate(node=>node===document.activeElement),true);
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  await until(async()=>await activeTab()==='710002','Enter did not open the focused second list row');
  await page.locator('.comment[data-floor="0"]').waitFor();
  assert.equal(await app.evaluate(()=>global.__navigationIntegrity.reads.filter(item=>item.id==='710002').length),1);
  await rows().nth(2).focus();await page.keyboard.press('Control+Enter');await barrier();
  assert.equal(await page.locator('.reading-tab[data-tab-id="710003"]').count(),1);
  assert.equal(await activeTab(),'710002');assert.equal(await page.locator('.reading-tab').count(),2);
  await page.keyboard.press('Control+Enter');await barrier();
  assert.equal(await page.locator('.reading-tab[data-tab-id="710003"]').count(),1);
  assert.equal(await page.locator('.reading-tab').count(),2);assert.equal(await activeTab(),'710002');
  const filter=page.getByRole('textbox',{name:'筛选当前列表',exact:true}),beforeFilterReads=await app.evaluate(()=>global.__navigationIntegrity.reads.length);
  await filter.fill('单页');await filter.press('ArrowLeft');
  assert.equal(await filter.evaluate(node=>node.selectionStart),1);
  await filter.press('Enter');await barrier();
  assert.equal(await filter.evaluate(node=>node===document.activeElement),true);
  assert.equal(await activeTab(),'710002');assert.equal(await page.locator('.reading-tab').count(),2);
  assert.equal(await app.evaluate(()=>global.__navigationIntegrity.reads.length),beforeFilterReads);
  await filter.fill('');await rows().nth(0).focus();
  await rows().nth(0).evaluate(node=>node.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true,cancelable:true})));
  await barrier();assert.equal(await page.locator('.reading-tab').count(),2);assert.equal(await activeTab(),'710002');
  check('Focused list arrows and Enter open one post; Ctrl+Enter opens one background tab and input or IME keys stay local');
  await page.getByRole('button',{name:'关闭全部帖子标签',exact:true}).click();

  await open(2);
  await page.locator('.reader-scroll').evaluate(node=>{node.scrollTop=400;});await barrier();
  assert.ok(await page.locator('.reader-scroll').evaluate(node=>node.scrollTop)>300);
  await page.getByRole('button',{name:'关闭全部帖子标签',exact:true}).click();
  assert.equal(await page.locator('.reading-tab').count(),0);
  await open(2);
  assert.equal(await page.locator('.reader-scroll').evaluate(node=>node.scrollTop),0);
  check('Top close-all clears reading positions before reopening a thread');

  await rows().nth(0).click({modifiers:['Control']});
  await rows().nth(1).click({modifiers:['Control']});
  await page.getByRole('button',{name:'返回总览',exact:true}).click();
  await page.keyboard.press('Control+Shift+Tab');await barrier();
  assert.equal(await activeTab(),(await order()).at(-1));
  check('Reverse keyboard cycling from overview selects the final tab');

  await page.keyboard.press('Control+k');
  await page.getByRole('textbox',{name:'搜索 NodeSeek',exact:true}).fill('deferred');
  await app.evaluate(({ipcMain})=>{
    const state=global.__navigationIntegrity;
    ipcMain.removeHandler('parity:query');
    ipcMain.handle('parity:query',(_event,request)=>request.kind==='search'?new Promise(resolve=>{
      state.releaseSearch=()=>resolve({posts:[{...state.posts[5],title:'Deferred search result'}]});
    }):request.kind==='account'?{profile:{id:42,name:state.account.name,coin:10},unread:{mentions:0,replies:0,messages:0}}:{});
  });
  await page.getByRole('dialog',{name:'搜索 NodeSeek',exact:true}).getByRole('button',{name:'搜索',exact:true}).click();
  await until(()=>app.evaluate(()=>typeof global.__navigationIntegrity.releaseSearch==='function'),'Deferred search did not start');
  await page.getByRole('dialog',{name:'搜索 NodeSeek',exact:true}).getByRole('button',{name:'取消',exact:true}).click();
  await page.getByTestId('settings-button').click();await page.getByTestId('settings-panel').waitFor();
  const histories=await app.evaluate(()=>global.__navigationIntegrity.historyWrites.length);
  await app.evaluate(()=>global.__navigationIntegrity.releaseSearch());await barrier();await barrier();
  assert.equal(await page.getByTestId('settings-panel').count(),1);
  assert.equal(await page.getByRole('dialog',{name:'搜索 NodeSeek',exact:true}).count(),0);
  assert.equal(await app.evaluate(()=>global.__navigationIntegrity.historyWrites.length),histories);
  await page.getByRole('button',{name:'返回论坛',exact:true}).click();
  assert.ok(!(await page.locator('.list-heading h1').innerText()).includes('deferred'));
  assert.equal(await rows().count(),12);
  check('A canceled search cannot replace the list, close settings or save late history');

  await open(1);
  await page.locator('.comment[data-floor="1"] .user-menu summary').click();
  await page.getByRole('button',{name:'查询管理记录',exact:true}).click();
  await page.getByRole('dialog',{name:/管理记录/}).waitFor();
  const beforeDialog=await activeTab();
  await page.keyboard.press('Escape');await barrier();
  assert.equal(await page.getByRole('dialog',{name:/管理记录/}).count(),0);
  assert.equal(await activeTab(),beforeDialog);
  assert.equal(await page.getByTestId('reading-overview').count(),0);
  check('Escape closes a modal without changing the underlying reading selection');

  for(let index=3;index<12;index++)await rows().nth(index).click({modifiers:['Control']});
  await page.locator('.reading-tab').first().getByRole('tab').click();await barrier();
  await page.locator('.reading-tab').first().evaluate(node=>{
    const dataTransfer=new DataTransfer();
    node.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
    node.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer}));
  });
  for(let index=0;index<10;index++){await page.keyboard.press('Control+Tab');await barrier();}
  const bounds=await page.locator('.reading-tab.current').evaluate(node=>{
    const tab=node.getBoundingClientRect(),container=node.closest('.tabs').getBoundingClientRect();
    return {tabLeft:tab.left,tabRight:tab.right,containerLeft:container.left,containerRight:container.right};
  });
  assert.ok(bounds.tabLeft>=bounds.containerLeft-2&&bounds.tabRight<=bounds.containerRight+2,JSON.stringify(bounds));
  check('Canceled tab dragging restores automatic scrolling for keyboard selection');

  await app.evaluate(({BrowserWindow})=>{const post={id:'719999',url:'https://www.nodeseek.com/post-719999-1',title:'Native open event fixture',author:'Synthetic native author',authorId:999,category:'tech',published:'',summary:''};BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).webContents.send('app:open-post',post);});
  await until(async()=>await activeTab()==='719999','Native open-post event did not activate a reading tab');
  check('Native official-page or notification open-post events still reach the reading workspace');
  await page.addInitScript(()=>{const interval=window.setInterval.bind(window);window.setInterval=((handler,delay,...args)=>interval(handler,delay===60000?40:delay,...args));});
  await app.evaluate(()=>{const state=global.__navigationIntegrity;state.appearance.autoRefresh=true;state.workspace={tabs:[],activeId:null,overviewOpen:true};});
  await page.reload();await rows().first().waitFor();const initialReads=await app.evaluate(()=>global.__navigationIntegrity.listReads);
  await until(async()=>await app.evaluate(()=>global.__navigationIntegrity.listReads)>initialReads,'Enabled one-minute refresh did not run in the overview');
  check('Automatic overview refresh still runs; the fixture accelerates only its one-minute interval');
  assert.deepEqual(report.errors,[]);
  assert.equal(await app.evaluate(()=>global.__navigationIntegrity.writes.length),0);
  check('No renderer exceptions or real forum mutations');report.status='pass';
})().catch(async error=>{
  report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;
  if(page)await capture('failure.png').catch(()=>{});
}).finally(async()=>{
  if(app)await app.close();
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
});
