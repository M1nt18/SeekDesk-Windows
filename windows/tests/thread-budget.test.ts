import test from 'node:test';import assert from 'node:assert/strict';import {chooseThreadEvictions,threadCharacters} from '../shared/thread-budget';
const comments=(html:string)=>[{id:'0',html,author:'',date:'',floor:'',signature:'signature'}];
test('body budgets account for signatures and evict inactive least-recent readers without deleting the active or busy document',()=>{
  const entries=[{id:'old',comments:comments('12345'),busy:false,used:1},{id:'recent',comments:comments('12345'),busy:false,used:2},{id:'active',comments:comments('12345'),busy:false,used:0},{id:'loading',comments:comments('12345'),busy:true,used:0}];
  assert.equal(threadCharacters(entries[0].comments),14);assert.deepEqual(chooseThreadEvictions(entries,'active',{floors:3,characters:100}),['old']);assert.deepEqual(chooseThreadEvictions(entries,'active',{floors:1,characters:1}),['old','recent']);assert.equal(entries.length,4);
});
