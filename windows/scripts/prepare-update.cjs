// Generate public update metadata locally. This script never uploads a release.
const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createReadStream}=require('node:fs');
const project=path.resolve(__dirname,'..');
const pkg=require('../package.json');
async function prepareUpdate(output=path.join(project,pkg.build.directories.output)){
  const directory=path.resolve(project,output),relative=path.relative(project,directory);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw Error('更新清单输出必须位于项目内的构建目录');
  if(!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(pkg.version))throw Error('仅稳定版可生成更新清单');
  const filename=`SeekDesk-Windows-${pkg.version}-x64-Setup.exe`,artifact=path.join(directory,filename);
  const stat=await fs.lstat(artifact);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1_000_000)throw Error('缺少已构建的完整 x64 安装程序');
  const hash=createHash('sha512');for await(const chunk of createReadStream(artifact))hash.update(chunk);
  const sha512=hash.digest('base64');
  const yaml=`version: ${pkg.version}\nfiles:\n  - url: ${filename}\n    sha512: ${sha512}\n    size: ${stat.size}\npath: ${filename}\nsha512: ${sha512}\nreleaseDate: '${new Date().toISOString()}'\n`;
  const target=path.join(directory,'latest.yml');await fs.writeFile(target+'.tmp',yaml,'utf8');await fs.rename(target+'.tmp',target);
  return {version:pkg.version,file:filename,size:stat.size,sha512,metadata:'latest.yml'};
}
module.exports={prepareUpdate};
if(require.main===module)prepareUpdate(process.argv[2]).then(result=>console.log(JSON.stringify(result))).catch(error=>{console.error(error.message);process.exitCode=1;});
