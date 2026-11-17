/* Corrupt only an isolated test profile, then exercise production IPC and quit. */
const {_electron}=require('playwright-core');const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.test-data','storage-failure-'+Date.now());
let app;
(async()=>{
  await fs.mkdir(path.join(profile,'userscripts'),{recursive:true});
  const features=path.join(profile,'workspace-features.json'),pro=path.join(profile,'userscripts/nodeseek-pro.json');
  const featureData='{"drafts":{"42":',proData='{"settings":{"image_upload":';
  await fs.writeFile(features,featureData);await fs.writeFile(pro,proData);
  const entry=path.join(profile,'entry.cjs');
  await fs.writeFile(entry,`const {app,session}=require('electron');app.whenReady().then(()=>{for(const partition of ['persist:nodeseek','public-rss'])session.fromPartition(partition).protocol.handle('https',()=>new Response('<!doctype html><script>window.__config__={user:null}</script><div id=nsk-head></div><div id=nsk-body-left><ul class=post-list></ul></div>',{headers:{'content-type':'text/html'}}));});globalThis.fetch=async()=>{throw Error('No live requests');};require(${JSON.stringify(path.join(root,'dist-electron/electron/main.js'))});`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[entry],env});const page=await app.firstWindow();await page.locator('.workspace').waitFor();
  const boot=await page.evaluate(()=>window.seekdesk.bootstrap());assert.match(boot.storageWarning,/工作区配置无法读取/);assert.match(boot.storageWarning,/NodeSeek Pro/);
  await assert.rejects(page.evaluate(()=>window.seekdesk.loadDraft('reply:123',42)),/无法读取/);
  await assert.rejects(page.evaluate(()=>window.seekdesk.saveAppearance({brand:'green'})),/无法读取/);
  assert.equal(await fs.readFile(features,'utf8'),featureData);assert.equal(await fs.readFile(pro,'utf8'),proData);
  await page.evaluate(()=>window.seekdesk.setCloseBehavior('quit'));
  const closed=app.waitForEvent('close',{timeout:20000});await page.getByRole('button',{name:'关闭窗口',exact:true}).click();await closed;app=undefined;
  assert.equal(await fs.readFile(features,'utf8'),featureData);assert.equal(await fs.readFile(pro,'utf8'),proData);
  console.log('PASS Corrupt files surface startup/read/write errors, remain byte-identical, and ordinary quit completes without overwriting them');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
