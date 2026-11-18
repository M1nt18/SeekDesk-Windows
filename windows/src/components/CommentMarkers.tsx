import {Pin} from 'lucide-react';
import type {Comment} from '../../shared/types';

export function CommentMarkers({comment}:{comment:Comment}){
  if(comment.id==='0')return null;
  const hot=comment.isHot||(comment.chicken||0)>0;
  if(!hot&&!comment.isPinned)return null;
  return <span className="comment-markers">
    {comment.isPinned&&<span className="comment-pin-badge" role="img" aria-label="置顶回复" title="置顶回复"><Pin size={16} strokeWidth={2.3} aria-hidden="true"/></span>}
    {hot&&<span className="comment-hot-badge" role="img" aria-label="热门回复" title="热门回复">HOT</span>}
  </span>;
}
