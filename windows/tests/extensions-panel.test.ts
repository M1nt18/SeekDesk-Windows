import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {defaultExtensions} from '../electron/extensions';

test('a completed extension save preserves edits made on the same detail while waiting',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'https://audit.invalid'});
  const globals=['window','document','navigator','HTMLElement','Element','IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  const css=require.extensions['.css'];require.extensions['.css']=()=>{};
  const {createRoot}=require('react-dom/client') as typeof import('react-dom/client');
  const {ExtensionsPanel}=require('../src/parity-panels') as typeof import('../src/parity-panels');
  let state=defaultExtensions(),finishSave!:()=>void;
  const onChange=(next:typeof state)=>new Promise<void>(resolve=>{finishSave=()=>{state=next;render();resolve();};});
  const root=createRoot(dom.window.document.getElementById('root')!);
  const render=()=>root.render(createElement(ExtensionsPanel,{account:{status:'signed-out'},state,onChange,onBack:()=>{},onNotify:()=>{},onOpenRanking:()=>{},onOpenPost:()=>{},onMember:()=>{}}));
  const fill=async(input:HTMLInputElement,value:string)=>act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  try{
    await act(async()=>render());
    await act(async()=>dom.window.document.querySelector<HTMLButtonElement>('.extension-card')!.click());
    const input=dom.window.document.querySelector<HTMLInputElement>('input[aria-label="热榜侧栏显示条数"]')!;
    await fill(input,'22');
    await act(async()=>[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='保存设置')!.click());
    await fill(input,'23');await act(async()=>finishSave());
    assert.equal(state.hotSidebarCount,22,'The in-flight snapshot is the saved value');
    assert.equal(input.value,'23','The newer unsaved edit must remain visible');
    await act(async()=>[...dom.window.document.querySelectorAll('button')].find(button=>button.textContent==='保存设置')!.click());
    await act(async()=>finishSave());
    assert.equal(state.hotSidebarCount,23,'The preserved edit can be saved deliberately');
  }finally{
    await act(async()=>root.unmount());dom.window.close();
    if(css)require.extensions['.css']=css;else delete require.extensions['.css'];
    for(const key of globals){const descriptor=previous.get(key);if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete (globalThis as any)[key];}
  }
});
