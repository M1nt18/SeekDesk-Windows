import fs from 'node:fs';
import io from 'node:fs/promises';
import path from 'node:path';

export interface CaptureMode {outputPath:string;userDataDirectory:string;frames:120}
export interface CaptureModeOptions {workingDirectory:string;temporaryDirectory:string}
interface CaptureContents {
  executeJavaScript(source:string):Promise<unknown>;
  capturePage():Promise<{toPNG():Buffer;isEmpty?():boolean}>;
}

/** Synchronous by design: call before Electron's ready event or any session use. */
export function prepareCaptureMode(argv:readonly string[],options:CaptureModeOptions):CaptureMode|undefined {
  const matches=argv.flatMap((value,index)=>value==='--screenshot'?[{index,value:argv[index+1]}]:value.startsWith('--screenshot=')?[{index,value:value.slice(13)}]:[]);
  if(!matches.length)return;
  if(matches.length!==1)throw new Error('只能指定一个截图输出文件');
  const value=matches[0].value;
  if(!value||value.startsWith('-')||/[\x00-\x1f]/.test(value)||path.extname(value).toLowerCase()!=='.png')throw new Error('--screenshot 需要一个 PNG 输出文件');
  if(!path.isAbsolute(options.workingDirectory)||!path.isAbsolute(options.temporaryDirectory))throw new Error('截图工作目录无效');
  const outputPath=path.resolve(options.workingDirectory,value);
  if(fs.existsSync(outputPath))throw new Error('截图输出文件已存在，请指定新的 PNG 文件');
  fs.mkdirSync(options.temporaryDirectory,{recursive:true});
  const userDataDirectory=fs.mkdtempSync(path.join(options.temporaryDirectory,'seekdesk-capture-'));
  return {outputPath,userDataDirectory,frames:120};
}

const waitForFrame=String.raw`new Promise((resolve,reject)=>{
  let frames=0;
  const timer=setTimeout(()=>reject(new Error('截图页面尚未就绪')),12000);
  const step=()=>{
    const ready=document.querySelector('.workspace')||document.querySelector('.boot-screen [role="alert"]');
    if(ready&&++frames>=120){clearTimeout(timer);resolve();return;}
    requestAnimationFrame(step);
  };
  Promise.resolve(document.fonts?.ready).then(()=>requestAnimationFrame(step),reject);
})`;

async function bounded<T>(task:Promise<T>,milliseconds:number):Promise<T> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([task,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('截图等待超时')),milliseconds);})]);}
  finally{clearTimeout(timer);}
}

/** Only captures the explicitly requested, isolated local renderer. */
export async function captureModeImage(contents:CaptureContents,mode:CaptureMode,options:{timeoutMs?:number}={}):Promise<{outputPath:string;bytes:number}> {
  const timeout=options.timeoutMs??15000;
  if(!Number.isFinite(timeout)||timeout<=0||timeout>60000)throw new Error('截图等待参数无效');
  await bounded(contents.executeJavaScript(waitForFrame),timeout);
  const image=await bounded(contents.capturePage(),timeout),png=image.toPNG();
  if(image.isEmpty?.()||!Buffer.isBuffer(png)||png.length<8||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('未取得有效 PNG 截图');
  await io.mkdir(path.dirname(mode.outputPath),{recursive:true});
  const file=await io.open(mode.outputPath,'wx');
  try{await file.writeFile(png);await file.sync();}
  catch(error){await file.close();await io.unlink(mode.outputPath).catch(()=>{});throw error;}
  await file.close();
  return {outputPath:mode.outputPath,bytes:png.length};
}
