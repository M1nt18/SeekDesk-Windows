import test from 'node:test';import assert from 'node:assert/strict';
import {PreferenceQueue} from '../shared/preference-queue';
for(const failures of [[true,true],[true,false],[false,true],[false,false]])test('queued settings failures '+failures.join('/'),async()=>{
  let displayed={width:370,font:16},disk={...displayed},calls=0;const candidates:typeof disk[]=[];
  const queue=new PreferenceQueue(disk,async value=>{candidates.push({...value});if(failures[calls++])throw Error('synthetic failed save');disk={...value};return disk;},value=>{displayed=value;});
  const first=queue.submitValue({width:430,font:16}).catch(()=>null),second=queue.submitValue({width:430,font:20}).catch(()=>null);await Promise.all([first,second]);
  assert.deepEqual(candidates[1],{width:failures[0]?370:430,font:20});assert.deepEqual(displayed,disk);
  assert.deepEqual(disk,{width:failures[0]?370:430,font:failures[1]?16:20});
});
test('in-flight submit cannot overwrite committed state after replace',async()=>{
  let release!:()=>void,markEntered!:()=>void,displayed={width:370,font:16};const entered=new Promise<void>(resolve=>{markEntered=resolve;}),persisted:typeof displayed[]=[];
  const queue=new PreferenceQueue(displayed,async value=>{persisted.push({...value});if(persisted.length===1){markEntered();await new Promise<void>(resolve=>{release=resolve;});}return value;},value=>{displayed=value;});
  const first=queue.submit({width:420});
  await entered;
  queue.replace({width:500,font:20});
  release();await first;
  await queue.submit({font:22});
  assert.deepEqual(persisted[1],{width:500,font:22});
  assert.deepEqual(displayed,{width:500,font:22});
});
