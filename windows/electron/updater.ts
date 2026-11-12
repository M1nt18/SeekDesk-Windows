import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {UpdateState} from '../shared/desktop';
import type {AppAdapter} from 'electron-updater/out/AppAdapter';

export const UPDATE_REPOSITORY = 'https://github.com/M1nt18/SeekDesk-Windows';
export const UPDATE_RELEASE_API = 'https://api.github.com/repos/M1nt18/SeekDesk-Windows/releases/latest';
export const UPDATE_CACHE_NAME = 'updater-cache-v1';
const DAY = 86_400_000;
const RECEIPT = 'seekdesk-update.json';
const MAX_CACHE_BYTES = 512 * 1024 * 1024;
type FileSystem = Pick<typeof fs, 'mkdir'|'lstat'|'realpath'|'readdir'|'readFile'|'writeFile'|'rename'|'unlink'|'rmdir'>;
type UpdateInfo = {version:string; files?:{url:string;sha512?:string;size?:number;isAdminRightsRequired?:boolean}[]; path?:string; sha512?:string; packages?:unknown; releaseDate?:string};
export type VerifiedDownload = {version:string;file:string;sha512:string;isAdminRightsRequired?:boolean};
type Receipt = VerifiedDownload & {phase:'downloaded'|'installing';at:number};
export interface NativeUpdater {
  autoDownload:boolean; autoInstallOnAppQuit:boolean; allowPrerelease:boolean; allowDowngrade:boolean;
  disableWebInstaller:boolean; disableDifferentialDownload:boolean; logger:unknown;
  requestHeaders:unknown;
  setFeedURL(value:{provider:'github';owner:string;repo:string;private:false;releaseType:'release'}):void;
  checkForUpdates():Promise<{updateInfo:UpdateInfo;isUpdateAvailable:boolean}|null>;
  downloadUpdate(token:{cancel():void;readonly cancelled:boolean}):Promise<string[]>;
  restoreVerifiedDownload(download:VerifiedDownload):Promise<void>;
  quitAndInstall(silent:boolean,forceRunAfter:boolean):void;
  resetAfterInstallError?():void;
  on(event:string,listener:(...args:any[])=>void):unknown;
  removeListener(event:string,listener:(...args:any[])=>void):unknown;
}
export interface UpdaterOptions {
  currentVersion:string;
  isPackaged:boolean;
  isInstalled:boolean;
  userDataDirectory:string;
  onChange?:(state:UpdateState)=>void;
  nativeFactory?:(cacheDirectory:string)=>NativeUpdater;
  cancellationFactory?:()=>{cancel():void;readonly cancelled:boolean};
  fetchRelease?:(url:string,signal:AbortSignal)=>Promise<{ok:boolean;status:number;json():Promise<unknown>}>;
  fileSystem?:FileSystem;
  hashFile?:(file:string)=>Promise<string>;
  installerBusy?:(file:string)=>Promise<boolean>;
  now?:()=>number;
  automaticCheckDelayMs?:number;
  cleanupRetryDelayMs?:number;
}

function stableVersion(value:unknown):string|null {
  if(typeof value!=='string'||!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))return null;
  return value.replace(/^v/,'');
}
export function compareUpdateVersions(a:string,b:string):number {
  if(!stableVersion(a)||!stableVersion(b))throw new Error('更新版本号无效');
  const av=a.replace(/^v/,'').split('.').map(BigInt),bv=b.replace(/^v/,'').split('.').map(BigInt);
  for(let i=0;i<3;i++){if(av[i]>bv[i])return 1;if(av[i]<bv[i])return -1;}return 0;
}
function isHash(value:unknown):value is string {
  return typeof value==='string'&&/^[A-Za-z0-9+/]{86}==$/.test(value)&&Buffer.from(value,'base64').length===64&&Buffer.from(value,'base64').toString('base64')===value;
}
function installerName(version:string):string {return `SeekDesk-Windows-${version}-x64-Setup.exe`;}
function manifestFile(info:UpdateInfo):{file:string;sha512:string;isAdminRightsRequired?:boolean} {
  const version=stableVersion(info?.version);
  if(!version||version!==info.version||info.packages)throw new Error('更新清单无效');
  const files=info.files?.length?info.files:[{url:info.path||'',sha512:info.sha512}];
  if(files.length!==1)throw new Error('更新清单仅支持完整 x64 安装包');
  const file=files[0];
  if(file.url!==installerName(version)||!isHash(file.sha512)||('size' in file&&file.size!==undefined&&(!Number.isSafeInteger(file.size)||file.size<=0)))throw new Error('更新清单缺少有效的安装包或 SHA-512');
  if('isAdminRightsRequired' in file&&file.isAdminRightsRequired!==undefined&&typeof file.isAdminRightsRequired!=='boolean')throw new Error('更新清单权限字段无效');
  return {file:file.url,sha512:file.sha512,...('isAdminRightsRequired' in file?{isAdminRightsRequired:file.isAdminRightsRequired}:{})};
}
function errorCode(error:unknown):string {return String((error as {code?:unknown})?.code||'');}
function missingManifest(error:unknown):boolean {return errorCode(error)==='ERR_UPDATER_CHANNEL_FILE_NOT_FOUND';}
function verificationError(error:unknown):boolean {return /CHECKSUM|SIGNATURE|INVALID_UPDATE|NO_CHECKSUM/.test(errorCode(error));}
async function defaultHashFile(file:string):Promise<string> {
  const hash=createHash('sha512');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('base64');
}
async function defaultInstallerBusy(file:string):Promise<boolean> {
  if(process.platform!=='win32')return true;
  const exec=promisify(execFile);
  try {
    // NSIS may be running from its extracted temporary executable after launch.
    const {stdout}=await exec('tasklist.exe',['/FO','CSV','/NH'],{windowsHide:true,timeout:8000,maxBuffer:2*1024*1024});
    const names=stdout.split(/\r?\n/).map(line=>/^"([^"]+)"/.exec(line)?.[1]?.toLowerCase()).filter(Boolean);
    return names.some(name=>name===file.toLowerCase()||/^ns[a-z0-9_-]*\.tmp$/.test(name!));
  }catch{return true;}
}

/** Lazily loads Electron; unit tests can import this module without starting it. */
export function createIsolatedNativeUpdater(cacheDirectory:string,appAdapter?:AppAdapter):NativeUpdater {
  const {NsisUpdater}=require('electron-updater') as typeof import('electron-updater');
  const {DownloadedUpdateHelper}=require('electron-updater/out/DownloadedUpdateHelper') as typeof import('electron-updater/out/DownloadedUpdateHelper');
  class IsolatedNsisUpdater extends NsisUpdater {
    constructor(){super(undefined,appAdapter);this.downloadedUpdateHelper=new DownloadedUpdateHelper(cacheDirectory);}
    resetAfterInstallError(){this.quitAndInstallCalled=false;}
    async restoreVerifiedDownload(download:VerifiedDownload){
      const expected=manifestFile({version:download.version,files:[{url:download.file,sha512:download.sha512,isAdminRightsRequired:download.isAdminRightsRequired}]});
      const file=path.join(cacheDirectory,'pending',expected.file);
      const entry={url:expected.file,sha512:expected.sha512,isAdminRightsRequired:expected.isAdminRightsRequired===true};
      // BaseUpdater.install() requires both helper.file and downloadedFileInfo.
      // The actual 6.8.11 API restores those plus versionInfo/fileInfo; merely
      // reading our receipt or update-info.json does not initialize them.
      await this.downloadedUpdateHelper!.setDownloadedFile(file,null,{version:download.version,files:[entry],path:entry.url,sha512:entry.sha512,releaseDate:''},{url:new URL(UPDATE_REPOSITORY+'/releases/download/v'+download.version+'/'+entry.url),info:entry},entry.url,false);
    }
  }
  return new IsolatedNsisUpdater() as unknown as NativeUpdater;
}

export class UpdaterService {
  private state:UpdateState;
  private readonly io:FileSystem;
  private readonly now:()=>number;
  private readonly cache:string;
  private native:NativeUpdater|undefined;
  private info:UpdateInfo|undefined;
  private receipt:Receipt|undefined;
  private initialized:Promise<void>|undefined;
  private checkTask:Promise<UpdateState>|undefined;
  private downloadTask:Promise<UpdateState>|undefined;
  private installTask:Promise<UpdateState>|undefined;
  private token:{cancel():void;readonly cancelled:boolean}|undefined;
  private timer:ReturnType<typeof setTimeout>|undefined;
  private periodic:ReturnType<typeof setInterval>|undefined;
  private cleanupRetry:ReturnType<typeof setTimeout>|undefined;
  private disposed=false;
  private installing=false;
  private readonly lifecycle=new AbortController();
  private releaseController:AbortController|undefined;
  private receiptTask:Promise<void>=Promise.resolve();
  private readonly listeners:{event:string;listener:(...args:any[])=>void}[]=[];
  constructor(private readonly options:UpdaterOptions) {
    if(!stableVersion(options.currentVersion))throw new Error('当前版本号无效');
    if(!path.isAbsolute(options.userDataDirectory))throw new Error('更新缓存位置无效');
    this.io=options.fileSystem||fs;this.now=options.now||Date.now;
    this.cache=path.join(path.resolve(options.userDataDirectory),UPDATE_CACHE_NAME);
    const supported=options.isPackaged&&options.isInstalled;
    this.state={status:supported?'idle':'unsupported',currentVersion:options.currentVersion,installable:supported,message:supported?'仅在确认后下载和安装更新':options.isPackaged?'便携版不支持在线安装，请前往发布页下载安装版':'源码调试版不支持在线安装',releaseUrl:UPDATE_REPOSITORY+'/releases'};
  }
  getState():UpdateState {return structuredClone({...this.state,canDownload:!this.disposed&&this.available()&&Boolean(this.info)&&!this.state.manualOnly&&['available','cancelled','error'].includes(this.state.status)&&!this.installing});}
  private emit(patch:Partial<UpdateState>) {
    if(this.disposed)return;
    this.state={...this.state,...patch};this.options.onChange?.(this.getState());
  }
  private available():boolean {return this.options.isPackaged&&this.options.isInstalled;}
  private assertActive(){if(this.disposed)throw Object.assign(new Error('Updater disposed'),{code:'DISPOSED'});}
  initialize():Promise<void> {
    if(this.initialized)return this.initialized;
    this.initialized=(async()=>{
      await this.prepareCache();
      if(this.disposed)return;
      await this.cleanup();
      if(!this.available()||this.disposed)return;
      this.native=(this.options.nativeFactory||createIsolatedNativeUpdater)(this.cache);
      Object.assign(this.native,{autoDownload:false,autoInstallOnAppQuit:false,allowPrerelease:false,allowDowngrade:false,disableWebInstaller:true,disableDifferentialDownload:true,logger:null,requestHeaders:null});
      this.native.setFeedURL({provider:'github',owner:'M1nt18',repo:'SeekDesk-Windows',private:false,releaseType:'release'});
      this.listen('download-progress',progress=>{
        if(this.state.status!=='downloading')return;
        const finite=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?Math.max(0,value):0;
        this.emit({progress:{percent:Math.min(100,finite(progress.percent)),bytesPerSecond:finite(progress.bytesPerSecond),transferred:finite(progress.transferred),total:finite(progress.total)}});
      });
      // Errors are also rejected by check/download promises. Never expose native
      // stack traces, headers or local paths to renderer logs or UI.
      this.listen('error',error=>{
        if(this.installing){
          this.installing=false;this.native?.resetAfterInstallError?.();
          if(this.receipt){this.receipt.phase='downloaded';void this.saveReceipt().catch(()=>{});}
          this.emit({status:'downloaded',errorCode:'install',message:'无法启动安装程序，请重试安装',installable:true});
        }
      });
      await this.restorePendingDownload();
      if(this.disposed)return;
      this.timer=setTimeout(()=>{void this.check();},this.options.automaticCheckDelayMs??15_000);this.timer.unref?.();
      this.periodic=setInterval(()=>{void this.cleanup().catch(()=>{});if(!this.checkTask&&!this.downloadTask&&!this.installing&&this.state.status!=='downloaded')void this.check();},DAY);this.periodic.unref?.();
    })();
    return this.initialized;
  }
  private listen(event:string,listener:(...args:any[])=>void) {this.native!.on(event,listener);this.listeners.push({event,listener});}
  private async restorePendingDownload(){
    const receipt=await this.readReceipt();
    if(this.disposed||!receipt||compareUpdateVersions(receipt.version,this.options.currentVersion)<=0)return;
    if(await (this.options.installerBusy||defaultInstallerBusy)(receipt.file)){
      this.emit({status:'error',errorCode:'install',installable:false,message:'安装程序仍在运行，请完成或关闭安装程序后重试'});return;
    }
    if(this.disposed)return;
    try{
      const file=path.join(this.cache,'pending',receipt.file);
      await this.assertSafeFile(file);this.assertActive();
      const actual=await (this.options.hashFile||defaultHashFile)(file);this.assertActive();
      if(actual!==receipt.sha512)throw Object.assign(new Error('校验失败'),{code:'ERR_UPDATER_CHECKSUM_MISMATCH'});
      await this.native!.restoreVerifiedDownload(receipt);this.assertActive();
      const restored:Receipt={...receipt,phase:'downloaded'};
      if(receipt.phase==='installing'){await this.saveReceipt(restored);this.assertActive();}
      this.receipt=restored;
      this.emit({status:'downloaded',version:receipt.version,manualOnly:false,errorCode:undefined,progress:undefined,installable:true,releaseUrl:UPDATE_REPOSITORY+'/releases/tag/v'+receipt.version,message:'已恢复并重新校验待安装包，点击安装并重启'});
    }catch(error){
      if(this.disposed)return;
      this.receipt=undefined;await this.clearPending().catch(()=>{});
      this.emit({status:'error',errorCode:'verification',message:'缓存的更新包无法通过校验，已清理，请重新检查更新'});
    }
  }
  async check():Promise<UpdateState> {
    if(this.disposed)return this.getState();
    if(this.checkTask)return this.checkTask;
    if(this.downloadTask||this.installTask||this.installing||this.state.status==='downloaded')return this.getState();
    this.checkTask=this.performCheck().finally(()=>{this.checkTask=undefined;});return this.checkTask;
  }
  private async performCheck():Promise<UpdateState> {
    try {
      await this.initialize();
      if(this.disposed||this.state.status==='downloaded')return this.getState();
      this.info=undefined;
      this.emit({status:'checking',message:'正在检查 GitHub 稳定版',errorCode:undefined,progress:undefined,manualOnly:false});
      if(!this.available()){await this.checkReleaseApi(true);return this.getState();}
      let result:{updateInfo:UpdateInfo;isUpdateAvailable:boolean}|null;
      try {result=await this.native!.checkForUpdates();}
      catch(error){this.assertActive();if(missingManifest(error)){await this.checkReleaseApi(false);return this.getState();}throw error;}
      this.assertActive();
      if(!result)throw new Error('更新检查未完成');
      const info=result.updateInfo;
      const version=stableVersion(info?.version);
      if(!version)throw Object.assign(new Error('更新清单无效'),{code:'ERR_UPDATER_INVALID_UPDATE_INFO'});
      if(compareUpdateVersions(version,this.options.currentVersion)<=0){this.emit({status:'up-to-date',version,checkedAt:new Date(this.now()).toISOString(),message:'当前已是最新稳定版',installable:true,manualOnly:false});return this.getState();}
      if(!result.isUpdateAvailable){this.emit({status:'unsupported',version,checkedAt:new Date(this.now()).toISOString(),installable:false,manualOnly:true,message:'新版本暂不适用于当前系统或尚未向此设备开放，请在官方发布页核对'});return this.getState();}
      try {manifestFile(info);}catch{throw Object.assign(new Error('更新清单无效'),{code:'ERR_UPDATER_INVALID_UPDATE_INFO'});}
      this.info=info;
      this.emit({status:'available',version,releaseUrl:UPDATE_REPOSITORY+'/releases/tag/v'+version,publishedAt:validDate(info.releaseDate),checkedAt:new Date(this.now()).toISOString(),installable:true,manualOnly:false,message:'发现新版本，可下载并校验安装包'});
    }catch(error){this.emit({status:'error',errorCode:verificationError(error)?'verification':'network',message:verificationError(error)?'发布清单或校验信息无效，请在官方发布页核对':'检查更新失败，请检查网络后重试',installable:this.available()});}
    return this.getState();
  }
  private async checkReleaseApi(unsupported:boolean) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12_000);timer.unref?.();
    this.assertActive();this.releaseController=controller;
    try {
      const response=await (this.options.fetchRelease||((url,signal)=>fetch(url,{signal,redirect:'error',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'SeekDesk-Windows-Updater'}})))(UPDATE_RELEASE_API,controller.signal);
      this.assertActive();
      if(!response.ok)throw new Error('发布查询失败');
      const release=await response.json() as {tag_name?:unknown;draft?:unknown;prerelease?:unknown;published_at?:unknown};
      this.assertActive();
      const version=stableVersion(release?.tag_name);
      if(!version||release.draft!==false||release.prerelease!==false)throw new Error('发布信息无效');
      const newer=compareUpdateVersions(version,this.options.currentVersion)>0;
      this.emit({status:newer?'available':unsupported?'unsupported':'up-to-date',version,releaseUrl:UPDATE_REPOSITORY+'/releases/tag/'+encodeURIComponent(String(release.tag_name)),publishedAt:validDate(release.published_at),checkedAt:new Date(this.now()).toISOString(),installable:false,manualOnly:true,errorCode:!unsupported?'manifest-missing':undefined,message:unsupported?(this.options.isPackaged?'便携版不支持在线安装，请前往官方发布页下载安装版':'源码调试版不支持在线安装，请在官方发布页查看版本'):newer?'此版本尚未提供在线更新清单，请在官方发布页审核并手动下载':'当前已是最新稳定版；该发布未提供在线更新清单'});
    } finally {clearTimeout(timer);if(this.releaseController===controller)this.releaseController=undefined;}
  }
  async download():Promise<UpdateState> {
    if(this.disposed)return this.getState();
    if(this.downloadTask)return this.downloadTask;
    if(!this.info&&this.available()&&this.state.status==='error'){await this.check();if(this.disposed)return this.getState();}
    if(this.downloadTask)return this.downloadTask;
    if(!this.available()||!this.info||this.state.manualOnly||!['available','cancelled','error'].includes(this.state.status))return this.getState();
    this.downloadTask=this.performDownload().finally(()=>{this.downloadTask=undefined;this.token=undefined;});return this.downloadTask;
  }
  private async performDownload():Promise<UpdateState> {
    const info=this.info!,expected=manifestFile(info);
    let started=false;
    try {
      await this.prepareCache();
      this.assertActive();
      await this.filesIn(this.cache);
      this.assertActive();
      const previous=await this.readReceipt();
      this.assertActive();
      if(previous&&await (this.options.installerBusy||defaultInstallerBusy)(previous.file)){
        this.emit({status:'error',errorCode:'install',message:'安装程序仍在运行，请完成或关闭安装程序后重试'});return this.getState();
      }
      this.assertActive();
      this.token=this.options.cancellationFactory?.()||new (require('builder-util-runtime').CancellationToken)();
      started=true;
      this.emit({status:'downloading',errorCode:undefined,message:'正在下载并校验安装包',progress:{percent:0,bytesPerSecond:0,transferred:0,total:0}});
      const files=await this.native!.downloadUpdate(this.token!);
      this.assertActive();
      if(this.token!.cancelled)throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});
      if(files.length!==1||!this.isExpectedFile(files[0],expected.file))throw Object.assign(new Error('校验失败'),{code:'ERR_UPDATER_INVALID_UPDATE_INFO'});
      await this.assertSafeFile(files[0]);
      this.assertActive();
      const actual=await (this.options.hashFile||defaultHashFile)(files[0]);
      this.assertActive();
      if(actual!==expected.sha512)throw Object.assign(new Error('校验失败'),{code:'ERR_UPDATER_CHECKSUM_MISMATCH'});
      if(this.token!.cancelled)throw Object.assign(new Error('cancelled'),{code:'CANCELLED'});
      const receipt:Receipt={version:info.version,...expected,phase:'downloaded',at:this.now()};await this.saveReceipt(receipt);this.assertActive();
      this.receipt=receipt;
      this.emit({status:'downloaded',installable:true,message:'安装包已通过 SHA-512 校验，点击安装并重启',progress:undefined});
    }catch(error){
      const cancelled=this.token?.cancelled||errorCode(error)==='CANCELLED';
      // Wait until the native download settles before removing partial files.
      if(started){this.receipt=undefined;await this.clearPending().catch(()=>{});}
      this.emit({status:cancelled?'cancelled':'error',errorCode:cancelled?undefined:verificationError(error)?'verification':'download',message:cancelled?'已取消下载，可重新下载':verificationError(error)?'安装包校验失败，已删除，请重新下载':'下载失败，已清理临时文件，请重试',progress:undefined,installable:true});
    }
    return this.getState();
  }
  cancel():UpdateState {if(this.state.status==='downloading')this.token?.cancel();return this.getState();}
  async install():Promise<UpdateState> {
    if(this.installTask)return this.installTask;
    if(this.disposed||!this.available()||this.installing||this.state.status!=='downloaded'||!this.receipt||this.receipt.phase!=='downloaded')return this.getState();
    this.installTask=this.performInstall({...this.receipt},this.native!).finally(()=>{this.installTask=undefined;});return this.installTask;
  }
  private async performInstall(receipt:Receipt,native:NativeUpdater):Promise<UpdateState> {
    try {
      const file=path.join(this.cache,'pending',receipt.file);
      await this.assertSafeFile(file);
      this.assertActive();
      const actual=await (this.options.hashFile||defaultHashFile)(file);this.assertActive();
      if(actual!==receipt.sha512)throw Object.assign(new Error('校验失败'),{code:'ERR_UPDATER_CHECKSUM_MISMATCH'});
      const installing:Receipt={...receipt,phase:'installing',at:this.now()};await this.saveReceipt(installing);this.assertActive();
      this.receipt=installing;
      this.installing=true;this.emit({status:'installing',message:'正在启动安装程序，请按安装向导完成更新'});
      this.assertActive();native.quitAndInstall(false,true);
    }catch(error){
      this.installing=false;
      if(this.disposed)return this.getState();
      if(verificationError(error)){this.receipt=undefined;await this.clearPending().catch(()=>{});this.emit({status:'error',errorCode:'verification',message:'安装包校验失败，已删除，请重新下载'});}
      else {this.receipt=receipt;await this.saveReceipt(receipt).catch(()=>{});if(!this.disposed){native.resetAfterInstallError?.();this.emit({status:'downloaded',errorCode:'install',message:'无法启动安装程序，请重试安装'});}}
    }
    return this.getState();
  }
  dispose() {this.disposed=true;this.lifecycle.abort();this.releaseController?.abort();clearTimeout(this.timer);clearTimeout(this.cleanupRetry);clearInterval(this.periodic);this.token?.cancel();for(const {event,listener} of this.listeners)this.native?.removeListener(event,listener);}

  private async prepareCache() {
    await this.io.mkdir(this.options.userDataDirectory,{recursive:true});
    const base=await this.io.realpath(this.options.userDataDirectory);
    await this.io.mkdir(this.cache,{recursive:true});
    const stat=await this.io.lstat(this.cache);
    if(!stat.isDirectory()||stat.isSymbolicLink()||path.relative(base,await this.io.realpath(this.cache))!==UPDATE_CACHE_NAME)throw new Error('更新缓存位置无效');
    const pending=path.join(this.cache,'pending');
    try {const st=await this.io.lstat(pending);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('更新缓存位置无效');}catch(error){if(errorCode(error)!=='ENOENT')throw error;}
  }
  private isExpectedFile(file:string,name:string):boolean {return path.resolve(file)===path.join(this.cache,'pending',name);}
  private async assertSafeFile(file:string) {
    await this.prepareCache();
    const st=await this.io.lstat(file);
    const pending=path.join(this.cache,'pending');
    // A userData parent can legitimately be redirected to another drive. Only
    // the cache and pending nodes must be real directories, and the resolved
    // file must remain directly inside the resolved pending directory.
    if(!st.isFile()||st.isSymbolicLink()||path.dirname(file)!==pending||path.resolve(await this.io.realpath(file))!==path.join(await this.io.realpath(pending),path.basename(file)))throw Object.assign(new Error('更新包位置无效'),{code:'ERR_UPDATER_INVALID_UPDATE_INFO'});
  }
  private saveReceipt(receipt:Receipt=this.receipt!):Promise<void> {
    const snapshot={...receipt};
    const task=this.receiptTask.catch(()=>{}).then(()=>this.persistReceipt(snapshot));this.receiptTask=task;return task;
  }
  private async persistReceipt(receipt:Receipt) {
    this.assertActive();
    const file=path.join(this.cache,RECEIPT),temporary=file+'.next';
    try{const stat=await this.io.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('更新缓存位置无效');}catch(error){if(errorCode(error)!=='ENOENT')throw error;}
    this.assertActive();
    try{
      try{const stat=await this.io.lstat(temporary);if(!stat.isFile()||stat.isSymbolicLink())throw new Error('更新缓存位置无效');}catch(error){if(errorCode(error)!=='ENOENT')throw error;}
      this.assertActive();await this.io.writeFile(temporary,JSON.stringify(receipt),{encoding:'utf8',signal:this.lifecycle.signal});
      this.assertActive();await this.io.rename(temporary,file);this.assertActive();
    }finally{await this.io.unlink(temporary).catch(error=>{if(errorCode(error)!=='ENOENT')throw error;});}
  }
  private async readReceipt():Promise<Receipt|undefined> {
    try {
      const file=path.join(this.cache,RECEIPT),stat=await this.io.lstat(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>4096)return undefined;
      const value=JSON.parse(await this.io.readFile(file,'utf8')) as Receipt;
      if(!stableVersion(value.version)||stableVersion(value.version)!==value.version||value.file!==installerName(value.version)||!isHash(value.sha512)||!['downloaded','installing'].includes(value.phase)||!Number.isFinite(value.at)||(value.isAdminRightsRequired!==undefined&&typeof value.isAdminRightsRequired!=='boolean'))return undefined;
      return value;
    }catch{return undefined;}
  }
  private async filesIn(directory:string):Promise<{file:string;size:number;mtime:number}[]> {
    const files:{file:string;size:number;mtime:number}[]=[];
    let entries;try{entries=await this.io.readdir(directory,{withFileTypes:true});}catch(error){if(errorCode(error)==='ENOENT')return files;throw error;}
    for(const entry of entries){
      const file=path.join(directory,entry.name),stat=await this.io.lstat(file);
      if(stat.isSymbolicLink())throw new Error('更新缓存含有无效链接');
      if(stat.isFile())files.push({file,size:stat.size,mtime:stat.mtimeMs});
      else if(stat.isDirectory()&&directory===this.cache&&entry.name==='pending')files.push(...await this.filesIn(file));
      else throw new Error('更新缓存含有无效目录');
    }
    return files;
  }
  private async clearPending() {
    await this.prepareCache();
    if(this.installing)return;
    const previous=await this.readReceipt();
    if(previous?.phase==='installing'&&await (this.options.installerBusy||defaultInstallerBusy)(previous.file))return;
    const pending=path.join(this.cache,'pending');
    const files=await this.filesIn(pending);
    for(const item of files)await this.io.unlink(item.file);
    await this.io.unlink(path.join(this.cache,RECEIPT)).catch(error=>{if(errorCode(error)!=='ENOENT')throw error;});
  }
  /** Only this app's validated cache is traversed. Pending or active installers
   * are exempt from age/size eviction; unknown process state always preserves. */
  async cleanup():Promise<void> {
    if(this.disposed||this.downloadTask||this.installTask||this.installing)return;
    await this.prepareCache();
    if(this.disposed)return;
    const receipt=this.receipt||await this.readReceipt();
    if(this.disposed)return;
    const files=await this.filesIn(this.cache);
    if(this.disposed)return;
    let protectPending=Boolean(receipt&&compareUpdateVersions(receipt.version,this.options.currentVersion)>0);
    let busy=false;
    if(receipt?.phase==='installing'){
      busy=await (this.options.installerBusy||defaultInstallerBusy)(receipt.file);
      if(this.disposed)return;
      if(busy){protectPending=true;this.scheduleCleanupRetry();}
    }
    if(!busy){clearTimeout(this.cleanupRetry);this.cleanupRetry=undefined;}
    // A newer downloaded package is deliberately retained for the next launch.
    // Once the new version runs and no installer remains, all old artifacts go.
    const installed=Boolean(receipt&&compareUpdateVersions(this.options.currentVersion,receipt.version)>=0&&!protectPending);
    const protectedFiles=new Set(receipt?[path.join(this.cache,'pending',receipt.file),path.join(this.cache,'pending','update-info.json'),path.join(this.cache,RECEIPT)]:[]);
    const candidates=files.filter(item=>!(protectPending&&protectedFiles.has(item.file)));
    let total=files.reduce((sum,item)=>sum+item.size,0);
    for(const item of candidates.sort((a,b)=>a.mtime-b.mtime)){
      if(this.disposed)return;
      if(installed||this.now()-item.mtime>7*DAY||total>MAX_CACHE_BYTES){
        if(/\.(exe|tmp)$/i.test(item.file)&&await (this.options.installerBusy||defaultInstallerBusy)(path.basename(item.file)))continue;
        if(this.disposed)return;
        await this.io.unlink(item.file);total-=item.size;
        if(item.file===path.join(this.cache,RECEIPT))this.receipt=undefined;
      }
    }
  }
  private scheduleCleanupRetry(){
    if(this.disposed||this.cleanupRetry)return;
    this.cleanupRetry=setTimeout(()=>{
      this.cleanupRetry=undefined;
      void this.cleanup().then(async()=>{if(!this.disposed&&this.native&&this.state.errorCode==='install'&&!this.checkTask&&!this.installTask&&!this.installing&&!this.downloadTask)await this.restorePendingDownload();}).catch(()=>{});
    },this.options.cleanupRetryDelayMs??60_000);this.cleanupRetry.unref?.();
  }
}
function validDate(value:unknown):string|undefined {return typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;}
