import test from 'node:test';import assert from 'node:assert/strict';
import {PreferenceQueue} from '../shared/preference-queue';
for(const failures of [[true,true],[true,false],[false,true],[false,false]])test('queued settings failures '+failures.join('/'),async()=>{
  let displayed={width:370,font:16},disk={...displayed},calls=0;const candidates:typeof disk[]=[];
  const queue=new PreferenceQueue(disk,async value=>{candidates.push({...value});if(failures[calls++])throw Error('synthetic failed save');disk={...value};return disk;},value=>{displayed=value;});
  const first=queue.submitValue({width:430,font:16}).catch(()=>null),second=queue.submitValue({width:430,font:20}).catch(()=>null);await Promise.all([first,second]);
  assert.deepEqual(candidates[1],{width:failures[0]?370:430,font:20});assert.deepEqual(displayed,disk);
  assert.deepEqual(disk,{width:failures[0]?370:430,font:failures[1]?16:20});
});
