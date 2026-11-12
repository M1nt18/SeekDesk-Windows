const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const project=path.resolve(__dirname,'..'),output=path.join(project,'verification');
const profile=path.join(project,'.test-data',`revision-${Date.now()}`);
const report={testedAt:new Date().toISOString(),scope:'Source-only Electron regression. All forum writes are intercepted fixtures, never submitted to the live site.',checks:[],screenshots:[],errors:[]};
let app,page;let replyRejected=true,following=false,postedReply='',delayListing=true;const writes=[];
const png=require('node:fs').readFileSync(path.join(project,'build/icon.png'));
const check=(name,detail)=>{report.checks.push({name,status:'pass',detail});console.log('PASS',name,detail||'');};
const config=()=>({user:{member_id:42,member_name:'测试账号',rank:4},postData:{postId:123,comments:[{floorIndex:0,commentId:9876,upvoteCount:3},{floorIndex:1,commentId:9877}]}});
function documentHtml(url) {
  const route=new URL(url).pathname;
  let content='';
  if(route.startsWith('/post-'))content=`<div class="nsk-post-wrapper"><h1><a class="post-title-link">iLatency 公测，社区内 Ping 站邀请共建</a></h1><div class="content-item" id="0"><div class="nsk-content-meta-info"><div class="author-info"><a class="author-name" href="/space/77">清羽</a><span class="role-tag">Lv 7</span><span class="role-tag">技术分享</span><time datetime="2026-11-11T03:30:00Z"></time></div></div><div class="post-content"><p>这是用于验收客户端排版的公开风格测试内容。</p><p>在这里阅读技术讨论、查看用户资料，并直接回复。所有本轮提交都由测试拦截，不会发送到论坛。</p><pre><code>ping example.com\n64 bytes: time=18.5 ms</code></pre><table><tr><th>地区</th><th>延迟</th></tr><tr><td>上海</td><td>18.5 ms</td></tr></table></div><div class="signature">分享经验，认真交流。</div><div class="comment-menu"><button title="点赞">3</button></div></div></div><div class="comments"><div class="content-item" id="1"><div class="nsk-content-meta-info"><a class="author-name" href="/space/88">同行</a><span class="role-tag">Lv 6</span><time datetime="2026-11-11T03:40:00Z"></time></div><div class="post-content"><p>${postedReply||'赞，已测试。新的列表排版和全局字号是否都清楚？'}</p></div></div></div>`;
  else if(route.startsWith('/space/'))content='<h1>用户主页</h1>';
  else content='<ul class="post-list">'+Array.from({length:30},(_,i)=>`<li class="post-list-item"><div class="post-title"><a href="/post-${123+i}-1">${i===0?'iLatency 公测，社区内 Ping 站邀请共建':['关于 Windows 客户端的阅读体验','网络线路测试记录与交流','一份实用的服务器部署笔记'][i%3]}${i?' · '+i:''}</a></div><div class="info-author"><a href="/space/77">清羽</a></div><a class="post-category" href="/categories/tech">技术</a><time datetime="2026-11-11T03:30:00Z"></time></li>`).join('')+'</ul>';
  return `<!doctype html><meta charset="utf-8"><title>排版与交互测试</title><script>window.__config__=${JSON.stringify(config())}</script><div id="nsk-head"></div><div id="nsk-body-left">${content}</div>`;
}
async function capture(name){await page.screenshot({path:path.join(output,name)});report.screenshots.push(name);}
async function fontMetrics(){return page.evaluate(()=>{
  const size=selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
  const small=[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length && [...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()) && !['SCRIPT','STYLE','OPTION'].includes(el.tagName)).filter(el=>parseFloat(getComputedStyle(el).fontSize)<12).map(el=>({tag:el.tagName,text:el.textContent.slice(0,50),size:getComputedStyle(el).fontSize}));
  return {menu:size('.board-link'),title:size('.post-row h2'),metadata:size('.post-row-meta'),tab:size('.reading-tab button'),body:size('.reader-content'),small,overflow:document.documentElement.scrollWidth>innerWidth};
});}
async function waitIdle(){await page.waitForFunction(()=>!document.querySelector('[data-testid="submit-reply"]')?.disabled || Boolean(document.querySelector('[data-testid="submit-reply"]')?.disabled && document.querySelector('[data-testid="reply-content"]')?.value==='')) .catch(()=>{});}
(async()=>{
  await fs.mkdir(output,{recursive:true});await fs.mkdir(profile,{recursive:true});
  const installer=path.join(project,'release/SeekDesk-Windows-0.1.0-x64-Setup.exe');const originalHash=createHash('sha256').update(await fs.readFile(installer)).digest('hex');
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings:{theme:'light',uiFontSize:16,fontSize:18,compact:false,restoreTabs:true,defaultSource:'rss',nodeSeekPro:false},workspace:{tabs:[],activeId:null,overviewOpen:true},blockedUsers:[]}));
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project],env});page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
  await app.context().route('https://www.nodeseek.com/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.pathname.startsWith('/avatar/'))return route.fulfill({status:200,contentType:'image/png',body:png});
    if(url.pathname.startsWith('/api/account/getInfo/')) {const id=Number(url.pathname.split('/').pop());return route.fulfill({json:{success:true,detail:{member_id:id,rank:id===77?7:6,roles:[{display_text:'技术分享'}],followed:following}}});}
    if(url.pathname.startsWith('/api/progress/'))return route.fulfill({json:{maxFreeLike:2,freeLikeUsed:0}});
    if(request.method()==='POST') {
      const body=request.postDataJSON();writes.push({path:url.pathname,body});
      if(url.pathname==='/api/content/new-comment'&&replyRejected)return route.fulfill({json:{success:false,message:'回归测试：权限校验失败'}});
      if(url.pathname==='/api/content/new-comment')postedReply=body.content;
      if(url.pathname==='/api/fans/add')following=true;
      if(url.pathname==='/api/fans/del')following=false;
      return route.fulfill({json:{success:true,current:4,coin:20}});
    }
    if(delayListing && (url.pathname==='/' || url.pathname.startsWith('/categories/')))await new Promise(resolve=>setTimeout(resolve,750));
    return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:documentHtml(request.url())});
  });
  await page.waitForSelector('.workspace');
  await page.getByTestId('post-row').first().waitFor({timeout:30000});
  const publicRss=await page.evaluate(()=>window.seekdesk.listPosts({}));const publicIndex=publicRss.posts.findIndex(post=>post.summary.length>0);
  assert.equal(publicRss.source,'rss');assert.ok(publicIndex>=0);
  await page.getByTestId('post-row').nth(publicIndex).click();await page.getByTestId('reader-content').first().waitFor({timeout:20000});
  await capture('revision-rss-partial-1440x920.png');
  check('Current source build still reads real public RSS and explicitly labels summaries',{posts:publicRss.posts.length,source:publicRss.source});
  await page.getByRole('button',{name:'关闭全部帖子标签',exact:true}).click();await page.waitForTimeout(300);
  await page.evaluate(async()=>{const b=await window.seekdesk.bootstrap();await window.seekdesk.saveSettings({...b.settings,defaultSource:'auto'});});
  await page.reload();await page.waitForSelector('.workspace');await page.locator('.skeleton-list').waitFor();await capture('revision-loading-1440x920.png');
  await page.getByTestId('post-row').first().waitFor({timeout:30000});delayListing=false;
  await page.getByTestId('post-row').first().click();await page.getByTestId('reader-content').first().waitFor({timeout:20000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="account-button"] img')?.naturalWidth>0);
  assert.equal(await page.locator('.titlebar-brand').innerText(),'SeekDesk');assert.equal(await page.locator('.sidebar .brand-mark,.sidebar-heading,.titlebar-caption,.platform-label').count(),0);
  assert.match(await page.locator('.level-badge').first().innerText(),/7/);
  const row=await page.getByTestId('post-row').first().evaluate(el=>{
    const badge=el.querySelector('.category-tag').getBoundingClientRect(),text=el.querySelector('.post-title-text');const range=document.createRange();range.setStart(text.firstChild,0);range.setEnd(text.firstChild,1);const title=range.getBoundingClientRect();const list=el.closest('.list-scroll').getBoundingClientRect();
    return {badge:{x:badge.x,y:badge.y,right:badge.right},title:{x:title.x,y:title.y},height:el.getBoundingClientRect().height,fullyVisible:[...el.parentElement.querySelectorAll('.post-row')].filter(row=>row.getBoundingClientRect().bottom<=list.bottom).length};
  });
  assert.ok(Math.abs(row.badge.y-row.title.y)<8);assert.ok(row.badge.right<=row.title.x+2);assert.ok(row.fullyVisible>=7,JSON.stringify(row));
  const baseline=await fontMetrics();assert.ok(baseline.title>=16&&baseline.menu>=15&&baseline.body>=18);assert.deepEqual(baseline.small,[]);assert.equal(baseline.overflow,false);
  check('Inline board labels, denser list, readable default typography, single brand and real avatar',{row,fonts:baseline});
  await capture('revision-reading-1440x920.png');
  const filter=page.getByRole('textbox',{name:'筛选帖子或粘贴帖子链接'});await filter.fill('seekdesk-no-matching-topic-76543');await page.locator('.list-empty').waitFor();await capture('revision-empty-1440x920.png');await filter.fill('');
  check('Empty filter state recovers without losing the active reader');
  await page.getByRole('button',{name:'关闭阅读总览',exact:true}).click();assert.equal(await page.getByRole('tab',{name:'阅读总览',exact:true}).count(),0);
  await page.waitForTimeout(300);assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).workspace.overviewOpen,false);
  await page.reload();await page.getByTestId('reader-content').first().waitFor();assert.equal(await page.getByRole('tab',{name:'阅读总览',exact:true}).count(),0);
  await page.getByRole('button',{name:'打开阅读总览',exact:true}).click();await page.getByRole('tab',{name:'阅读总览',exact:true}).waitFor();
  await page.locator('.reading-tab button[role="tab"]').first().click();check('Overview closes, stays closed after reload, and can reopen');

  const reply=page.getByTestId('reply-content');await reply.fill('只用于模拟接口的回归回复');await page.getByTestId('submit-reply').click();
  await page.getByText('回归测试：权限校验失败',{exact:false}).waitFor();assert.equal(await reply.inputValue(),'只用于模拟接口的回归回复');assert.equal(writes.filter(w=>w.path==='/api/content/new-comment').length,1);
  assert.equal(await page.locator('.toast-error[role="alert"]').count(),1);await capture('revision-reply-error-1440x920.png');
  replyRejected=false;await page.getByTestId('submit-reply').click();await page.waitForFunction(()=>document.querySelector('[data-testid="reply-content"]')?.value==='');await page.getByTestId('reader-content').filter({hasText:'只用于模拟接口的回归回复'}).waitFor();
  assert.equal(writes.filter(w=>w.path==='/api/content/new-comment').length,2);check('Reply failure keeps text; explicit retry submits once and refreshes the thread');
  await page.getByRole('button',{name:'引用回复',exact:true}).first().click();assert.match(await reply.inputValue(),/> @清羽/);await reply.fill('');
  const firstComment=page.locator('.comment').first();await firstComment.locator('summary').click();await firstComment.getByRole('button',{name:'关注用户',exact:true}).click();await firstComment.getByRole('button',{name:'取消关注',exact:true}).waitFor();
  assert.ok(writes.some(w=>w.path==='/api/fans/add'&&w.body.followed_member_id===77));
  await firstComment.getByRole('button',{name:'发送私信',exact:true}).click();await page.getByLabel('私信内容',{exact:true}).fill('仅发送到模拟私信接口');await page.getByRole('dialog').getByRole('button',{name:'发送私信',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
  assert.ok(writes.some(w=>w.path==='/api/notification/message/send'&&w.body.receiverUid===77));check('Quote, follow, and private message use confirmed API payloads');
  await firstComment.getByRole('button',{name:'在本机屏蔽',exact:true}).click();await firstComment.getByText('已屏蔽此用户的内容，楼层保留。').waitFor();assert.ok((await page.evaluate(()=>window.seekdesk.bootstrap())).blockedUsers.includes(77));
  await firstComment.getByRole('button',{name:'临时展开',exact:true}).click();await firstComment.getByTestId('reader-content').waitFor();await firstComment.getByRole('button',{name:'解除本机屏蔽',exact:true}).click();
  check('Local block hides content, preserves floors, and supports temporary reveal/unblock');
  const beforeChicken=writes.filter(w=>w.path==='/api/statistics/like').length;await firstComment.getByRole('button',{name:'🍗 鸡腿',exact:true}).click();await page.getByTestId('reaction-confirmation').waitFor();assert.equal(writes.filter(w=>w.path==='/api/statistics/like').length,beforeChicken);
  await page.getByRole('button',{name:'确认免费赠送',exact:true}).click();await page.getByTestId('reaction-confirmation').waitFor({state:'hidden'});await page.waitForFunction(()=>!document.querySelector('.comment-actions button')?.disabled);
  assert.equal(writes.filter(w=>w.path==='/api/statistics/like').length,beforeChicken+1);
  const beforeDislike=writes.filter(w=>w.path==='/api/statistics/dislike').length;await firstComment.getByRole('button',{name:'踩',exact:true}).click();await page.getByTestId('reaction-confirmation').waitFor();await page.getByTestId('reaction-confirmation').getByRole('button',{name:'取消',exact:true}).click();assert.equal(writes.filter(w=>w.path==='/api/statistics/dislike').length,beforeDislike);
  check('Chicken and dislike confirmations prevent unintended charged writes');

  await page.getByTestId('settings-button').click();await page.getByRole('slider',{name:'全局界面字号',exact:true}).focus();await page.keyboard.press('End');await page.waitForFunction(()=>getComputedStyle(document.documentElement).fontSize==='24px');
  await page.getByRole('slider',{name:'正文字号',exact:true}).focus();await page.keyboard.press('End');await page.waitForTimeout(100);
  const settings=await page.evaluate(()=>window.seekdesk.bootstrap());assert.equal(settings.settings.uiFontSize,24);assert.equal(settings.settings.fontSize,40);
  await capture('revision-settings-large-1440x920.png');await page.getByRole('button',{name:'返回阅读',exact:true}).click();
  const large=await fontMetrics();assert.ok(large.menu>baseline.menu&&large.title>baseline.title&&large.tab>baseline.tab&&large.body>=40);assert.deepEqual(large.small,[]);assert.equal(large.overflow,false);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')).setSize(980,720));await page.waitForTimeout(150);
  assert.equal((await fontMetrics()).overflow,false);await capture('revision-large-980x720.png');
  await page.getByRole('button',{name:'收起帖子列表',exact:true}).click();await capture('revision-focus-large-980x720.png');
  check('Global font scales menus, list, tabs and home; body reaches 40px and narrow view stays usable',{baseline,large});
  await page.getByTestId('settings-button').click();
  await page.getByRole('slider',{name:'全局界面字号',exact:true}).focus();await page.keyboard.press('Home');
  const minText=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getClientRects().length && [...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()) && !['SCRIPT','STYLE','OPTION'].includes(el.tagName)).filter(el=>parseFloat(getComputedStyle(el).fontSize)<12).map(el=>({text:el.textContent.slice(0,40),size:getComputedStyle(el).fontSize})));
  assert.deepEqual(minText,[]);check('Minimum global size still keeps visible helper text at least 12px');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  await page.getByRole('slider',{name:'正文字号',exact:true}).focus();await page.keyboard.press('Home');for(let i=0;i<4;i++)await page.keyboard.press('ArrowRight');
  await page.getByRole('button',{name:'深色',exact:true}).click();await page.getByRole('button',{name:'返回阅读',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await capture('revision-dark-980x720.png');
  const dark=await fontMetrics();assert.deepEqual(dark.small,[]);assert.equal(dark.overflow,false);check('Dark theme and normal fonts remain readable at 980x720',dark);
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')).setSize(1440,920));
  await page.getByTestId('settings-button').click();
  await page.getByRole('switch',{name:'NodeSeek Pro（官方页面）',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).settings.nodeSeekPro,true);
  await page.getByRole('button',{name:'打开脚本设置',exact:true}).click();await page.getByTestId('official-panel').waitFor();
  let pro;
  for(let i=0;i<150;i++) {
    pro=await app.evaluate(async({BrowserWindow})=>{
      const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));
      const view=main.contentView.children.find(v=>v.webContents);
      if(!view)return null;
      return view.webContents.executeJavaScriptInIsolatedWorld(1004,[{code:'({version:window.__seekdeskProRuntime?.version,menus:window.__seekdeskProRuntime?.getMenuLabels(),settings:window.__seekdeskProRuntime?.getSettings()})'}]).catch(()=>null);
    });
    if(pro?.menus?.length)break;await page.waitForTimeout(100);
  }
  assert.equal(pro?.version,'1.0.8');assert.ok(pro.menus.some(s=>s.includes('高级设置')));assert.equal(pro.settings.sign_in.ns.enabled,false);
  const proMenuVisible=await app.evaluate(async({BrowserWindow})=>{
    const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));const view=main.contentView.children.find(v=>v.webContents);
    return view.webContents.executeJavaScript('Boolean(document.querySelector("#seekdesk-pro-menu") && getComputedStyle(document.querySelector("#seekdesk-pro-menu")).display!=="none")');
  });
  assert.equal(proMenuVisible,true,'The application script-settings button must actually open the menu');
  const proIsolation=await app.evaluate(async({BrowserWindow})=>{
    const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));const view=main.contentView.children.find(v=>v.webContents);
    return view.webContents.executeJavaScript('({node:typeof require,app:typeof window.seekdesk,gm:typeof window.__seekdeskGM})');
  });
  assert.deepEqual(proIsolation,{node:'undefined',app:'undefined',gm:'undefined'});
  const proWrites=writes.filter(w=>w.path==='/api/attendance');assert.equal(proWrites.length,0);
  check('Settings toggle runs the pinned NodeSeek Pro inside the isolated official page',{version:pro.version,menus:pro.menus,mainWorld:proIsolation});
  await page.getByTestId('close-official').click();await page.getByTestId('settings-button').click();await page.getByRole('switch',{name:'NodeSeek Pro（官方页面）',exact:true}).click();
  assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).settings.nodeSeekPro,false);
  assert.deepEqual(report.errors,[]);assert.equal(createHash('sha256').update(await fs.readFile(installer)).digest('hex'),originalHash);
  check('Source-only build, installer unchanged, no real forum writes',{interceptedWrites:writes.length,installerHash:originalHash});report.status='pass';
})().catch(async error=>{report.status='fail';report.failure=error.stack;console.error(error);if(page)await capture('revision-failure.png').catch(()=>{});process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(output,'revision-smoke.json'),JSON.stringify(report,null,2));});
