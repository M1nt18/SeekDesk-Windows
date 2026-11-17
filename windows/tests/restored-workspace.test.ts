import test from 'node:test';
import assert from 'node:assert/strict';
import {restoredWorkspace} from '../shared/restored-workspace';

test('the startup IPC snapshot retains locations without forwarding prior-session post metadata',()=>{
  const snapshot=restoredWorkspace({tabs:[{id:'123',url:'https://www.nodeseek.com/post-123-3#17',title:'PRIVATE_TITLE_SENTINEL',author:'PRIVATE_AUTHOR_SENTINEL',category:'PRIVATE_CATEGORY_SENTINEL',published:'PRIVATE_DATE_SENTINEL',summary:'PRIVATE_SUMMARY_SENTINEL',avatar:'https://example.test/PRIVATE_AVATAR_SENTINEL.png',authorId:9988,readingRank:255,featured:true}],activeId:'123',overviewOpen:false,listHidden:true,scrollPositions:{123:100},readingAnchors:{123:{page:3,floor:'17',offset:20}}});
  assert.equal(JSON.stringify(snapshot).includes('PRIVATE_'),false);
  assert.deepEqual(Object.keys(snapshot.tabs[0]).sort(),['author','category','id','published','summary','title','url']);
  assert.equal(snapshot.tabs[0].title,'帖子 #123');assert.equal(snapshot.tabs[0].url,'https://www.nodeseek.com/post-123-3#17');
  assert.equal(snapshot.activeId,'123');assert.equal(snapshot.listHidden,true);assert.deepEqual(snapshot.readingAnchors?.['123'],{page:3,floor:'17',offset:20});
});
test('restored snapshots cannot mutate the stored reading positions and anchors',()=>{
  const original={tabs:[],activeId:null,scrollPositions:{123:100},readingAnchors:{123:{page:3,floor:'17',offset:20}}};
  const copy=restoredWorkspace(original);copy.scrollPositions!['123']=900;copy.readingAnchors!['123'].offset=300;
  assert.equal(original.scrollPositions[123],100);assert.equal(original.readingAnchors[123].offset,20);
});
