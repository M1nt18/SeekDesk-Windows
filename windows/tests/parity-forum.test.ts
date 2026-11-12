import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createQueryScript,createWriteScript,officialStickers,requestPage,validateQueryRequest,validateWriteRequest} from '../electron/parity-forum';
import {captureTerminalsScript,extractThreadScript,sanitizeContent} from '../electron/forum';
import {parseAnsi} from '../src/ansi';

const response=(body:unknown,status=200)=>({ok:status>=200&&status<300,status,headers:{get:()=>null},json:async()=>body});
function fixture(fetcher:(url:string,options:any)=>Promise<unknown>=async()=>response({success:true}),url='https://www.nodeseek.com/post-123-1'){
  const page=new JSDOM('<div id="nsk-head"></div><textarea id="editor"></textarea><select id="category"><option value="tech">技术</option><option value="inside" disabled>内部</option></select>',{url,runScripts:'outside-only'}),win=page.window as any,calls:{url:string;options:any}[]=[];
  win.__config__={user:{member_id:42,rank:3},commmentPerPage:20,postData:{postId:123,title:'原始标题',rank:2,comments:[{floorIndex:0,commentId:9000,markdown:'原始正文',poster:{isMe:true}},{floorIndex:8,commentId:9876,markdown:'原始回复',poster:{isMe:true}},{floorIndex:9,commentId:9999,markdown:'别人的回复',poster:{isMe:false}}]}};
  win.AbortSignal=AbortSignal;win.fetch=async(url:string,options:any)=>{calls.push({url,options});return fetcher(url,options);};
  return {page,win,calls,query:(request:unknown)=>win.eval(createQueryScript(request,42)),write:(request:unknown)=>win.eval(createWriteScript(request,42))};
}
test('parity boundary strips renderer extras and rejects malformed requests',()=>{
  assert.throws(()=>validateQueryRequest({kind:'conversation',memberId:0}));
  assert.throws(()=>validateWriteRequest({kind:'edit',url:'https://evil.test/post-123-1',floor:'8',content:'x'}));
  assert.throws(()=>validateWriteRequest({kind:'new-topic',title:'x',content:'x',category:'tech',rank:'3'}));
  assert.deepEqual(validateWriteRequest({kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'8',content:'x',commentId:666,rank:255}),{kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'8',content:'x'});
  assert.equal(requestPage({kind:'composer-options'}),'https://www.nodeseek.com/new-discussion');
  assert.equal(requestPage({kind:'search',term:'鸡腿 a',page:2}),'https://www.nodeseek.com/search/page-2?q=%E9%B8%A1%E8%85%BF%20a');
  assert.equal(officialStickers().length,252);assert.equal(officialStickers().find(row=>row.id==='xhj004')?.url,'https://www.nodeseek.com/static/image/sticker/xhj/004.gif');
});
test('private conversation isolates the exact participant pair and message list aggregates unread incoming rows',async()=>{
  const msgArray=[{id:1,sender_id:77,receiver_id:42,sender_name:'甲',content:'早期未读',created_at:'2026-01-01',viewed:0},{id:2,sender_id:42,receiver_id:77,receiver_name:'甲',content:'较新的发出',created_at:'2026-01-03',viewed:1},{id:3,sender_id:77,receiver_id:88,content:'他人私信',created_at:'2026-01-04',viewed:0},{id:4,sender_id:88,receiver_id:42,sender_name:'乙',content:'另一个对话',created_at:'2026-01-02',viewed:1}];
  const f=fixture(async()=>response({success:true,msgArray}));try{
    const list=await f.query({kind:'notifications',category:'messages'});assert.equal(list.conversations.length,2);assert.equal(list.conversations[0].id,77);assert.equal(list.conversations[0].preview,'较新的发出');assert.equal(list.conversations[0].unread,true);
    const thread=await f.query({kind:'conversation',memberId:77});assert.deepEqual(Array.from(thread.messages,(row:any)=>row.id),['1','2']);
  }finally{f.page.window.close();}
});
test('mark-read derives actual incoming message IDs, never peer IDs or outgoing/foreign messages',async()=>{
  const f=fixture(async(url)=>response(url.includes('/with/')?{success:true,msgArray:[{id:100,sender_id:77,receiver_id:42,viewed:0},{id:101,sender_id:77,receiver_id:42,viewed:1},{id:102,sender_id:42,receiver_id:77,viewed:0},{id:103,sender_id:77,receiver_id:88,viewed:0}]}:{success:true}));
  try{await f.write({kind:'mark-read',category:'messages',id:77});assert.equal(f.calls[1].url,'/api/notification/message/markViewed');assert.deepEqual(JSON.parse(f.calls[1].options.body),{messages:[100]});}finally{f.page.window.close();}
});
test('edit revalidates ownership, floor and genuine comment ID on the official post',async()=>{
  const f=fixture();try{
    const source=await f.query({kind:'edit-source',url:'https://www.nodeseek.com/post-123-1',floor:'8'});assert.equal(source.edit.content,'原始回复');
    await assert.rejects(f.write({kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'9',content:'试图编辑别人'}),/只能编辑/);assert.equal(f.calls.length,0);
    await f.write({kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'8',content:'修订'});assert.equal(f.calls[0].url,'/api/content/edit-comment');assert.deepEqual(JSON.parse(f.calls[0].options.body),{mode:'edit-comment',content:'修订',commentId:9876});assert.match(f.calls[0].options.headers['csrf-token'],/^[A-Za-z0-9]{16}$/);
    f.win.__config__.user.member_id=88;await assert.rejects(f.write({kind:'edit',url:'https://www.nodeseek.com/post-123-1',floor:'8',content:'x'}),/账号会话/);assert.equal(f.calls.length,1);
  }finally{f.page.window.close();}
});
test('publish reads actual enabled categories and account rank and only accepts safe redirect',async()=>{
  const f=fixture(async()=>response({success:true,redirect:'https://evil.test/post-444-1'}),'https://www.nodeseek.com/new-discussion');try{
    const result=await f.query({kind:'composer-options'});assert.equal(result.options.categories.length,1);assert.equal(result.options.ranks.length,5);
    const request={kind:'new-topic',title:'测试',content:'正文',category:'tech',rank:2};
    await assert.rejects(f.write({...request,category:'inside'}),/重新选择/);await assert.rejects(f.write({...request,rank:4}),/重新选择/);assert.equal(f.calls.length,0);
    const wrote=await f.write(request);assert.equal(wrote.url,undefined);assert.deepEqual(JSON.parse(f.calls[0].options.body),{mode:'new-discussion',title:'测试',content:'正文',category:'tech',rank:2});
  }finally{f.page.window.close();}
});
test('profile save preserves newer untouched fields and rejects a changed-field conflict before writing',async()=>{
  let latest={bio:'新的简介',signature_markdown:'旧签名',readme:'旧自述'};
  const f=fixture(async(url)=>response(url.includes('getInfo')?{success:true,detail:{member_id:42,member_name:'自己',...latest}}:{success:true}));try{
    const original={bio:'旧简介',signature:'旧签名',readme:'旧自述'},draft={...original,readme:'新自述'};
    await f.write({kind:'profile',original,draft});assert.deepEqual(JSON.parse(f.calls[1].options.body),{bio:'新的简介',signature:'旧签名',readme:'新自述'});
    latest={...latest,readme:'别处新改'};await assert.rejects(f.write({kind:'profile',original,draft}),/其他页面更新/);assert.equal(f.calls.filter(row=>row.options.method==='POST').length,1);
  }finally{f.page.window.close();}
});
test('unknown write results are never successful and never retried',async()=>{
  const f=fixture(async()=>response({}),'https://www.nodeseek.com/new-discussion');try{
    await assert.rejects(f.write({kind:'new-topic',title:'测试',content:'正文',category:'tech',rank:0}),/勿重复提交/);assert.equal(f.calls.length,1);
  }finally{f.page.window.close();}
});
test('server missing-user HTTP 500 produces an empty directory instead of a fabricated error',async()=>{
  const f=fixture(async()=>response({success:false,message:'USER NOT FOUND'},500));try{const result=await f.query({kind:'search-users',term:'missing-user'});assert.equal(result.users.length,0);}finally{f.page.window.close();}
});

test('terminal source survives xterm replacement and hidden report tabs retain every line',async()=>{
  const f=fixture();try{
    f.page.window.document.body.innerHTML='<div id="nsk-body-left"><div class="nsk-post-wrapper"><h1><a class="post-title-link">报告</a><span>只读</span></h1><div class="content-item" id="0"><div class="nsk-content-meta-info"><a class="author-name" href="/space/42">楼主</a></div><div class="post-content"></div></div></div></div>';
    f.page.window.eval(captureTerminalsScript);
    const content=f.page.window.document.querySelector('.post-content')!;
    content.innerHTML='<div class="nsk-magic-tabs"><div class="nsk-magic-tab-title">基本信息</div><div class="nsk-magic-tab-body"><pre class="ansi"><code></code></pre></div><div class="nsk-magic-tab-title">IP质量</div><div class="nsk-magic-tab-body" hidden aria-hidden="true"><pre class="ansi"><code></code></pre></div></div>';
    const codes=content.querySelectorAll('code');codes[0].textContent='\x1b[31m基本报告\x1b[0m';codes[1].textContent=Array.from({length:300},(_,i)=>'\x1b[32m完整第'+i+'行\x1b[0m').join('\n');await Promise.resolve();
    content.querySelectorAll('pre').forEach(pre=>{const terminal=f.page.window.document.createElement('div');terminal.className='terminal-container';terminal.innerHTML='<div class="xterm"><canvas></canvas></div>';pre.replaceWith(terminal);});await Promise.resolve();
    const result=f.page.window.eval(extractThreadScript),html=sanitizeContent(result.comments[0].html);
    assert.equal(result.replyRestriction,'只读');assert.equal(result.rootAuthorId,42);assert.equal(result.comments[0].isOwn,true);
    assert.match(html,/nsk-magic-tab-title/);assert.match(html,/IP质量/);assert.match(html,/seekdesk-terminal/);assert.match(html,/完整第299行/);assert.doesNotMatch(html,/canvas|aria-hidden|hidden/);
  }finally{f.page.window.close();}
});
test('ANSI decoder preserves SGR foreground/background, 256-color, RGB and resets without dropping report lines',()=>{
  const source='标题\n\x1b[1;31m红色粗体\x1b[0m 普通\n\x1b[38;5;196;48;2;1;2;3m颜色\x1b[39;49;22m复原';
  const result=parseAnsi(source);assert.equal(result.map(row=>row.text).join(''),'标题\n红色粗体 普通\n颜色复原');
  assert.equal(result.find(row=>row.text==='红色粗体')?.bold,true);assert.equal(result.find(row=>row.text==='红色粗体')?.foreground,'#e06c75');assert.equal(result.find(row=>row.text==='颜色')?.foreground,'rgb(255,0,0)');assert.equal(result.find(row=>row.text==='颜色')?.background,'rgb(1,2,3)');assert.equal(result.at(-1)?.foreground,undefined);assert.equal(result.at(-1)?.bold,undefined);
  assert.equal(parseAnsi('[INFO] 原样保存 [OK]\n[31m红色[0m').map(row=>row.text).join(''),'[INFO] 原样保存 [OK]\n红色');
});
test('Markdown preview sanitizes active markup and only expands real sticker tokens outside code',async()=>{
  const page=new JSDOM('<html></html>');const previous=(globalThis as any).window;(globalThis as any).window=page.window;
  try{
    const {renderMarkdown,applyMarkdownCommand}=await import('../src/markdown');
    const html=renderMarkdown('**加粗**\n\n:ac01: `:ac01:`\n\n<script>alert(1)</script>\n\n[恶意](javascript:alert(1))\n\n![图](https://example.com/a.png)',{'https://example.com/a.png':640});
    assert.match(html,/<strong>加粗<\/strong>/);assert.equal((html.match(/class="sticker"/g)||[]).length,1);assert.match(html,/<code>:ac01:<\/code>/);assert.doesNotMatch(html,/<script\b|href="javascript:|onerror=/);assert.match(html,/width:640px/);
    const edit=applyMarkdownCommand('alpha\nbeta',2,8,'quote');assert.equal(edit.text,'> alpha\n> beta');
    const bold=applyMarkdownCommand('测试文本',0,2,'bold');assert.equal(bold.text,'**测试**文本');assert.equal(bold.text.slice(bold.start,bold.end),'测试');
  }finally{(globalThis as any).window=previous;page.window.close();}
});
test('featured marker uses the upstream award diamond selector on feeds and global search',async()=>{
  const {extractListingScript}=await import('../electron/forum');
  const f=fixture(undefined,'https://www.nodeseek.com/search?q=fixture');try{
    f.page.window.document.body.innerHTML='<div id="nsk-body-left"><ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-123-1">精品帖子</a><a href="/award"><svg><use href="#diamonds"></use></svg></a></div><a class="post-category" href="/categories/tech">技术</a></li></ul></div>';
    assert.equal(f.page.window.eval(extractListingScript).posts[0].featured,true);
    assert.equal((await f.query({kind:'search',term:'fixture'})).posts[0].featured,true);
  }finally{f.page.window.close();}
});
