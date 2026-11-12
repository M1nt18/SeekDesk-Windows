// Read-only research of public website JavaScript. Never sends interaction requests.
const {_electron}=require('playwright-core');
const path=require('node:path');
const fs=require('node:fs/promises');
(async()=>{
 const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:path.resolve('.test-data/research-actions-'+Date.now())};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
 const app=await _electron.launch({executablePath:require('electron'),args:[path.resolve('.')],env});
 try {
  const result=await app.evaluate(async({BrowserWindow})=>{
   const win=new BrowserWindow({show:false,webPreferences:{partition:'research-public-actions',nodeIntegration:false,contextIsolation:true,sandbox:true}});
   try {
    await win.loadURL('https://www.nodeseek.com/space/9');
    return await win.webContents.executeJavaScript(String.raw`(async()=>{
      const scripts=[...document.scripts].map(s=>s.src).filter(u=>u&&new URL(u).origin===location.origin&&!/icon\.|cdn-cgi/.test(u));
      const files=[];
      for(const src of scripts){const r=await fetch(src,{credentials:'omit'});const text=await r.text();const matches=[...text.matchAll(/.{0,160}(?:\/api\/fans|changeFollow|\/notification#\/message).{0,260}/gi)].slice(0,12).map(m=>m[0]);if(matches.length)files.push({src,matches});}
      return {checkedAt:new Date().toISOString(),scope:'Read-only public profile scripts; no authenticated profile, cookies, passwords or write requests inspected.',title:document.title,files};
    })()`);
   } finally{win.destroy();}
  });
  await fs.writeFile('verification/public-actions-research.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
