/* Anonymous comparison for a user-supplied public report. No existing profile. */
const {_electron}=require('playwright-core'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'.test-data','image-network-'+Date.now());let app;
(async()=>{
  await fs.mkdir(profile,{recursive:true});const entry=path.join(profile,'entry.cjs');await fs.writeFile(entry,`const {app,BrowserWindow,session}=require('electron');app.setPath('userData',${JSON.stringify(profile)});app.whenReady().then(async()=>{globalThis.__mediaDiagnostic=session.fromPartition('image-diagnostic');const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});await win.loadURL('data:text/html,<title>Anonymous image timing</title>');});`);
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;app=await _electron.launch({executablePath:require('electron'),args:[entry],env});await app.firstWindow();
  const url=process.argv[2];if(!url)throw Error('请指定待测公开 HTTPS 报告地址');
  const result=await app.evaluate(async(_,url)=>{
    const s=globalThis.__mediaDiagnostic;
    const read=async(kind,url)=>{const start=Date.now();try{const response=await(kind==='node'?fetch(url,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(12000)}):s.fetch(url,{credentials:'omit',redirect:'manual',signal:AbortSignal.timeout(12000)}));const text=(await response.text()).slice(0,2000000);return {kind,status:response.status,mime:response.headers.get('content-type'),redirect:response.headers.get('location'),ms:Date.now()-start,text};}catch(error){return {kind,error:error.cause?.code||error.code||error.name,ms:Date.now()-start};}};
    const report=await Promise.all(['node','chromium'].map(kind=>read(kind,url))),body=report.find(row=>row.status===200)?.text||'';
    const images=[...body.matchAll(/(?:src|content)=["']([^"']+\.(?:png|webp|jpe?g)(?:\?[^"']*)?)["']/gi)].map(match=>new URL(match[1].replaceAll('&amp;','&'),url).href).filter((url,index,all)=>url.startsWith('https:')&&all.indexOf(url)===index).slice(0,2);
    for(const row of report)delete row.text;const imageResults=[];for(const image of images)for(const kind of ['node','chromium']){const row=await read(kind,image);delete row.text;imageResults.push({...row,url:image});}
    return {url,systemProxyUsed:(await s.resolveProxy(url))!=='DIRECT',report,images:imageResults};
  },url);console.log(JSON.stringify(result,null,2));await fs.mkdir(path.join(root,'verification'),{recursive:true});await fs.writeFile(path.join(root,'verification/image-network-diagnose.json'),JSON.stringify(result,null,2));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(async()=>{if(app)await app.close().catch(()=>{});});
