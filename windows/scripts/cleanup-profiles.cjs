const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
  const root=await fs.realpath(path.resolve(__dirname,'..'));
  const target=await fs.realpath(path.join(root,'.test-data'));
  if(path.relative(root,target)!=='.test-data') throw Error('Refusing unexpected test profile path');
  const installed=path.join(target,'installed-app','SeekDesk Windows.exe');
  try {await fs.access(installed);throw Error('Uninstall the isolated test installation first');} catch(e) {if(e.code!=='ENOENT')throw e;}
  await fs.rm(target,{recursive:true,force:true,maxRetries:3,retryDelay:500});
  console.log('Removed only generated .test-data browser profiles');
})().catch(e=>{console.error(e);process.exitCode=1;});
