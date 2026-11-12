import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {ParityStore,appearanceDefaults,validateAppearance,validateDraft,validateHistory} from '../electron/parity-store';

async function temporary(run:(directory:string)=>Promise<void>){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'seekdesk-parity-'));try{await run(directory);}finally{await fs.rm(directory,{recursive:true,force:true});}}
test('drafts survive restart and remain isolated by confirmed account owner',async()=>temporary(async directory=>{
  const store=new ParityStore(directory);await store.load();
  await store.saveDraft(101,'reply:42',{content:'账号 A 的回复',imageWidths:{'https://example.com/a.png':640}});
  await store.saveDraft(202,'reply:42',{content:'账号 B 的回复'});
  const editKey='edit:https://www.nodeseek.com/post-42-1:0';
  await store.saveDraft(101,editKey,{content:'编辑主题的 Markdown',title:'原始标题'});
  assert.equal(store.loadDraft(undefined,'reply:42'),null);
  assert.equal(store.loadDraft(303,'reply:42'),null);
  await assert.rejects(store.saveDraft(undefined,'reply:42',{content:'未确认账号'}),/登录/);
  const reloaded=new ParityStore(directory);await reloaded.load();
  assert.equal(reloaded.loadDraft(101,'reply:42')?.content,'账号 A 的回复');
  assert.deepEqual(reloaded.loadDraft(101,'reply:42')?.imageWidths,{'https://example.com/a.png':640});
  assert.equal(reloaded.loadDraft(202,'reply:42')?.content,'账号 B 的回复');
  assert.equal(reloaded.loadDraft(101,editKey)?.content,'编辑主题的 Markdown');
  await reloaded.saveDraft(202,'reply:42',null);assert.equal(reloaded.loadDraft(202,'reply:42'),null);
  assert.equal(reloaded.loadDraft(101,'reply:42')?.content,'账号 A 的回复');
}));
test('draft dictionaries do not expose inherited properties or permit prototype mutation',async()=>temporary(async directory=>{
  const store=new ParityStore(directory);await store.saveDraft(1,'reply:1',{content:'safe'});
  assert.equal(store.loadDraft(1,'constructor'),null);
  assert.equal(store.loadDraft(1,'toString'),null);
  await store.saveDraft(1,'__proto__',{content:'must remain an ordinary draft'});
  assert.equal(store.loadDraft(1,'content'),null);
  assert.equal(store.loadDraft(1,'__proto__')?.content,'must remain an ordinary draft');
  const reloaded=new ParityStore(directory);await reloaded.load();
  assert.equal(reloaded.loadDraft(1,'content'),null);
  assert.equal(reloaded.loadDraft(1,'__proto__')?.content,'must remain an ordinary draft');
}));
test('queued writes persist the latest account drafts without losing simultaneous changes',async()=>temporary(async directory=>{
  const store=new ParityStore(directory);
  await Promise.all(Array.from({length:12},(_,index)=>store.saveDraft(index%2+1,`reply:${index}`,{content:String(index)})));
  const reloaded=new ParityStore(directory);await reloaded.load();
  for(let index=0;index<12;index++)assert.equal(reloaded.loadDraft(index%2+1,`reply:${index}`)?.content,String(index));
  const files=await fs.readdir(directory);assert.deepEqual(files,['workspace-features.json']);
}));
test('invalid stored fields and drafts are discarded without removing valid account drafts',async()=>temporary(async directory=>{
  await fs.writeFile(path.join(directory,'workspace-features.json'),JSON.stringify({
    appearance:{...appearanceDefaults,nqScale:-1},extensions:{installed:['hot','unknown'],enabled:['hot','unknown']},history:'invalid',
    drafts:{'7':{'reply:1':{content:'survives'},'reply:2':{content:'x'.repeat(200001)},'bad\u0000key':{content:'bad'}},'-1':{'reply:1':{content:'invalid owner'}}},
  }));
  const store=new ParityStore(directory);await store.load();
  assert.deepEqual(store.appearance,appearanceDefaults);assert.deepEqual(store.extensions.installed,['hot']);assert.deepEqual(store.history,[]);
  assert.equal(store.loadDraft(7,'reply:1')?.content,'survives');assert.equal(store.loadDraft(7,'reply:2'),null);
  assert.equal(store.loadDraft(-1,'reply:1'),null);assert.throws(()=>store.loadDraft(7,'bad\u0000key'),/位置/);
}));
test('draft validation limits text, permissions, widths and locations before persistence',async()=>temporary(async directory=>{
  assert.equal(validateDraft({content:'x'.repeat(200000)})?.content.length,200000);
  assert.throws(()=>validateDraft({content:'x'.repeat(200001)}),/过长/);
  assert.throws(()=>validateDraft({content:'ok',rank:256}),/等级/);
  assert.throws(()=>validateDraft({content:'ok',imageWidths:{a:31}}),/尺寸/);
  assert.throws(()=>validateDraft({content:'ok',imageWidths:{a:Infinity}}),/尺寸/);
  const store=new ParityStore(directory);await assert.rejects(store.saveDraft(1,'bad\u0000key',{content:'bad key'}),/位置/);
  await assert.rejects(store.saveDraft(1,'reply:1',{content:42}),/正文/);assert.equal(store.loadDraft(1,'reply:1'),null);
}));
test('appearance and search history reject nonfinite data while retaining valid settings',()=>{
  assert.equal(validateAppearance({...appearanceDefaults,nqScale:125,autoRefresh:true}).nqScale,125);
  for(const input of [{...appearanceDefaults,listFontSize:NaN},{...appearanceDefaults,sidebarWidth:Infinity},{...appearanceDefaults,brand:'unknown'},{...appearanceDefaults,notificationPolling:1}])assert.throws(()=>validateAppearance(input));
  const entry={term:'香港 VPS',mode:'posts',categories:['tech','tech','trade'],date:'2026-11-11'};
  assert.deepEqual(validateHistory([entry])[0].categories,['tech','trade']);
  assert.throws(()=>validateHistory([{...entry,categories:['../']}]),/历史/);
  assert.throws(()=>validateHistory(Array.from({length:31},()=>entry)),/历史/);
});
test('all UI appearance slider bounds persist with percent scales unchanged',async()=>temporary(async directory=>{
  const bounds={sidebarWidth:[190,390],listWidth:[280,640],listFontSize:[14,28],authorFontSize:[80,160],boardFontSize:[13,24],rankingFontSize:[13,24],nqScale:[25,200],tqScale:[50,200]};
  for(const edge of [0,1]){
    const input={...appearanceDefaults,...Object.fromEntries(Object.entries(bounds).map(([key,range])=>[key,range[edge]]))};
    const store=new ParityStore(directory);store.appearance=validateAppearance(input);await store.save();
    const reloaded=new ParityStore(directory);await reloaded.load();assert.deepEqual(reloaded.appearance,input);
  }
  for(const [key,[lower,upper]] of Object.entries(bounds)){assert.throws(()=>validateAppearance({...appearanceDefaults,[key]:lower-1}));assert.throws(()=>validateAppearance({...appearanceDefaults,[key]:upper+1}));}
}));

test('older conversation contacts survive restart, deduplicate, keep names and remain account isolated',async()=>temporary(async directory=>{
  const store=new ParityStore(directory);
  await store.rememberConversationContact(101,{id:201,name:'Older peer',content:'must not persist'});
  await store.rememberConversationContact(101,{id:202,name:'Recent peer'});
  await store.rememberConversationContact(101,{id:201,name:''});
  await store.rememberConversationContact(102,{id:201,name:'Another account contact'});
  await store.rememberConversationContact(101,{id:101,name:'self'});
  assert.deepEqual(store.readConversationContacts(101),[{id:201,name:'Older peer'},{id:202,name:'Recent peer'}]);
  assert.deepEqual(store.readConversationContacts(undefined),[]);
  assert.deepEqual(store.readConversationContacts(999),[]);
  const reloaded=new ParityStore(directory);await reloaded.load();
  assert.deepEqual(reloaded.readConversationContacts(101),store.readConversationContacts(101));
  assert.deepEqual(reloaded.readConversationContacts(102),[{id:201,name:'Another account contact'}]);
  assert.doesNotMatch(await fs.readFile(path.join(directory,'workspace-features.json'),'utf8'),/must not persist/);
  await assert.rejects(store.rememberConversationContact(undefined,{id:201,name:'invalid owner'}),/账号/);
  await assert.rejects(store.rememberConversationContact(101,{id:-2,name:'invalid peer'}),/联系人/);
  await assert.rejects(store.rememberConversationContact(101,{id:3,name:'bad\u0000name'}),/联系人/);
}));
test('private-message drafts retain an explicit plain-text flag',()=>{
  assert.equal(validateDraft({content:'**literal**',markdown:false})?.markdown,false);
  assert.equal(validateDraft({content:'**bold**',markdown:true})?.markdown,true);
  assert.throws(()=>validateDraft({content:'text',markdown:'false'}),/格式/);
});
