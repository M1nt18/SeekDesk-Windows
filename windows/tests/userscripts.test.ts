import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {buildUserscriptRuntime,initialUserscriptValues,validateUserscriptRequest,UserscriptHost,publicUserscriptValues} from '../electron/userscripts';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';

function protectedFixture(directory:string,options:Partial<ConstructorParameters<typeof UserscriptHost>[0]>={}){
  const frame={url:'https://www.nodeseek.com/'},contents={isDestroyed:()=>false,mainFrame:frame,executeJavaScriptInIsolatedWorld:async()=>({})},handlers=new Map<string,(...args:any[])=>any>();
  const key=randomBytes(32);
  const protection={isEncryptionAvailable:()=>true,encryptString:(value:string)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),bytes]);},decryptString:(value:Buffer)=>{const cipher=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));cipher.setAuthTag(value.subarray(12,28));return Buffer.concat([cipher.update(value.subarray(28)),cipher.final()]).toString('utf8');}};
  const host=new UserscriptHost({storageDirectory:directory,getOfficialContents:()=>contents as any,onOpen:async()=>{},storageProtection:protection,...options});
  host.registerIPC({handle:(name:string,callback:any)=>handlers.set(name,callback)} as any);
  return {host,protection,request:(request:unknown)=>handlers.get('userscript:request')!({sender:contents,senderFrame:frame},request),set:(name:string,value:unknown)=>handlers.get('userscript:set')!({sender:contents,senderFrame:frame},name,value),remove:(name:string)=>handlers.get('userscript:remove')!({sender:contents,senderFrame:frame},name)};
}
test('only trusted credential edits change keys, fixed host operations bind them in main, and exports omit them',async()=>{
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'seekdesk-pro-boundary-')),previousFetch=globalThis.fetch;
  try{
    const fixture=protectedFixture(directory);await fixture.host.load();await fixture.host.saveCredential({service:'ai',apiKey:'synthetic-bound-ai-secret'});await fixture.host.saveCredential({service:'nodeimage',apiKey:'synthetic-bound-image-secret'});
    await fixture.set('settings',{ai_comment:{api_key:'attacker-replacement',model:'fixture'},image_upload:{api_key:''}});await fixture.remove('settings');
    assert.deepEqual(fixture.host.credentials(),{aiConfigured:true,nodeimageConfigured:true});assert.doesNotMatch(fixture.host.exportPreferences(),/synthetic-bound|attacker-replacement/);
    let calls=0;globalThis.fetch=async(input,init)=>{calls++;assert.equal(String(input),'https://api.openai.com/v1/chat/completions');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer synthetic-bound-ai-secret');return new Response(JSON.stringify({echo:'synthetic-bound-ai-secret'}),{headers:{'Content-Type':'application/json'}});};
    const result=await fixture.request({url:'https://api.openai.com/v1/chat/completions',method:'POST',headers:{Authorization:'Bearer public-placeholder'},data:'{}'});assert.equal(calls,1);assert.doesNotMatch(result.responseText,/synthetic-bound/);
    for(const url of ['https://api.openai.com/v1/files','https://api.openai.com/v1/chat/completions?proxy=true','https://api.nodeimage.com/api/user/api-key'])await assert.rejects(fixture.request({url,method:'POST'}),/仅支持/);
    assert.equal(calls,1);await fixture.host.saveCredential({service:'ai',clear:true});assert.equal(fixture.host.credentials().aiConfigured,false);
  }finally{globalThis.fetch=previousFetch;await fsp.rm(directory,{recursive:true,force:true});}
});
test('Pro API credentials migrate and round-trip encrypted while ordinary preferences remain readable',async()=>{
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'seekdesk-gm-crypto-')),target=path.join(directory,'nodeseek-pro.json');
  try{
    const values={settings:{ai_comment:{enabled:false,api_key:'fixture-ai-secret'},image_upload:{api_key:'fixture-image-secret'},ordinary:'preference'}};
    await fsp.writeFile(target,JSON.stringify(values));const fixture=protectedFixture(directory);await fixture.host.load();assert.equal(fixture.host.storageWarning,undefined);
    const saved=await fsp.readFile(target,'utf8');assert.doesNotMatch(saved,/fixture-ai-secret|fixture-image-secret/);assert.match(saved,/preference/);
    const row=JSON.parse(saved);assert.equal(fixture.protection.decryptString(Buffer.from(row.settings.ai_comment.api_key.data,'base64')),'fixture-ai-secret');
    const reloaded=protectedFixture(directory,{storageProtection:fixture.protection});await reloaded.host.load();assert.equal(reloaded.host.storageWarning,undefined);
    await reloaded.set('probe',true);assert.equal(JSON.parse(await fsp.readFile(target,'utf8')).probe,true);
    await reloaded.remove('probe');assert.equal(JSON.parse(await fsp.readFile(target,'utf8')).probe,undefined);
    assert.doesNotMatch(await fsp.readFile(target,'utf8'),/fixture-ai-secret|fixture-image-secret/);
  }finally{await fsp.rm(directory,{recursive:true,force:true});}
});
test('unavailable protection rejects new credentials without committing them or erasing previous settings',async()=>{
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'seekdesk-gm-unavailable-')),target=path.join(directory,'nodeseek-pro.json');
  try{
    const fixture=protectedFixture(directory,{storageProtection:undefined});await fixture.host.load();await fixture.set('probe','retained');const original=await fsp.readFile(target,'utf8');
    await assert.rejects(fixture.host.saveCredential({service:'ai',apiKey:'fixture-secret'}),/未保存/);assert.equal(await fsp.readFile(target,'utf8'),original);
    await fixture.set('another',true);assert.doesNotMatch(await fsp.readFile(target,'utf8'),/fixture-secret/);
  }finally{await fsp.rm(directory,{recursive:true,force:true});}
});
test('unreadable or undecryptable Pro config remains preserved and refuses later writes',async()=>{
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'seekdesk-gm-broken-')),target=path.join(directory,'nodeseek-pro.json');
  try{
    for(const original of ['{"settings":','null','[]',JSON.stringify({settings:{api_key:{protected:'seekdesk-dpapi-v1',data:'AAAA'}}})]){
      await fsp.writeFile(target,original);const fixture=protectedFixture(directory);await fixture.host.load();assert.match(fixture.host.storageWarning||'',/原文件已保留/);
      await assert.rejects(fixture.set('probe',true),/无法读取/);await assert.rejects(fixture.remove('settings'),/无法读取/);assert.equal(await fsp.readFile(target,'utf8'),original);
    }
  }finally{await fsp.rm(directory,{recursive:true,force:true});}
});
test('failed Pro writes do not become active and later queued saves retain confirmed state',async()=>{
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'seekdesk-gm-failure-')),target=path.join(directory,'nodeseek-pro.json');let fail=false;
  try{
    const fixture=protectedFixture(directory,{fileSystem:{...fsp,rename:async(...args:Parameters<typeof fsp.rename>)=>{if(fail){fail=false;throw Error('synthetic denied');}return fsp.rename(...args);}}});
    await fixture.host.load();await fixture.set('probe','confirmed');fail=true;
    const rejected=assert.rejects(fixture.set('probe','uncommitted'),/synthetic/),queued=fixture.set('other',true);await rejected;await queued;
    const saved=JSON.parse(await fsp.readFile(target,'utf8'));assert.equal(saved.probe,'confirmed');assert.equal(saved.other,true);assert.equal((await fsp.readdir(directory)).some(file=>file.endsWith('.tmp')),false);
  }finally{await fsp.rm(directory,{recursive:true,force:true});}
});

test('NodeSeek Pro cross-origin requests reject local schemes, credentials, cookies and unknown endpoints',()=>{
  for(const url of ['file:///C:/Windows/win.ini','http://api.nodeimage.com/test','https://localhost/test','https://127.0.0.1/test','https://api.openai.com.evil.invalid/test','https://user:pass@api.openai.com/test','https://api.openai.com:444/test'])assert.throws(()=>validateUserscriptRequest({url}));
  for(const key of ['Cookie','Host','Origin','Proxy-Authorization','Sec-Fetch-Site'])assert.throws(()=>validateUserscriptRequest({url:'https://api.openai.com/v1/chat/completions',headers:{[key]:'secret'}}));
  assert.throws(()=>validateUserscriptRequest({url:'https://api.nodeimage.com/api/upload',data:'x'.repeat(8_000_001)}));
  const request=validateUserscriptRequest({url:'https://api.openai.com/v1/chat/completions',method:'POST',headers:{Authorization:'Bearer configured-key'},data:'{}'});
  assert.equal(request.method,'POST');assert.equal(request.headers?.Authorization,'Bearer configured-key');
});

test('first NodeSeek Pro settings disable automatic attendance while preserving a later explicit opt-in',()=>{
  const first=initialUserscriptValues({});
  assert.equal((first.settings as any).sign_in.ns.enabled,false);
  assert.equal((first.settings as any).sign_in.df.enabled,false);
  const explicit=initialUserscriptValues({settings:{sign_in:{ns:{enabled:true,method:2}}}});
  assert.equal((explicit.settings as any).sign_in.ns.enabled,true);
});

test('GM storage accepts only the enabled official top frame, rejects prototype keys and persists values',async()=>{
  const directory=await fsp.mkdtemp(path.join(os.tmpdir(),'seekdesk-gm-'));
  try {
    let enabled=true;
    const frame={url:'https://www.nodeseek.com/'};
    const contents={isDestroyed:()=>false,mainFrame:frame};
    const handlers=new Map<string,(...args:any[])=>any>();
    const host=new UserscriptHost({storageDirectory:directory,getOfficialContents:()=>contents as any,onOpen:async()=>{},isEnabled:()=>enabled});
    await host.load();host.registerIPC({handle:(name:string,callback:any)=>handlers.set(name,callback)} as any);
    const set=handlers.get('userscript:set')!;
    const event={sender:contents,senderFrame:frame};
    assert.throws(()=>set({sender:{},senderFrame:frame},'settings',{}));
    assert.throws(()=>set({sender:contents,senderFrame:{url:frame.url}},'settings',{}));
    await assert.rejects(()=>set(event,'__proto__',{}));
    await set(event,'probe',{literal:"$& $` $'"});
    const saved=JSON.parse(await fsp.readFile(path.join(directory,'nodeseek-pro.json'),'utf8'));
    assert.deepEqual(saved.probe,{literal:"$& $` $'"});
    enabled=false;assert.throws(()=>set(event,'settings',{}));
  } finally {await fsp.rm(directory,{recursive:true,force:true});}
});

test('pinned NodeSeek Pro executes menus and settings against shared DOM without a main-world bridge',async()=>{
  const directory=path.resolve(__dirname,'../vendor/nodeseek-pro');
  const assets:Record<string,string>={};
  for(const name of ['nodeseek-pro.user.js','layui.js','layui.css','layui-dark.css','highlight.js','highlight-light.css','highlight-dark.css'])assets[name]=fs.readFileSync(path.join(directory,name),'utf8');
  // jsdom's CSS parser does not implement every pinned browser stylesheet. Real
  // Chromium rendering is separately checked by userscript-electron-run.cjs.
  const virtualConsole=new VirtualConsole();
  virtualConsole.on('jsdomError',error=>{if(error.type!=='css-parsing')throw error;});
  const page=new JSDOM('<!doctype html><html><head></head><body><div id="nsk-head"><div class="user-menu"></div></div><main id="nsk-body-left"><ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-42-1">真实脚本 DOM 测试</a></div><div class="info-author"><a href="/space/42">fixture</a></div></li></ul></main></body></html>',{url:'https://www.nodeseek.com/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole});
  const win=page.window as any;
  win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.ResizeObserver=class{observe(){}disconnect(){}};
  win.fetch=async()=>({ok:true,status:200,json:async()=>({}),text:async()=>''});
  win.__seekdeskGM={set:async(_key:string,value:unknown)=>value,remove:async()=>{},open:async()=>{},request:async()=>({status:200,response:{}})};
  const literal="literal $& $` $' __CONFIG__";
  const source=buildUserscriptRuntime({values:{settings:{testValue:literal,ai_comment:{api_key:'synthetic-do-not-expose-ai'},image_upload:{api_key:'synthetic-do-not-expose-image'}}},config:{user:null,postData:null},assets});
  assert.doesNotMatch(source,/synthetic-do-not-expose/);
  const result=win.eval(source);
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(result.status,'running');
  assert.equal(result.version,'1.0.8');
  const runtime=win.__seekdeskProRuntime;
  assert.ok(runtime.getMenuLabels().length>4,runtime.getMenuLabels().join(','));
  assert.equal(runtime.getSettings().sign_in.ns.enabled,false);
  assert.equal(runtime.getSettings().testValue,literal);
  assert.ok(page.window.document.getElementById('seekdesk-pro-host'));
  runtime.showMenu();
  assert.ok(page.window.document.querySelectorAll('#seekdesk-pro-menu button').length>4);
  const advanced=[...page.window.document.querySelectorAll<HTMLButtonElement>('#seekdesk-pro-menu button')].find(button=>button.textContent?.includes('高级设置'));
  assert.ok(advanced,'Original advanced settings menu must be registered');
  advanced.click();
  assert.ok(page.window.document.querySelector('.layui-layer'),'Original Layui settings dialog renders');
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.doesNotMatch(page.window.document.documentElement.outerHTML,/synthetic-do-not-expose/);
  const credentialInputs=[...page.window.document.querySelectorAll<HTMLInputElement>('input')].filter(input=>/api[_-]?key|nsx-ai-key/.test(input.name||input.id));
  assert.ok(credentialInputs.length>0);assert.ok(credentialInputs.every(input=>input.disabled&&input.readOnly&&!input.value.includes('synthetic')));
  let release!:(value:unknown)=>void,requested:unknown;
  win.__seekdeskGM.set=async(_key:string,value:unknown)=>{requested=value;return new Promise(resolve=>release=resolve);};
  const save=page.window.document.querySelector<HTMLAnchorElement>('.layui-layer-btn0')!;save.click();await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal([...page.window.document.querySelectorAll('.layui-layer-msg')].some(node=>node.textContent?.includes('已保存')),false);
  assert.equal(page.window.document.querySelector('.layui-layer-btn0')!==null,true,'The form must stay open before persistence acknowledges');
  win.__seekdeskGM.set=async(_key:string,value:unknown)=>value;release(requested);
  for(let i=0;i<50;i++){if([...page.window.document.querySelectorAll('.layui-layer-msg')].some(node=>node.textContent?.includes('已保存')))break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.ok([...page.window.document.querySelectorAll('.layui-layer-msg')].some(node=>node.textContent?.includes('已保存')));
  page.window.close();
});
