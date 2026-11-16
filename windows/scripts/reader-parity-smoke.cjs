// Original-reader layout and click-path checks with synthetic accounts and IPC only.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification','reader-parity');
const report={checks:[],errors:[],scope:'Production React and sandboxed preload; isolated profile; all forum requests are synthetic.'};
let app,page;
const check=name=>{report.checks.push(name);console.log('PASS',name);};
async function until(predicate,message,timeout=10000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await new Promise(resolve=>setTimeout(resolve,30));}throw Error(message);}
const barrier=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const rows=()=>page.getByTestId('post-row');
async function open(index){await rows().nth(index).click();await page.locator('.comment[data-floor="0"]').waitFor();await barrier();}
async function capture(name){await page.screenshot({path:path.join(output,name)});}
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(project,'.test-data','reader-parity-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project,'--host-resolver-rules=MAP * ~NOTFOUND'],env});page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await app.evaluate(({ipcMain,BrowserWindow})=>{
    const now=new Date().toISOString(),account={id:42,name:'Synthetic reader',status:'signed-in',level:4};
    const settings={theme:'dark',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const appearance={brand:'blue',readerGradient:false,sidebarWidth:250,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'edit',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
    const extensions={installed:['block','authorOnly','rulings'],enabled:['block','authorOnly','rulings'],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作台',officeButton:'返回',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0};
    const posts=Array.from({length:12},(_,index)=>({id:String(710001+index),url:'https://www.nodeseek.com/post-'+(710001+index)+'-1',title:['单层主题','单页多楼层主题','私有精品锁定主题'][index]||'等宽及键盘切换测试主题 '+(index+1),author:'Author '+(100+index),authorId:100+index,category:'daily',published:now,summary:'',...(index===2?{readingRank:255,featured:true}:{})}));
    const state=global.__readerParity={account,settings,extensions,posts,official:[],external:[],writes:[],reads:[],drafts:{},drag:[],workspace:{tabs:[],activeId:null,overviewOpen:true}};
    const mock=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
    mock('app:bootstrap',()=>({account,settings,workspace:state.workspace,version:'0.1.1',official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[]}));
    mock('parity:bootstrap',()=>({appearance,extensions,media:{hasApiKey:false,defaultImageWidth:0},stickers:[],searchHistory:[]}));
    mock('forum:list',()=>({posts,source:'web',fetchedAt:now,nextPage:null}));
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
    mock('forum:avatar',()=>null);mock('app:external',(_event,url)=>{state.external.push(url);});
    mock('forum:action',(_event,request,owner)=>{state.writes.push({request,owner});return {message:'Synthetic action accepted'};});
    mock('parity:query',(_event,request)=>request.kind==='account'?{profile:{id:42,name:account.name,coin:10},unread:{mentions:0,replies:0,messages:0}}:{});
    mock('parity:draft-load',(_event,key,owner)=>owner===42?state.drafts[key]||null:null);
    mock('parity:draft-save',(_event,key,value,owner)=>{if(owner!==42)throw Error('Wrong synthetic owner');if(value)state.drafts[key]=value;else delete state.drafts[key];});
    mock('extensions:save',(_event,value)=>{Object.assign(extensions,value);return extensions;});
    mock('app:blocked-users',(_event,value)=>value);
    mock('app:workspace',(_event,value)=>{state.workspace=value;});
    mock('media:prepare',(_event,content)=>content);mock('media:stickers',()=>[]);
    const main=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:'));const send=main.webContents.send.bind(main.webContents);main.webContents.send=(channel,...args)=>{if(channel!=='forum:account-change')send(channel,...args);};state.accountEvent=value=>send('forum:account-change',value);main.setSize(1440,960);
  });
  await page.reload();await rows().first().waitFor();
  await open(0);assert.equal(await page.getByTestId('thread-pagination').count(),0);assert.equal(await page.locator('.thread-footer').count(),0);await page.getByText('还没有回复。',{exact:true}).waitFor();
  const noCount=page.locator('.comment[data-floor="0"] .comment-actions');assert.equal(await noCount.locator('button:has(svg.lucide-thumbs-up),button:has(svg.lucide-thumbs-down)').count(),0);assert.ok(!(await noCount.innerText()).includes('0'));
  await page.locator('.comment[data-floor="0"] .role-badge').nth(1).waitFor();assert.deepEqual(await page.locator('.comment[data-floor="0"] .role-badge').allTextContents(),['认证成员','管理员']);
  assert.ok((await page.locator('.comment[data-floor="0"] .role-badge').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor))).every(color=>color!=='rgba(0, 0, 0, 0)'));
  check('A one-floor single page has no duplicate navigation or empty footer, and unknown reaction counts stay unknown');

  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await barrier();
    const dimensions=await page.locator('.fixed-reply>header').evaluate(header=>{const button=header.querySelector('.reply-open-button'),b=button.getBoundingClientRect(),h=header.getBoundingClientRect();return {right:b.right,headerRight:h.right,x:b.x,mid:h.x+h.width/2};});
    assert.ok(dimensions.x>dimensions.mid);assert.ok(Math.abs(dimensions.right-dimensions.headerRight)<3);
  }
  await page.getByRole('button',{name:'写回复',exact:true}).click();await page.getByRole('textbox',{name:'回复帖子',exact:true}).fill('回复草稿最后一个字');
  const close=page.getByRole('button',{name:'关闭回复编辑器',exact:true});const right=await close.boundingBox(),header=await page.locator('.fixed-reply>header').boundingBox();assert.ok(right.x>header.x+header.width/2);await close.click();await page.getByRole('button',{name:'写回复',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'回复帖子',exact:true}).inputValue(),'回复草稿最后一个字');await close.click();
  check('The collapsed reply button is right aligned in both themes; the right-side close preserves the draft');

  await open(1);assert.equal(await page.getByTestId('thread-pagination').count(),0);await page.getByRole('button',{name:'只看楼主',exact:true}).click();await until(()=>page.getByText('当前已加载页面中暂无楼主回复。',{exact:true}).isVisible(),'Author-only empty state did not appear');assert.equal(await page.locator('.comment').count(),1);await page.getByRole('button',{name:'只看楼主',exact:true}).click();await until(async()=>await page.locator('.comment').count()===2,'Replies did not return');
  check('Several floors on one page still hide pagination and the original reply section exposes author-only empty state');

  await open(2);assert.equal(await page.getByTestId('thread-pagination').count(),2);assert.equal(await page.locator('.reader-toolbar .featured-badge').count(),1);assert.equal(await page.locator('.reader-toolbar .access-badge').innerText(),'私有');assert.match(await page.locator('.thread-restriction').innerText(),/已锁定/);assert.equal(await page.locator('.reader-toolbar .category-tag').innerText(),'技术');assert.equal(await page.getByRole('button',{name:'引用第1楼',exact:true}).count(),0);assert.equal(await page.getByRole('button',{name:'回复第1楼',exact:true}).count(),0);await capture('reader-controls-dark.png');
  check('Real second pages retain both navigation points and private, featured and locked fields keep their original meaning');

  const beforeRows=await rows().count();await rows().nth(1).click({button:'right'});await page.getByRole('menu',{name:'帖子操作',exact:true}).waitFor();await page.keyboard.press('Escape');assert.equal(await page.getByRole('menu',{name:'帖子操作',exact:true}).count(),0);assert.equal(await page.locator('.reading-tab.current').getAttribute('data-tab-id'),'710003');await rows().nth(1).click({button:'right'});await page.getByRole('menuitem',{name:'屏蔽作者',exact:true}).click();await until(()=>rows().nth(1).getByText('已屏蔽',{exact:true}).isVisible(),'Blocked post marker missing');assert.equal(await rows().count(),beforeRows);await rows().nth(1).click({button:'right'});await page.getByRole('menuitem',{name:'解除屏蔽作者',exact:true}).click();await until(async()=>await rows().nth(1).getByText('已屏蔽',{exact:true}).count()===0,'Blocked marker did not clear');
  await rows().nth(3).click({button:'right'});await page.getByRole('menuitem',{name:'在后台打开',exact:true}).click();assert.equal(await page.locator('.reading-tab[data-tab-id="710004"]').count(),1);assert.equal(await page.locator('.reading-tab.current').getAttribute('data-tab-id'),'710003');
  await rows().nth(3).click({button:'right'});await page.getByRole('menuitem',{name:'在浏览器打开',exact:true}).click();await until(()=>app.evaluate(()=>global.__readerParity.external.includes('https://www.nodeseek.com/post-710004-1')),'Browser source did not open');
  check('Post context actions work and blocking retains the topic with an actionable blocked marker');

  for(let index=4;index<11;index++)await rows().nth(index).click({modifiers:['Control']});
  const order=await page.locator('.reading-tab').evaluateAll(nodes=>nodes.map(node=>node.dataset.tabId));
  await page.locator('.reading-tab[data-tab-id="710004"]').click({button:'right'});await page.getByRole('menuitem',{name:'向左移动',exact:true}).click();const moved=await page.locator('.reading-tab').evaluateAll(nodes=>nodes.map(node=>node.dataset.tabId));assert.equal(moved.indexOf('710004'),order.indexOf('710004')-1);
  for(let index=0;index<6;index++){await page.keyboard.press('Control+Tab');await barrier();const visible=await page.locator('.reading-tab.current').evaluate(node=>{const r=node.getBoundingClientRect(),p=node.closest('.tabs').getBoundingClientRect();return r.left>=p.left-2&&r.right<=p.right+2;});assert.equal(visible,true);}
  await page.locator('.reading-tab.current').click({button:'right'});await page.getByRole('menuitem',{name:'关闭全部标签',exact:true}).click();assert.equal(await page.locator('.reading-tab').count(),0);
  check('Original tab context moves and close-all work, and keyboard-selected tabs scroll into view');

  await app.evaluate(()=>{const state=global.__readerParity;state.account.status='signed-out';state.account.id=undefined;state.account.name='';state.accountEvent({...state.account});});await rows().first().waitFor();await open(1);const known=page.locator('.comment[data-floor="1"] .comment-actions button:has(svg.lucide-thumbs-up)');assert.equal(await known.isEnabled(),true);await known.click();await until(()=>app.evaluate(()=>global.__readerParity.official.filter(url=>url.endsWith('/signIn.html')).length===1),'Guest like did not open login');await page.getByRole('button',{name:'引用第1楼',exact:true}).click();await until(()=>app.evaluate(()=>global.__readerParity.official.filter(url=>url.endsWith('/signIn.html')).length===2),'Guest quote did not open login');assert.equal((await app.evaluate(()=>global.__readerParity.writes)).length,0);
  check('Guest interactions and quotes guide to the official login instead of sending or silently disabling');
  assert.deepEqual(report.errors,[]);check('No renderer exceptions, real forum mutations, user credentials or installations');report.status='pass';
})().catch(async error=>{report.status='fail';report.failure=error.stack;console.error(error);if(app)report.fixture=await app.evaluate(()=>({reads:global.__readerParity?.reads,official:global.__readerParity?.official,writes:global.__readerParity?.writes})).catch(()=>undefined);if(page)await capture('failure.png').catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close();await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
