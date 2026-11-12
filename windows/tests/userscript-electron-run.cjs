const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
let app;
(async()=>{
 const env={...process.env,SEEKDESK_USER_DATA:path.join(root,'.test-data',`userscript-${Date.now()}`)};delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'userscript-electron-main.cjs')],env});
 await app.firstWindow();
 for(let i=0;i<100;i++){if(await app.evaluate(()=>globalThis.userscriptTest?.ready))break;await new Promise(resolve=>setTimeout(resolve,100));}
 const state=await app.evaluate(async()=>{
   const test=globalThis.userscriptTest;
   if(!test.ready)throw Error('Userscript fixture did not start');
   const mainWorld=await test.contents.executeJavaScript('({node:typeof require,bridge:typeof window.__seekdeskGM,application:typeof window.seekdesk})');
   const isolated=await test.contents.executeJavaScriptInIsolatedWorld(test.world,[{code:'({version:window.__seekdeskProRuntime.version,menus:window.__seekdeskProRuntime.getMenuLabels(),settings:window.__seekdeskProRuntime.getSettings()})'}]);
   await test.host.openMenu(test.contents);
   await test.contents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('#seekdesk-pro-menu button')].find(node=>node.textContent.includes('高级设置'));if(!button)throw Error('Missing original settings command');button.click();})()`);
   await new Promise(resolve=>setTimeout(resolve,450));
   const title=await test.contents.executeJavaScript('document.querySelector(".layui-layer-title")?.textContent');
   const dialog=await test.contents.executeJavaScript('(()=>{const node=document.querySelector(".layui-layer");const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,viewportWidth:innerWidth,viewportHeight:innerHeight};})()');
   const image=(await test.contents.capturePage()).toPNG().toString('base64');
   return {result:test.result,mainWorld,isolated,title,dialog,requests:test.requests,errors:test.errors,image};
 });
 assert.equal(state.result.status,'running');assert.equal(state.mainWorld.node,'undefined');assert.equal(state.mainWorld.bridge,'undefined');assert.equal(state.mainWorld.application,'undefined');
 assert.equal(state.isolated.settings.sign_in.ns.enabled,false);assert.ok(state.isolated.menus.length>4);assert.match(state.title,/Pro.*设置/);
 assert.ok(state.dialog.x>=0 && state.dialog.y>=0 && state.dialog.width>200 && state.dialog.x+state.dialog.width<=state.dialog.viewportWidth+2,JSON.stringify(state.dialog));
 assert.deepEqual(state.requests.filter(r=>r.method!=='GET'),[],'No real or simulated write should happen without a user command');
 const narrow=await app.evaluate(async({BrowserWindow})=>{
   const test=globalThis.userscriptTest,view=BrowserWindow.getAllWindows()[0].contentView.children.find(child=>child.webContents);
   view.setBounds({x:0,y:40,width:512,height:640});
   await new Promise(resolve=>setTimeout(resolve,100));
   return test.contents.executeJavaScript('(()=>{const r=document.querySelector(".layui-layer").getBoundingClientRect();return{x:r.x,width:r.width,viewportWidth:innerWidth};})()');
 });
 assert.ok(narrow.x>=-1 && narrow.x+narrow.width<=narrow.viewportWidth+1,JSON.stringify(narrow));state.narrowDialog=narrow;
 const stored=JSON.parse(await fs.readFile(path.join(env.SEEKDESK_USER_DATA,'gm/nodeseek-pro.json'),'utf8'));
 assert.equal(stored.settings.sign_in.ns.enabled,false);state.gmStoragePersisted=true;
 await fs.writeFile(path.join(root,'verification/nodeseek-pro-settings.png'),Buffer.from(state.image,'base64'));delete state.image;
 await fs.writeFile(path.join(root,'verification/nodeseek-pro-electron.json'),JSON.stringify({status:'pass',scope:'Real Electron with isolated mock HTTPS responses; no live forum writes',...state},null,2));
 console.log('PASS real Electron: NodeSeek Pro isolated world, menu, original settings, and attendance disabled');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
