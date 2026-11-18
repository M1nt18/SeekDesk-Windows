import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {MediaService} from '../electron/media';

const encryption={isEncryptionAvailable:()=>true,encryptString:(value:string)=>Buffer.from('synthetic:'+value),decryptString:(value:Buffer)=>value.toString().replace(/^synthetic:/,'')};
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function fixture(run:(directory:string)=>Promise<void>){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-media-settings-'));try{await run(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
const read=(directory:string)=>fs.readFile(path.join(directory,'media.json'),'utf8').then(JSON.parse);
test('unreadable media config rejects writes while undecryptable keys survive unrelated changes',async()=>fixture(async directory=>{
  const target=path.join(directory,'media.json'),cipher='opaque-ciphertext',original=JSON.stringify({key:cipher,width:640,stickers:[]});
  await fs.writeFile(target,original);
  for(const protectedAvailable of [true,false]){
    const media=new MediaService(directory,()=>null,{encryption:{...encryption,isEncryptionAvailable:()=>protectedAvailable,decryptString:()=>{throw Error('synthetic decrypt failure');}}});await media.load();assert.match(media.settings().credentialError||'',/密文已保留/);
    await media.setSettings({defaultImageWidth:320});assert.equal((await read(directory)).key,cipher);await media.setSettings({clearKey:true});assert.equal((await read(directory)).key,undefined);await fs.writeFile(target,original);
  }
  await fs.writeFile(target,'{"key":');const media=new MediaService(directory,()=>null,{encryption});await media.load();assert.match(media.storageWarning||'',/原文件已保留/);await assert.rejects(media.setSettings({defaultImageWidth:800}),/无法读取/);assert.equal(await fs.readFile(target,'utf8'),'{"key":');
}));
test('anonymous image redirects validate every destination and never send cookies or follow private URLs',async()=>fixture(async directory=>{
  const png=await sharp({create:{width:3,height:4,channels:3,background:'#123456'}}).png().toBuffer();let calls:string[]=[];
  const media=new MediaService(directory,()=>null,{encryption,fetchImage:async(input,options)=>{calls.push(String(input));assert.equal(options?.credentials,'omit');assert.equal(options?.redirect,'manual');return calls.length===1?new Response(null,{status:302,headers:{Location:'https://93.184.215.14/final.png'}}):new Response(png,{headers:{'content-type':'image/png'}});}});
  const image=await media.readerImage('https://93.184.215.14/original.png',1200);assert.equal(image.width,3);assert.equal(calls.length,2);
  for(const target of ['http://93.184.215.14/image.png','https://127.0.0.1/private','https://user:pass@93.184.215.14/image.png']){
    calls=[];const blocked=new MediaService(directory,()=>null,{encryption,fetchImage:async(input)=>{calls.push(String(input));return new Response(null,{status:302,headers:{Location:target}});}});await assert.rejects(blocked.readerImage('https://93.184.215.14/original.png',1200));assert.equal(calls.length,1);
  }
}));

test('a failed media settings replacement preserves the committed width and encrypted key',async()=>fixture(async directory=>{
  let fail=false;
  const persistence={...fs,rename:async(from:Parameters<typeof fs.rename>[0],to:Parameters<typeof fs.rename>[1])=>{if(fail)throw Error('synthetic rename failure');await fs.rename(from,to);}};
  const media=new MediaService(directory,()=>null,{persistence,encryption});
  await media.setSettings({defaultImageWidth:640,apiKey:'committed-test-key'});const committed=await read(directory);
  fail=true;await assert.rejects(media.setSettings({defaultImageWidth:320,clearKey:true}),/synthetic rename failure/);
  assert.deepEqual(media.settings(),{hasApiKey:true,defaultImageWidth:640});assert.deepEqual(await read(directory),committed);
  await assert.rejects(media.setSettings({defaultImageWidth:800,apiKey:'rejected-test-key'}),/synthetic rename failure/);
  assert.deepEqual(media.settings(),{hasApiKey:true,defaultImageWidth:640});
  fail=false;await media.setSettings({});assert.deepEqual(await read(directory),committed,'A later save cannot commit a previously rejected candidate');
  const restarted=new MediaService(directory,()=>null,{encryption});await restarted.load();assert.deepEqual(restarted.settings(),media.settings());
}));

test('concurrent media patches observe committed predecessors and remain invisible until saved',async()=>fixture(async directory=>{
  let hold=false;const entered=deferred(),release=deferred();
  const persistence={...fs,rename:async(from:Parameters<typeof fs.rename>[0],to:Parameters<typeof fs.rename>[1])=>{if(hold){hold=false;entered.resolve();await release.promise;}await fs.rename(from,to);}};
  const media=new MediaService(directory,()=>null,{persistence,encryption});await media.setSettings({defaultImageWidth:640});
  hold=true;const first=media.setSettings({defaultImageWidth:320});await entered.promise;
  assert.deepEqual(media.settings(),{hasApiKey:false,defaultImageWidth:640});
  const second=media.setSettings({apiKey:'later-test-key'});release.resolve();
  assert.deepEqual(await first,{hasApiKey:false,defaultImageWidth:320});assert.deepEqual(await second,{hasApiKey:true,defaultImageWidth:320});
  const saved=await read(directory);assert.equal(saved.width,320);assert.equal(encryption.decryptString(Buffer.from(saved.key,'base64')),'later-test-key');
}));

test('a queued media patch follows the committed state after its predecessor fails',async()=>fixture(async directory=>{
  let fail=false;const entered=deferred(),release=deferred();
  const persistence={...fs,rename:async(from:Parameters<typeof fs.rename>[0],to:Parameters<typeof fs.rename>[1])=>{if(fail){fail=false;entered.resolve();await release.promise;throw Error('synthetic queued failure');}await fs.rename(from,to);}};
  const media=new MediaService(directory,()=>null,{persistence,encryption});await media.setSettings({defaultImageWidth:640});
  fail=true;const first=assert.rejects(media.setSettings({defaultImageWidth:320}),/synthetic queued failure/);await entered.promise;
  const second=media.setSettings({apiKey:'accepted-test-key'});release.resolve();await first;await second;
  assert.deepEqual(media.settings(),{hasApiKey:true,defaultImageWidth:640});assert.equal((await read(directory)).width,640);
}));

test('failed sticker imports clean their files and failed removals preserve the committed sticker',async()=>fixture(async directory=>{
  const source=path.join(directory,'fixture.png');await sharp({create:{width:2,height:2,channels:4,background:'#123456'}}).png().toFile(source);
  let fail=false;
  const persistence={...fs,rename:async(from:Parameters<typeof fs.rename>[0],to:Parameters<typeof fs.rename>[1])=>{if(fail)throw Error('synthetic sticker failure');await fs.rename(from,to);}};
  const dialogs={showOpenDialog:async()=>({canceled:false,filePaths:[source]})};
  const media=new MediaService(directory,()=>null,{persistence,encryption,dialogs});await media.setSettings({defaultImageWidth:640});
  fail=true;await assert.rejects(media.importStickers('Fixture'),/synthetic sticker failure/);
  assert.deepEqual((await media.getStickers()).filter(row=>!row.official),[]);assert.deepEqual(await fs.readdir(path.join(directory,'stickers')),[]);assert.deepEqual((await read(directory)).stickers,[]);
  fail=false;const imported=(await media.importStickers('Fixture')).find(row=>!row.official)!;assert.ok(imported);
  const committed=await read(directory),stored=path.join(directory,'stickers',committed.stickers[0].file);
  fail=true;await assert.rejects(media.removeSticker(imported.id),/synthetic sticker failure/);
  assert.equal((await media.getStickers()).some(row=>row.id===imported.id),true);await fs.access(stored);assert.deepEqual(await read(directory),committed);
  fail=false;await media.setSettings({});assert.deepEqual(await read(directory),committed);await media.removeSticker(imported.id);
  assert.deepEqual((await read(directory)).stickers,[]);await assert.rejects(fs.access(stored));
}));
