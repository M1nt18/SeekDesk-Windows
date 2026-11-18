import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeThreadPage,isThreadCommentVisible,countAddedVisibleComments} from '../shared/thread-stream';
import type {Comment,ThreadResult} from '../shared/types';

const url=(page:number,id='123')=>'https://www.nodeseek.com/post-'+id+'-'+page;
const comment=(id:string,patch:Partial<Comment>={}):Comment=>({id,author:'Member '+id,authorId:42,date:'2026-11-13T00:00:00Z',floor:id==='0'?'楼主':'#'+id,html:'<p>Floor '+id+'</p>',...patch});
const page=(number:number,patch:Partial<ThreadResult>={}):ThreadResult=>({id:'123',url:url(number),title:'Thread title',source:'web',page:number,nextPage:number+1,comments:[comment('0',{isAuthor:true}),comment(String((number-1)*2+1)),comment(String((number-1)*2+2))],...patch});
const links=(...numbers:number[])=>numbers.map(number=>({number,url:url(number)}));

test('continuation counts new visible floors rather than hidden replies or duplicate HOT copies',()=>{
  const first=page(1,{rootAuthorId:99}),ordinary=mergeThreadPage(first,page(2,{rootAuthorId:99}));
  assert.equal(countAddedVisibleComments(first,ordinary,false),2);
  assert.equal(countAddedVisibleComments(first,ordinary,true),0);
  const withOwner=mergeThreadPage(first,page(2,{rootAuthorId:99,comments:[comment('0',{isAuthor:true}),comment('3',{authorId:99}),comment('4')]}));
  assert.equal(countAddedVisibleComments(first,withOwner,true),1);
  assert.equal(countAddedVisibleComments(first,ordinary,true,'4'),1);
  assert.equal(isThreadCommentVisible(comment('8',{authorId:undefined}),undefined,true),false);
  const repeated=mergeThreadPage(first,page(2,{comments:first.comments}));
  assert.equal(countAddedVisibleComments(first,repeated,false),0);
});

test('pages one to two to three append replies in order while the original post appears only once',()=>{
  const first=page(1),second=page(2),third=page(3,{nextPage:null});
  const merged=mergeThreadPage(mergeThreadPage(first,second),third);
  assert.deepEqual(merged.comments.map(item=>item.id),['0','1','2','3','4','5','6']);
  assert.equal(merged.url,url(3));assert.equal(merged.page,3);assert.equal(merged.nextPage,null);
  assert.equal(merged.comments[0],first.comments[0]);assert.equal(merged.comments[1],first.comments[1]);
  assert.equal(merged.comments[3],second.comments[1]);assert.equal(merged.comments[5],third.comments[1]);
});

test('duplicate HOT floors update real zero/false reactions in place without losing complete text, badges or their original action page',()=>{
  const hot=comment('85',{html:'<p>A complete reply with more details than its repeated hot preview</p>',level:4,role:'贡献者',signature:'Full public signature',isHot:true,isPinned:true,isOwn:true,likes:8,chicken:3,dislikes:2,liked:true,gaveChicken:true,disliked:true,following:true,sourcePage:9,actionUrl:url(9)+'#85'});
  const first=page(1,{comments:[comment('0'),hot,comment('1')]});
  const next=page(2,{comments:[comment('0'),comment('85',{author:'NodeSeek 用户',html:'<p>Preview</p>',level:undefined,role:'',signature:'',isHot:false,isPinned:false,isOwn:false,likes:0,chicken:0,dislikes:0,liked:false,gaveChicken:false,disliked:false,following:false}),comment('3')]});
  const merged=mergeThreadPage(first,next),updated=merged.comments[1];
  assert.deepEqual(merged.comments.map(item=>item.id),['0','85','1','3']);
  assert.equal(updated.html,hot.html);assert.equal(updated.author,hot.author);assert.equal(updated.level,4);assert.equal(updated.role,'贡献者');assert.equal(updated.signature,hot.signature);
  assert.equal(updated.sourcePage,9);assert.equal(updated.actionUrl,url(9)+'#85');
  assert.equal(updated.isHot,true);assert.equal(updated.isPinned,true);assert.equal(updated.isOwn,true);
  assert.equal(updated.likes,0);assert.equal(updated.chicken,0);assert.equal(updated.dislikes,0);
  assert.equal(updated.liked,false);assert.equal(updated.gaveChicken,false);assert.equal(updated.disliked,false);assert.equal(updated.following,false);
  assert.notEqual(updated,hot);assert.equal(hot.likes,8);assert.equal(hot.liked,true);
});

test('a later copy can fill a missing original action page and richer profile fields including legitimate level zero',()=>{
  const first=page(1,{comments:[comment('0'),comment('25',{author:'NodeSeek 用户',html:'',isHot:true,date:'昨天'})]});
  const next=page(2,{comments:[comment('25',{author:'Real name',level:0,html:'<p>Actual reply</p>',date:'2026-11-13T00:00:00Z',role:'成员',signatureHtml:'<a href="https://example.com">Website</a>',sourcePage:3,actionUrl:url(3)+'#comment-25'})]});
  const merged=mergeThreadPage(first,next),hot=merged.comments[1];
  assert.equal(hot.author,'Real name');assert.equal(hot.level,0);assert.equal(hot.html,'<p>Actual reply</p>');assert.equal(hot.date,'2026-11-13T00:00:00Z');
  assert.equal(hot.sourcePage,3);assert.equal(hot.actionUrl,url(3)+'#comment-25');assert.equal(hot.isHot,true);
  const sparse=mergeThreadPage(merged,page(3,{comments:[comment('25',{date:'昨天',html:'',signatureHtml:'',sourcePage:undefined,actionUrl:undefined})]}));
  assert.equal(sparse.comments[1].date,hot.date);assert.equal(sparse.comments[1].signatureHtml,hot.signatureHtml);assert.equal(sparse.comments[1].actionUrl,hot.actionUrl);
});

test('only the advertised later page is accepted; duplicates, reversals, missing next and another post are rejected',()=>{
  const first=page(1);
  for(const wrong of [page(1),page(3),page(2,{id:'124',url:url(2,'124')}),page(2,{url:url(1)})])assert.throws(()=>mergeThreadPage(first,wrong),/分页|下一页|页码/);
  assert.throws(()=>mergeThreadPage(page(2),page(1)),/页码/);
  assert.throws(()=>mergeThreadPage(page(1,{nextPage:null}),page(2)),/页码/);
  assert.throws(()=>mergeThreadPage(page(1,{nextPage:1}),page(1)),/页码/);
});

test('RSS and forged page identities cannot enter a live official reply stream',()=>{
  assert.throws(()=>mergeThreadPage(page(1,{source:'rss'}),page(2)),/官网/);
  assert.throws(()=>mergeThreadPage(page(1),page(2,{source:'rss'})),/官网/);
  for(const forged of ['https://evil.test/post-123-2','http://www.nodeseek.com/post-123-2','https://user:password@www.nodeseek.com/post-123-2','https://www.nodeseek.com:444/post-123-2',url(2,'124')])assert.throws(()=>mergeThreadPage(page(1),page(2,{url:forged})),/位置/);
  assert.throws(()=>mergeThreadPage(page(1),page(2,{comments:[comment('')]})),/内容/);
});

test('only the new page supplies forward navigation and cyclic or malformed next pointers stop the stream',()=>{
  for(const nextPage of [null,0,1,2,-1,2.5,Number.NaN,Number.POSITIVE_INFINITY,100001])assert.equal(mergeThreadPage(page(1),page(2,{nextPage})).nextPage,null);
  assert.equal(mergeThreadPage(page(1),page(2,{nextPage:3})).nextPage,3);
  assert.equal(mergeThreadPage(page(1),page(2,{nextPage:null,totalPages:9})).nextPage,null,'Known totals cannot invent a missing next link');
});

test('page links merge by real page number and discard foreign, mismatched and malformed metadata',()=>{
  const first=page(1,{pages:[...links(1,2,50),{number:7,url:'https://evil.test/post-123-7'},{number:8,url:url(8,'124')},{number:9,url:url(10)}]});
  const next=page(2,{pages:[{number:2,url:'/post-123-2?ignored=1#4'},...links(3),{number:-1,url:url(3)},{number:4,url:'javascript:alert(1)'}]});
  const merged=mergeThreadPage(first,next);
  assert.deepEqual(merged.pages,links(1,2,3,50));assert.equal(merged.totalPages,undefined,'Maximum observed links are not a true total');
});

test('explicit trustworthy total survives absent metadata but a new smaller last page replaces stale old links',()=>{
  const first=page(1,{totalPages:50,pages:links(1,2,3,50)});
  const unknown=mergeThreadPage(first,page(2,{totalPages:undefined}));assert.equal(unknown.totalPages,50);
  const shorter=mergeThreadPage(first,page(2,{totalPages:3,pages:links(1,2,3)}));assert.equal(shorter.totalPages,3);assert.deepEqual(shorter.pages,links(1,2,3));
  const contradiction=mergeThreadPage(first,page(2,{totalPages:2,nextPage:3}));assert.equal(contradiction.totalPages,50);
  const invalid=mergeThreadPage(page(1),page(2,{totalPages:1}));assert.equal(invalid.totalPages,undefined);
});

test('partial thread metadata does not erase the known title, root identity, notices or reply restrictions',()=>{
  const first=page(1,{rootAuthorId:42,notice:'Known notice',replyRestriction:'只读'});
  const merged=mergeThreadPage(first,page(2,{title:'',rootAuthorId:undefined,notice:undefined,replyRestriction:''}));
  assert.equal(merged.title,'Thread title');assert.equal(merged.rootAuthorId,42);assert.equal(merged.notice,'Known notice');assert.equal(merged.replyRestriction,'只读');
});

test('duplicates inside a page collapse without reordering retained floors or mutating frozen inputs',()=>{
  const frozen=(value:ThreadResult)=>{value.comments.forEach(Object.freeze);Object.freeze(value.comments);value.pages?.forEach(Object.freeze);if(value.pages)Object.freeze(value.pages);return Object.freeze(value);};
  const root=comment('0'),normal=comment('1');
  const first=frozen(page(1,{comments:[root,normal,root],pages:links(1,2)}));
  const second=frozen(page(2,{comments:[comment('0'),comment('3',{likes:1}),comment('3',{likes:2}),comment('4')],pages:links(2,3)}));
  const beforeFirst=JSON.stringify(first),beforeSecond=JSON.stringify(second),merged=mergeThreadPage(first,second);
  assert.deepEqual(merged.comments.map(item=>item.id),['0','1','3','4']);assert.equal(merged.comments[2].likes,2);
  assert.equal(merged.comments[0],root);assert.equal(merged.comments[1],normal);assert.notEqual(merged.comments,first.comments);
  assert.equal(JSON.stringify(first),beforeFirst);assert.equal(JSON.stringify(second),beforeSecond);
});

test('an incomplete or forged HOT action location cannot overwrite a known genuine original page',()=>{
  const original=comment('25',{isHot:true,sourcePage:3,actionUrl:url(3)+'#25'});
  const first=page(1,{comments:[comment('0'),original]});
  for(const patch of [{sourcePage:2},{sourcePage:2,actionUrl:url(3)+'#25'},{sourcePage:3,actionUrl:'https://evil.test/post-123-3#25'},{sourcePage:3,actionUrl:url(3)+'#26'}]){
    const merged=mergeThreadPage(first,page(2,{comments:[comment('25',{isHot:true,...patch})]}));
    assert.equal(merged.comments[1].sourcePage,3);assert.equal(merged.comments[1].actionUrl,url(3)+'#25');
  }
});

test('a confirmed private denial on the next page discards previously displayed floors',()=>{
  const previous={id:'123',url:'https://www.nodeseek.com/post-123-1',title:'Visible before',source:'web' as const,page:1,nextPage:2,comments:[{id:'0',author:'Owner',floor:'楼主',date:'',html:'previous visible content'}]};
  const denied={id:'123',url:'https://www.nodeseek.com/post-123-2',title:'私有帖子',source:'web' as const,page:2,nextPage:null,comments:[],accessStatus:'private' as const};
  const merged=mergeThreadPage(previous,denied);assert.equal(merged.accessStatus,'private');assert.deepEqual(merged.comments,[]);assert.equal(merged.nextPage,null);assert.equal(previous.comments.length,1);
});
