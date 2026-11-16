import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {flushUpdateDrafts,saveUpdateDraft,useUpdateDraftSaver,type UpdateDraftSnapshot,type UpdateDraftSaverOptions} from '../src/update-drafts';

function deferred<T=void>() {
  let resolve!:(value:T|PromiseLike<T>)=>void,reject!:(reason:unknown)=>void;
  const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
}

async function mountedSavers(run:(render:(callbacks:(()=>Promise<unknown>)[])=>Promise<void>,unmount:()=>Promise<void>)=>Promise<void>,options:UpdateDraftSaverOptions={}) {
  const dom=new JSDOM('<div id="root"></div>');
  const previous={window:Object.getOwnPropertyDescriptor(globalThis,'window'),document:Object.getOwnPropertyDescriptor(globalThis,'document'),act:Object.getOwnPropertyDescriptor(globalThis,'IS_REACT_ACT_ENVIRONMENT')};
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});
  Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});
  Object.defineProperty(globalThis,'IS_REACT_ACT_ENVIRONMENT',{configurable:true,value:true});
  const root=createRoot(dom.window.document.getElementById('root')!);
  let unmounted=false;
  function Saver({save}:{save:()=>Promise<unknown>}){useUpdateDraftSaver(save,options);return null;}
  const render=async(callbacks:(()=>Promise<unknown>)[])=>{await act(async()=>{root.render(callbacks.map((save,index)=>createElement(Saver,{key:index,save})));});};
  const unmount=async()=>{if(!unmounted){unmounted=true;await act(async()=>root.unmount());}};
  try {await run(render,unmount);}finally{
    await unmount();dom.window.close();
    for(const [key,descriptor] of Object.entries(previous)){const name=key==='act'?'IS_REACT_ACT_ENVIRONMENT':key;if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete (globalThis as any)[name];}
  }
}

test('install flush uses the latest text callback and removes an unmounted editor',async()=>{
  await mountedSavers(async(render,unmount)=>{
    const saved:string[]=[];
    await render([async()=>{saved.push('old');}]);
    await render([async()=>{saved.push('last keystroke');}]);
    await flushUpdateDrafts();assert.deepEqual(saved,['last keystroke']);
    await unmount();await flushUpdateDrafts();assert.deepEqual(saved,['last keystroke']);
  });
});

test('concurrent update requests wait for one shared round of all local draft writes',async()=>{
  await mountedSavers(async render=>{
    const a=deferred(),b=deferred();let callsA=0,callsB=0,done=false;
    await render([async()=>{callsA++;await a.promise;},async()=>{callsB++;await b.promise;}]);
    const first=flushUpdateDrafts(),second=flushUpdateDrafts();assert.equal(first,second);
    void first.then(()=>{done=true;});await Promise.resolve();
    assert.equal(callsA,1);assert.equal(callsB,1);
    a.resolve();await Promise.resolve();assert.equal(done,false);
    b.resolve();await first;assert.equal(done,true);
  });
});

test('a failing draft blocks installation, waits for other saves, and allows an explicit retry',async()=>{
  await mountedSavers(async render=>{
    const gate=deferred();let fail=true,finished=false,calls=0;
    await render([async()=>{calls++;if(fail)throw Error('Disk unavailable');},async()=>{await gate.promise;}]);
    const first=flushUpdateDrafts();const failure=assert.rejects(first,/部分草稿未能保存/).then(()=>{finished=true;});
    await Promise.resolve();await Promise.resolve();assert.equal(finished,false);
    gate.resolve();await failure;
    fail=false;await flushUpdateDrafts();assert.equal(calls,2);
  });
});

test('leaving an editor saves the latest text immediately and update waits for that detached write',async()=>{
  const gate=deferred();const saved:string[]=[];let done=false;
  await mountedSavers(async(render,unmount)=>{
    await render([async()=>{saved.push('old');await gate.promise;}]);
    await render([async()=>{saved.push('last text before Settings');await gate.promise;}]);
    await unmount();assert.deepEqual(saved,['last text before Settings']);
    const flush=flushUpdateDrafts({owner:7});void flush.then(()=>{done=true;});
    await Promise.resolve();assert.equal(done,false);
    gate.resolve();await flush;assert.equal(done,true);
    await flushUpdateDrafts({owner:7});assert.equal(saved.length,1);
  },{owner:7,saveOnUnmount:true});
});

test('a failed unmount write is retried at update time and failure never counts as saved',async()=>{
  let writes=0,fail=true;
  await mountedSavers(async(render,unmount)=>{
    await render([async()=>{writes++;if(fail)throw Error('Disk unavailable');}]);
    await unmount();assert.equal(writes,1);
    await assert.rejects(flushUpdateDrafts({owner:7}),/部分草稿未能保存/);assert.equal(writes,2);
    fail=false;await flushUpdateDrafts({owner:7});assert.equal(writes,3);
  },{owner:7,saveOnUnmount:true});
});

test('old account and successfully submitted detached drafts cannot block or repopulate the new session',async()=>{
  let writes=0,current=true;
  await mountedSavers(async(render,unmount)=>{
    await render([async()=>{writes++;throw Error('Prior account save failed');}]);
    await unmount();assert.equal(writes,1);
    await flushUpdateDrafts({owner:8});assert.equal(writes,1);
    await flushUpdateDrafts({owner:7});assert.equal(writes,1,'discarded old-owner work cannot return later');
  },{owner:7,saveOnUnmount:true,isCurrent:()=>current});
  await mountedSavers(async(render,unmount)=>{
    await render([async()=>{writes++;}]);
    current=false;await unmount();await flushUpdateDrafts({owner:7});assert.equal(writes,1,'accepted send invalidates the detached draft before a retry');
  },{owner:7,saveOnUnmount:true,isCurrent:()=>current});
});

const snapshot=(overrides:Partial<UpdateDraftSnapshot>={}):UpdateDraftSnapshot=>({owner:7,key:'new-topic',scope:'7:new-topic',ready:true,value:{title:'Title',content:'last character',category:'tech',rank:2,imageWidths:{'https://example.com/a.png':320}},...overrides});

test('update saves preserve the exact editable draft fields and its confirmed owner',async()=>{
  const value=snapshot();const calls:unknown[]=[];
  await saveUpdateDraft(value,{scope:()=>value.scope,busy:()=>false},async(key,draft,owner)=>{calls.push({key,draft,owner});});
  assert.deepEqual(calls,[{key:'new-topic',draft:value.value,owner:7}]);
  const message=snapshot({key:'message:9',scope:'7:9',value:{content:'*plain text*',markdown:false,imageWidths:{}}});
  await saveUpdateDraft(message,{scope:()=>message.scope,busy:()=>false},async(key,draft,owner)=>{calls.push({key,draft,owner});});
  assert.deepEqual(calls[1],{key:'message:9',draft:{content:'*plain text*',markdown:false,imageWidths:{}},owner:7});
});

test('unloaded, read-only and signed-out editors cannot overwrite an existing local draft',async()=>{
  let writes=0;const save=async()=>{writes++;},current={scope:()=> '7:new-topic',busy:()=>false};
  await saveUpdateDraft(snapshot({owner:undefined}),current,save);
  await saveUpdateDraft(snapshot({readOnly:true}),current,save);
  await saveUpdateDraft(snapshot({ready:false,value:{content:''}}),current,save);
  await assert.rejects(saveUpdateDraft(snapshot({ready:false}),current,save),/尚未读取完成/);
  assert.equal(writes,0);
});

test('sending and account changes before or during a save block the install acknowledgement',async()=>{
  let scope='7:new-topic',busy=false,writes=0;const current={scope:()=>scope,busy:()=>busy};
  const save=async()=>{writes++;};busy=true;
  await assert.rejects(saveUpdateDraft(snapshot(),current,save),/正在发送或发布/);assert.equal(writes,0);
  busy=false;scope='8:new-topic';
  await assert.rejects(saveUpdateDraft(snapshot(),current,save),/账号或页面已变化/);assert.equal(writes,0);
  scope='7:new-topic';const gate=deferred();
  const late=saveUpdateDraft(snapshot(),current,async(_key,_value,owner)=>{assert.equal(owner,7);writes++;await gate.promise;});
  scope='8:new-topic';gate.resolve();await assert.rejects(late,/草稿状态已变化/);assert.equal(writes,1);
  scope='7:new-topic';const sendGate=deferred();
  const sending=saveUpdateDraft(snapshot(),current,async()=>{writes++;await sendGate.promise;});
  busy=true;sendGate.resolve();await assert.rejects(sending,/草稿状态已变化/);assert.equal(writes,2);
});
