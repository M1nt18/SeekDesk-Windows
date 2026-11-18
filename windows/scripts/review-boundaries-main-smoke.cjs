/* Real main/sandboxed preload with synthetic forum documents and failing local IO. */
const {_electron}=require('playwright-core'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.test-data','review-boundaries-'+Date.now());let app,page;
(async()=>{
  await fs.mkdir(profile,{recursive:true});const entry=path.join(profile,'entry.cjs');
  await fs.writeFile(entry,`const {app,session,dialog}=require('electron'),fs=require('node:fs/promises');globalThis.performance=require('node:perf_hooks').performance;const state=globalThis.__boundary={owner:42,failPreferences:false,exportPath:${JSON.stringify(path.join(profile,'pro-export.json'))}};const rename=fs.rename;fs.rename=async(from,to)=>{if(state.failPreferences&&String(to).endsWith('preferences.json'))throw Object.assign(Error('synthetic preference failure'),{code:'EACCES'});return rename(from,to);};dialog.showSaveDialog=async()=>({canceled:false,filePath:state.exportPath});app.whenReady().then(()=>{
session.defaultSession.protocol.handle('file',()=>new Response('<!doctype html><title>Boundary fixture</title>',{headers:{'content-type':'text/html'}}));const s=session.fromPartition('persist:nodeseek'),clear=s.clearStorageData.bind(s);s.clearStorageData=async(...args)=>{state.owner=null;return clear(...args);};s.protocol.handle('https',request=>new Response('<!doctype html><title>Fixture</title><script>window.__config__='+JSON.stringify({user:state.owner?{member_id:state.owner,member_name:'Synthetic '+state.owner}:null})+'</script><div id=nsk-head></div><div id=nsk-body-left><ul class=post-list></ul></div>',{headers:{'content-type':'text/html'}}));});globalThis.fetch=async()=>{throw Error('No live calls allowed');};require(${JSON.stringify(path.join(root,'dist-electron/electron/main.js'))});`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[entry],env});page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.seekdesk));
  assert.equal((await page.evaluate(()=>window.seekdesk.checkAccount())).id,42);
  await page.evaluate(async()=>{await window.seekdesk.openOfficial('https://www.nodeseek.com/');await window.seekdesk.closeOfficial();});
  await app.evaluate(()=>{globalThis.__boundary.owner=84;});
  assert.equal((await page.evaluate(()=>window.seekdesk.checkAccount())).id,84);
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal((await page.evaluate(()=>window.seekdesk.bootstrap())).account.id,84);
  console.log('PASS Fresh account confirmation ignores a retained official document from the previous account');
  await page.evaluate(()=>window.seekdesk.saveDraft('reply:123',{content:'new owner local draft',imageWidths:{}},84));
  await page.evaluate(()=>window.seekdesk.saveProCredential({service:'ai',apiKey:'synthetic-main-only-secret'}));
  const credentials=await page.evaluate(()=>window.seekdesk.getProCredentials());assert.deepEqual(credentials,{aiConfigured:true,nodeimageConfigured:false});
  assert.equal((await page.evaluate(()=>window.seekdesk.exportProPreferences())).canceled,false);
  const exported=await fs.readFile(path.join(profile,'pro-export.json'),'utf8');assert.doesNotMatch(exported,/synthetic-main-only-secret|api_key|Cookie/);assert.equal(JSON.parse(exported).format,'seekdesk-pro-preferences');
  console.log('PASS Local IPC exposes credential status only and completes a secret-free export through a trusted save dialog');
  await app.evaluate(()=>{globalThis.__boundary.failPreferences=true;});
  await assert.rejects(page.evaluate(()=>window.seekdesk.clearSession()),/会话已清除/);
  const account=(await page.evaluate(()=>window.seekdesk.bootstrap())).account;assert.equal(account.status,'signed-out');assert.equal(account.id,undefined);
  await assert.rejects(page.evaluate(()=>window.seekdesk.readReadingLibrary(84)),/会话/);assert.equal(await page.evaluate(()=>window.seekdesk.loadDraft('reply:123',84)),null);
  await assert.rejects(page.evaluate(()=>window.seekdesk.saveDraft('reply:123',{content:'stale write',imageWidths:{}},84)),/账号/);
  console.log('PASS Session clearing invalidates the old owner and all private local access even when preferences cannot be saved');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app){await app.evaluate(()=>{globalThis.__boundary.failPreferences=false;}).catch(()=>{});await app.close().catch(()=>{});}});
