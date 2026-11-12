import type {ForumNotice,UnreadCounts} from './parity';
import type {Comment,Post,ThreadResult} from './types';

export type InboxCategory='mentions'|'replies'|'messages';
export function preferredInboxCategory(counts?:UnreadCounts):InboxCategory {
  return (['mentions','replies','messages'] as const).find(key=>(counts?.[key]||0)>0)||'mentions';
}
export function noticePost(notice:ForumNotice):Post {
  const url=new URL(notice.url),match=/^\/post-([1-9]\d*)-([1-9]\d*)\/?$/.exec(url.pathname);
  if(url.protocol!=='https:'||!['www.nodeseek.com','nodeseek.com'].includes(url.host)||url.username||url.password||!match||Number(match[1])!==notice.postId||!Number.isSafeInteger(notice.floor)||notice.floor<0)throw new Error('通知中的帖子地址无效');
  url.hash=String(notice.floor);
  return {id:String(notice.postId),url:url.href,title:notice.title,author:notice.author,authorId:notice.authorId,category:'',published:notice.date,summary:''};
}
export function noticeComment(thread:ThreadResult,notice:ForumNotice):Comment|undefined {
  if(thread.source!=='web'||thread.id!==String(notice.postId))return;
  return thread.comments.find(comment=>comment.id===String(notice.floor)&&comment.html.trim());
}
export function inboxLinkedPost(input:string):Post|undefined {
  try{const url=new URL(input),match=/^\/post-([1-9]\d*)(?:-([1-9]\d*))?\/?$/.exec(url.pathname);if(url.protocol!=='https:'||!['www.nodeseek.com','nodeseek.com'].includes(url.host)||url.username||url.password||!match)return;return {id:match[1],url:'https://www.nodeseek.com/post-'+match[1]+'-'+(match[2]||1)+(/^#(?:comment-)?\d+$/.test(url.hash)?url.hash:''),title:'帖子 #'+match[1],author:'',category:'',published:'',summary:''};}catch{return;}
}
