import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {UpdaterService,type NativeUpdater} from '../electron/updater';

const require=createRequire(import.meta.url);
const {prepareUpdate}=require('../scripts/prepare-update.cjs');
const {load}=require('js-yaml');

test('locally generated update metadata is accepted and its complete installer is verified by the update service',async()=>{
  const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const taskRoot=path.join(project,'.test-data');await fs.mkdir(taskRoot,{recursive:true});
  const directory=await fs.mkdtemp(path.join(taskRoot,'manifest-integration-'));
  try{
    const payload=Buffer.alloc(1_000_001,0x53),filename='SeekDesk-Windows-0.1.0-x64-Setup.exe';
    await fs.writeFile(path.join(directory,filename),payload);
    await prepareUpdate(directory);
    const metadata=load(await fs.readFile(path.join(directory,'latest.yml'),'utf8'));
    assert.equal(metadata.version,'0.1.0');assert.equal(metadata.files.length,1);
    assert.equal(metadata.files[0].sha512,createHash('sha512').update(payload).digest('base64'));
    const emitter=new EventEmitter(),userData=path.join(directory,'profile');let downloads=0;
    const native=Object.assign(emitter,{setFeedURL(){},checkForUpdates:async()=>({updateInfo:metadata,isUpdateAvailable:true}),downloadUpdate:async()=>{downloads++;const destination=path.join(userData,'updater-cache-v1','pending',filename);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,payload);return [destination];},quitAndInstall(){throw Error('This test must never install');}}) as unknown as NativeUpdater;
    const service=new UpdaterService({currentVersion:'0.0.9',isPackaged:true,isInstalled:true,userDataDirectory:userData,nativeFactory:()=>native,automaticCheckDelayMs:3_600_000});
    try{assert.equal((await service.check()).status,'available');assert.equal((await service.download()).status,'downloaded');assert.equal(downloads,1);}finally{service.dispose();}
  }finally{
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(taskRoot));
    await fs.rm(directory,{recursive:true,force:true});
  }
});
