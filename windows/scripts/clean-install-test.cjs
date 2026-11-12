const fs=require('node:fs/promises');
const path=require('node:path');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const testRoot=path.join(root,'.test-data');
const destination=path.join(testRoot,'installed-app');
if(path.relative(testRoot,destination)!=='installed-app') throw Error('Unexpected installation test path');
(async()=>{
  const uninstaller=path.join(destination,'Uninstall SeekDesk Windows.exe');
  try {await fs.access(uninstaller);} catch {console.log('No isolated installation to remove');return;}
  await new Promise((resolve,reject)=>{
    const child=spawn(uninstaller,['/S','_?='+destination],{stdio:'inherit',shell:false});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('Test uninstall failed: '+code)));
  });
  let removed=false;
  for(let i=0;i<20;i++) {
    try {await fs.access(path.join(destination,'SeekDesk Windows.exe'));} catch {removed=true;break;}
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!removed) throw Error('Installed executable remains after uninstall');
  const reportPath=path.join(root,'verification','installation.json');
  const report=JSON.parse(await fs.readFile(reportPath,'utf8'));
  report.testInstallationRemoved=true;await fs.writeFile(reportPath,JSON.stringify(report,null,2));
  console.log('PASS isolated installation uninstalled; release artifacts retained');
})().catch(e=>{console.error(e);process.exitCode=1;});
