/* Source build only. All forum traffic is served by an isolated Electron protocol fixture. */
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),profile=path.join(project,'.test-data','reply-refresh-'+Date.now()),output=path.join(project,'verification');
const report={testedAt:new Date().toISOString(),scope:'Real Electron renderer/main/preload with isolated userData. All forum requests are local HTTPS protocol fixtures; no real forum mutation. Cache assertions verify executed CDP cache disabling and fresh document reads, not a live CDN.',checks:[],errors:[]};
let app,page;
const check=(name,detail)=>{report.checks.push({name,status:'pass',detail});console.log('PASS',name,detail||'');};
function installFixture(fixture){
  const {app,session}=require('electron');
  const state=globalThis.__replyFixture={writes:[],documents:[],commands:[],accepted:false,page3Reads:0,revision:1};
  app.on('web-contents-created',(_event,contents)=>{
    const original=contents.debugger.sendCommand.bind(contents.debugger);
    contents.debugger.sendCommand=async(method,params)=>{const result=await original(method,params);state.commands.push({method,params,success:true});return result;};
  });
  const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json','cache-control':'no-store'}});
  const floor=(id,authorId,name,body,isAuthor=false)=>'<div class="content-item" id="'+id+'"><div class="nsk-content-meta-info"><div class="author-info"><a class="author-name" href="/space/'+authorId+'">'+name+'</a><span class="role-tag">Lv '+(isAuthor?'7':'4')+'</span>'+(isAuthor?'<span class="is-poster">楼主</span>':'')+'<time datetime="2026-11-11T06:00:00Z"></time></div></div><div class="post-content"><p>'+body+'</p></div></div>';
  function documentHtml(url){
    const location=new URL(url),match=location.pathname.match(/^\/post-(\d+)-(\d+)$/),page=Number(match?.[2]||1);
    const comments=[{floorIndex:0,commentId:7000,poster:{isMe:false}}];
    let content='<ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-123-1">回复分页回归主题</a></div><div class="info-author"><a href="/space/77">主题作者</a></div><a class="post-category" href="/categories/tech">技术</a><time datetime="2026-11-11T06:00:00Z"></time></li></ul>';
    if(match){
      if(page===3)state.page3Reads++;
      const showNew=state.accepted&&page===3&&state.page3Reads>=2;
      if(showNew)comments.push({floorIndex:25,commentId:7025,poster:{isMe:true}});
      const root='<div class="nsk-post-wrapper"><h1><a class="post-title-link">回复分页回归主题</a></h1>'+floor(0,77,'主题作者','原主题内容，自己的新回复应在第三页。',true)+'</div>';
      const body=page===3?floor(21,77,'主题作者','楼主后续补充。',true)+(showNew?floor(25,42,'当前账号','新回复已同步 revision '+state.revision+'：'+state.content):''):floor(1,88,'其他成员','第一页已有回复。');
      content=root+'<div class="comments">'+body+'</div><nav class="pagination">'+(page<3?'<a rel="next" href="/post-123-'+(page+1)+'">下一页</a>':'')+'</nav>';
    }
    const config={user:{member_id:42,member_name:'当前账号',rank:4},commmentPerPage:10,postData:{postId:123,title:'回复分页回归主题',comments}};
    return '<!doctype html><meta charset="utf-8"><title>回复分页回归</title><script>window.__config__='+JSON.stringify(config)+'</script><div id="nsk-head"></div><div id="nsk-body-left">'+content+'</div>';
  }
  async function route(request){
    const url=new URL(request.url);
    if(!['www.nodeseek.com','nodeseek.com','rss.nodeseek.com'].includes(url.hostname))return new Response('Only fixture hosts are allowed',{status:403});
    if(request.method==='POST'){
      const body=await request.json();state.writes.push({path:url.pathname,body});
      if(url.pathname!=='/api/content/new-comment')return json({success:false,message:'Unexpected test write'});
      state.accepted=true;state.content=body.content;return json({success:true,redirectHash:'#comment-25'});
    }
    if(url.pathname.startsWith('/avatar/'))return new Response(Buffer.from(fixture.png,'base64'),{headers:{'content-type':'image/png'}});
    if(url.pathname.startsWith('/api/account/getInfo/')){const id=Number(url.pathname.split('/').pop());return json({success:true,detail:{member_id:id,member_name:id===42?'当前账号':id===77?'主题作者':'其他成员',rank:id===77?7:4,coin:20,bio:'',signature_markdown:'',readme:''}});}
    if(url.pathname==='/api/notification/unread-count')return json({success:true,unreadCount:{atMe:0,reply:0,message:0}});
    if(url.pathname.startsWith('/api/'))return json({success:true,data:[],memberList:[],msgArray:[]});
    if(url.hostname==='rss.nodeseek.com')return new Response('<rss><channel><item><title>回复分页回归主题</title><link>https://www.nodeseek.com/post-123-1</link><description>公开摘要</description></item></channel></rss>',{headers:{'content-type':'application/rss+xml'}});
    state.documents.push({url:request.url,cacheControl:request.headers.get('cache-control'),pragma:request.headers.get('pragma')});
    return new Response(documentHtml(request.url),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=3600'}});
  }
  app.whenReady().then(()=>{for(const partition of [undefined,'persist:nodeseek','public-rss']){const target=partition?session.fromPartition(partition):session.defaultSession;target.protocol.handle('https',route);}});
  globalThis.fetch=async input=>{throw new Error('No external request expected: '+String(input));};
}
(async()=>{
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(output,{recursive:true});
  const settings={theme:'light',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings,workspace:{tabs:[],activeId:null,overviewOpen:true}}));
  const extensions={installed:['authorOnly'],enabled:['authorOnly'],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,authorOnly:true,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作计划',officeButton:'返回',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,blocked:[],hits:[],unread:0};
  await fs.writeFile(path.join(profile,'workspace-features.json'),JSON.stringify({extensions,history:[],drafts:{}}));
  const entry=path.join(profile,'fixture-entry.cjs'),fixture={main:path.join(project,'dist-electron/electron/main.js'),png:(await fs.readFile(path.join(project,'build/icon.png'))).toString('base64')};
  await fs.writeFile(entry,'('+installFixture.toString()+')('+JSON.stringify(fixture)+');require('+JSON.stringify(fixture.main)+');');
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[entry],env,timeout:45000});page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.locator('.workspace').waitFor();await page.evaluate(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/'));await page.waitForFunction(async()=>(await window.seekdesk.checkAccount()).id===42);await page.evaluate(()=>window.seekdesk.closeOfficial());
  await page.getByTestId('post-row').first().waitFor({timeout:30000});await page.getByTestId('post-row').first().click();await page.locator('.thread-original').waitFor();
  assert.equal(await page.locator('.comment[data-floor="25"]').count(),0);assert.match(await page.locator('.thread-pagination').innerText(),/第 1 页/);
  const editor=page.locator('.fixed-reply .md-editor textarea');if(!await editor.count())await page.getByRole('button',{name:'写回复',exact:true}).click();
  await editor.fill('只进入隔离测试接口的新回复');await page.getByTestId('submit-reply').click();
  await page.locator('.comment[data-floor="25"]').waitFor({timeout:20000});await page.getByText('第 3 页',{exact:true}).waitFor();
  assert.match(await page.locator('.comment[data-floor="25"]').innerText(),/新回复已同步 revision 1/);
  const afterReply=await app.evaluate(()=>globalThis.__replyFixture);
  assert.equal(afterReply.writes.length,1);assert.equal(afterReply.writes[0].path,'/api/content/new-comment');assert.equal(afterReply.writes[0].body.postId,123);assert.ok(afterReply.page3Reads>=2);
  check('Reply navigates from page one to its real third-page floor and retries reads without repeating POST',{postCount:afterReply.writes.length,page3Reads:afterReply.page3Reads});
  assert.ok(await page.locator('.comment[data-floor="25"]').isVisible());check('Own newly published reply remains visible while the author-only preference is active');
  await page.screenshot({path:path.join(output,'reply-refresh-visible.png')});

  const beforeDirect=afterReply.documents.filter(row=>new URL(row.url).pathname==='/post-123-3').length;
  await app.evaluate(()=>{globalThis.__replyFixture.revision=2;});
  const direct=await page.evaluate(()=>window.seekdesk.readThread({id:'123',url:'https://www.nodeseek.com/post-123-3#comment-25',title:'回复分页回归主题',author:'主题作者',authorId:77,category:'tech',published:'',summary:''},3));
  assert.match(direct.comments.find(row=>row.id==='25').html,/revision 2/);
  const afterDirect=await app.evaluate(()=>globalThis.__replyFixture);
  assert.ok(afterDirect.documents.filter(row=>new URL(row.url).pathname==='/post-123-3').length>beforeDirect);
  assert.ok(afterDirect.commands.some(row=>row.method==='Network.enable'&&row.success));
  assert.ok(afterDirect.commands.some(row=>row.method==='Network.setCacheDisabled'&&row.params?.cacheDisabled===true&&row.success));
  check('Hidden reader executes CDP cache disabling and a changed hash performs a fresh document read',{freshReads:afterDirect.documents.filter(row=>new URL(row.url).pathname==='/post-123-3').length-beforeDirect,cacheDisabled:true});

  await app.evaluate(()=>{globalThis.__replyFixture.revision=3;});
  await page.getByRole('button',{name:'刷新当前帖子',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.comment[data-floor="25"]')?.textContent.includes('revision 3'));
  assert.equal((await app.evaluate(()=>globalThis.__replyFixture)).writes.length,1);
  check('Manual refresh shows newly fetched content and never repeats the accepted reply');
  assert.deepEqual(report.errors,[]);report.status='pass';
})().catch(async error=>{report.status='fail';report.failure=error.stack;console.error(error);if(page)await page.screenshot({path:path.join(output,'reply-refresh-failure.png')}).catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'reply-refresh-smoke.json'),JSON.stringify(report,null,2));});
