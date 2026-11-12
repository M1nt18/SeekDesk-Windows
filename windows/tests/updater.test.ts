import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {UpdaterService,UPDATE_CACHE_NAME,UPDATE_RELEASE_API,UPDATE_REPOSITORY,compareUpdateVersions,createIsolatedNativeUpdater,type NativeUpdater,type UpdaterOptions,type VerifiedDownload} from '../electron/updater';

const payload=Buffer.from('an inert test fixture, never an executable');
const hash=createHash('sha512').update(payload).digest('base64');
const fileName='SeekDesk-Windows-0.2.0-x64-Setup.exe';
const info={version:'0.2.0',files:[{url:fileName,sha512:hash,size:payload.length}]};
class FakeNative extends EventEmitter implements NativeUpdater {
  autoDownload=true;autoInstallOnAppQuit=true;allowPrerelease=true;allowDowngrade=true;
  disableWebInstaller=false;disableDifferentialDownload=false;logger:unknown;requestHeaders:unknown;
  feed:unknown;checks=0;downloads=0;installCalls:unknown[][]=[];resetCalls=0;
  restoredDownloads:VerifiedDownload[]=[];
  result=info;isUpdateAvailable=true;failure:Error|undefined;
  downloadAction:((token:{cancel():void;readonly cancelled:boolean})=>Promise<string[]>)|undefined;
  constructor(readonly cache:string){super();}
  setFeedURL(value:unknown){this.feed=value;}
  async checkForUpdates(){this.checks++;if(this.failure)throw this.failure;return {updateInfo:this.result,isUpdateAvailable:this.isUpdateAvailable};}
  async downloadUpdate(token:{cancel():void;readonly cancelled:boolean}){
    this.downloads++;
    if(this.downloadAction)return this.downloadAction(token);
    const file=path.join(this.cache,'pending',fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,payload);
    this.emit('download-progress',{percent:48,bytesPerSecond:2048,transferred:12,total:25});
    return [file];
  }
  quitAndInstall(...args:unknown[]){this.installCalls.push(args);}
  async restoreVerifiedDownload(download:VerifiedDownload){this.restoredDownloads.push(download);}
  resetAfterInstallError(){this.resetCalls++;}
}
async function fixture(overrides:Partial<UpdaterOptions>={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-updater-'));
  let native:FakeNative|undefined;
  const service=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:directory,automaticCheckDelayMs:60_000,installerBusy:async()=>false,nativeFactory:cache=>native=new FakeNative(cache),...overrides});
  await service.initialize();
  return {directory,service,native:native!,cache:path.join(directory,UPDATE_CACHE_NAME),async close(){service.dispose();await fs.rm(directory,{recursive:true,force:true});}};
}
function missing(){return Object.assign(new Error('sensitive native error C:\\private\\token'),{code:'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'});}
function response(version='v0.2.0',extra:Record<string,unknown>={}) {return {ok:true,status:200,async json(){return {tag_name:version,draft:false,prerelease:false,published_at:'2026-11-11T12:00:00Z',...extra};}};}
function deferred<T=void>() {let resolve!:(value:T|PromiseLike<T>)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}

test('stable semantic versions compare numerically and reject prerelease or malformed tags',()=>{
  assert.equal(compareUpdateVersions('0.10.0','0.2.0'),1);
  assert.equal(compareUpdateVersions('v0.2.0','0.2.0'),0);
  for(const invalid of ['1.0.0-beta','1.02.0','1.0','../1.0.0'])assert.throws(()=>compareUpdateVersions(invalid,'0.1.0'));
});

test('native updater uses the public stable repository and requires explicit download and installation',async()=>{
  const f=await fixture();try {
    assert.deepEqual(f.native.feed,{provider:'github',owner:'M1nt18',repo:'SeekDesk-Windows',private:false,releaseType:'release'});
    assert.equal(f.native.autoDownload,false);assert.equal(f.native.autoInstallOnAppQuit,false);
    assert.equal(f.native.allowPrerelease,false);assert.equal(f.native.allowDowngrade,false);
    assert.equal(f.native.disableWebInstaller,true);assert.equal(f.native.disableDifferentialDownload,true);
    assert.equal(f.native.logger,null);assert.equal(f.native.requestHeaders,null);
    const checked=await f.service.check();assert.equal(checked.status,'available');assert.equal(checked.installable,true);assert.equal(checked.canDownload,true);
    assert.equal(f.native.downloads,0);assert.equal(f.native.installCalls.length,0);
  }finally{await f.close();}
});

test('missing latest.yml falls back to the official API and exposes only a manual release page',async()=>{
  const requests:string[]=[];
  const f=await fixture({fetchRelease:async(url)=>{requests.push(url);return response('v0.2.0',{html_url:'https://evil.invalid',assets:[{browser_download_url:'https://evil.invalid/setup.exe'}]});}});
  try{
    f.native.failure=missing();const state=await f.service.check();
    assert.equal(state.status,'available');assert.equal(state.manualOnly,true);assert.equal(state.installable,false);assert.equal(state.errorCode,'manifest-missing');
    assert.equal(state.releaseUrl,UPDATE_REPOSITORY+'/releases/tag/v0.2.0');assert.deepEqual(requests,[UPDATE_RELEASE_API]);
    await f.service.download();await f.service.install();assert.equal(f.native.downloads,0);assert.equal(f.native.installCalls.length,0);
  }finally{await f.close();}
});

test('API 404, prereleases and malformed responses never claim the installed version is latest',async()=>{
  for(const api of [{ok:false,status:404,json:async()=>({})},response('v0.2.0',{prerelease:true}),response('garbage'),response('v0.2.0',{draft:true})]){
    const f=await fixture({fetchRelease:async()=>api});try{f.native.failure=missing();assert.equal((await f.service.check()).status,'error');}finally{await f.close();}
  }
  const f=await fixture({fetchRelease:async()=>response('v0.1.0')});try{f.native.failure=missing();const state=await f.service.check();assert.equal(state.status,'up-to-date');assert.equal(state.manualOnly,true);}finally{await f.close();}
});

test('a failed native network request is sanitized and does not silently switch sources',async()=>{
  let requested=false;const f=await fixture({fetchRelease:async()=>{requested=true;return response();}});
  try{f.native.failure=new Error('Authorization: token secret-token C:\\private\\Alice');const state=await f.service.check();assert.equal(state.status,'error');assert.equal(state.errorCode,'network');assert.equal(requested,false);assert.ok(!JSON.stringify(state).includes('secret-token'));assert.ok(!JSON.stringify(state).includes('Alice'));}finally{await f.close();}
});

test('portable and development builds never construct an installer or download executables',async()=>{
  for(const flags of [{isPackaged:true,isInstalled:false},{isPackaged:false,isInstalled:true}]){
    let constructed=false;const f=await fixture({...flags,nativeFactory:()=>{constructed=true;throw new Error('must not construct');},fetchRelease:async()=>response()});
    try{assert.equal(f.service.getState().status,'unsupported');const checked=await f.service.check();assert.equal(checked.installable,false);assert.equal(checked.manualOnly,true);await f.service.download();await f.service.install();assert.equal(constructed,false);}finally{await f.close();}
  }
});

test('metadata must contain a canonical SHA-512 and exactly the expected full installer filename',async()=>{
  for(const altered of [{url:'https://evil.invalid/setup.exe',sha512:hash},{url:'../'+fileName,sha512:hash},{url:fileName,sha512:'not-a-hash'},{url:'other.exe',sha512:hash}]){
    const f=await fixture();try{f.native.result={...info,files:[{...altered,size:1}]};const state=await f.service.check();assert.equal(state.status,'error');assert.equal(state.errorCode,'verification');await f.service.download();assert.equal(f.native.downloads,0);}finally{await f.close();}
  }
});

test('a newer version declined by the native OS or rollout check is never offered for installation',async()=>{
  const f=await fixture();try{f.native.isUpdateAvailable=false;const state=await f.service.check();assert.equal(state.status,'unsupported');assert.equal(state.installable,false);await f.service.download();assert.equal(f.native.downloads,0);}finally{await f.close();}
});

test('download reports progress, hashes the package, and only explicit install runs the visible installer',async()=>{
  const progress:number[]=[];const f=await fixture({onChange:state=>{if(state.progress)progress.push(state.progress.percent);}});
  try{
    await f.service.check();assert.equal((await f.service.download()).status,'downloaded');assert.ok(progress.includes(48));assert.equal(f.native.installCalls.length,0);
    const receipt=JSON.parse(await fs.readFile(path.join(f.cache,'seekdesk-update.json'),'utf8'));assert.equal(receipt.sha512,hash);assert.equal(receipt.phase,'downloaded');
    assert.equal((await f.service.install()).status,'installing');assert.deepEqual(f.native.installCalls,[[false,true]]);
    await f.service.install();assert.equal(f.native.installCalls.length,1);
    await f.service.cleanup();assert.deepEqual(await fs.readFile(path.join(f.cache,'pending',fileName)),payload);
  }finally{await f.close();}
});

test('hash mismatch removes partial artifacts and can be retried without a real network or installer',async()=>{
  const f=await fixture();try{
    await f.service.check();f.native.downloadAction=async()=>{const file=path.join(f.cache,'pending',fileName);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'wrong content');return [file];};
    const failed=await f.service.download();assert.equal(failed.status,'error');assert.equal(failed.errorCode,'verification');assert.equal(failed.canDownload,true);assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);
    f.native.downloadAction=undefined;assert.equal((await f.service.download()).status,'downloaded');
  }finally{await f.close();}
});

test('cancellation waits for the writer to settle before deleting temporary files',async()=>{
  const f=await fixture();try{
    await f.service.check();let release!:()=>void;let started!:()=>void;
    const written=new Promise<void>(resolve=>started=resolve),gate=new Promise<void>(resolve=>release=resolve);
    const file=path.join(f.cache,'pending','temp-setup.exe');
    f.native.downloadAction=async()=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,payload);started();await gate;throw new Error('cancelled native download');};
    const download=f.service.download();await written;f.service.cancel();await f.service.cleanup();assert.ok(await fs.stat(file));release();
    const cancelled=await download;assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.canDownload,true);assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);
  }finally{await f.close();}
});

test('tampering after download is detected again before installation',async()=>{
  const f=await fixture();try{
    await f.service.check();await f.service.download();await fs.writeFile(path.join(f.cache,'pending',fileName),'tampered');
    const state=await f.service.install();assert.equal(state.status,'error');assert.equal(state.errorCode,'verification');assert.equal(f.native.installCalls.length,0);assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);
  }finally{await f.close();}
});

test('asynchronous native install failure preserves a verified package for an explicit retry',async()=>{
  const f=await fixture();try{
    await f.service.check();await f.service.download();await f.service.install();f.native.emit('error',new Error('spawn failed C:\\private'));
    assert.equal(f.service.getState().status,'downloaded');assert.equal(f.service.getState().errorCode,'install');await f.service.install();assert.equal(f.native.installCalls.length,2);assert.equal(f.native.resetCalls,1);
  }finally{await f.close();}
});

test('cleanup retains the pending package while evicting aged and oversized cache files only',async()=>{
  const now=Date.now();const f=await fixture({now:()=>now});try{
    const outside=path.join(f.directory,'account-drafts.json');await fs.writeFile(outside,'keep private data');await f.service.check();await f.service.download();
    const old=path.join(f.cache,'pending','old-update.exe');await fs.writeFile(old,'old');await fs.utimes(old,new Date(now-8*86_400_000),new Date(now-8*86_400_000));
    const large=path.join(f.cache,'old-installer.exe');const handle=await fs.open(large,'w');await handle.truncate(513*1024*1024);await handle.close();
    await f.service.cleanup();assert.deepEqual(await fs.readFile(path.join(f.cache,'pending',fileName)),payload);assert.equal(await fs.readFile(outside,'utf8'),'keep private data');await assert.rejects(fs.stat(old));await assert.rejects(fs.stat(large));
  }finally{await f.close();}
});

test('next startup removes completed update artifacts but never an installer still in use',async()=>{
  const f=await fixture();try{
    await f.service.check();await f.service.download();await f.service.install();f.service.dispose();
    let busy=true;const options={currentVersion:'0.2.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,automaticCheckDelayMs:60_000,installerBusy:async()=>busy,nativeFactory:(cache:string)=>new FakeNative(cache)};
    const restarted=new UpdaterService(options);await restarted.initialize();assert.ok(await fs.stat(path.join(f.cache,'pending',fileName)));busy=false;await restarted.cleanup();assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);restarted.dispose();
  }finally{await f.close();}
});

test('a previous installer blocks replacing its package until its process has ended',async()=>{
  let busy=false;const f=await fixture({installerBusy:async()=>busy});try{
    await f.service.check();await f.service.download();await f.service.install();f.service.dispose();busy=true;
    let native:FakeNative|undefined;const restarted=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,installerBusy:async()=>busy,automaticCheckDelayMs:60_000,nativeFactory:cache=>native=new FakeNative(cache)});await restarted.initialize();await restarted.check();assert.equal((await restarted.download()).errorCode,'install');assert.equal(native!.downloads,0);assert.deepEqual(await fs.readFile(path.join(f.cache,'pending',fileName)),payload);restarted.dispose();
  }finally{await f.close();}
});

test('cache junctions are rejected before a native download and outside files remain untouched',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-updater-link-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-private-'));
  let constructed=false;const service=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:directory,nativeFactory:()=>{constructed=true;throw new Error('must not construct');}});
  try{
    await fs.writeFile(path.join(outside,'keep.txt'),'keep');await fs.symlink(outside,path.join(directory,UPDATE_CACHE_NAME),process.platform==='win32'?'junction':'dir');
    await assert.rejects(service.initialize());assert.equal(constructed,false);assert.equal(await fs.readFile(path.join(outside,'keep.txt'),'utf8'),'keep');
  }finally{service.dispose();await fs.rm(directory,{recursive:true,force:true});await fs.rm(outside,{recursive:true,force:true});}
});

test('a legitimate redirected userData parent supports downloads without permitting cache junctions',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-userdata-link-'));
  const actual=path.join(directory,'storage'),redirected=path.join(directory,'redirected');
  await fs.mkdir(actual);await fs.symlink(actual,redirected,process.platform==='win32'?'junction':'dir');
  const service=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:redirected,automaticCheckDelayMs:60_000,installerBusy:async()=>false,nativeFactory:cache=>new FakeNative(cache)});
  try{await service.initialize();await service.check();assert.equal((await service.download()).status,'downloaded');assert.equal((await service.install()).status,'installing');}finally{service.dispose();await fs.rm(directory,{recursive:true,force:true});}
});

test('startup checks automatically without downloading or installing',async()=>{
  let checked!:()=>void;const complete=new Promise<void>(resolve=>checked=resolve);
  const f=await fixture({automaticCheckDelayMs:1,onChange:state=>{if(state.status==='available')checked();}});
  try{await complete;assert.equal(f.native.checks,1);assert.equal(f.native.downloads,0);assert.equal(f.native.installCalls.length,0);}finally{await f.close();}
});

test('disposing the service never installs on quit or accepts later install requests',async()=>{
  const f=await fixture();try{await f.service.check();await f.service.download();f.service.dispose();await f.service.install();await f.service.check();assert.equal(f.native.installCalls.length,0);assert.equal(f.native.autoInstallOnAppQuit,false);assert.equal(f.native.checks,1);}finally{await f.close();}
});

test('restart restores the real electron-updater helper before exposing a cached package as installable',async()=>{
  const f=await fixture();let restarted:UpdaterService|undefined;
  try{
    await f.service.check();await f.service.download();f.service.dispose();
    let native:NativeUpdater|undefined,quits=0;
    const adapter={version:'0.1.0',name:'SeekDesk Windows',isPackaged:true,appUpdateConfigPath:path.join(f.directory,'unused.yml'),userDataPath:f.directory,baseCachePath:f.directory,whenReady:async()=>{},relaunch(){throw new Error('No relaunch allowed');},quit(){quits++;},onQuit(){throw new Error('No automatic quit handler allowed');}};
    restarted=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,automaticCheckDelayMs:60_000,installerBusy:async()=>false,nativeFactory:cache=>{
      native=createIsolatedNativeUpdater(cache,adapter);
      assert.equal((native as any).downloadedUpdateHelper.file,null);
      assert.equal((native as any).downloadedUpdateHelper.downloadedFileInfo,null);
      native.checkForUpdates=async()=>{throw new Error('No network check allowed');};
      native.downloadUpdate=async()=>{throw new Error('No network download allowed');};
      return native;
    }});
    await restarted.initialize();assert.equal(restarted.getState().status,'downloaded');assert.equal(restarted.getState().canDownload,false);
    const helper=(native as any).downloadedUpdateHelper;
    assert.equal(helper.file,path.join(f.cache,'pending',fileName));assert.equal((native as any).installerPath,helper.file);
    assert.deepEqual(helper.downloadedFileInfo,{fileName,sha512:hash,isAdminRightsRequired:false});
    assert.equal(helper.versionInfo.version,'0.2.0');assert.equal(helper.fileInfo.info.sha512,hash);assert.equal(helper.packageFile,null);
    assert.equal((await restarted.check()).status,'downloaded');assert.equal(quits,0);
    // Never invoke quitAndInstall or BaseUpdater.install: this regression checks
    // the actual helper/getter preconditions without executing an installer.
  }finally{restarted?.dispose();await f.close();}
});

test('a cancelled installer is restored to downloaded on the next startup of the old version',async()=>{
  const f=await fixture();let restarted:UpdaterService|undefined;try{
    await f.service.check();await f.service.download();await f.service.install();f.service.dispose();
    let native:FakeNative|undefined;restarted=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,automaticCheckDelayMs:60_000,installerBusy:async()=>false,nativeFactory:cache=>native=new FakeNative(cache)});
    await restarted.initialize();assert.equal(restarted.getState().status,'downloaded');assert.equal(native!.restoredDownloads.length,1);
    assert.equal(JSON.parse(await fs.readFile(path.join(f.cache,'seekdesk-update.json'),'utf8')).phase,'downloaded');
    await restarted.install();assert.deepEqual(native!.installCalls,[[false,true]]);
  }finally{restarted?.dispose();await f.close();}
});

test('a tampered cached installer is removed before startup restoration reaches the native adapter',async()=>{
  const f=await fixture();let restarted:UpdaterService|undefined;try{
    await f.service.check();await f.service.download();f.service.dispose();await fs.writeFile(path.join(f.cache,'pending',fileName),'tampered');
    let native:FakeNative|undefined;restarted=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,automaticCheckDelayMs:60_000,installerBusy:async()=>false,nativeFactory:cache=>native=new FakeNative(cache)});
    await restarted.initialize();assert.equal(restarted.getState().errorCode,'verification');assert.equal(native!.restoredDownloads.length,0);assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);
    assert.equal((await restarted.download()).status,'downloaded');assert.equal(native!.checks,1);
  }finally{restarted?.dispose();await f.close();}
});

test('completed updates retry cache cleanup promptly after the NSIS finish window closes',async()=>{
  const f=await fixture();let restarted:UpdaterService|undefined;try{
    await f.service.check();await f.service.download();await f.service.install();f.service.dispose();
    let busy=true;restarted=new UpdaterService({currentVersion:'0.2.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,automaticCheckDelayMs:60_000,cleanupRetryDelayMs:10,installerBusy:async()=>busy,nativeFactory:cache=>new FakeNative(cache)});
    await restarted.initialize();assert.ok(await fs.stat(path.join(f.cache,'pending',fileName)));busy=false;
    for(let i=0;i<50;i++){if(!(await fs.readdir(path.join(f.cache,'pending'))).length)break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);await assert.rejects(fs.stat(path.join(f.cache,'seekdesk-update.json')));
  }finally{restarted?.dispose();await f.close();}
});

test('disposing the new version cancels its delayed cleanup retry and preserves the active installer',async()=>{
  const f=await fixture();let restarted:UpdaterService|undefined;try{
    await f.service.check();await f.service.download();await f.service.install();f.service.dispose();
    let busy=true;restarted=new UpdaterService({currentVersion:'0.2.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,automaticCheckDelayMs:60_000,cleanupRetryDelayMs:10,installerBusy:async()=>busy,nativeFactory:cache=>new FakeNative(cache)});
    await restarted.initialize();restarted.dispose();busy=false;await new Promise(resolve=>setTimeout(resolve,30));assert.ok(await fs.stat(path.join(f.cache,'pending',fileName)));
  }finally{restarted?.dispose();await f.close();}
});

test('disposing during an in-flight native check suppresses success and missing-manifest fallback',async()=>{
  for(const missingManifest of [false,true]){
    let fallback=0;const changes:string[]=[];const entered=deferred(),gate=deferred();
    const f=await fixture({onChange:state=>changes.push(state.status),fetchRelease:async()=>{fallback++;return response();}});
    try{
      f.native.checkForUpdates=async()=>{entered.resolve();await gate.promise;if(missingManifest)throw missing();return {updateInfo:info,isUpdateAvailable:true};};
      const task=f.service.check();await entered.promise;f.service.dispose();const before=changes.length;gate.resolve();await task;
      assert.equal(changes.length,before);assert.equal(fallback,0);assert.equal((f.service as any).info,undefined);
    }finally{await f.close();}
  }
});

test('disposing aborts an already-started fallback request and ignores its late response',async()=>{
  const entered=deferred(),gate=deferred();let signal:AbortSignal|undefined;const changes:string[]=[];
  const f=await fixture({onChange:state=>changes.push(state.status),fetchRelease:async(_url,currentSignal)=>{signal=currentSignal;entered.resolve();await gate.promise;return response();}});
  try{f.native.failure=missing();const task=f.service.check();await entered.promise;f.service.dispose();const before=changes.length;assert.equal(signal!.aborted,true);gate.resolve();await task;assert.equal(changes.length,before);}finally{await f.close();}
});

test('disposing during download preparation prevents the native download from starting',async()=>{
  const entered=deferred(),gate=deferred();let pause=false;
  const io={...fs,realpath:async(...args:any[])=>{if(pause){pause=false;entered.resolve();await gate.promise;}return (fs.realpath as any)(...args);}};
  const f=await fixture({fileSystem:io as any});try{
    await f.service.check();pause=true;const task=f.service.download();await entered.promise;f.service.dispose();gate.resolve();await task;assert.equal(f.native.downloads,0);await assert.rejects(fs.stat(path.join(f.cache,'seekdesk-update.json')));
  }finally{await f.close();}
});

test('disposing while hashing a download removes its files without recording a completed receipt',async()=>{
  const entered=deferred(),gate=deferred(),changes:string[]=[];
  const f=await fixture({hashFile:async()=>{entered.resolve();await gate.promise;return hash;},onChange:state=>changes.push(state.status)});
  try{await f.service.check();const task=f.service.download();await entered.promise;f.service.dispose();const before=changes.length;gate.resolve();await task;assert.equal(changes.length,before);assert.ok(!changes.includes('downloaded'));assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);await assert.rejects(fs.stat(path.join(f.cache,'seekdesk-update.json')));}finally{await f.close();}
});

test('disposing during receipt persistence cancels the write and leaves no successful download record',async()=>{
  const entered=deferred(),gate=deferred();let writeSignal:AbortSignal|undefined;
  const io={...fs,writeFile:async(...args:any[])=>{if(String(args[0]).endsWith('seekdesk-update.json.next')){writeSignal=args[2].signal;entered.resolve();await gate.promise;}return (fs.writeFile as any)(...args);}};
  const f=await fixture({fileSystem:io as any});try{
    await f.service.check();const task=f.service.download();await entered.promise;f.service.dispose();assert.equal(writeSignal!.aborted,true);gate.resolve();await task;
    await assert.rejects(fs.stat(path.join(f.cache,'seekdesk-update.json')));await assert.rejects(fs.stat(path.join(f.cache,'seekdesk-update.json.next')));assert.deepEqual(await fs.readdir(path.join(f.cache,'pending')),[]);
  }finally{await f.close();}
});

test('disposing during install validation preserves the package and never launches its installer',async()=>{
  const entered=deferred(),gate=deferred();let pause=false;
  const f=await fixture({hashFile:async()=>{if(pause){entered.resolve();await gate.promise;}return hash;}});try{
    await f.service.check();await f.service.download();pause=true;const task=f.service.install();await entered.promise;f.service.dispose();gate.resolve();await task;
    assert.equal(f.native.installCalls.length,0);assert.equal(JSON.parse(await fs.readFile(path.join(f.cache,'seekdesk-update.json'),'utf8')).phase,'downloaded');assert.ok(await fs.stat(path.join(f.cache,'pending',fileName)));
  }finally{await f.close();}
});

test('concurrent install requests reserve one validation task and launch the installer only once',async()=>{
  const entered=deferred(),gate=deferred();let pause=false,hashes=0;
  const f=await fixture({hashFile:async()=>{if(pause){hashes++;entered.resolve();await gate.promise;}return hash;}});try{
    await f.service.check();await f.service.download();pause=true;const first=f.service.install();await entered.promise;const second=f.service.install();gate.resolve();await Promise.all([first,second]);assert.equal(hashes,1);assert.equal(f.native.installCalls.length,1);
  }finally{await f.close();}
});

test('disposing during startup verification leaves the pending receipt intact and never restores native state',async()=>{
  const f=await fixture();let restarted:UpdaterService|undefined;try{
    await f.service.check();await f.service.download();f.service.dispose();const original=await fs.readFile(path.join(f.cache,'seekdesk-update.json'),'utf8');
    const entered=deferred(),gate=deferred();let native:FakeNative|undefined;const changes:string[]=[];
    restarted=new UpdaterService({currentVersion:'0.1.0',isPackaged:true,isInstalled:true,userDataDirectory:f.directory,hashFile:async()=>{entered.resolve();await gate.promise;return hash;},installerBusy:async()=>false,nativeFactory:cache=>native=new FakeNative(cache),onChange:state=>changes.push(state.status)});
    const task=restarted.initialize();await entered.promise;restarted.dispose();gate.resolve();await task;assert.equal(native!.restoredDownloads.length,0);assert.deepEqual(changes,[]);assert.equal(await fs.readFile(path.join(f.cache,'seekdesk-update.json'),'utf8'),original);
  }finally{restarted?.dispose();await f.close();}
});

test('a failed recheck never advertises download from a stale available version',async()=>{
  const f=await fixture();try{await f.service.check();assert.equal(f.service.getState().canDownload,true);f.native.failure=new Error('network unavailable');const state=await f.service.check();assert.equal(state.status,'error');assert.equal(state.version,'0.2.0');assert.equal(state.canDownload,false);}finally{await f.close();}
});
