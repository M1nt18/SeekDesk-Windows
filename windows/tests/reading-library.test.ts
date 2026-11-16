import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ReadingLibraryStore,validateLibraryPost,validateLibraryMutation} from '../electron/reading-library';
import type {Post} from '../shared/types';

const post=(id:string,patch:Partial<Post>={}):Post=>({id,url:'https://www.nodeseek.com/post-'+id+'-1',title:'主题 '+id,author:'作者',category:'tech',published:'2026-11-14T00:00:00.000Z',summary:'untrusted HTML must never be persisted',...patch});
async function temporary(run:(directory:string)=>Promise<void>){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-library-'));try{await run(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}

test('library post validation binds a canonical official location to its own ID and drops private extras',()=>{
  const value=validateLibraryPost({...post('42'),url:'https://nodeseek.com/post-42-3?tracking=yes#comment-5',cookie:'secret',avatar:'https://private.invalid/avatar',readingRank:255});
  assert.deepEqual(value,{id:'42',url:'https://www.nodeseek.com/post-42-3#comment-5',title:'主题 42',author:'作者',category:'tech',published:'2026-11-14T00:00:00.000Z',summary:''});
  for(const url of ['http://www.nodeseek.com/post-42-1','https://nodeseek.com.evil.test/post-42-1','https://user:pass@nodeseek.com/post-42-1','file:///post-42-1','https://www.nodeseek.com/post-43-1','https://www.nodeseek.com/post-42-100001'])assert.throws(()=>validateLibraryPost(post('42',{url})));
  for(const patch of [{id:'__proto__'},{id:'0'},{title:''},{title:'x'.repeat(501)},{author:'x'.repeat(201)},{category:'x'.repeat(65)},{title:'bad\u0000title'}])assert.throws(()=>validateLibraryPost({...post('42'),...patch}));
  assert.deepEqual(validateLibraryMutation({kind:'history-remove',postId:'42',extra:'discarded'}),{kind:'history-remove',postId:'42'});
  for(const request of [null,{}, {kind:'visit'}, {kind:'clear-all'}, {kind:'bookmark-remove',postId:'../42'}])assert.throws(()=>validateLibraryMutation(request));
});

test('same-title posts remain separate while history visits never replace a pinned bookmark',async()=>temporary(async directory=>{
  let time=Date.parse('2026-11-14T00:00:00Z');const store=new ReadingLibraryStore(directory,{now:()=>++time});await store.load();
  await store.mutate(101,{kind:'visit',post:post('1',{title:'相同标题'})});
  await store.mutate(101,{kind:'visit',post:post('2',{title:'相同标题'})});
  await store.mutate(101,{kind:'bookmark-toggle',post:post('1',{title:'相同标题'})});
  await store.mutate(101,{kind:'visit',post:post('1',{title:'更新后的标题',url:'https://www.nodeseek.com/post-1-3#9'})});
  const state=store.read(101);
  assert.deepEqual(state.history.map(entry=>entry.post.id),['1','2']);assert.equal(state.bookmarks.length,1);
  assert.equal(state.history[0].post.title,'更新后的标题');assert.equal(state.history[0].post.url,'https://www.nodeseek.com/post-1-3#9');
  assert.equal(state.bookmarks[0].post.title,'相同标题');assert.equal(state.bookmarks[0].post.url,'https://www.nodeseek.com/post-1-1');
  assert.ok(Date.parse(state.history[0].visitedAt)>Date.parse(state.history[1].visitedAt));
}));

test('bookmark-add is atomic and idempotent before or after restarting and preserves its exact saved page',async()=>temporary(async directory=>{
  const store=new ReadingLibraryStore(directory);await store.load();
  const saved=post('42',{url:'https://www.nodeseek.com/post-42-2#4'});
  await Promise.all([store.mutate(1,{kind:'bookmark-add',post:saved}),store.mutate(1,{kind:'bookmark-add',post:saved})]);
  const original=store.read(1).bookmarks[0];await store.mutate(1,{kind:'visit',post:post('42')});
  const restarted=new ReadingLibraryStore(directory);await restarted.load();
  await restarted.mutate(1,{kind:'bookmark-add',post:post('42')});
  assert.equal(restarted.read(1).bookmarks.length,1);assert.deepEqual(restarted.read(1).bookmarks[0],original);
  assert.equal(restarted.read(1).history[0].post.url,'https://www.nodeseek.com/post-42-1');
}));

test('localized RSS category labels remain display metadata rather than being rejected as URL slugs',async()=>temporary(async directory=>{
  const store=new ReadingLibraryStore(directory);await store.load();
  await store.mutate(undefined,{kind:'bookmark-add',post:post('42',{category:'技术 讨论'})});
  const restored=new ReadingLibraryStore(directory);await restored.load();
  assert.equal(restored.read(undefined).bookmarks[0].post.category,'技术 讨论');
  assert.equal(restored.read(undefined).bookmarks[0].post.summary,'');
}));

test('guest and confirmed-account libraries survive restart without exposing each other',async()=>temporary(async directory=>{
  const store=new ReadingLibraryStore(directory);await store.load();
  await store.mutate(undefined,{kind:'bookmark-toggle',post:post('1',{title:'公开记录'})});
  await store.mutate(101,{kind:'bookmark-toggle',post:post('2',{title:'账号 A 记录'})});
  await store.mutate(202,{kind:'visit',post:post('3',{title:'账号 B 记录'})});
  const restarted=new ReadingLibraryStore(directory);await restarted.load();
  assert.deepEqual(restarted.read(undefined).bookmarks.map(entry=>entry.post.id),['1']);
  assert.deepEqual(restarted.read(101).bookmarks.map(entry=>entry.post.id),['2']);assert.deepEqual(restarted.read(101).history,[]);
  assert.deepEqual(restarted.read(202).history.map(entry=>entry.post.id),['3']);assert.deepEqual(restarted.read(202).bookmarks,[]);
  assert.deepEqual(restarted.read(303),{bookmarks:[],history:[]});
  for(const owner of [0,-1,NaN,Infinity,1.5,10_000_000_000])assert.throws(()=>restarted.read(owner));
  await assert.rejects(restarted.mutate(-1,{kind:'clear-history'}),/账号/);
  const saved=await fs.readFile(path.join(directory,'reading-library.json'),'utf8');assert.doesNotMatch(saved,/untrusted HTML|private\.invalid|cookie/);
  assert.deepEqual(await fs.readdir(directory),['reading-library.json']);
}));

test('history retains the latest 200 unique IDs without evicting an older bookmark',async()=>temporary(async directory=>{
  let time=Date.parse('2026-11-14T00:00:00Z');const store=new ReadingLibraryStore(directory,{now:()=>++time});await store.load();
  await store.mutate(1,{kind:'bookmark-toggle',post:post('1')});
  await Promise.all(Array.from({length:205},(_,index)=>store.mutate(1,{kind:'visit',post:post(String(index+1))})));
  const state=store.read(1);assert.equal(state.history.length,200);assert.equal(state.history[0].post.id,'205');assert.equal(state.history.at(-1)?.post.id,'6');assert.equal(state.bookmarks[0].post.id,'1');
  const restarted=new ReadingLibraryStore(directory);await restarted.load();assert.deepEqual(restarted.read(1),state);
}));

test('concurrent account mutations serialize without dropping unrelated entries and snapshots are independent',async()=>temporary(async directory=>{
  const store=new ReadingLibraryStore(directory);await store.load();
  const requests=Array.from({length:20},(_,index)=>store.mutate(index%2+1,{kind:'bookmark-toggle',post:post(String(index+1))}));
  const results=await Promise.all(requests);assert.equal(store.read(1).bookmarks.length,10);assert.equal(store.read(2).bookmarks.length,10);
  results.at(-1)!.bookmarks[0].post.title='mutated return value';
  const copy=store.read(1);copy.bookmarks.length=0;
  assert.equal(store.read(1).bookmarks.length,10);assert.ok(!store.read(2).bookmarks.some(entry=>entry.post.title==='mutated return value'));
  const restarted=new ReadingLibraryStore(directory);await restarted.load();assert.deepEqual(restarted.read(1),store.read(1));assert.deepEqual(restarted.read(2),store.read(2));
}));

test('a clock correction cannot reorder actual reading visits after restart',async()=>temporary(async directory=>{
  let time=2_000;const store=new ReadingLibraryStore(directory,{now:()=>time});await store.load();
  await store.mutate(1,{kind:'visit',post:post('1')});time=1_000;await store.mutate(1,{kind:'visit',post:post('2')});
  const restarted=new ReadingLibraryStore(directory);await restarted.load();assert.deepEqual(restarted.read(1).history.map(entry=>entry.post.id),['2','1']);
}));

test('bookmarks remove and clear independently from history and other account scopes',async()=>temporary(async directory=>{
  const store=new ReadingLibraryStore(directory);await store.load();
  for(const id of ['1','2']){await store.mutate(1,{kind:'visit',post:post(id)});await store.mutate(1,{kind:'bookmark-toggle',post:post(id)});}
  await store.mutate(2,{kind:'visit',post:post('3')});
  await store.mutate(1,{kind:'bookmark-remove',postId:'1'});assert.deepEqual(store.read(1).bookmarks.map(entry=>entry.post.id),['2']);assert.equal(store.read(1).history.length,2);
  await store.mutate(1,{kind:'history-remove',postId:'2'});assert.deepEqual(store.read(1).history.map(entry=>entry.post.id),['1']);assert.equal(store.read(1).bookmarks.length,1);
  await store.mutate(1,{kind:'clear-bookmarks'});assert.equal(store.read(1).bookmarks.length,0);assert.equal(store.read(1).history.length,1);
  await store.mutate(1,{kind:'clear-history'});assert.deepEqual(store.read(1),{bookmarks:[],history:[]});assert.equal(store.read(2).history.length,1);
}));

test('a full bookmark collection rejects additions without truncation and still permits removal',async()=>temporary(async directory=>{
  const bookmarks=Array.from({length:500},(_,index)=>({post:post(String(index+1),{summary:''}),visitedAt:'2026-11-14T00:00:00.000Z'}));
  const target=path.join(directory,'reading-library.json');await fs.writeFile(target,JSON.stringify({version:1,libraries:{'user:1':{bookmarks,history:[]}}}));
  const store=new ReadingLibraryStore(directory);await store.load();const original=await fs.readFile(target,'utf8');
  await assert.rejects(store.mutate(1,{kind:'bookmark-toggle',post:post('501')}),/500/);assert.equal(store.read(1).bookmarks.length,500);assert.equal(await fs.readFile(target,'utf8'),original);
  await store.mutate(1,{kind:'bookmark-toggle',post:post('1')});await store.mutate(1,{kind:'bookmark-toggle',post:post('501')});assert.equal(store.read(1).bookmarks.length,500);assert.ok(store.read(1).bookmarks.some(entry=>entry.post.id==='501'));
}));

test('failed atomic replacement preserves both prior disk data and memory, and a later retry succeeds',async()=>temporary(async directory=>{
  let fail=false;
  const io={...fs,rename:async(...args:Parameters<typeof fs.rename>)=>{if(fail){fail=false;throw new Error('private filesystem path must not be exposed');}return fs.rename(...args);}};
  const store=new ReadingLibraryStore(directory,{fileSystem:io});await store.load();await store.mutate(1,{kind:'bookmark-toggle',post:post('1')});
  const target=path.join(directory,'reading-library.json'),before=await fs.readFile(target,'utf8');fail=true;
  await assert.rejects(store.mutate(1,{kind:'bookmark-toggle',post:post('2')}),error=>error instanceof Error&&!/private filesystem/.test(error.message)&&/原资料已保留/.test(error.message));
  assert.equal(await fs.readFile(target,'utf8'),before);assert.deepEqual(store.read(1).bookmarks.map(entry=>entry.post.id),['1']);assert.deepEqual(await fs.readdir(directory),['reading-library.json']);
  await store.mutate(1,{kind:'bookmark-toggle',post:post('2')});assert.deepEqual(store.read(1).bookmarks.map(entry=>entry.post.id),['2','1']);
}));

test('corrupt and externally changed files are retained instead of replaced with an empty library',async()=>temporary(async directory=>{
  const target=path.join(directory,'reading-library.json'),broken='{broken private records';await fs.writeFile(target,broken);
  const store=new ReadingLibraryStore(directory);await store.load();assert.throws(()=>store.read(1),/原文件已保留/);
  await assert.rejects(store.mutate(1,{kind:'clear-history'}),/原文件已保留/);assert.equal(await fs.readFile(target,'utf8'),broken);
  await fs.writeFile(target,JSON.stringify({version:1,libraries:{}}));await store.load();assert.deepEqual(store.read(1),{bookmarks:[],history:[]});
  await store.mutate(1,{kind:'visit',post:post('1')});
  const external=JSON.stringify({version:1,libraries:{public:{bookmarks:[],history:[]}}});await fs.writeFile(target,external);
  await assert.rejects(store.mutate(1,{kind:'visit',post:post('2')}),/原资料已保留/);assert.equal(await fs.readFile(target,'utf8'),external);assert.deepEqual(store.read(1).history.map(entry=>entry.post.id),['1']);
}));

test('malformed saved records cannot be loaded or laundered through a later write',async()=>temporary(async directory=>{
  const target=path.join(directory,'reading-library.json');const malformed={version:1,libraries:{'user:1':{bookmarks:[{post:post('1',{url:'https://evil.invalid/post-1-1'}),visitedAt:'2026-11-14'}],history:[]}}};
  await fs.writeFile(target,JSON.stringify(malformed));const store=new ReadingLibraryStore(directory);await store.load();assert.throws(()=>store.read(1),/原文件已保留/);await assert.rejects(store.mutate(1,{kind:'visit',post:post('2')}));assert.deepEqual(JSON.parse(await fs.readFile(target,'utf8')),malformed);
}));
