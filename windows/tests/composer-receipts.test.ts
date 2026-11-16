import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptComposerSubmission,beginComposerSubmission,composerReceiptState,editComposerDraft,getPendingComposerSubmissionCount,rejectComposerSubmission,restoreComposerDraft,sameComposerSnapshot} from '../src/composer-receipts';

const draft={title:'Topic',content:'Identical accepted content',category:'daily',rank:0,imageWidths:{}};

test('a pending snapshot cannot be posted twice and acceptance survives the old view finalizer',()=>{
  const intent=editComposerDraft(8101,'new-topic',draft),first=beginComposerSubmission(8101,'new-topic',draft,intent)!;
  assert.ok(first);assert.equal(getPendingComposerSubmissionCount(),1);assert.equal(beginComposerSubmission(8101,'new-topic',draft,intent),undefined);
  acceptComposerSubmission(first);rejectComposerSubmission(first);
  assert.equal(getPendingComposerSubmissionCount(),0);assert.equal(composerReceiptState(8101,'new-topic',draft,intent),'accepted');
  assert.equal(beginComposerSubmission(8101,'new-topic',draft,intent),undefined);
});

test('an unchanged newly opened view is cleared when the older POST is accepted',()=>{
  const intent=editComposerDraft(8102,'new-topic',draft),ticket=beginComposerSubmission(8102,'new-topic',draft,intent)!;
  const reopened=restoreComposerDraft(8102,'new-topic',draft);assert.equal(reopened.snapshot.content,draft.content);assert.equal(composerReceiptState(8102,'new-topic',reopened.snapshot,reopened.intent),'pending');
  acceptComposerSubmission(ticket);
  assert.equal(composerReceiptState(8102,'new-topic',reopened.snapshot,reopened.intent),'accepted');
  const next=restoreComposerDraft(8102,'new-topic',draft);assert.equal(next.snapshot.content,'');assert.equal(next.snapshot.title,'');
  assert.equal(composerReceiptState(8102,'new-topic',draft,0),'accepted');
});

test('newly edited content wins over both an old accepted response and a delayed disk snapshot',()=>{
  const oldIntent=editComposerDraft(8103,'new-topic',draft),ticket=beginComposerSubmission(8103,'new-topic',draft,oldIntent)!;
  const newer={...draft,title:'New title',content:'Keep this new unsent body'},newIntent=editComposerDraft(8103,'new-topic',newer);
  acceptComposerSubmission(ticket);
  const reopened=restoreComposerDraft(8103,'new-topic',draft);assert.deepEqual(reopened.snapshot,newer);assert.equal(reopened.intent,newIntent);assert.equal(composerReceiptState(8103,'new-topic',reopened.snapshot,reopened.intent),'none');
  const next=beginComposerSubmission(8103,'new-topic',reopened.snapshot,reopened.intent)!;assert.ok(next);rejectComposerSubmission(next);
});

test('a deliberate later edit may repeat the exact text, including after another remount',()=>{
  const initial=editComposerDraft(8104,'message:99',{content:'OK',markdown:false,imageWidths:{}}),ticket=beginComposerSubmission(8104,'message:99',{content:'OK',markdown:false},initial)!;
  acceptComposerSubmission(ticket);
  assert.equal(composerReceiptState(8104,'message:99',{content:'OK',markdown:false},0),'accepted');
  const explicit=editComposerDraft(8104,'message:99',{content:'OK',markdown:false,imageWidths:{}}),reopened=restoreComposerDraft(8104,'message:99',{content:'old cache',markdown:true});
  assert.equal(reopened.intent,explicit);assert.equal(reopened.snapshot.content,'OK');assert.equal(composerReceiptState(8104,'message:99',reopened.snapshot,reopened.intent),'none');
  const repeated=beginComposerSubmission(8104,'message:99',reopened.snapshot,reopened.intent)!;assert.ok(repeated);rejectComposerSubmission(repeated);
});

test('an explicit edit while a prior identical message is pending waits, then stays as a new draft',()=>{
  const snapshot={content:'Same text',markdown:true},initial=editComposerDraft(8105,'message:12',snapshot),ticket=beginComposerSubmission(8105,'message:12',snapshot,initial)!;
  const explicit=editComposerDraft(8105,'message:12',snapshot);
  assert.equal(beginComposerSubmission(8105,'message:12',snapshot,explicit),undefined);
  acceptComposerSubmission(ticket);
  assert.equal(composerReceiptState(8105,'message:12',snapshot,explicit),'none');assert.equal(restoreComposerDraft(8105,'message:12',{content:''}).snapshot.content,'Same text');
});

test('accepted memory tombstones prevent a failed local cleanup from restoring the old send buffer',()=>{
  const staleCache={content:'Already sent',markdown:true,imageWidths:{}},intent=editComposerDraft(8106,'message:40',staleCache),ticket=beginComposerSubmission(8106,'message:40',staleCache,intent)!;
  acceptComposerSubmission(ticket);
  const afterFailedCleanup=restoreComposerDraft(8106,'message:40',staleCache);assert.equal(afterFailedCleanup.snapshot.content,'');assert.equal(staleCache.content,'Already sent');
  assert.equal(beginComposerSubmission(8106,'message:40',staleCache,0),undefined);
  assert.equal(composerReceiptState(8107,'message:40',staleCache,0),'none');
});

test('edit receipts retain the saved body and replace stale local edit caches with authoritative source',()=>{
  const snapshot={...draft,content:'Saved edited body'},intent=editComposerDraft(8108,'edit:123:1',snapshot),ticket=beginComposerSubmission(8108,'edit:123:1',snapshot,intent)!;
  acceptComposerSubmission(ticket);
  assert.equal(restoreComposerDraft(8108,'edit:123:1',{...draft,content:'Stale pre-save draft'}).snapshot.content,'Saved edited body');
  const fresh={...snapshot,content:'Current original source'};assert.deepEqual(restoreComposerDraft(8108,'edit:123:1',draft,{authoritativeEdit:fresh}).snapshot,fresh);
  assert.equal(restoreComposerDraft(8108,'edit:123:1',draft).snapshot.content,'Current original source');
});

test('snapshot matching covers formatting, permissions and dimensions without depending on width map order',()=>{
  const first={...draft,imageWidths:{'https://b.test/2.png':100,'https://a.test/1.png':200}};
  assert.equal(sameComposerSnapshot(first,{...first,imageWidths:{'https://a.test/1.png':200,'https://b.test/2.png':100}}),true);
  for(const changed of [{...first,title:'Other'},{...first,rank:255},{...first,markdown:false},{...first,imageWidths:{'https://b.test/2.png':200}}])assert.equal(sameComposerSnapshot(first,changed),false);
  assert.equal(beginComposerSubmission(0,'new-topic',draft),undefined);assert.equal(beginComposerSubmission(8109,'',draft),undefined);
});
