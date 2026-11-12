import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import fsp from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {buildUserscriptRuntime,initialUserscriptValues,validateUserscriptRequest,UserscriptHost} from '../electron/userscripts';

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
  win.__seekdeskGM={set:async()=>{},remove:async()=>{},open:async()=>{},request:async()=>({status:200,response:{}})};
  const literal="literal $& $` $' __CONFIG__";
  const source=buildUserscriptRuntime({values:{settings:{testValue:literal}},config:{user:null,postData:null},assets});
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
  page.window.close();
});
