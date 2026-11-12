import {useEffect,useState} from 'react';
import {ArrowUpRight,Quote} from 'lucide-react';
import type {ForumNotice} from '../../shared/parity';
import type {Comment,Post} from '../../shared/types';
import {inboxLinkedPost,noticeComment,noticePost} from '../../shared/notifications';
import {ReaderContent} from '../ReaderContent';
import {Avatar,dateLabel,errorMessage,Loading} from './shared-ui';
import './notification-preview.css';

export interface NotificationPreviewProps {
  notice:ForumNotice;
  category:'mentions'|'replies';
  revision?:number;
  onOpenPost:(post:Post,background?:boolean,explicit?:boolean)=>void;
  onMember:(id:number)=>void;
}
export function NotificationPreview({notice,category,revision=0,onOpenPost,onMember}:NotificationPreviewProps) {
  const [comment,setComment]=useState<Comment>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    let live=true;setLoading(true);setComment(undefined);setError('');
    void (async()=>{const post=noticePost(notice),page=Number(new URL(post.url).pathname.match(/-(\d+)\/?$/)?.[1]||1),thread=await window.seekdesk.readThread(post,page);if(!live)return;const floor=noticeComment(thread,notice);if(!floor)throw new Error('暂时无法读取这层回复，可重试或打开帖子查看。');setComment(floor);})().catch(reason=>{if(live)setError(errorMessage(reason));}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[notice.id,notice.postId,notice.floor,notice.url,revision,retry]);
  const open=()=>{try{onOpenPost(noticePost(notice),false,true);}catch(reason){setError(errorMessage(reason));}};
  const navigate=(url:string)=>{const post=inboxLinkedPost(url);if(post)onOpenPost(post,false,true);else void window.seekdesk.openExternal(url);};
  return <section className="notification-detail" aria-label="通知详情"><header><button className="notice-author" disabled={!notice.authorId} onClick={()=>notice.authorId&&onMember(notice.authorId)}><Avatar name={notice.author} id={notice.authorId} large/><span><strong>{notice.author||'NodeSeek 用户'}</strong><time dateTime={notice.date}>{dateLabel(notice.date,true)}</time></span></button></header><p className="muted">{category==='mentions'?'在帖子中提到了你':'回复了你的主题'}</p><h2>{notice.title}</h2><div className="notice-reply-preview"><h3><Quote size={16}/>回复正文 · #{notice.floor}</h3>{loading?<Loading label={`正在读取第 ${notice.floor} 楼…`}/>:error?<div className="notice-preview-error" role="status"><p>{error}</p><button className="text-button" onClick={()=>setRetry(value=>value+1)}>重新读取</button></div>:comment&&<ReaderContent html={comment.html} onNavigate={navigate}/>}</div><button className="primary-button" onClick={open}>打开第 {notice.floor} 楼<ArrowUpRight size={16}/></button></section>;
}
