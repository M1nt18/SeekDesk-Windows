import test from 'node:test';import assert from 'node:assert/strict';import {ImageCache} from '../electron/image-cache';
test('one cancelled reader cannot abort a shared image still needed by another reader',async()=>{
  const cache=new ImageCache<string>(s=>s.length),a=new AbortController(),b=new AbortController();let finish!:(value:string)=>void,underlying!:AbortSignal;
  const first=cache.get('shared',signal=>{underlying=signal;return new Promise(resolve=>finish=resolve);},false,a.signal),second=cache.get('shared',async()=>{throw Error('duplicate');},false,b.signal),rejected=assert.rejects(first,/已取消/);
  await Promise.resolve();a.abort();await rejected;assert.equal(underlying.aborted,false);finish('image');assert.equal(await second,'image');assert.equal(cache.stats().bytes,5);
});
test('cancelled queued images never start downloading and release their waiting slots',async()=>{
  const cache=new ImageCache<string>(s=>s.length,{maxBytes:20,ttlMs:100,concurrency:1,maxWaiting:4,now:()=>0});let finish!:(value:string)=>void,loads=0;
  const first=cache.get('active',()=>new Promise(resolve=>finish=resolve));await Promise.resolve();const controller=new AbortController(),queued=cache.get('old',async()=>{loads++;return 'old';},false,controller.signal),rejected=assert.rejects(queued,/已取消/);controller.abort();await rejected;
  const next=cache.get('visible',async()=>{loads++;return 'visible';});finish('first');await first;assert.equal(await next,'visible');assert.equal(loads,1);
});
test('same-key image work is deduplicated and expires or refreshes without double-counting bytes',async()=>{
  let now=0,loads=0,finish!:(value:string)=>void;
  const cache=new ImageCache<string>(s=>s.length,{maxBytes:10,ttlMs:100,concurrency:2,maxWaiting:10,now:()=>now});
  const a=cache.get('a',()=>{loads++;return new Promise(resolve=>finish=resolve);}),b=cache.get('a',async()=>{throw Error('duplicate');});await Promise.resolve();finish('1234');assert.deepEqual(await Promise.all([a,b]),['1234','1234']);assert.equal(loads,1);assert.equal(cache.stats().bytes,4);
  await cache.get('a',async()=>{loads++;return 'no';});assert.equal(loads,1);now=101;assert.equal(await cache.get('a',async()=>{loads++;return '12';}),'12');assert.equal(cache.stats().bytes,2);
  assert.equal(await cache.get('a',async()=> 'new',true),'new');assert.equal(cache.stats().bytes,3);
});
test('image decoding has a concurrency and byte ceiling, and failures release the next slot',async()=>{
  const cache=new ImageCache<string>(s=>s.length,{maxBytes:5,ttlMs:100,concurrency:1,maxWaiting:2,now:()=>0});let finish!:(value:string)=>void,started=0;
  const a=cache.get('a',()=>new Promise(resolve=>{started++;finish=resolve;})),b=cache.get('b',async()=>{started++;throw Error('decode failure');}),rejected=assert.rejects(b,/decode/),c=cache.get('c',async()=>{started++;return '123456';});await Promise.resolve();assert.equal(started,1);assert.equal(cache.stats().waiting,2);await assert.rejects(cache.get('d',async()=> '1'),/队列已满/);finish('1234');await a;await rejected;await c;assert.equal(cache.stats().bytes,4);assert.equal(cache.stats().cached,1);
  await cache.get('e',async()=> '123');assert.equal(cache.stats().bytes,3);
});
