/* Actual production image IPC, explicitly supplied public URLs, fresh session. */
const {_electron}=require('playwright-core'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.test-data','image-public-'+Date.now());let app;
(async()=>{
  if(!process.argv[2])throw Error('请指定待测公开 HTTPS 图片地址');await fs.mkdir(profile,{recursive:true});const entry=path.join(profile,'entry.cjs');
  await fs.writeFile(entry,`const {app,session}=require('electron');app.whenReady().then(()=>session.defaultSession.protocol.handle('file',()=>new Response('<!doctype html><title>Anonymous image IPC</title>',{headers:{'content-type':'text/html'}})));require(${JSON.stringify(path.join(root,'dist-electron/electron/main.js'))});`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[entry],env});const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.seekdesk));const results=[];
  for(const url of process.argv.slice(2)){const start=Date.now();const image=await page.evaluate(url=>window.seekdesk.loadReaderImage(url,1200,true),url);if(!image.data.startsWith('data:image/webp;base64,')||!image.width||!image.height)throw Error('未读到可显示的图片');results.push({host:new URL(url).hostname,width:image.width,height:image.height,originalWidth:image.originalWidth,originalHeight:image.originalHeight,ms:Date.now()-start,pixelsReadable:true});}
  console.log(JSON.stringify({scope:'Anonymous GET via the real main/preload; no existing account or profile.',results},null,2));await fs.mkdir(path.join(root,'verification'),{recursive:true});await fs.writeFile(path.join(root,'verification/image-public.json'),JSON.stringify(results,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
