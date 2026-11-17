import test from 'node:test';
import assert from 'node:assert/strict';
import {canAccessLocalDraft} from '../shared/draft-owner';

test('the last confirmed local draft remains saveable during temporary site verification',()=>{
  for(const status of ['signed-in','verification','unknown'] as const)assert.equal(canAccessLocalDraft({status,id:42},'user:42',42),true);
});
test('new guests, another confirmed account and forged owners cannot read or write an old draft',()=>{
  assert.equal(canAccessLocalDraft({status:'unknown'},undefined,42),false);
  assert.equal(canAccessLocalDraft({status:'signed-out',id:42},'user:42',42),false);
  assert.equal(canAccessLocalDraft({status:'signed-in',id:43},'user:43',42),false);
  assert.equal(canAccessLocalDraft({status:'verification',id:42},'user:43',42),false);
  assert.equal(canAccessLocalDraft({status:'signed-in',id:42},'user:42','42'),false);
});
