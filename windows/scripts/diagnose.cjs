const {_electron}=require('playwright-core');
const path=require('node:path');
(async()=>{
 const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.resolve('.test-data/diagnose')};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve('.')],env});
 const p=await app.firstWindow();await p.waitForSelector('.workspace');
 console.log(await app.evaluate(async({session})=>{
  const r=await session.fromPartition('public-diagnostic').fetch('https://rss.nodeseek.com/',{credentials:'omit'});
  return {url:r.url,status:r.status,type:r.type,headers:Object.fromEntries(r.headers),length:(await r.text()).length};
 }));
 console.log(await p.evaluate(async()=>{try{return await window.seekdesk.listPosts({});}catch(e){return e.message;}}));
 await p.screenshot({path:path.resolve('verification/diagnostic.png')});
 await app.close();
})().catch(e=>{console.error(e);process.exitCode=1;});
