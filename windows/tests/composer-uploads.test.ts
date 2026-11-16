import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {beginComposerUpload,getComposerUploadCount,useComposerUploads} from '../src/composer-uploads';

test('upload guards update synchronously and each transfer releases its own lease once',()=>{
  assert.equal(getComposerUploadCount(),0);
  const first=beginComposerUpload(),second=beginComposerUpload();
  try{assert.equal(getComposerUploadCount(),2);first();assert.equal(getComposerUploadCount(),1);first();assert.equal(getComposerUploadCount(),1);}finally{first();second();}
  assert.equal(getComposerUploadCount(),0);
});

test('parent send controls observe overlapping uploads and remain blocked when one editor unmounts',async()=>{
  const dom=new JSDOM('<div id="root"></div>'),previousWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),previousDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  let uploading=false;function Harness(){uploading=useComposerUploads();return createElement('button',{disabled:uploading},'Send');}
  const root=createRoot(dom.window.document.getElementById('root')!);let first:(()=>void)|undefined,second:(()=>void)|undefined;
  try{
    await act(async()=>root.render(createElement(Harness)));assert.equal(uploading,false);
    await act(async()=>{first=beginComposerUpload();second=beginComposerUpload();});assert.equal(uploading,true);assert.equal(dom.window.document.querySelector('button')!.disabled,true);
    await act(async()=>first!());assert.equal(uploading,true);
    await act(async()=>root.unmount());assert.equal(getComposerUploadCount(),1,'An outstanding detached upload is still visible to install/send guards');
    second();assert.equal(getComposerUploadCount(),0);
  }finally{
    first?.();second?.();dom.window.close();if(previousWindow)Object.defineProperty(globalThis,'window',previousWindow);else delete (globalThis as any).window;if(previousDocument)Object.defineProperty(globalThis,'document',previousDocument);else delete (globalThis as any).document;delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
