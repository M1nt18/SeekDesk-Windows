const {spawn}=require('node:child_process');
const {realpathSync}=require('node:fs');
const path=require('node:path');

// esbuild's metafile paths and Vite's cache paths must use the same physical drive.
// The user's Documents workspace can be a C: junction pointing to D:.
const projectRoot=realpathSync(path.resolve(__dirname,'..'));
const devURL='http://127.0.0.1:5173';
let compiler;
let vite;
let electron;
let stopping=false;

function stop(code=0) {
  if(stopping) return;
  stopping=true;
  process.exitCode=code;
  for(const child of [compiler,vite,electron]) {
    if(child && child.exitCode===null && !child.killed) child.kill();
  }
}
process.on('SIGINT',()=>stop(0));
process.on('SIGTERM',()=>stop(0));
process.on('exit',()=>stop(process.exitCode || 0));

async function main() {
  compiler=spawn(process.execPath,[require.resolve('typescript/bin/tsc'),'-p','tsconfig.electron.json'],{cwd:projectRoot,stdio:'inherit'});
  await new Promise((resolve,reject)=>{
    compiler.once('error',reject);
    compiler.once('exit',code=>code===0 ? resolve() : reject(new Error(`Electron 编译失败，退出码 ${code}`)));
  });
  if(stopping) return;
  vite=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js')],{cwd:projectRoot,stdio:'inherit'});
  vite.once('error',error=>{console.error(error);stop(1);});
  vite.once('exit',code=>{
    if(!stopping) {console.error(`Vite 已退出（${code ?? 'signal'}）。`);stop(code || 1);}
  });
  const deadline=Date.now()+20000;
  let ready=false;
  while(!stopping && Date.now()<deadline) {
    try {
      const response=await fetch(devURL,{signal:AbortSignal.timeout(1000)});
      if(response.ok && (await response.text()).includes('/src/main.tsx')) {ready=true;break;}
    } catch { /* The development server is still starting. */ }
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(stopping) return;
  if(!ready) throw new Error('Vite 未在 20 秒内启动，请检查 5173 端口和上方输出。');
  const env={...process.env,SEEKDESK_DEV_URL:devURL};
  delete env.ELECTRON_RUN_AS_NODE;
  electron=spawn(require('electron'),['.'],{cwd:projectRoot,stdio:'inherit',env,shell:false});
  electron.once('error',error=>{console.error(error);stop(1);});
  electron.once('exit',code=>stop(code || 0));
}
main().catch(error=>{console.error(error);stop(1);});
