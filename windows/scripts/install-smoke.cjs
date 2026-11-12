const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const destination=path.join(root,'.test-data','installed-app');
const installer=path.join(root,'release','SeekDesk-Windows-0.1.0-x64-Setup.exe');
const run=(exe,args,env)=>new Promise((resolve,reject)=>{
  const child=spawn(exe,args,{stdio:'inherit',env:env||process.env,shell:false});
  child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(`Exit ${code}: ${path.basename(exe)}`)));
});
(async()=>{
  await fs.mkdir(path.dirname(destination),{recursive:true});
  await run(installer,['/S','/D='+destination]);
  const executable=path.join(destination,'SeekDesk Windows.exe');
  assert.ok((await fs.stat(executable)).size>1_000_000);
  await fs.writeFile(path.join(root,'verification','installation.json'),JSON.stringify({status:'pass',installer:path.basename(installer),installedExecutable:'SeekDesk Windows.exe',installation:'isolated per-user NSIS silent installation',testedAt:new Date().toISOString()},null,2));
  console.log('PASS NSIS installed executable',executable);
  await run(process.execPath,[path.join(root,'scripts','smoke.cjs')],{...process.env,SEEKDESK_INSTALLED_EXE:executable});
})().catch(e=>{console.error(e);process.exitCode=1;});
