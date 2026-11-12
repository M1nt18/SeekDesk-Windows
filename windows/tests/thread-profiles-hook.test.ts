import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {useThreadProfiles} from '../src/useThreadProfiles';
import type {ThreadResult} from '../shared/types';

test('a successful follow remains authoritative without profile data, and never survives an account boundary',async()=>{
  const dom=new JSDOM('<div id="root"></div>');
  const savedWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),savedDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});
  Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
  (dom.window as any).seekdesk={readUserProfiles:async()=>({outcomes:[{memberId:99,status:'failed',reason:'verification'}],complete:true})};
  const document:ThreadResult={id:'1',url:'https://www.nodeseek.com/post-1-1',title:'Thread',source:'web',page:1,nextPage:null,comments:[{id:'0',author:'Author',authorId:99,date:'',floor:'0',html:'<p>Body</p>',following:false}]};
  let state:ReturnType<typeof useThreadProfiles>;
  function Harness({scope}:{scope:number}){state=useThreadProfiles(document,true,scope);return null;}
  const root=createRoot(dom.window.document.getElementById('root')!);
  try {
    await act(async()=>{root.render(createElement(Harness,{scope:1}));});
    assert.equal(state!.profiles[99]?.status,'failed');
    await act(async()=>{state!.updateFollowing(99,true);});
    assert.equal(state!.followingOverride(99),true);
    assert.equal(document.comments[0].following,false,'The original document stays immutable so scroll restoration is unaffected');
    await act(async()=>{state!.updateFollowing(99,false);});
    assert.equal(state!.followingOverride(99),false,'A successful unfollow is distinct from an unknown relationship');
    await act(async()=>{root.render(createElement(Harness,{scope:2}));});
    assert.equal(state!.followingOverride(99),undefined);
  } finally {
    await act(async()=>root.unmount());dom.window.close();
    if(savedWindow)Object.defineProperty(globalThis,'window',savedWindow);else delete (globalThis as any).window;
    if(savedDocument)Object.defineProperty(globalThis,'document',savedDocument);else delete (globalThis as any).document;
    delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
  }
});
