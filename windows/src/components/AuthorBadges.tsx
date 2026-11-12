import type {Comment} from '../../shared/types';
import type {UserProfileOutcome} from '../../shared/profiles';
import './author-badges.css';

export function AuthorBadges({comment,outcome,loading,onRetry}:{comment:Comment;outcome?:UserProfileOutcome;loading:boolean;onRetry:()=>void}) {
  const profile=outcome?.profile,level=profile?.level??comment.level,role=profile?.role||comment.role;
  return <>{level!==undefined?<span className="level-badge" data-level={level} title={profile?.levelSource==='points'?'按公开鸡腿数计算，与 NodeSeek Pro 相同':'用户等级'}>Lv {level}{profile?.joinedDays!==undefined&&<span className="joined-days"> | {profile.joinedDays}天</span>}</span>:comment.authorId&&(loading?<span className="profile-status">读取等级…</span>:outcome?.status==='failed'||outcome?.status==='stale'?<button className="profile-retry" title="用户资料暂未读到，点击重试" onClick={onRetry}>重试等级</button>:outcome?.status==='ready'?<span className="profile-status" title="接口未提供等级或鸡腿数据">等级未公开</span>:null)}{role&&<span className="role-badge" data-role={role}>{role}</span>}</>;
}
