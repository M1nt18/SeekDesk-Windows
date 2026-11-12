import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isOfficialUrl, normalizePostUrl, listingUrl, parseRss, sanitizeContent,
  extractListingScript, extractThreadScript, extractIdentityScript, createProfileMetadataScript, extractThreadWithProfilesScript } from '../electron/forum';

test('official links reject forged hosts, credentials, schemes, ports, and malformed post routes', () => {
  for (const value of ['https://www.nodeseek.com.evil.test/post-1-1', 'http://www.nodeseek.com/post-1-1',
    'https://user:pass@www.nodeseek.com/post-1-1', 'https://www.nodeseek.com:444/post-1-1',
    'javascript:alert(1)', 'file:///post-1-1', null]) assert.equal(isOfficialUrl(value), false);
  assert.equal(isOfficialUrl('https://nodeseek.com:443/'), true);
  assert.equal(normalizePostUrl('https://nodeseek.com/post-123?unsafe=1#comment-4'), 'https://www.nodeseek.com/post-123-1#comment-4');
  for (const value of ['https://www.nodeseek.com/post-0-1', 'https://www.nodeseek.com/post-1-0',
    'https://www.nodeseek.com/post-1-1/extra']) assert.throws(() => normalizePostUrl(value));
});

test('listing routes allow only known boards, valid ordering, and bounded page numbers', () => {
  assert.equal(listingUrl({category:'tech', order:'replyTime', page:2}), 'https://www.nodeseek.com/categories/tech/page-2?sortBy=replyTime');
  assert.equal(listingUrl({category:'award'}), 'https://www.nodeseek.com/award');
  assert.throws(() => listingUrl({category:'../api/delete'}));
  assert.throws(() => listingUrl({page:-1}));
  assert.throws(() => listingUrl({page:1.5}));
});

test('RSS parses CDATA, HTML, metadata, duplicate IDs and rejects foreign links', () => {
  const xml = `<?xml version="1.0"?><rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel>
    <title>NodeSeek</title><item><title>Test &amp; public</title><link>https://www.nodeseek.com/post-123-1</link>
    <dc:creator>author</dc:creator><category>tech</category><pubDate>Wed, 11 Nov 2026 02:00:00 GMT</pubDate>
    <description><![CDATA[<p>Hello <strong>world</strong></p><script>alert(1)</script><img src="/avatar/1.png" onerror="alert(1)">]]></description></item>
    <item><title>duplicate</title><link>https://nodeseek.com/post-123-2</link></item>
    <item><title>foreign</title><link>https://evil.test/post-456-1</link></item>
    </channel></rss>`;
  const posts = parseRss(xml);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Test & public');
  assert.equal(posts[0].author, 'author');
  assert.equal(posts[0].category, 'tech');
  assert.equal(posts[0].published, '2026-11-11T02:00:00.000Z');
  assert.match(posts[0].summary, /<strong>world<\/strong>/);
  assert.match(posts[0].summary, /https:\/\/www.nodeseek.com\/avatar\/1.png/);
  assert.doesNotMatch(posts[0].summary, /script|onerror|alert/);
});

test('RSS rejects external entities, malformed XML, unrelated HTML, and broken item links', () => {
  assert.throws(() => parseRss('<!DOCTYPE rss [<!ENTITY xxe SYSTEM "file:///secret">]><rss><channel/></rss>'));
  assert.throws(() => parseRss('<rss><channel>'));
  assert.throws(() => parseRss('<html><body>challenge</body></html>'));
  assert.throws(() => parseRss('<rss><channel><item><title>x</title><link>javascript:alert(1)</link></item></channel></rss>'));
  assert.deepEqual(parseRss('<rss><channel><title>empty</title></channel></rss>'), []);
});

test('content allowlist retains reading markup while stripping active HTML and dangerous URL forms', () => {
  const result = sanitizeContent(`<h2>Headline</h2><table><tr><td>value</td></tr></table><pre><code class="language-js">const x=1;</code></pre>
    <svg onload="alert(1)"><script>bad()</script></svg><iframe src="https://evil.test">bad frame</iframe>
    <form action="https://evil.test"><input name="password"></form><p style="position:fixed" onclick="bad()">OK</p>
    <a href="javascript:alert(1)">click</a><img src="data:text/html,bad"><img src="//example.com/image.png" onerror="bad()">
    <a href="/post-123-1">read</a><a href="https://u:p@evil.test">credentials</a>`);
  assert.match(result, /<h2>Headline<\/h2>/);
  assert.match(result, /<table>/);
  assert.match(result, /language-js/);
  assert.match(result, /href="https:\/\/www.nodeseek.com\/post-123-1"/);
  assert.match(result, /rel="noopener noreferrer"/);
  assert.doesNotMatch(result, /svg|script|iframe|input|style=|onclick|onerror|javascript:|data:|u:p@/);
});

function dom(html: string, url = 'https://www.nodeseek.com/') {
  return new JSDOM(html, {url, runScripts:'outside-only'});
}

test('list extraction preserves board, author and locked reading level with pagination', () => {
  const page = dom(`<div id="nsk-body-left"><ul class="post-list"><li class="post-list-item">
    <div class="post-title"><a href="/post-123-1">A real-shaped post</a><span>20<svg><use href="#lock"></use></svg></span></div>
    <div class="info-author"><a href="/space/42">Author</a></div><img class="avatar-normal" data-src="/avatar/42.png">
    <a class="post-category" href="/categories/tech">技术</a><time datetime="2026-11-11T00:00:00Z"></time>
    </li></ul><a class="pager-next" href="/page-2">Next</a></div>`);
  const result = page.window.eval(extractListingScript);
  assert.equal(result.posts.length, 1);
  assert.equal(result.posts[0].author, 'Author');
  assert.equal(result.posts[0].authorId, 42);
  assert.equal(result.posts[0].category, 'tech');
  assert.equal(result.posts[0].readingRank, 20);
  assert.equal(result.posts[0].avatar, 'https://www.nodeseek.com/avatar/42.png');
  assert.equal(result.nextPage, 2);
  page.window.close();
});

test('list extraction combines pinned and normal lists, deduplicating posts across lists', () => {
  const row = (id: number, title: string) => `<li class="post-list-item"><div class="post-title"><a href="/post-${id}-1">${title}</a></div><div class="info-author"><a href="/space/42">Author</a></div></li>`;
  const page = dom(`<div id="nsk-body-left">
    <ul class="post-list pinned">${row(123, 'Pinned post')}</ul>
    <ul class="post-list regular">${row(123, 'Duplicated pin')}${row(456, 'Latest public post')}${row(789, 'Another public post')}</ul>
    <a class="pager-next" href="/page-2">Next</a></div>`);
  const result = page.window.eval(extractListingScript);
  assert.equal(result.posts.length, 3);
  assert.equal(JSON.stringify(result.posts.map((post: {id: string}) => post.id)), JSON.stringify(['123', '456', '789']));
  assert.equal(result.posts[0].title, 'Pinned post');
  assert.equal(result.posts[1].title, 'Latest public post');
  assert.equal(result.nextPage, 2);
  page.window.close();
});

test('thread extraction reads each floor, lazy media and same-thread next page without copying scripts', () => {
  const page = dom(`<div id="nsk-body-left"><div class="nsk-post-wrapper"><h1><a class="post-title-link">Thread</a></h1>
    <div class="content-item" id="0"><div class="nsk-content-meta-info"><a class="author-name" href="/space/42">Owner</a>
    <div class="avatar-wrapper"><img data-src="/avatar/42.png"></div><time datetime="2026-11-11T00:00:00Z">Now</time></div>
    <div class="post-content"><p>Public body</p><img data-src="/pic.png"><script>bad()</script></div></div></div>
    <div class="comments"><div class="content-item" id="1"><div class="nsk-content-meta-info"><a class="author-name">Reader</a></div><div class="post-content"><p>Reply</p></div></div></div>
    <div class="pagination"><a href="/post-123-2">2</a><a href="/post-999-2">other</a></div></div>`, 'https://www.nodeseek.com/post-123-1');
  const result = page.window.eval(extractThreadScript);
  assert.equal(result.id, '123');
  assert.equal(result.comments.length, 2);
  assert.equal(result.comments[0].floor, '楼主');
  assert.equal(result.comments[1].author, 'Reader');
  assert.match(result.comments[0].html, /https:\/\/www.nodeseek.com\/pic.png/);
  assert.doesNotMatch(result.comments[0].html, /script|bad/);
  assert.equal(result.nextPage, 2);
  page.window.close();
});

test('identity distinguishes unknown, signed out, signed in, and site verification', () => {
  const page = dom('<div id="nsk-head"></div>');
  assert.equal(page.window.eval(extractIdentityScript).status, 'unknown');
  (page.window as unknown as {__config__: unknown}).__config__ = {user:null};
  assert.equal(page.window.eval(extractIdentityScript).status, 'signed-out');
  (page.window as unknown as {__config__: unknown}).__config__ = {user:{member_id:42,member_name:'Fixture User'}};
  const identity = page.window.eval(extractIdentityScript);
  assert.equal(identity.status, 'signed-in');
  assert.equal(identity.id, 42);
  assert.equal(identity.name, 'Fixture User');
  assert.equal(identity.avatar, 'https://www.nodeseek.com/avatar/42.png');
  page.window.document.title = 'Just a moment...';
  assert.equal(page.window.eval(extractIdentityScript).status, 'verification');
  page.window.close();
});

test('thread metadata exposes real author IDs, levels, roles, signatures and reaction state',()=>{
  const page=dom(`<div id="nsk-body-left"><div class="nsk-post-wrapper"><h1><a class="post-title-link">Thread</a></h1>
    <div class="content-item" id="0"><div class="nsk-content-meta-info"><div class="author-info"><a class="author-name" href="/space/42">Owner</a><span class="role-tag">Lv 7</span><span class="role-tag">管理员</span><span class="role-tag is-poster">楼主</span></div></div><div class="post-content"><p>Body</p></div><div class="signature"><a href="/space/77">Public signature</a></div><div class="comment-menu"><button title="点赞" class="clicked">12</button><button title="加鸡腿">3</button><button title="反对">1</button></div></div></div></div>`,'https://www.nodeseek.com/post-123-1');
  try {
    const result=page.window.eval(extractThreadScript),comment=result.comments[0];
    assert.equal(comment.authorId,42);assert.equal(comment.level,7);assert.equal(comment.role,'管理员');
    assert.equal(comment.signature,'Public signature');assert.match(comment.signatureHtml,/href="https:\/\/www\.nodeseek\.com\/space\/77"/);assert.equal(comment.likes,12);assert.equal(comment.chicken,3);assert.equal(comment.dislikes,1);assert.equal(comment.liked,true);
    assert.equal(comment.avatar,'https://www.nodeseek.com/avatar/42.png');
  }finally{page.window.close();}
});

test('optional profile reads cap eight members and four concurrent requests, without inventing missing levels',async()=>{
  const page=dom('<div/>');let active=0,maxActive=0;const calls:string[]=[];
  (page.window as any).AbortController=AbortController;
  (page.window as any).fetch=async(url:string,options:RequestInit)=>{
    calls.push(url);assert.equal(options.credentials,'same-origin');assert.equal(options.method,undefined);
    active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,5));active--;
    const id=Number(url.split('/').pop());
    return {ok:true,headers:{get:()=>null},json:async()=>({success:true,detail:{member_id:id,rank:id===1?null:5,roles:[{display_text:'公开称号'}],followed:true}})};
  };
  try {
    const result=await page.window.eval(createProfileMetadataScript(Array.from({length:12},(_,i)=>i+1)));
    assert.equal(result.length,8);assert.equal(calls.length,8);assert.equal(maxActive,4);assert.equal(result.find((row:{memberId:number})=>row.memberId===1).level,undefined);
    assert.equal(result[0].role,'公开称号');assert.equal(result[0].following,true);
  }finally{page.window.close();}
});

test('combined thread extraction keeps the body when optional profile reads fail',async()=>{
  const page=dom('<div id="nsk-body-left"><div class="nsk-post-wrapper"><h1><a class="post-title-link">Thread</a></h1><div class="content-item" id="0"><div class="nsk-content-meta-info"><a class="author-name" href="/space/42">Owner</a></div><div class="post-content"><p>Readable body</p></div></div></div></div>','https://www.nodeseek.com/post-123-1');
  (page.window as any).AbortController=AbortController;
  (page.window as any).fetch=async()=>{throw new Error('profile service unavailable');};
  try {
    const result=await page.window.eval(extractThreadWithProfilesScript);
    assert.equal(result.comments[0].authorId,42);assert.equal(result.comments[0].level,undefined);assert.match(result.comments[0].html,/Readable body/);
  }finally{page.window.close();}
});
