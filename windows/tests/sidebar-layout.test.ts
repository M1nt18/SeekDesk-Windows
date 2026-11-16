import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {SIDEBAR_STANDARD,SIDEBAR_MIN,SIDEBAR_MAX,PANE_DIVIDER,sidebarBounds,clampSidebarWidth} from '../shared/layout';
import {appearanceDefaults,validateAppearance,ParityStore} from '../electron/parity-store';

test('sidebar defaults and available-window bounds follow DeskSidebarSizing',()=>{
  assert.deepEqual([SIDEBAR_STANDARD,SIDEBAR_MIN,SIDEBAR_MAX,PANE_DIVIDER],[228,184,360,9]);
  assert.deepEqual(sidebarBounds(2000),[184,360]);
  assert.deepEqual(sidebarBounds(1000),[184,330]);
  assert.deepEqual(sidebarBounds(600),[184,184]);
  assert.equal(clampSidebarWidth(350,1000),330);
});

test('valid older sidebar sizes remain unchanged while finite legacy extremes are fitted',()=>{
  assert.equal(appearanceDefaults.sidebarWidth,228);
  assert.equal(validateAppearance({sidebarWidth:250}).sidebarWidth,250);
  assert.equal(validateAppearance({sidebarWidth:390}).sidebarWidth,360);
  assert.equal(validateAppearance({sidebarWidth:190}).sidebarWidth,190);
  assert.equal(validateAppearance({sidebarWidth:0}).sidebarWidth,184);
  assert.equal(validateAppearance({sidebarWidth:184}).sidebarWidth,184);
  assert.equal(validateAppearance({sidebarWidth:360}).sidebarWidth,360);
  for(const value of [NaN,Infinity,-Infinity,'228'])assert.throws(()=>validateAppearance({sidebarWidth:value}));
  assert.throws(()=>validateAppearance({sidebarWidth:228,listWidth:999}));
});

test('loading an older wide sidebar preserves the rest of the appearance instead of resetting it',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-sidebar-migration-'));
  try{
    await fs.writeFile(path.join(directory,'workspace-features.json'),JSON.stringify({appearance:{...appearanceDefaults,sidebarWidth:390,listWidth:415,brand:'green',readerGradient:false,listFontSize:22},history:[]}));
    const store=new ParityStore(directory);await store.load();
    assert.equal(store.appearance.sidebarWidth,360);assert.equal(store.appearance.listWidth,415);
    assert.equal(store.appearance.brand,'green');assert.equal(store.appearance.readerGradient,false);assert.equal(store.appearance.listFontSize,22);
    await store.save();const restarted=new ParityStore(directory);await restarted.load();
    assert.deepEqual(restarted.appearance,store.appearance);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
