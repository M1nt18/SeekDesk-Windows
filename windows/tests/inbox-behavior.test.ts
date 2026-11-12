import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {inboxLinkedPost,noticePost,noticeComment,preferredInboxCategory} from '../shared/notifications';
import {mergeExtensionEdits} from '../shared/extension-edits';
import {defaultExtensions} from '../electron/extensions';
import type {ForumNotice} from '../shared/parity';
import type {ThreadResult} from '../shared/types';

const notice:ForumNotice={id:'9',author:'Example',title:'A topic',date:'2026-11-12T02:00:00Z',unread:true,postId:123,floor:25,url:'https://www.nodeseek.com/post-123-3#25'};
test('notice preview retains the actual page and floor, rejecting external or mismatched targets',()=>{
  const post=noticePost(notice);assert.equal(post.url,notice.url);assert.equal(post.id,'123');
  for(const url of ['https://evil.test/post-123-3','https://www.nodeseek.com/post-456-3','https://bad@www.nodeseek.com/post-123-3','https://www.nodeseek.com:444/post-123-3','javascript:alert(1)'])assert.throws(()=>noticePost({...notice,url}));
});
test('notice preview displays only its exact official floor, never an RSS summary or another topic',()=>{
  const thread:ThreadResult={id:'123',url:notice.url,title:notice.title,source:'web',page:3,nextPage:null,comments:[{id:'24',author:'A',date:'',floor:'#24',html:'Wrong floor'},{id:'25',author:'B',date:'',floor:'#25',html:'<p>Exact reply</p>'}]};
  assert.equal(noticeComment(thread,notice)?.html,'<p>Exact reply</p>');
  assert.equal(noticeComment({...thread,source:'rss'},notice),undefined);
  assert.equal(noticeComment({...thread,id:'456'},notice),undefined);
  assert.equal(noticeComment({...thread,comments:thread.comments.slice(0,1)},notice),undefined);
});
test('inbox initially selects a real unread category and falls back to mentions',()=>{
  assert.equal(preferredInboxCategory({mentions:0,replies:3,messages:9}),'replies');
  assert.equal(preferredInboxCategory({mentions:0,replies:0,messages:9}),'messages');
  assert.equal(preferredInboxCategory({mentions:2,replies:3,messages:9}),'mentions');
  assert.equal(preferredInboxCategory(),'mentions');
});
test('inbox forum links preserve pages and floors while external links stay external',()=>{
  assert.equal(inboxLinkedPost('https://nodeseek.com/post-123-4#comment-34')?.url,'https://www.nodeseek.com/post-123-4#comment-34');
  assert.equal(inboxLinkedPost('https://www.nodeseek.com/post-123')?.url,'https://www.nodeseek.com/post-123-1');
  assert.equal(inboxLinkedPost('https://example.com/post-123-4'),undefined);
  assert.equal(inboxLinkedPost('javascript:alert(1)'),undefined);
});
test('saving extension edits preserves runtime hits and unrelated configuration updates',()=>{
  const original=defaultExtensions(),edited={...original,watchWords:'VPS+香港',hotSidebarCount:15};
  const latest={...original,officeTitle:'Updated elsewhere',unread:3,lastCheck:'2026-11-12T03:00:00Z',watchError:'temporary',attendance:{kind:'completed' as const,gain:5}};
  const saved=mergeExtensionEdits(latest,original,edited);
  assert.equal(saved.watchWords,'VPS+香港');assert.equal(saved.hotSidebarCount,15);assert.equal(saved.officeTitle,'Updated elsewhere');
  assert.equal(saved.unread,3);assert.equal(saved.lastCheck,latest.lastCheck);assert.deepEqual(saved.attendance,latest.attendance);assert.equal(saved.watchError,'temporary');
});
test('plain private messages preserve Markdown punctuation and HTML text while Markdown messages are sanitized',async()=>{
  const page=new JSDOM('<!doctype html>');Object.assign(globalThis,{window:page.window});
  try{
    const {DirectMessageBody}=await import('../src/components/DirectMessageBody');
    const plain=renderToStaticMarkup(createElement(DirectMessageBody,{message:{text:'**literal**\n<b>literal</b>',markdown:false}}));
    assert.match(plain,/\*\*literal\*\*/);assert.match(plain,/&lt;b&gt;literal&lt;\/b&gt;/);assert.doesNotMatch(plain,/<strong>|<b>/);
    const rich=renderToStaticMarkup(createElement(DirectMessageBody,{message:{text:'**bold** [bad](javascript:alert(1)) <script>alert(1)</script>',markdown:true}}));
    assert.match(rich,/<strong>bold<\/strong>/);assert.doesNotMatch(rich,/<script|href="javascript:/);
  }finally{page.window.close();}
});
