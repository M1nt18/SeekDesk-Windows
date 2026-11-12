import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,defaults,validateSettings,validateWorkspace,validateBlockedUsers} from '../electron/store';

test('preference validation rejects invalid types and strips untrusted private post data',()=>{
  assert.throws(()=>validateSettings({...defaults,fontSize:1000}));
  assert.throws(()=>validateSettings({...defaults,restoreTabs:'yes'}));
  assert.throws(()=>validateWorkspace({tabs:[{url:'https://evil.invalid/post-1-1',title:'bad'}]}));
  const workspace=validateWorkspace({tabs:[{id:'forged',url:'https://www.nodeseek.com/post-42-3#comment-10',title:'Title',summary:'private content',cookie:'not allowed'}],activeId:'42'});
  assert.equal(workspace.tabs[0].id,'42');
  assert.equal(workspace.tabs[0].summary,'');
  assert.ok(!JSON.stringify(workspace).includes('private content'));
  assert.ok(!JSON.stringify(workspace).includes('cookie'));
  assert.equal(workspace.tabs[0].url,'https://www.nodeseek.com/post-42-3#comment-10');
});

test('queued saves restore the last workspace, and disabling restore removes persisted tabs',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-store-'));
  try {
    const store=new Store(directory);
    store.workspace=validateWorkspace({tabs:[{url:'https://www.nodeseek.com/post-42-3',title:'Title'}],activeId:'42',scrollPositions:{42:180,77:999,88:Infinity}});
    const first=store.save();
    store.settings={...defaults,fontSize:19,theme:'dark'};
    await Promise.all([first,store.save()]);
    const restored=new Store(directory);await restored.load();
    assert.equal(restored.settings.fontSize,19);
    assert.equal(restored.workspace.activeId,'42');
    assert.equal(restored.workspace.tabs[0].url,'https://www.nodeseek.com/post-42-3');
    assert.deepEqual(restored.workspace.scrollPositions,{'42':180});
    store.settings={...store.settings,restoreTabs:false};await store.save();
    const withoutTabs=new Store(directory);await withoutTabs.load();
    assert.deepEqual(withoutTabs.workspace,{tabs:[],activeId:null,overviewOpen:true,listHidden:false,scrollPositions:{}});
    await fs.writeFile(path.join(directory,'preferences.json'),'corrupt');
    const recovered=new Store(directory);await recovered.load();
    assert.deepEqual(recovered.settings,defaults);
  } finally {await fs.rm(directory,{recursive:true,force:true});}
});

test('new global font settings migrate old preferences and preserve overview and blocked users',async()=>{
  const old={theme:'dark',fontSize:24,compact:true,restoreTabs:true,defaultSource:'rss'};
  assert.equal(validateSettings(old).uiFontSize,16);
  assert.equal(validateSettings(old).nodeSeekPro,false);
  assert.equal(validateSettings({...old,fontSize:13}).fontSize,14);
  assert.equal(validateSettings({...defaults,uiFontSize:24,fontSize:40}).fontSize,40);
  assert.throws(()=>validateSettings({...defaults,uiFontSize:30}));
  assert.throws(()=>validateBlockedUsers([1,'2']));
  assert.deepEqual(validateBlockedUsers([42,42,77]),[42,77]);
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-appearance-'));
  try {
    const store=new Store(directory);store.settings=validateSettings(old);
    store.workspace={tabs:[],activeId:null,overviewOpen:false};store.blockedUsers=[42,77];await store.save();
    const restored=new Store(directory);await restored.load();
    assert.equal(restored.workspace.overviewOpen,false);assert.deepEqual(restored.blockedUsers,[42,77]);
    assert.equal(restored.settings.theme,'dark');assert.equal(restored.settings.fontSize,24);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('reading layout remains remembered even when tab restoration is disabled',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-layout-'));
  try {const original=new Store(directory);original.settings={...defaults,restoreTabs:false};original.workspace={tabs:[],activeId:null,listHidden:true};await original.save();const restored=new Store(directory);await restored.load();assert.equal(restored.workspace.listHidden,true);assert.deepEqual(restored.workspace.tabs,[]);assert.equal(validateWorkspace({tabs:[],activeId:null,listHidden:'bad'}).listHidden,false);}finally{await fs.rm(directory,{recursive:true,force:true});}
});
