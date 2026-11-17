/* Low-volume anonymous public timing. Never attaches to a user's profile. */
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');const path=require('node:path');
const project=path.resolve(__dirname,'..'),profile=path.join(project,'.test-data','public-timing-'+Date.now());
const report={testedAt:new Date().toISOString(),scope:'Live anonymous homepage and one public post, fresh isolated Chromium profile, no login or writes.'};
let app;
(async()=>{
  await fs.mkdir(profile,{recursive:true});const entry=path.join(profile,'entry.cjs');
  await fs.writeFile(entry,`const {app,session}=require('electron');app.whenReady().then(()=>session.defaultSession.protocol.handle('file',()=>new Response('<!doctype html><title>Anonymous timing</title>',{headers:{'content-type':'text/html'}})));require(${JSON.stringify(path.join(project,'dist-electron/electron/main.js'))});`);
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[entry],env,timeout:45000});
  const page=await app.firstWindow();await page.waitForFunction(()=>Boolean(window.seekdesk));
  report.direct=await app.evaluate(async({BrowserWindow,session})=>{
    const win=new BrowserWindow({show:false,webPreferences:{session:session.fromPartition('persist:nodeseek'),sandbox:true,contextIsolation:true,nodeIntegration:false}}),start=Date.now(),result={};
    win.webContents.once('dom-ready',()=>{result.domMs=Date.now()-start;});let timer;
    try{await Promise.race([win.loadURL('https://www.nodeseek.com/'),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('30s timeout')),30000);})]);result.loadMs=Date.now()-start;result.page=await win.webContents.executeJavaScript('({verification:/just a moment|验证|checking your browser/i.test(document.title),postLinks:document.querySelectorAll(".post-title a").length})');}catch(error){result.error=error.message;}finally{clearTimeout(timer);win.destroy();}
    return result;
  });
  let start=Date.now();const listing=await page.evaluate(()=>window.seekdesk.listPosts({}));report.client={ms:Date.now()-start,source:listing.source,count:listing.posts.length};
  const target=listing.posts.reduce((newest,post)=>!newest||Number(post.id)>Number(newest.id)?post:newest,null);
  if(listing.source==='web'&&target){start=Date.now();try{const thread=await page.evaluate(post=>window.seekdesk.readThread(post),target);report.thread={ms:Date.now()-start,source:thread.source,comments:thread.comments.length};}catch(error){report.thread={ms:Date.now()-start,error:error.message};}}
  report.account=await page.evaluate(()=>window.seekdesk.checkAccount()).then(value=>({status:value.status}));
  console.log(JSON.stringify(report,null,2));
})().catch(error=>{report.error=error.message;console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});await fs.mkdir(path.join(project,'verification'),{recursive:true});await fs.writeFile(path.join(project,'verification','reading-public-timing'+(process.argv.includes('--record')?'-baseline':'')+'.json'),JSON.stringify(report,null,2));});
