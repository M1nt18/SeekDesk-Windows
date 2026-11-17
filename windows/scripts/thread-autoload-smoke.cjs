'use strict';

// Real React/preload with local IPC fixtures. No live forum traffic, account
// credentials, browser, clipboard write, installer or existing userData is used.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {_electron:electron}=require('playwright-core');
const project=path.resolve(__dirname,'..');
const output=path.join(project,'verification','thread-autoload');
const titles={101:'评论自动连读测试 A',202:'评论自动连读测试 B',303:'只看楼主预读暂停测试',404:'重复楼层预读暂停测试'};
const report={checks:[],errors:[],mode:'isolated Electron renderer and real preload; synthetic same-origin thread IPC only'};
let app,page;
const check=(name,detail)=>{report.checks.push({name,...(detail?{detail}:{})});console.log('PASS',name);};
const key=(postId,number,owner=42)=>postId+':'+number+':'+owner;
const topNav=()=>page.getByRole('navigation',{name:'帖子顶部分页',exact:true});
const reader=()=>page.locator('.reader-scroll');
const calls=()=>app.evaluate(()=>global.__autoload.reads);
const countCalls=async(postId,number,owner=42)=>(await calls()).filter(row=>row.postId===postId&&row.page===number&&row.owner===owner).length;
async function until(predicate,label,timeout=10000){const deadline=Date.now()+timeout;for(;;){if(await predicate())return;if(Date.now()>=deadline)throw Error(label);await new Promise(resolve=>setTimeout(resolve,30));}}
async function waitForCall(postId,number,owner=42){await until(async()=>await countCalls(postId,number,owner)>0,'Expected automatic page request');}
async function release(postId,number,owner=42){await app.evaluate((_electron,key)=>global.__autoload.release(key),key(postId,number,owner));}
async function hold(postId,number,owner=42){await app.evaluate((_electron,key)=>global.__autoload.holds.add(key),key(postId,number,owner));}
async function scrollToEnd(){await reader().evaluate(node=>{node.scrollTop=node.scrollHeight-node.clientHeight-200;});}
async function saveAnchor(){return reader().evaluate(node=>{
  const bounds=node.getBoundingClientRect(),point=document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+Math.min(40,bounds.height/3));
  const article=point?.closest('article.comment[data-floor]')||[...node.querySelectorAll('article.comment[data-floor]')].find(item=>item.getBoundingClientRect().bottom>bounds.top+10);
  window.__autoloadVisible={article,floor:article?.dataset.floor,offset:article?.getBoundingClientRect().top-bounds.top,scrollTop:node.scrollTop};
  return {floor:window.__autoloadVisible.floor,offset:window.__autoloadVisible.offset,scrollTop:node.scrollTop};
});}
async function assertAnchor(before){const after=await reader().evaluate(node=>({offset:window.__autoloadVisible.article.getBoundingClientRect().top-node.getBoundingClientRect().top,connected:window.__autoloadVisible.article.isConnected,scrollTop:node.scrollTop}));assert.equal(after.connected,true);assert.ok(Math.abs(after.offset-before.offset)<5,JSON.stringify({before,after}));assert.ok(after.scrollTop>100);return after;}
async function assertOriginalNodes(){assert.equal(await page.evaluate(()=>[...window.__autoloadOriginalNodes].every(([id,node])=>document.querySelector('article.comment[data-floor="'+id+'"]')===node)),true);}
async function screenshot(name){await page.screenshot({path:path.join(output,name)});}

(async()=>{
  await fs.mkdir(output,{recursive:true});
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.join(project,'.test-data','thread-autoload-'+Date.now())};
  delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  await fs.mkdir(env.SEEKDESK_USER_DATA,{recursive:true});
  const entry=path.join(env.SEEKDESK_USER_DATA,'entry.cjs');
  await fs.writeFile(entry,`const {app,session}=require('electron');app.whenReady().then(()=>{for(const partition of ['persist:nodeseek','public-rss'])session.fromPartition(partition).protocol.handle('https',()=>new Response('Synthetic frontend fixture',{status:503}));});globalThis.fetch=async()=>{throw Error('No live requests in frontend fixture');};require(${JSON.stringify(path.join(project,'dist-electron/electron/main.js'))});`);
  app=await electron.launch({executablePath:require('electron'),args:[entry,'--host-resolver-rules=MAP * ~NOTFOUND'],env});
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await page.evaluate(()=>window.seekdesk.listPosts({}).catch(()=>null));
  await app.evaluate(({ipcMain,BrowserWindow},{titles,version})=>{
    const state=global.__autoload={owner:42,reads:[],pending:[],holds:new Set(['101:2:42','101:3:42']),failures:{},writes:[],clipboard:[],workspace:{tabs:[],activeId:null,overviewOpen:true},workspaceWrites:[],bootstraps:[],drafts:{}};
    const location=(id,number)=>'https://www.nodeseek.com/post-'+id+'-'+number;
    const owner=()=>({status:'signed-in',id:state.owner,name:'隔离账号'+state.owner,level:1,coin:900});
    const settings={theme:'light',uiFontSize:16,fontSize:18,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const appearance={brand:'blue',readerGradient:true,sidebarWidth:250,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'split',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
    const extensions={installed:['authorOnly'],enabled:['authorOnly'],authorOnly:false,blocked:[],hits:[],unread:0,hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,watchWords:'',watchNote:''};
    const posts=Object.entries(titles).map(([id,title])=>({id,title,url:location(id,1)+(id==='101'?'#1':''),author:'公开示例作者',authorId:1001,category:'tech',published:'2026-11-13T00:00:00Z',summary:''}));
    const floor=(id,number,snapshotOwner,postId,paragraphs=14)=>({id:String(id),author:'账号'+snapshotOwner+'作者'+id,authorId:1001+Number(id),level:1,date:'2026-11-13T00:00:00Z',floor:id===0?'楼主':'#'+id,html:Array.from({length:paragraphs},(_,index)=>'<p>账号'+snapshotOwner+' · 帖子'+postId+' · 楼层'+id+' · 段落'+index+'。这是一段足够长的固定正文，用于保持阅读位置并验证滚动追加不会清除前面的内容。</p>').join(''),isAuthor:id===0,isOwn:false,sourcePage:number,actionUrl:location(postId,number)+'#'+id});
    const thread=(post,number,snapshotOwner)=>{
      const last=post.id==='101'?3:post.id==='202'?1:6;
      if(number<1||number>last)throw Error('Fixture rejects unexpected page');
      const root=floor(0,1,snapshotOwner,post.id,['303','404'].includes(post.id)?24:12),hot={...floor(5,3,snapshotOwner,post.id,number===3?18:3),isHot:true,chicken:number===3?4:2};
      const normal=post.id==='404'?[]:post.id==='101'&&number===3?[floor(6,3,snapshotOwner,post.id)]:[floor((number-1)*2+1,number,snapshotOwner,post.id),floor((number-1)*2+2,number,snapshotOwner,post.id)];
      return {id:post.id,url:location(post.id,number),title:titles[post.id],source:'web',page:number,nextPage:number<last?number+1:null,totalPages:last,pages:Array.from({length:last},(_,index)=>({number:index+1,url:location(post.id,index+1)})),rootAuthorId:1001,comments:[root,...(['101','404'].includes(post.id)?[hot]:[]),...normal]};
    };
    state.release=key=>{state.holds.delete(key);const released=state.pending.filter(row=>row.key===key);state.pending=state.pending.filter(row=>row.key!==key);for(const row of released)row.resolve(row.result);};
    const mock=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
    mock('app:bootstrap',()=>{state.bootstraps.push({tabs:state.workspace.tabs.map(tab=>({id:tab.id,url:tab.url})),activeId:state.workspace.activeId,at:Date.now()});return {settings,workspace:state.workspace,account:owner(),official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[],version};});
    mock('parity:bootstrap',()=>({appearance,extensions,stickers:[],searchHistory:[],media:{hasApiKey:false,defaultImageWidth:0}}));
    mock('forum:account',()=>owner());
    mock('forum:list',()=>({posts,nextPage:null,source:'web',fetchedAt:new Date().toISOString()}));
    mock('forum:thread',(_event,post,number=1)=>{
      const snapshotOwner=state.owner,key=post.id+':'+number+':'+snapshotOwner,result=thread(post,number,snapshotOwner);
      state.reads.push({postId:post.id,page:number,owner:snapshotOwner,key});
      if(state.failures[key]>0){state.failures[key]--;throw Error('模拟下一页暂时不可读取');}
      if(state.holds.has(key))return new Promise(resolve=>state.pending.push({key,result,resolve}));
      return result;
    });
    mock('forum:profiles',(_event,request)=>({outcomes:request.memberIds.map(memberId=>({memberId,status:'ready',profile:{memberId,level:1}})),complete:true}));
    mock('forum:avatar',()=>null);mock('app:workspace',(_event,value)=>{state.workspace=value;state.workspaceWrites.push({tabs:value.tabs.map(tab=>({id:tab.id,url:tab.url})),activeId:value.activeId,at:Date.now()});});
    mock('parity:query',(_event,request)=>request.kind==='account'?{profile:{id:state.owner,name:'隔离账号'+state.owner,rank:1,coin:900},unread:{mentions:0,replies:0,messages:0}}:{});
    mock('parity:draft-load',(_event,key,owner)=>state.drafts[owner+':'+key]||null);
    mock('parity:draft-save',(_event,key,value,owner)=>{state.drafts[owner+':'+key]=value;});
    mock('extensions:get',()=>extensions);mock('extensions:ranking',()=>({period:'realtime',items:[],fetchedAt:new Date().toISOString()}));
    mock('extensions:save',(_event,value)=>{Object.assign(extensions,value);BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file:')).webContents.send('extensions:change',extensions);return extensions;});
    mock('app:clipboard',(_event,text)=>{state.clipboard.push(text);});
    for(const name of ['forum:action','parity:write'])mock(name,()=>{state.writes.push(name);throw Error('Fixture prohibits forum writes');});
    mock('app:external',()=>{throw Error('Fixture prohibits opening a browser');});
    BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file:')).setSize(1440,960);
  },{titles,version:require('../package.json').version});
  await page.reload();
  await page.getByTestId('post-row').first().click();
  await page.locator('.comment[data-floor="2"]').waitFor();
  await page.waitForTimeout(150);
  assert.equal(await countCalls('101',2),0,'The first viewport must not immediately auto-load the next page');
  await page.evaluate(()=>{window.__autoloadOriginalNodes=new Map([...document.querySelectorAll('article.comment[data-floor]')].map(node=>[node.dataset.floor,node]));});

  await scrollToEnd();await waitForCall('101',2);
  const pageOneAnchor=await saveAnchor();
  await reader().evaluate(node=>{node.scrollTop-=3;node.scrollTop+=3;node.dispatchEvent(new Event('scroll'));});
  await page.waitForTimeout(200);assert.equal(await countCalls('101',2),1);
  await release('101',2);await page.locator('.comment[data-floor="4"]').waitFor();
  const pageTwoPosition=await assertAnchor(pageOneAnchor);await assertOriginalNodes();
  assert.equal(await countCalls('101',3),0);
  await scrollToEnd();await waitForCall('101',3);const pageTwoAnchor=await saveAnchor();
  await release('101',3);await page.locator('.comment[data-floor="6"]').waitFor();
  const pageThreePosition=await assertAnchor(pageTwoAnchor);await assertOriginalNodes();
  assert.equal(await countCalls('101',2),1);assert.equal(await countCalls('101',3),1);
  assert.equal(await page.locator('.comment[data-floor="0"]').count(),1);assert.equal(await page.locator('.comment[data-floor="5"]').count(),1);
  assert.deepEqual(await page.locator('.comment').evaluateAll(nodes=>nodes.map(node=>node.dataset.floor)),['0','5','1','2','3','4','6']);
  assert.equal(await topNav().locator('[aria-current="page"]').innerText(),'3');
  const visibleLink=await reader().evaluate(node=>{const box=node.getBoundingClientRect(),point=document.elementFromPoint(box.left+box.width/2,box.top+Math.min(40,box.height/3)),floor=point?.closest('article.comment[data-floor]')||[...node.querySelectorAll('article.comment[data-floor]')].find(item=>item.getBoundingClientRect().bottom>box.top+10);return 'https://www.nodeseek.com/post-101-'+floor.dataset.streamPage+'#'+floor.dataset.floor;});
  await page.getByRole('button',{name:'复制帖子链接',exact:true}).click();
  assert.equal(await app.evaluate(()=>global.__autoload.clipboard.at(-1)),visibleLink);
  check('Scrolling alone fetches pages two and three once each, appends replies, deduplicates OP/HOT and copies the visible permalink',{pageTwoPosition,pageThreePosition});
  check('The original comment DOM nodes and visible floor offsets survive both appends, including a HOT preview growing above the viewport');

  for(const [floor,sourcePage] of [[1,1],[3,2],[5,3]]){
    await page.getByRole('button',{name:'回复第'+floor+'楼',exact:true}).click();
    await page.locator('.fixed-reply textarea').waitFor();
    assert.ok((await page.locator('.fixed-reply textarea').inputValue()).includes('https://www.nodeseek.com/post-101-'+sourcePage+'#'+floor));
  }
  await page.getByRole('button',{name:'关闭回复编辑器',exact:true}).click();
  check('Replies to earlier normal floors and a cross-page HOT floor retain their genuine page and floor links');

  const reopenAnchor=await reader().evaluate(node=>{const article=node.querySelector('.comment[data-floor="4"]');node.scrollTop+=article.getBoundingClientRect().top-node.getBoundingClientRect().top+260;return {floor:'4',page:2,offset:article.getBoundingClientRect().top-node.getBoundingClientRect().top};});
  await until(async()=>page.evaluate(async expected=>{const result=await window.seekdesk.bootstrap(),anchor=result.workspace.readingAnchors?.['101'];return result.workspace.tabs.find(tab=>tab.id==='101')?.url==='https://www.nodeseek.com/post-101-2#4'&&anchor?.floor===expected.floor&&anchor?.page===expected.page&&Math.abs(anchor.offset-expected.offset)<5;},reopenAnchor),'Visible floor and exact offset did not persist');
  const reopenFrom=(await calls()).length;await hold('101',3);await page.reload();
  await page.locator('.comment[data-floor="4"]').waitFor();
  await page.waitForFunction(()=>{const reader=document.querySelector('.reader-scroll'),bounds=reader.getBoundingClientRect();return document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+40)?.closest('.comment')?.dataset.floor==='4';});
  await until(async()=>reader().evaluate((node,expected)=>Math.abs(node.querySelector('.comment[data-floor="4"]').getBoundingClientRect().top-node.getBoundingClientRect().top-expected.offset)<5,reopenAnchor),'Restored floor offset changed after restart');
  const reopenedReads=(await calls()).slice(reopenFrom);assert.equal(reopenedReads[0].page,2);
  await release('101',3);
  check('The saved workspace restores the visible earlier-page floor and its exact in-body offset instead of reopening only the latest appended page');

  await topNav().locator('[data-page="1"]').click();
  await page.locator('.comment[data-floor="2"]').waitFor();
  await page.waitForFunction(()=>document.querySelector('.reader-scroll').scrollTop<12);
  assert.equal(await page.locator('.comment[data-floor="3"]').count(),0);
  await until(async()=>page.evaluate(async()=>{const result=await window.seekdesk.bootstrap();return result.workspace.tabs.find(tab=>tab.id==='101')?.url==='https://www.nodeseek.com/post-101-1';}),'Manual first page did not clear the saved floor hash');
  check('Clicking page one resets the accumulated stream, removes old replies and clears the prior floor hash');

  await app.evaluate(()=>{global.__autoload.failures['101:2:42']=1;});
  const beforeFailure=await countCalls('101',2);await scrollToEnd();
  await page.getByRole('button',{name:'重试加载',exact:true}).waitFor();
  assert.equal(await page.locator('.comment[data-floor="2"]').count(),1);assert.equal(await page.locator('.comment[data-floor="3"]').count(),0);
  await page.waitForTimeout(350);assert.equal(await countCalls('101',2),beforeFailure+1);
  await page.getByRole('button',{name:'重试加载',exact:true}).click();
  await page.locator('.comment[data-floor="4"]').waitFor();assert.equal(await countCalls('101',2),beforeFailure+2);
  check('A failed next-page read preserves existing content without automatic retry loops; the retry button appends the missing page');

  await hold('101',3);const beforeTab=await countCalls('101',3);await scrollToEnd();
  await until(async()=>await countCalls('101',3)>beforeTab,'Delayed tab page did not start');
  await page.getByTestId('post-row').nth(1).click();await page.locator('.thread-heading h1').getByText(titles[202],{exact:true}).waitFor();
  await release('101',3);await page.waitForTimeout(200);
  assert.equal(await page.locator('.thread-heading h1').innerText(),titles[202]);assert.equal(await topNav().count(),0,'A single-page peer thread must not show pagination');
  assert.ok((await page.locator('.reader-document').innerText()).includes('帖子202'));assert.ok(!(await page.locator('.reader-document').innerText()).includes('帖子101'));
  check('A delayed page from another tab cannot replace the active thread or its pagination');

  await page.getByRole('button',{name:'关闭标签：'+titles[101],exact:true}).click();await page.getByTestId('post-row').first().click();
  await page.locator('.comment[data-floor="2"]').waitFor();await hold('101',2);const beforeAccount=await countCalls('101',2);await scrollToEnd();
  await until(async()=>await countCalls('101',2)>beforeAccount,'Delayed account page did not start');
  await app.evaluate(({BrowserWindow})=>{const state=global.__autoload;state.owner=43;BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().startsWith('file:')).webContents.send('forum:account-change',{status:'signed-in',id:43,name:'隔离账号43',level:1,coin:900});});
  await page.waitForFunction(()=>document.querySelector('.toolbar-account')?.textContent.includes('隔离账号43'));
  await page.getByTestId('post-row').first().click();await page.locator('.comment[data-floor="2"]').waitFor();
  await release('101',2);await page.waitForTimeout(250);
  assert.equal(await topNav().locator('[aria-current="page"]').innerText(),'1');assert.equal(await page.locator('.comment[data-floor="3"]').count(),0);
  const finalText=await page.locator('.reader-document').innerText();assert.ok(finalText.includes('账号43'));assert.ok(!finalText.includes('账号42'));
  await screenshot('account-scope-light.png');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});await screenshot('account-scope-dark.png');
  check('A delayed old-account page cannot refill the same thread ID after switching accounts');

  await page.getByTestId('post-row').nth(2).click();await page.locator('.thread-heading h1').getByText(titles[303],{exact:true}).waitFor();
  await page.getByRole('button',{name:'只看楼主',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('article.comment').length===1);
  await scrollToEnd();
  await page.getByText('连续两页没有新增可见评论，已暂停自动加载',{exact:false}).waitFor();
  assert.equal(await countCalls('303',2,43),1);assert.equal(await countCalls('303',3,43),1);
  await page.waitForTimeout(300);assert.equal(await countCalls('303',4,43),0);
  await page.getByRole('button',{name:'继续加载',exact:true}).click();await waitForCall('303',4,43);
  check('Author-only reading pauses after two pages with no new visible replies and resumes only from Continue');

  await page.getByRole('button',{name:'只看楼主',exact:true}).click();
  await page.getByTestId('post-row').nth(3).click();await page.locator('.thread-heading h1').getByText(titles[404],{exact:true}).waitFor();
  await scrollToEnd();await page.getByText('连续两页没有新增可见评论，已暂停自动加载',{exact:false}).waitFor();
  assert.equal(await countCalls('404',2,43),1);assert.equal(await countCalls('404',3,43),1);
  await page.waitForTimeout(300);assert.equal(await countCalls('404',4,43),0);
  assert.equal(await page.locator('.comment[data-floor="0"]').count(),1);assert.equal(await page.locator('.comment[data-floor="5"]').count(),1);
  check('Pages containing only repeated OP/HOT floors also stop automatic prefetch instead of issuing an unbounded GET chain');

  await page.getByTestId('post-row').first().click();await page.locator('.comment[data-floor="2"]').waitFor();
  await scrollToEnd();await page.locator('.comment[data-floor="4"]').waitFor();await scrollToEnd();await page.locator('.comment[data-floor="6"]').waitFor();
  await reader().evaluate(node=>{const floor=node.querySelector('.comment[data-floor="1"]');node.scrollTop+=floor.getBoundingClientRect().top-node.getBoundingClientRect().top+120;node.dispatchEvent(new Event('scroll'));});
  const beforeRefresh=await saveAnchor(),readsBeforeRefresh=(await calls()).length;assert.equal(beforeRefresh.floor,'1');
  await page.getByRole('button',{name:'刷新当前帖子',exact:true}).click();await topNav().locator('[data-page="1"][aria-current="page"]').waitFor();await page.locator('.comment[data-floor="6"]').waitFor({state:'hidden'});
  assert.equal((await calls()).slice(readsBeforeRefresh)[0].page,1);await assertAnchor(beforeRefresh);
  check('Refreshing an earlier visible floor reloads its page rather than the prefetched last page and preserves the exact offset');
  assert.deepEqual(await app.evaluate(()=>global.__autoload.writes),[]);assert.deepEqual(report.errors,[]);
  report.reads=await calls();report.status='pass';check('No real forum requests, writes, private account data or renderer exceptions were used');
})().catch(async error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;if(app){report.reads=await calls().catch(()=>[]);report.workspaceDebug=await app.evaluate(()=>({workspace:global.__autoload.workspace,writes:global.__autoload.workspaceWrites,bootstraps:global.__autoload.bootstraps})).catch(()=>undefined);}if(page)await screenshot('failure.png').catch(()=>{});}).finally(async()=>{
  if(app)await app.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
});
