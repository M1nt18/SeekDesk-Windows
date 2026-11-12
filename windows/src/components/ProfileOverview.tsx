import { RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { renderMarkdown } from '../markdown';
import { errorMessage } from './shared-ui';
import './profile-overview.css';

/** The original personal-space overview keeps README beside the profile statistics. */
export function ProfileOverview({readme,loading,error,onRetry}:{readme?:string;loading:boolean;error?:string;onRetry:()=>void}) {
  const html=useMemo(()=>renderMarkdown(readme||''),[readme]),[linkError,setLinkError]=useState('');
  return <section className="profile-overview" aria-label="个人空间概况"><h3>README</h3>
    {readme!==undefined?(readme.trim()?<article className="prose profile-readme" onClick={event=>{const anchor=(event.target as HTMLElement).closest('a[href]');if(!anchor)return;event.preventDefault();try{const url=new URL(anchor.getAttribute('href')||'','https://www.nodeseek.com/');setLinkError('');void (url.protocol==='https:'&&['www.nodeseek.com','nodeseek.com'].includes(url.hostname)?window.seekdesk.openOfficial(url.href):window.seekdesk.openExternal(url.href)).catch(reason=>setLinkError(errorMessage(reason)));}catch{setLinkError('无法打开这个链接。');}}} dangerouslySetInnerHTML={{__html:html}}/>:<p className="muted">还没有填写 README。</p>):loading?<p className="muted" role="status">正在读取 README…</p>:<div className="profile-overview-error"><p>{error||'暂时无法读取 README。'}</p><button className="secondary-button" onClick={onRetry}><RefreshCw size={15}/>重试</button></div>}
    {linkError&&<p className="danger-text" role="alert">{linkError}</p>}
  </section>;
}
