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
