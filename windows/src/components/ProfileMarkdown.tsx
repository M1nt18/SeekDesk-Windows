import {useMemo,useState} from 'react';
import {renderMarkdown} from '../markdown';
import {errorMessage} from './shared-ui';
import './profile-markdown.css';

/** Read-only personal content shares the same safe Markdown renderer as the composer. */
export function ProfileMarkdown({source,label,className='',signature=false,opensLinks=true}:{source:string;label?:string;className?:string;signature?:boolean;opensLinks?:boolean}) {
  const html=useMemo(()=>renderMarkdown(source),[source]),[linkError,setLinkError]=useState('');
  return <div className={'profile-markdown-wrap'+(className?' '+className:'')}>
    <article className={'profile-markdown'+(signature?' profile-markdown-signature':'')} aria-label={label} onClick={event=>{
      const anchor=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');if(!anchor)return;
      event.preventDefault();if(!opensLinks)return;
      try {
        const url=new URL(anchor.getAttribute('href')||'','https://www.nodeseek.com/');
        if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('仅支持安全的 HTTP 或 HTTPS 链接。');
        setLinkError('');
        void (url.protocol==='https:'&&['www.nodeseek.com','nodeseek.com'].includes(url.hostname)&&!url.port?window.seekdesk.openOfficial(url.href):window.seekdesk.openExternal(url.href)).catch(reason=>setLinkError(errorMessage(reason)));
      }catch(reason){setLinkError(errorMessage(reason));}
    }} dangerouslySetInnerHTML={{__html:html}}/>
    {linkError&&<p className="danger-text profile-markdown-link-error" role="alert">{linkError}</p>}
  </div>;
}
