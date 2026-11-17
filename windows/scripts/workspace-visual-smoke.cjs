// Original-reader layout and click-path checks with synthetic accounts and IPC only.
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification','workspace-visual');
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

  report.frames=[];
  for(const width of [1440,980])for(const uiFontSize of [14,28])for(const theme of ['light','dark']){
    await app.evaluate(({BrowserWindow},{width,uiFontSize,theme})=>{
      const state=global.__navigationIntegrity;Object.assign(state.settings,{uiFontSize,theme});state.workspace={tabs:[],activeId:null,overviewOpen:true};
      BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')).setSize(width,width===1440?960:760);
    },{width,uiFontSize,theme});
    await page.reload();await rows().first().waitFor();await barrier();
    await page.getByRole('button',{name:'论坛版块',exact:true}).click();
    const metadata=await page.evaluate(()=>{
      const row=document.querySelector('[data-testid="post-row"]'),chip=row.querySelector('h2>.category-tag'),title=row.querySelector('.post-title-text');
      return {chipBeforeTitle:!!chip&&!!(chip.compareDocumentPosition(title)&Node.DOCUMENT_POSITION_FOLLOWING),boardSurfaces:[...document.querySelectorAll('.board-nav .board-link[data-category]')].map(node=>({text:node.textContent,color:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor})),accountBackground:getComputedStyle(document.querySelector('.toolbar-account')).backgroundColor};
    });
    assert.equal(metadata.chipBeforeTitle,true,'Board chip must precede the title');
    assert.ok(metadata.boardSurfaces.length>3&&metadata.boardSurfaces.every(item=>!['transparent','rgba(0, 0, 0, 0)'].includes(item.background)),'Forum boards retain filled colour cues');
    assert.ok(new Set(metadata.boardSurfaces.map(item=>item.color)).size>3,'Board text colours remain distinct');
    assert.ok(!['transparent','rgba(0, 0, 0, 0)'].includes(metadata.accountBackground),'Account has its requested flat background');
    await rows().nth(1).click({modifiers:['Control']});await rows().nth(2).click({modifiers:['Control']});await open(0);
    const geometry=await page.evaluate(()=>{
      const reply=[...document.querySelectorAll('button')].find(node=>node.getAttribute('aria-label')==='写回复').getBoundingClientRect();
      const fonts=[...document.querySelectorAll('button,input,.post-row-meta,.floor,time')].filter(node=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return rect.width&&rect.height&&rect.right>0&&rect.left<innerWidth&&rect.bottom>0&&rect.top<innerHeight&&style.visibility!=='hidden';}).map(node=>parseFloat(getComputedStyle(node).fontSize)).filter(Number.isFinite);
      return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,minFont:Math.min(...fonts),tabs:[...document.querySelectorAll('.reading-tab')].map(node=>node.getBoundingClientRect().width),reply:{left:reply.left,right:reply.right,bottom:reply.bottom}};
    });
    assert.ok(geometry.scrollWidth<=geometry.width&&geometry.scrollHeight<=geometry.height,'Workspace must not overflow the viewport');
    assert.ok(geometry.minFont>=12,'Visible interface text stays at least 12px');
    assert.ok(geometry.tabs.length===3&&Math.max(...geometry.tabs)-Math.min(...geometry.tabs)<=1,'Open tabs stay uniformly sized');
    assert.ok(geometry.reply.left>=0&&geometry.reply.right<=geometry.width&&geometry.reply.bottom<=geometry.height,'Reply entry remains reachable');
    await page.getByRole('button',{name:'写回复',exact:true}).click();
    await page.getByRole('textbox',{name:'回复帖子',exact:true}).waitFor();
    const expanded=await page.evaluate(()=>{const editor=document.querySelector('textarea[aria-label="回复帖子"]').getBoundingClientRect(),send=document.querySelector('[data-testid="submit-reply"]').getBoundingClientRect(),close=document.querySelector('[aria-label="关闭回复编辑器"]').getBoundingClientRect();return {editorHeight:editor.height,send:{left:send.left,right:send.right,bottom:send.bottom},close:{right:close.right,bottom:close.bottom},width:innerWidth,height:innerHeight};});
    assert.ok(expanded.editorHeight>0&&expanded.send.left>=0&&expanded.send.right<=expanded.width&&expanded.send.bottom<=expanded.height&&expanded.close.right<=expanded.width&&expanded.close.bottom<=expanded.height,'Expanded editor, send and close controls stay reachable');
    await page.getByRole('button',{name:'关闭回复编辑器',exact:true}).click();
    const name=theme+'-'+width+'-font'+uiFontSize+'.png';await capture(name);report.frames.push({theme,uiFontSize,...geometry,metadata,expanded,screenshot:name});
  }
  check('Eight light/dark, normal/narrow and minimum/maximum global-font layouts retain required colour and category cues');
  assert.deepEqual(report.errors,[]);assert.equal(await app.evaluate(()=>global.__navigationIntegrity.writes.length),0);check('No renderer exceptions or forum mutations');report.status='passed';
})().catch(async error=>{report.status='failed';report.failure=error.stack;console.error(error);if(page)await capture('failure.png').catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));});
