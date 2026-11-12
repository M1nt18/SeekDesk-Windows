/* Source-only integration. Every forum page/API and upload is a local fixture. */
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification'),profile=path.join(project,'.test-data','parity-backend-'+Date.now());
const report={testedAt:new Date().toISOString(),scope:'Real compiled Electron main and sandboxed preload; all forum requests and uploads intercepted; isolated userData; no package generation or real forum writes.',checks:[],errors:[]};
const check=(name,detail)=>{report.checks.push({name,status:'pass',detail});console.log('PASS',name,detail||'');};
let app,page,owner=42,intro={bio:'个人简介',signature:'原始签名',readme:'原始自述'},rejectNext=false;const writes=[],reads=[];
const messages=()=>[{id:100,sender_id:77,receiver_id:owner,sender_name:'朋友甲',content:'早期未读',created_at:'2026-11-01',viewed:0,is_markdown:1},{id:101,sender_id:owner,receiver_id:77,receiver_name:'朋友甲',content:'最新发出',created_at:'2026-11-03',viewed:1,is_markdown:1},{id:102,sender_id:77,receiver_id:88,sender_name:'外部',content:'不可泄漏',created_at:'2026-11-04',viewed:0,is_markdown:0}];
const config=()=>({user:{member_id:owner,member_name:'隔离测试账号 '+owner,rank:3},commmentPerPage:20,postData:{postId:123,title:'原帖标题',rank:2,comments:[{floorIndex:0,commentId:9000,markdown:'原始正文',poster:{isMe:owner===42}},{floorIndex:1,commentId:9001,markdown:'别人的回复',poster:{isMe:false}},{floorIndex:2,commentId:9002,markdown:'自己的回复',poster:{isMe:owner===42}}]}});
const row=(id,category='tech')=>`<li class="post-list-item"><div class="post-title"><a href="/post-${id}-1">测试帖子 ${id}</a></div><div class="info-author"><a href="/space/77">朋友甲</a></div><a class="post-category" href="/categories/${category}">${category}</a></li>`;
function documentHtml(url){const route=new URL(url).pathname;let content=route.startsWith('/post-')?'<div class="nsk-post-wrapper"><h1><a class="post-title-link">原帖标题</a></h1><div class="content-item" id="0"><div class="nsk-content-meta-info"><a class="author-name" href="/space/42">隔离测试账号</a></div><div class="post-content"><p>完整公开正文。</p></div></div></div><div class="comments"><div class="content-item" id="2"><div class="nsk-content-meta-info"><a class="author-name" href="/space/42">隔离测试账号</a></div><div class="post-content"><p>自己的回复</p></div></div></div>':route==='/new-discussion'?'<textarea id="editor"></textarea><select id="category"><option value="tech">技术</option><option value="daily">日常</option><option value="inside" disabled>禁用版块</option></select>':'<ul class="post-list">'+row(123)+row(124,'daily')+'</ul><a class="pager-next" href="/search/page-2">下一页</a>';
  return '<!doctype html><meta charset="utf-8"><title>隔离论坛接口</title><script>window.__config__='+JSON.stringify(config())+';window.markdownit=function(){this.render=function(s){return s.includes("![")?"<img src=x>":s.startsWith(">")?"<blockquote>":s;}}</script><div id="nsk-head"></div><div id="nsk-body-left">'+content+'</div>';
}
async function identity(id){owner=id;await page.evaluate(async()=>{await window.seekdesk.openOfficial('https://www.nodeseek.com/');await window.seekdesk.reloadOfficial();});for(let i=0;i<100;i++){const account=await page.evaluate(()=>window.seekdesk.checkAccount());if(account.status==='signed-in'&&account.id===id){await page.evaluate(()=>window.seekdesk.closeOfficial());return account;}await page.waitForTimeout(50);}throw new Error('Fixture identity did not become '+id);}
async function timed(promise,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Smoke timeout: '+label)),45000);})]);}finally{clearTimeout(timer);}}
async function query(request){return timed(page.evaluate(request=>window.seekdesk.queryForum(request),request),'query '+request.kind);}
async function write(request,id=owner){return timed(page.evaluate(({request,id})=>window.seekdesk.writeForum(request,id),{request,id}),'write '+request.kind);}
async function action(request,id=owner){return timed(page.evaluate(({request,id})=>window.seekdesk.forumAction(request,id),{request,id}),'action '+request.kind);}
(async()=>{
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(output,{recursive:true});
  // A blank, exact file URL keeps the real assertLocal/preload path while avoiding
  // React effects issuing unrelated polling calls during backend assertions.
  const entry=path.join(profile,'fixture-entry.cjs'),main=path.join(project,'dist-electron/electron/main.js'),png=await fs.readFile(path.join(project,'build/icon.png'));
  await fs.writeFile(entry,`const {app,session}=require('electron');
app.whenReady().then(()=>session.defaultSession.protocol.handle('file',()=>new Response('<!doctype html><meta charset="utf-8"><title>Backend fixture</title><main>SeekDesk backend integration</main>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));
globalThis.__fixtureMedia=[];globalThis.fetch=async(input,options={})=>{const url=String(input);if(url==='https://api.nodeimage.com/api/upload'){globalThis.__fixtureMedia.push({url,method:options.method,hasKey:typeof options.headers?.['X-API-Key']==='string',hasImage:options.body?.has('image')});return new Response(JSON.stringify({success:true,links:{direct:'https://www.nodeseek.com/uploaded-fixture.png'}}),{headers:{'content-type':'application/json'}});}if(url==='https://www.nodeseek.com/media-fixture.png')return new Response(Buffer.from(${JSON.stringify(png.toString('base64'))},'base64'),{headers:{'content-type':'image/png'}});throw new Error('Unexpected non-fixture main fetch: '+url);};require(${JSON.stringify(main)});`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[entry],env,timeout:45000});
  await app.context().route('https://**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(!['www.nodeseek.com','nodeseek.com'].includes(url.hostname))return route.fulfill({status:404,body:'No live requests permitted'});
    if(request.method()==='POST'){
      const body=request.postDataJSON();writes.push({path:url.pathname,body,headers:request.headers()});
      if(rejectNext){rejectNext=false;return route.fulfill({status:200,json:{success:false,message:'测试拒绝，保留草稿'}});}
      if(url.pathname==='/api/account/introduction')intro={...body};
      return route.fulfill({json:{success:true,redirect:'/post-222-1',gain:5,current:25,coin:30}});
    }
    reads.push(url.pathname+url.search);
    if(url.pathname.startsWith('/api/account/getInfo/')){const id=Number(url.pathname.split('/').pop());return route.fulfill({json:{success:true,detail:{member_id:id,member_name:'成员 '+id,rank:3,created_at_str:'2026-01-01',nPost:3,nComment:9,follows:2,fans:4,coin:20,bio:intro.bio,signature_markdown:intro.signature,readme:intro.readme,roles:[{display_text:'测试等级'}]}}});}
    if(url.pathname==='/api/notification/unread-count')return route.fulfill({json:{success:true,unreadCount:{atMe:1,reply:2,message:3}}});
    if(url.pathname==='/api/notification/at-me/list'||url.pathname==='/api/notification/reply-to-me/list')return route.fulfill({json:{success:true,data:[{id:800,commenter_id:77,commenter_name:'朋友甲',post_id:123,floor_id:21,title:'通知帖子',viewed:0,created_at:'2026-11-01'}]}});
    if(url.pathname==='/api/notification/message/list'||url.pathname.startsWith('/api/notification/message/with/'))return route.fulfill({json:{success:true,msgArray:messages()}});
    if(url.pathname.startsWith('/api/account/find/'))return decodeURIComponent(url.pathname).includes('missing')?route.fulfill({status:500,json:{success:false,message:'USER NOT FOUND'}}):route.fulfill({json:{success:true,memberList:[{member_id:77,member_name:'朋友甲'}]}});
    if(url.pathname==='/api/content/list-discussions'||url.pathname==='/api/content/list-comments'){const key=url.pathname.endsWith('comments')?'comments':'discussions';return route.fulfill({json:{success:true,[key]:url.searchParams.get('page')==='2'?[]:[{post_id:123,title:'成员动态',floor_id:key==='comments'?21:0,text:'动态正文'}]}});}
    if(url.pathname==='/api/fans/fans'||url.pathname==='/api/fans/follow')return route.fulfill({json:{success:true,memberList:[{member_id:77,member_name:'朋友甲'}]}});
    if(url.pathname.startsWith('/api/progress/'))return route.fulfill({json:{success:true,maxFreeLike:3,freeLikeUsed:1}});
    if(url.pathname.startsWith('/avatar/'))return route.fulfill({status:200,contentType:'image/png',body:png});
    if(url.pathname.startsWith('/api/'))throw new Error('Unexpected forum API '+url.pathname);
    return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:documentHtml(request.url())});
  });
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.waitForFunction(()=>Boolean(window.seekdesk?.queryForum));
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');check('Real sandboxed preload with exact local sender validation');
  await identity(42);check('Fixture official session is recognized without signing into a real account');
  const account=await query({kind:'account'});assert.equal(account.profile.id,42);assert.equal(account.profile.coin,20);assert.deepEqual(account.unread,{mentions:1,replies:2,messages:3});
  for(const category of ['mentions','replies']){const result=await query({kind:'notifications',category});assert.equal(result.notices[0].url,'https://www.nodeseek.com/post-123-2#21');}
  const inbox=await query({kind:'notifications',category:'messages'});assert.equal(inbox.conversations.length,1);assert.equal(inbox.conversations[0].unread,true);assert.equal(inbox.conversations[0].preview,'最新发出');
  const conversation=await query({kind:'conversation',memberId:77});assert.equal(conversation.messages.length,2);assert.ok(conversation.messages.every(row=>row.text!=='不可泄漏'));check('Account balances, unread counts, all inbox categories and exact private participants');
  const introduction=await query({kind:'introduction',memberId:42});assert.equal(introduction.introduction.signature,'原始签名');
  for(const section of ['topics','comments','followers','following']){const result=await query({kind:'space',memberId:42,section});assert.ok((result.activity||result.users).length>0);}
  for(const section of ['followers','following'])assert.equal((await query({kind:'directory',memberId:42,section})).users[0].id,77);
  assert.equal((await query({kind:'search-users',term:'朋友'})).users[0].id,77);assert.equal((await query({kind:'search-users',term:'missing'})).users.length,0);
  const search=await query({kind:'search',term:'fixture',categories:['tech']});assert.equal(search.posts.length,1);assert.equal(search.nextPage,2);
  assert.equal((await query({kind:'attendance-status'})).attendance.kind,'ready');assert.equal((await query({kind:'stickers'})).stickers.length,252);
  const options=await query({kind:'composer-options'});assert.equal(options.options.categories.length,2);assert.equal(options.options.ranks.at(-1).value,255);
  const edit=await query({kind:'edit-source',url:'https://www.nodeseek.com/post-123-1',floor:'2'});assert.equal(edit.edit.content,'自己的回复');check('Personal space, own directory, search/scope/pagination, editor permissions and official stickers');
  const post=await write({kind:'new-topic',title:'只发模拟接口',content:'模拟正文',category:'tech',rank:2});assert.equal(post.url,'https://www.nodeseek.com/post-222-1');
  await write({kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'0',title:'修订标题',content:'修订正文'});
  await write({kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'2',content:'修订自己的回复'});
  await assert.rejects(write({kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'1',content:'不允许改别人'}),/只能编辑/);
  await write({kind:'profile',original:introduction.introduction,draft:{...introduction.introduction,readme:'新的自述'}});
  for(const category of ['mentions','replies','messages'])await write({kind:'mark-read',category,id:category==='messages'?77:800});
  const mark=writes.find(row=>row.path==='/api/notification/message/markViewed');assert.deepEqual(mark.body,{messages:[100]});
  await page.evaluate(async()=>{const state=await window.seekdesk.getExtensions();await window.seekdesk.saveExtensions({...state,installed:[...new Set([...state.installed,'attendance'])],enabled:[...new Set([...state.enabled,'attendance'])],autoAttendance:false});});
  const attendance=await write({kind:'attendance',mode:'fixed'});assert.equal(attendance.attendance.kind,'completed');assert.equal(attendance.attendance.gain,5);
  assert.equal(writes.filter(row=>row.path==='/api/attendance').length,1);check('New topic, root/comment edit, conflict-safe profile, precise mark-read and attendance write routes');
  await action({kind:'reply',url:'https://www.nodeseek.com/post-123-1',content:'模拟回复'});
  await action({kind:'react',url:'https://www.nodeseek.com/post-123-1',commentId:'2',reaction:'like'});
  const quote=await action({kind:'react',url:'https://www.nodeseek.com/post-123-1',commentId:'2',reaction:'chicken'});assert.equal(quote.confirmation,'free');
  await action({kind:'react',url:'https://www.nodeseek.com/post-123-1',commentId:'2',reaction:'chicken',approval:'free'});
  const down=await action({kind:'react',url:'https://www.nodeseek.com/post-123-1',commentId:'2',reaction:'dislike'});assert.equal(down.confirmation,'paid');
  await action({kind:'follow',memberId:77,follow:true});await action({kind:'follow',memberId:77,follow:false});await action({kind:'message',memberId:77,content:'模拟私信'});
  assert.deepEqual(writes.find(row=>row.path==='/api/statistics/upvote').body,{commentId:9002,action:'add'});check('Reply, real comment-ID reactions, paid/free confirmations, follow/unfollow and private message');
  const before=writes.length;rejectNext=true;await assert.rejects(write({kind:'new-topic',title:'拒绝测试',content:'保留草稿',category:'tech',rank:0}),/测试拒绝/);assert.equal(writes.length,before+1);check('Explicit rejection never reports success or automatically resubmits');
  await page.evaluate(()=>window.seekdesk.saveDraft('new-topic',{title:'账号42草稿',content:'仅属于42'},42));await identity(84);
  assert.equal(await page.evaluate(()=>window.seekdesk.loadDraft('new-topic',42)),null);assert.equal(await page.evaluate(()=>window.seekdesk.loadDraft('new-topic',84)),null);
  const staleBefore=writes.length;await assert.rejects(write({kind:'new-topic',title:'错误账号',content:'不应发送',category:'tech',rank:0},42),/账号已变化/);await assert.rejects(action({kind:'message',memberId:77,content:'不应发送'},42),/账号已变化/);assert.equal(writes.length,staleBefore);
  await assert.rejects(page.evaluate(()=>window.seekdesk.saveDraft('new-topic',{content:'不可串号'},42)),/草稿所属账号/);
  await page.evaluate(()=>window.seekdesk.saveDraft('new-topic',{content:'账号84草稿'},84));await identity(42);assert.equal((await page.evaluate(()=>window.seekdesk.loadDraft('new-topic',42))).content,'仅属于42');check('Stale expected-owner writes rejected and per-account drafts remain isolated');
  const media=await page.evaluate(async()=>{const saved=await window.seekdesk.setMediaSettings({apiKey:'isolated-fixture-key',defaultImageWidth:640});const settings=await window.seekdesk.getMediaSettings();return {saved,settings,serialized:JSON.stringify(await window.seekdesk.parityBootstrap())};});assert.deepEqual(media.settings,{hasApiKey:true,defaultImageWidth:640});assert.ok(!media.serialized.includes('isolated-fixture-key'));
  const encrypted=JSON.parse(await fs.readFile(path.join(profile,'media.json'),'utf8'));assert.ok(encrypted.key);assert.ok(!JSON.stringify(encrypted).includes('isolated-fixture-key'));
  const uploaded=await page.evaluate(async base64=>{const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));return window.seekdesk.uploadImage({name:'fixture.png',mime:'image/png',bytes,width:320});},png.toString('base64'));assert.equal(uploaded.url,'https://www.nodeseek.com/uploaded-fixture.png');
  const thumbnail=await page.evaluate(()=>window.seekdesk.loadReaderImage('https://www.nodeseek.com/media-fixture.png',64));assert.equal(thumbnail.width,64);assert.equal(thumbnail.reduced,true);assert.match(thumbnail.data,/^data:image\/webp;base64,/);
  const resized=await page.evaluate(()=>window.seekdesk.prepareImages('![图](https://www.nodeseek.com/media-fixture.png)',{'https://www.nodeseek.com/media-fixture.png':64}));assert.match(resized,/uploaded-fixture/);
  const uploads=await app.evaluate(()=>globalThis.__fixtureMedia);assert.equal(uploads.length,2);assert.ok(uploads.every(row=>row.hasKey&&row.hasImage&&row.method==='POST'));check('DPAPI key stays out of renderer, typed-array upload/resize and lazy reader thumbnail use mocked NodeImage');
  const isolation=await app.evaluate(async({BrowserWindow})=>{const main=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:')),view=main.contentView.children.find(view=>view.webContents);return view.webContents.executeJavaScript('({require:typeof require,bridge:typeof window.seekdesk})');});assert.deepEqual(isolation,{require:'undefined',bridge:'undefined'});
  assert.deepEqual(report.errors,[]);check('Remote official page receives no Node or app IPC bridge');report.status='pass';report.interceptedWrites=writes.map(({path,body})=>({path,body}));report.readCount=reads.length;
})().catch(error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});await fs.mkdir(output,{recursive:true});await fs.writeFile(path.join(output,'parity-backend-smoke.json'),JSON.stringify(report,null,2));});
