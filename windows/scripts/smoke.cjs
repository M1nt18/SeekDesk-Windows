/* Real Electron/Chromium smoke test. Reads public data only; never signs in or posts. */
const { _electron: electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');

const project = path.resolve(__dirname,'..');
const output = path.join(project,'verification');
const profile = path.join(project,'.test-data',`${process.env.SEEKDESK_INSTALLED_EXE ? 'installed-smoke' : 'app-smoke'}-${Date.now()}`);
const report = {testedAt:new Date().toISOString(),executable:process.env.SEEKDESK_INSTALLED_EXE ? 'installed Windows executable' : 'development Electron with production bundle',checks:[],screenshots:[],consoleErrors:[]};
const check = (name,detail) => { report.checks.push({name,status:'pass',detail}); console.log('PASS',name,detail || ''); };
let instance;
let page;
async function launch() {
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};
  delete env.ELECTRON_RUN_AS_NODE; delete env.SEEKDESK_DEV_URL;
  instance=await electron.launch({executablePath:process.env.SEEKDESK_INSTALLED_EXE || require('electron'),args:process.env.SEEKDESK_INSTALLED_EXE ? [] : [project],env,timeout:45000});
  page=await instance.firstWindow({timeout:30000});
  page.on('pageerror',err=>report.consoleErrors.push(err.message));
  await page.waitForSelector('.workspace',{timeout:30000});
  return page;
}
async function capture(file) {
  await page.screenshot({path:path.join(output,file)});
  report.screenshots.push(file);
}
(async () => {
  await fs.mkdir(output,{recursive:true});
  await launch();
  const boot=await page.evaluate(()=>window.seekdesk.bootstrap());
  assert.equal(boot.version,'0.1.0');
  assert.equal(await page.evaluate(()=>typeof window.require),'undefined');
  check('Production renderer boot and Node isolation');
  await capture('loading-1440x920.png');
  await page.waitForSelector('.post-row',{timeout:60000});
  let listing=await page.evaluate(()=>window.seekdesk.listPosts({}));
  assert.ok(listing.posts.length>0);
  assert.ok(['rss','web'].includes(listing.source));
  check('Live public listing',{count:listing.posts.length,source:listing.source,fetchedAt:listing.fetchedAt});
  // Select a current RSS post rather than a pinned/old website topic. Website
  // verification can change between requests, and old topics have no RSS fallback.
  await page.evaluate(async()=>{const boot=await window.seekdesk.bootstrap();await window.seekdesk.saveSettings({...boot.settings,defaultSource:'rss'});});
  await page.reload();
  await page.waitForSelector('.post-row',{timeout:35000});
  listing=await page.evaluate(()=>window.seekdesk.listPosts({}));
  assert.equal(listing.source,'rss');
  check('Isolated public RSS fetch',{count:listing.posts.length});
  const post=listing.posts.find(p=>p.summary) || listing.posts[0];
  const thread=await page.evaluate(p=>window.seekdesk.readThread(p),post);
  assert.ok(thread.comments.some(c=>c.html.length>0),'Real content must contain nonempty public text');
  check('Live public reading',{postId:post.id,source:thread.source,comments:thread.comments.length,characters:thread.comments.reduce((n,c)=>n+c.html.length,0)});
  const index=listing.posts.findIndex(p=>p.id===post.id);
  await page.locator('.post-row').nth(index).click();
  await page.waitForSelector('.reader-content',{timeout:35000});
  await page.locator('.post-row').nth(index===0 ? 1 : 0).click({modifiers:['Control']});
  await page.waitForFunction(()=>document.querySelectorAll('.reading-tab').length===2);
  assert.equal(await page.locator('.reading-tab').count(),2);
  check('Multiple tabs with background opening');
  await capture('reading-light-1440x920.png');
  const search=page.getByRole('textbox',{name:'筛选帖子或粘贴帖子链接'});
  await search.fill('seekdesk-no-match-765432109');
  await page.waitForSelector('.list-empty');
  await capture('empty-filter-1440x920.png');
  await search.fill('');
  check('Empty search state and recovery');
  await page.locator('.settings-link').click();
  await page.getByRole('button',{name:'深色',exact:true}).click();
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.getByRole('button',{name:'增大字号',exact:true}).click();
  await page.waitForTimeout(300);
  const saved=await page.evaluate(()=>window.seekdesk.bootstrap());
  assert.equal(saved.settings.theme,'dark');
  assert.equal(saved.settings.fontSize,boot.settings.fontSize+1);
  await capture('settings-dark-1440x920.png');
  check('Settings UI persists theme and reading size');
  await page.getByRole('button',{name:'返回阅读',exact:true}).click();
  await instance.evaluate(({BrowserWindow}) => {const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));main.setSize(980,720);});
  await page.waitForTimeout(200);
  await capture('reading-dark-980x720.png');
  const overflow=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight}));
  assert.ok(overflow.scrollWidth <= overflow.width);
  assert.ok(overflow.scrollHeight <= overflow.height);
  check('980x720 desktop layout',overflow);
  // Keyboard activation must expose a visible focus outline.
  await search.focus();
  await page.keyboard.press('Tab');
  const focus=await page.evaluate(()=>({tag:document.activeElement?.tagName,outline:getComputedStyle(document.activeElement).outlineStyle,outlineWidth:getComputedStyle(document.activeElement).outlineWidth}));
  assert.ok(focus.outline !== 'none' && focus.outlineWidth !== '0px');
  check('Keyboard focus visibility',focus);
  const contrasts=await page.evaluate(()=>{
    const root=document.documentElement,original=root.dataset.theme;
    const luminance=hex=>{const s=hex.trim().replace('#','');const value=s.length===3?s.split('').map(c=>c+c).join(''):s;const rgb=[0,2,4].map(i=>parseInt(value.slice(i,i+2),16)/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4);return rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;};
    const results=[];
    for(const theme of ['light','dark']) {
      root.dataset.theme=theme;const style=getComputedStyle(root);
      for(const [fg,bg] of [['--text','--app'],['--secondary','--surface-alt'],['--muted','--sidebar'],['--accent-text','--accent-soft'],['--warning','--warning-bg']]) {
        const a=luminance(style.getPropertyValue(fg)),b=luminance(style.getPropertyValue(bg));
        results.push({theme,foreground:fg,background:bg,ratio:Number(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05)).toFixed(2))});
      }
    }
    root.dataset.theme=original;return results;
  });
  assert.ok(contrasts.every(c=>c.ratio>=4.5),JSON.stringify(contrasts));
  check('Rendered theme text contrast exceeds 4.5:1',contrasts);
  const invalid=await page.evaluate(async()=>{
    const results=[];
    for(const operation of [()=>window.seekdesk.openOfficial('file:///C:/Windows/win.ini'),()=>window.seekdesk.readThread({url:'https://evil.invalid/post-1-1'}),()=>window.seekdesk.listPosts({category:'../admin'})]) {
      try {await operation();results.push(false);} catch {results.push(true);}
    }
    return results;
  });
  assert.ok(invalid.every(Boolean));
  check('IPC rejects forged website and listing parameters');
  await page.evaluate(()=>window.seekdesk.openOfficial());
  await page.getByTestId('official-panel').waitFor();
  const windows=await instance.evaluate(async({BrowserWindow})=>{
    const main=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().startsWith('file:'));
    const view=main.contentView.children.find(v=>v.webContents);
    if(!view) throw Error('Embedded official page missing');
    const prefs=view.webContents.getLastWebPreferences();
    return {url:view.webContents.getURL(),visibleWindows:BrowserWindow.getAllWindows().filter(w=>w.isVisible()).length,node:prefs.nodeIntegration,isolated:prefs.contextIsolation,sandbox:prefs.sandbox,bridge:await view.webContents.executeJavaScript('typeof window.seekdesk'),require:await view.webContents.executeJavaScript('typeof window.require')};
  });
  assert.equal(windows.node,false);assert.equal(windows.isolated,true);assert.equal(windows.sandbox,true);assert.equal(windows.bridge,'undefined');assert.equal(windows.require,'undefined');
  assert.equal(windows.visibleWindows,1);
  check('Embedded official login page is isolated',windows);
  await page.getByTestId('close-official').click();
  // Force an actual failed network request in an isolated test partition, then
  // restore the shipping URL allowlist and verify the UI's retry path.
  await page.evaluate(async()=>{const boot=await window.seekdesk.bootstrap();await window.seekdesk.saveSettings({...boot.settings,defaultSource:'rss'});});
  await page.waitForTimeout(16000); // Expire the deliberately short public RSS cache.
  await instance.evaluate(({session})=>session.fromPartition('public-rss').webRequest.onBeforeRequest((_details,callback)=>callback({cancel:true})));
  await page.reload();
  await page.waitForSelector('.list-error',{timeout:25000});
  await capture('network-error-980x720.png');
  await instance.evaluate(({session})=>session.fromPartition('public-rss').webRequest.onBeforeRequest((details,callback)=>callback({cancel:details.url!=='https://rss.nodeseek.com/'})));
  await page.getByTestId('list-error').getByRole('button',{name:'重新读取',exact:true}).click();
  await page.waitForSelector('.post-row',{timeout:25000});
  assert.match(await page.getByTestId('list-source').innerText(),/RSS/);
  check('Network error feedback, retry, and independent RSS source');
  await instance.evaluate(async({session})=>{
    const s=session.fromPartition('persist:nodeseek');
    await s.cookies.set({url:'https://seekdesk.invalid',name:'seekdesk_smoke',value:'non-sensitive-persistence-test',expirationDate:Date.now()/1000+86400});
    await s.cookies.flushStore();
  });
  await page.waitForTimeout(500);
  await instance.close();instance=null;
  await launch();
  const restored=await page.evaluate(()=>window.seekdesk.bootstrap());
  assert.equal(restored.settings.theme,'dark');
  assert.equal(restored.workspace.tabs.length,2);
  const cookiePersisted=await instance.evaluate(async({session})=>(await session.fromPartition('persist:nodeseek').cookies.get({url:'https://seekdesk.invalid',name:'seekdesk_smoke'})).length);
  assert.equal(cookiePersisted,1);
  check('Restart restores tabs, settings, and persistent session storage','Uses a harmless cookie on seekdesk.invalid; real account login is not tested.');
  await page.evaluate(()=>window.seekdesk.clearSession());
  const remaining=await instance.evaluate(async({session})=>(await session.fromPartition('persist:nodeseek').cookies.get({})).length);
  assert.equal(remaining,0);
  check('Clear session removes all official partition cookies');
  assert.deepEqual(report.consoleErrors,[]);
  check('No renderer JavaScript exceptions');
  report.status='pass';
})().catch(error=>{report.status='fail';report.failure=error.stack;console.error(error);process.exitCode=1;}).finally(async()=>{
  if(instance) await instance.close().catch(()=>{});
  await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(output,process.env.SEEKDESK_INSTALLED_EXE ? 'installed-smoke.json' : 'electron-smoke.json'),JSON.stringify(report,null,2));
});
