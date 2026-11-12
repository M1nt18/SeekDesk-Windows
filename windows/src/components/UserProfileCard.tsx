import { Mail, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MemberProfile } from '../../shared/parity';
import type { UserProfileMetadata } from '../../shared/profiles';
import { Avatar, Modal, errorMessage } from './shared-ui';
import './user-profile-card.css';

export interface ProfileCardMember {id:number;name:string;avatar?:string;tags?:string[]}

/** A lightweight user card precedes the full personal space, as in ForumUserCard.swift. */
export function UserProfileCard({member,revision=0,canMessage=true,onClose,onOpenSpace,onMessage}:{member:ProfileCardMember;revision?:number;canMessage?:boolean;onClose:()=>void;onOpenSpace:()=>void;onMessage:(id:number,name:string)=>void}) {
  const [profile,setProfile]=useState<MemberProfile>(),[compact,setCompact]=useState<UserProfileMetadata>(),[loading,setLoading]=useState(true),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const loadedScope=useRef('');
  useEffect(()=>{
    let live=true;const scope=member.id+':'+revision;if(scope!==loadedScope.current){setProfile(undefined);setCompact(undefined);loadedScope.current=scope;}setError('');setLoading(true);
    void window.seekdesk.queryForum({kind:'introduction',memberId:member.id}).then(result=>{if(!live)return;if(result.profile?.id!==member.id)throw new Error('暂时无法读取个人资料');setProfile(result.profile);}).catch(reason=>{if(live)setError(errorMessage(reason));}).finally(()=>{if(live)setLoading(false);});
    void window.seekdesk.readUserProfiles({memberIds:[member.id],force:retry>0}).then(result=>{if(!live)return;const outcome=result.outcomes.find(item=>item.memberId===member.id);if(outcome?.profile)setCompact(outcome.profile);}).catch(()=>{});
    return()=>{live=false;};
  },[member.id,revision,retry]);
  const matchesScope=loadedScope.current===member.id+':'+revision;
  const visible=matchesScope&&profile?.id===member.id?profile:undefined,level=matchesScope&&compact?.memberId===member.id?compact:undefined;
  const title=visible?.name||member.name||'用户 '+member.id,rank=visible?.rank??level?.level,tags=[...new Set([...(member.tags||[]),...(visible?.roles||[]),...(level?.role?[level.role]:[])])].filter(Boolean).slice(0,4);
  return <Modal title="用户资料" onClose={onClose}><div className="user-profile-card">
    <header><Avatar name={title} src={visible?.avatar||member.avatar} id={member.id} large/><div><h3>{title}</h3><p>UID {member.id}</p><div className="user-profile-badges">{rank!==undefined&&<span className="level-badge" data-level={rank}>Lv {rank}</span>}{tags.map(tag=><span className="role-badge" key={tag}>{tag}</span>)}</div></div></header>
    {visible?<><div className="user-profile-metrics">{[['主题',visible.topics],['回复',visible.replies],['粉丝',visible.followers]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value??'—'}</strong></div>)}</div>{visible.joined&&<p className="user-profile-joined">加入于 {visible.joined}</p>}{visible.bio&&<p className="user-profile-bio">{visible.bio}</p>}</>:loading?<p className="muted" role="status">正在读取个人资料…</p>:null}
    {error&&<p className="user-profile-error" role="status">{visible?'刷新失败，正在显示先前资料。':''}{error}</p>}
    <button className="text-button" disabled={loading} onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>{error?'重试资料读取':'刷新资料'}</button>
    <footer><button className="secondary-button" onClick={onOpenSpace}>查看个人主页</button><button className="primary-button" disabled={!canMessage} onClick={()=>onMessage(member.id,title)}><Mail size={16}/>发私信</button></footer>
  </div></Modal>;
}
