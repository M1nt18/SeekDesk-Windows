import { RefreshCw } from 'lucide-react';
import {ProfileMarkdown} from './ProfileMarkdown';
import './profile-overview.css';

/** The original personal-space overview keeps README beside the profile statistics. */
export function ProfileOverview({readme,loading,error,onRetry}:{readme?:string;loading:boolean;error?:string;onRetry:()=>void}) {
  return <section className="profile-overview" aria-label="个人空间概况"><h3>README</h3>
    {readme!==undefined?(readme.trim()?<ProfileMarkdown source={readme} className="profile-readme" label="个人 README"/>:<p className="muted">还没有填写 README。</p>):loading?<p className="muted" role="status">正在读取 README…</p>:<div className="profile-overview-error"><p>{error||'暂时无法读取 README。'}</p><button className="secondary-button" onClick={onRetry}><RefreshCw size={15}/>重试</button></div>}
  </section>;
}
