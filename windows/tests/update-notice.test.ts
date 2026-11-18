import test from 'node:test';import assert from 'node:assert/strict';import {hasUpdateNotice} from '../shared/update-notice';
test('update red dots follow known newer versions including downloads, retries and manual portable updates',()=>{
  for(const status of ['available','downloading','downloaded','error','cancelled','unsupported'] as const)assert.equal(hasUpdateNotice({status,currentVersion:'0.1.4',version:'0.1.5',installable:false}),true);
  for(const version of ['0.1.4','0.1.3','0.1.5-beta','bad'])assert.equal(hasUpdateNotice({status:'available',currentVersion:'0.1.4',version,installable:true}),false);
  assert.equal(hasUpdateNotice({status:'up-to-date',currentVersion:'0.1.4',version:'0.1.5',installable:true}),false);
  assert.equal(hasUpdateNotice(undefined),false);
});
