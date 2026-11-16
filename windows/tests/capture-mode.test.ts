import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JSDOM} from 'jsdom';
import {prepareCaptureMode,captureModeImage} from '../electron/capture-mode';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function temporary(run:(directory:string)=>Promise<void>){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-capture-test-'));
  try{await run(directory);}finally{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('seekdesk-capture-test-'));await fs.rm(directory,{recursive:true,force:true});}
}

test('ordinary startup does not create capture storage, and explicit captures get independent profiles',async()=>temporary(async directory=>{
  const options={workingDirectory:directory,temporaryDirectory:path.join(directory,'temp')};
  assert.equal(prepareCaptureMode(['app','--other'],options),undefined);await assert.rejects(fs.stat(options.temporaryDirectory));
  const first=prepareCaptureMode(['app','--screenshot','one.png'],options)!,second=prepareCaptureMode(['app','--screenshot=two.png'],options)!;
  assert.equal(first.outputPath,path.join(directory,'one.png'));assert.notEqual(first.userDataDirectory,second.userDataDirectory);
  assert.equal(path.dirname(first.userDataDirectory),options.temporaryDirectory);assert.deepEqual(await fs.readdir(first.userDataDirectory),[]);
}));

test('malformed capture arguments and existing destinations never create a new profile or overwrite files',async()=>temporary(async directory=>{
  const options={workingDirectory:directory,temporaryDirectory:path.join(directory,'temp')};
  for(const args of [['--screenshot'],['--screenshot','--other'],['--screenshot','file.jpg'],['--screenshot','one.png','--screenshot=two.png'],['--screenshot','bad\n.png']])assert.throws(()=>prepareCaptureMode(args,options));
  await assert.rejects(fs.stat(options.temporaryDirectory));
  await fs.writeFile(path.join(directory,'kept.png'),'existing');assert.throws(()=>prepareCaptureMode(['--screenshot','kept.png'],options));
  assert.equal(await fs.readFile(path.join(directory,'kept.png'),'utf8'),'existing');
}));

test('capture waits for the local app and rendering frames before writing its PNG',async()=>temporary(async directory=>{
  const mode=prepareCaptureMode(['--screenshot','nested/shot.png'],{workingDirectory:directory,temporaryDirectory:directory})!;
  const dom=new JSDOM('<!doctype html><body></body>',{runScripts:'outside-only'}),frames:FrameRequestCallback[]=[];let captured=0;
  dom.window.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
  const pending=captureModeImage({executeJavaScript:async source=>dom.window.eval(source),capturePage:async()=>{captured++;return {toPNG:()=>png};}},mode);
  await new Promise(resolve=>setImmediate(resolve));
  for(let index=0;index<5;index++)frames.shift()!(index);assert.equal(captured,0);
  const workspace=dom.window.document.createElement('div');workspace.className='workspace';dom.window.document.body.append(workspace);
  for(let index=0;index<119;index++)frames.shift()!(index);await new Promise(resolve=>setImmediate(resolve));assert.equal(captured,0);
  frames.shift()!(120);const result=await pending;
  assert.equal(captured,1);assert.equal(result.bytes,png.length);assert.deepEqual(await fs.readFile(mode.outputPath),png);dom.window.close();
}));

test('a stalled renderer or invalid native image cannot leave a screenshot, and races cannot overwrite an existing one',async()=>temporary(async directory=>{
  const mode=prepareCaptureMode(['--screenshot','shot.png'],{workingDirectory:directory,temporaryDirectory:directory})!;
  let captures=0;
  await assert.rejects(captureModeImage({executeJavaScript:()=>new Promise(()=>{}),capturePage:async()=>{captures++;return {toPNG:()=>png};}},mode,{timeoutMs:5}),/超时/);
  assert.equal(captures,0);await assert.rejects(fs.stat(mode.outputPath));
  await assert.rejects(captureModeImage({executeJavaScript:async()=>{},capturePage:async()=>({toPNG:()=>Buffer.from('not PNG')})},mode),/PNG/);
  await fs.writeFile(mode.outputPath,'keep');
  await assert.rejects(captureModeImage({executeJavaScript:async()=>{},capturePage:async()=>({toPNG:()=>png})},mode),{code:'EEXIST'});
  assert.equal(await fs.readFile(mode.outputPath,'utf8'),'keep');
}));
