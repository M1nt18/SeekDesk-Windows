const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const project=path.resolve(__dirname,'..');
const output=path.join(project,'verification');
const profile=path.join(project,'.test-data',`embedded-login-${Date.now()}`);
const report={testedAt:new Date().toISOString(),scope:'Source build only. Real public page plus synthetic login navigation in an isolated profile; no account passwords or existing session read.',checks:[],errors:[]};
const check=(name,detail)=>{report.checks.push({name,status:'pass',detail});console.log('PASS',name,detail||'');};
let app;
let releaseSlow;
async function viewDetails() {
  return app.evaluate(async({BrowserWindow})=>{
    const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));
    const view=main.contentView.children.find(v=>v.webContents && !v.webContents.isDestroyed());
    const contents=view?.webContents;
    const prefs=contents?.getLastWebPreferences();
    return {visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length,children:main.contentView.children.length,visible:view?.getVisible(),bounds:view?.getBounds(),url:contents?.getURL(),node:prefs?.nodeIntegration,sandbox:prefs?.sandbox,isolated:prefs?.contextIsolation,bridge:contents?await contents.executeJavaScript('typeof window.seekdesk'):null};
  });
}
async function nativeClick(selector) {
  await app.evaluate(({BrowserWindow},selector)=>{
    const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));
    const view=main.contentView.children.find(v=>v.webContents);
    return view.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`,true);
  },selector);
}
function fixture(signedIn,url) {
  const signIn=new URL(url).pathname==='/signIn.html';
  const user=signedIn?{member_id:424242,member_name:'会话回归测试'}:null;
  const title=signedIn?'登录后的交易帖子':'登录前的交易帖子';
  return `<!doctype html><meta charset="utf-8"><title>官方页面流程测试</title><style>body{font:16px system-ui;padding:36px;color:#24314a;background:#f6f8fc}button{font:inherit;padding:12px 24px}p{line-height:1.8}</style><div id="nsk-head">NodeSeek 流程回归测试</div><script>window.__config__=${JSON.stringify({user})}</script>${signIn?'<h1>登录流程回归</h1><p>这是隔离测试页面，不会提交账号或密码。</p><button id="fixture-login" onclick="window.open(\'/\',\'_blank\')">模拟完成登录</button>':`<div id="nsk-body-left"><ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-424201-1">${title}</a></div><div class="info-author"><a href="/space/424242">会话回归测试</a></div><a class="post-category" href="/categories/trade">交易</a></li></ul></div>`}`;
}
(async()=>{
  await fs.mkdir(output,{recursive:true});await fs.mkdir(profile,{recursive:true});
  const installer=path.join(project,'release/SeekDesk-Windows-0.1.0-x64-Setup.exe');
  const before=createHash('sha256').update(await fs.readFile(installer)).digest('hex');
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings:{theme:'light',fontSize:16,compact:false,restoreTabs:true,defaultSource:'rss'},workspace:{tabs:[],activeId:null}}));
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project],env,timeout:30000});
  const page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));
  await page.waitForSelector('.workspace');
  await page.waitForSelector('.post-row',{timeout:30000});
  await page.evaluate(()=>window.seekdesk.openOfficial());
  await page.getByTestId('official-host').waitFor();
  let real;
  for(let i=0;i<100;i++) {real=await viewDetails();if(real.url?.startsWith('https://www.nodeseek.com/'))break;await page.waitForTimeout(200);}
  assert.equal(real.visibleWindows,1);assert.equal(real.children,1);assert.equal(real.visible,true);
  assert.equal(real.node,false);assert.equal(real.sandbox,true);assert.equal(real.isolated,true);assert.equal(real.bridge,'undefined');
  assert.ok(real.url.startsWith('https://www.nodeseek.com/'),JSON.stringify(real));
  const rect=await page.getByTestId('official-host').boundingBox();
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(real.bounds[key]-rect[key])<=2,JSON.stringify({real:real.bounds,rect}));
  check('Real official page stays inside one isolated main window',real);
  await page.screenshot({path:path.join(output,'embedded-login-shell.png')});
  const native=await app.evaluate(async({BrowserWindow})=>{
    const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));
    const view=main.contentView.children.find(v=>v.webContents);
    return (await view.webContents.capturePage()).toPNG().toString('base64');
  });
  await fs.writeFile(path.join(output,'embedded-login-native.png'),Buffer.from(native,'base64'));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:')).setSize(980,720));
  await page.waitForTimeout(150);
  const narrow=await viewDetails();const narrowRect=await page.getByTestId('official-host').boundingBox();
  for(const key of ['x','y','width','height'])assert.ok(Math.abs(narrow.bounds[key]-narrowRect[key])<=2);
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-panel').waitFor();
  assert.equal((await viewDetails()).visible,false);
  check('Resize and navigation remove native overlays',{bounds:narrow.bounds});

  let signedIn=false;let listingRequests=0;let slowRequested=false;
  const slowGate=new Promise(resolve=>{releaseSlow=resolve;});
  await app.context().route('https://www.nodeseek.com/**',async route=>{
    const url=route.request().url();
    if(url.includes('/post-424201-1')) {slowRequested=true;await slowGate;}
    if(new URL(url).pathname.startsWith('/categories/'))listingRequests++;
    await route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:fixture(signedIn,url)}).catch(()=>{});
  });
  await page.evaluate(async()=>{const boot=await window.seekdesk.bootstrap();await window.seekdesk.saveSettings({...boot.settings,defaultSource:'auto'});});
  await page.reload();await page.waitForSelector('.workspace');
  await page.getByRole('button',{name:'论坛版块',exact:true}).click();
  await page.getByRole('button',{name:'交易',exact:true}).click();
  await page.getByTestId('post-row').filter({hasText:'登录前的交易帖子'}).waitFor({timeout:30000});
  await page.evaluate(()=>{window.__pendingRead=window.seekdesk.readThread({id:'424201',url:'https://www.nodeseek.com/post-424201-1',title:'旧会话读取',author:'',category:'trade',published:'',summary:''}).then(()=>({accepted:true})).catch(error=>({accepted:false,error:error.message}));});
  for(let i=0;i<50&&!slowRequested;i++)await page.waitForTimeout(20);
  assert.equal(slowRequested,true);
  await page.evaluate(()=>window.seekdesk.openOfficial());
  await page.getByTestId('official-panel').waitFor();
  await page.evaluate(()=>window.seekdesk.reloadOfficial());
  let fixtureReady=false;
  for(let i=0;i<100;i++) {
    fixtureReady=await app.evaluate(async({BrowserWindow})=>{
      const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));
      const view=main.contentView.children.find(v=>v.webContents);
      return view.webContents.executeJavaScript('Boolean(document.querySelector("#fixture-login"))').catch(()=>false);
    });
    if(fixtureReady)break;await page.waitForTimeout(100);
  }
  assert.equal(fixtureReady,true,'Synthetic login page must finish loading');
  const prior=listingRequests;
  signedIn=true;
  await nativeClick('#fixture-login');
  await page.getByTestId('official-panel').waitFor({state:'hidden',timeout:15000});
  releaseSlow();
  await page.getByTestId('post-row').filter({hasText:'登录后的交易帖子'}).waitFor({timeout:15000});
  const after=await page.evaluate(()=>window.seekdesk.bootstrap());
  assert.equal(after.account.status,'signed-in');assert.equal(after.account.id,424242);assert.equal(after.official.visible,false);assert.equal(after.official.purpose,'login');
  assert.ok(listingRequests>prior);assert.match(await page.getByTestId('list-source').innerText(),/官方页面/);
  assert.equal(await page.getByTestId('list-error').count(),0);
  assert.match(await page.locator('.list-heading h1').innerText(),/交易/);
  const stale=await page.evaluate(()=>window.__pendingRead);
  assert.equal(stale.accepted,false);assert.match(stale.error,/会话已变更/);
  assert.equal((await viewDetails()).visibleWindows,1);
  check('Login popup stays embedded, then automatically returns and refreshes current board',{account:after.account,status:after.official,listingRequests});
  check('Old account read is rejected without restoring verification cooldown',stale);
  await page.screenshot({path:path.join(output,'embedded-login-returned.png')});
  await page.evaluate(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/categories/trade'));
  await page.getByTestId('official-panel').waitFor();
  assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).official.purpose,'browse');
  await page.waitForTimeout(1100);
  assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).official.visible,true);
  await page.getByTestId('close-official').click();
  assert.equal((await viewDetails()).visible,false);
  check('Signed-in browsing stays open until returning to reading');
  await page.evaluate(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/categories/trade'));
  await page.getByTestId('official-panel').waitFor();
  await app.evaluate(({BrowserWindow})=>{
    const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));
    const view=main.contentView.children.find(v=>v.webContents);
    view.webContents.focus();
    view.webContents.sendInputEvent({type:'keyDown',keyCode:'W',modifiers:['control']});
    view.webContents.sendInputEvent({type:'keyUp',keyCode:'W',modifiers:['control']});
  });
  await page.getByTestId('official-panel').waitFor({state:'hidden'});
  assert.equal((await viewDetails()).visibleWindows,1);
  check('Ctrl+W in the official page returns to reading and keeps the client open');
  await page.evaluate(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/categories/trade'));
  await page.getByTestId('official-panel').waitFor();
  await nativeClick('.post-title a');
  await page.getByTestId('official-panel').waitFor({state:'hidden'});
  await page.waitForTimeout(350);
  assert.ok((await page.evaluate(()=>window.seekdesk.bootstrap())).workspace.tabs.some(post=>post.id==='424201'));
  assert.equal((await viewDetails()).visibleWindows,1);
  check('Posts clicked in official shortcuts return to native reading tabs');
  assert.deepEqual(report.errors,[]);
  const afterHash=createHash('sha256').update(await fs.readFile(installer)).digest('hex');
  assert.equal(afterHash,before);check('Installer unchanged; no packaging performed',{sha256:afterHash});
  report.status='pass';
})().catch(e=>{report.status='fail';report.failure=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{releaseSlow?.();if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(output,'embedded-login-smoke.json'),JSON.stringify(report,null,2));});
