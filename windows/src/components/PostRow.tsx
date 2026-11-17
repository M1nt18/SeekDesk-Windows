import { memo } from 'react';
import { Diamond, LockKeyhole } from 'lucide-react';
import type { Post } from '../../shared/types';
import { Avatar, avatarURL, dateLabel } from './shared-ui';
import { boardName } from '../boards';

export interface PostRowContextMenu {post:Post;x:number;y:number;tab?:boolean}

type PostRowProps = {
  post:Post;
  index:number;
  selected:boolean;
  keyboardSelected:boolean;
  blocked:boolean;
  onOpen:(post:Post,background?:boolean)=>void;
  onSelect:(index:number)=>void;
  onContextMenu:(menu:PostRowContextMenu)=>void;
};

export const PostRow = memo(function PostRow({post,index,selected,keyboardSelected,blocked,onOpen,onSelect,onContextMenu}:PostRowProps) {
  return <button data-testid="post-row" data-post-id={post.id} aria-current={selected?'page':undefined} className={`post-row${blocked?' is-blocked':''}${selected?' selected':''}${keyboardSelected?' keyboard-selected':''}`}
    onFocus={()=>onSelect(index)}
    onContextMenu={event=>{event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();onContextMenu({post,x:Math.min(event.clientX||rect.left+20,window.innerWidth-230),y:Math.min(event.clientY||rect.bottom,window.innerHeight-190)});}}
    onClick={event=>{onSelect(index);onOpen(post,event.ctrlKey||event.metaKey);}}
    onAuxClick={event=>{if(event.button===1){event.preventDefault();onOpen(post,true);}}}
    title={`${post.title}\nCtrl + 点击在后台打开`}>
    <Avatar name={post.author} src={post.avatar||avatarURL(post.authorId)} large/>
    <span className="post-row-main">
      <h2>
        <span className="category-tag" data-category={post.category}>{boardName(post.category)}</span>
        <span className="post-title-text">{post.title}</span>
        {post.featured&&<Diamond className="featured-badge" size={14} aria-label="精品帖子"/>}
        {post.readingRank!==undefined?<span className="access-badge" title={post.readingRank===255?'私有帖子':'阅读权限 Lv '+post.readingRank}><LockKeyhole size={12}/>{post.readingRank===255?'私有':'Lv '+post.readingRank}</span>:null}
      </h2>
      <span className="post-row-meta">
        <span className="post-author">{post.author||'社区成员'}</span>
        {blocked&&<span className="blocked-post-label">已屏蔽</span>}
        <time>{dateLabel(post.published)}</time>
      </span>
    </span>
    {post.replies!==undefined&&<span className="reply-count">{post.replies}</span>}
  </button>;
});
