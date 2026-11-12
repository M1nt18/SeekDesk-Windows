import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, LoaderCircle, UserRound, X } from 'lucide-react';

export function IconButton({label,children,onClick,disabled,className=''}:{label:string;children:ReactNode;onClick:()=>void;disabled?:boolean;className?:string}) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
export const avatarURL=(id?:number)=>id?`https://www.nodeseek.com/avatar/${id}.png`:undefined;
export function Avatar({name='',src,id,large=false}:{name?:string;src?:string;id?:number;large?:boolean}) {
  const [resolved,setResolved]=useState(src||avatarURL(id)),[failed,setFailed]=useState(false);const attempt=useRef(false);
  useEffect(()=>{setResolved(src||avatarURL(id));setFailed(false);attempt.current=false;},[src,id]);
  useEffect(()=>{const member=id||Number(src?.match(/\/avatar\/(\d+)/)?.[1]);if(!failed||attempt.current||!member)return;attempt.current=true;let current=true;void window.seekdesk.loadAvatar(member).then(value=>{if(current&&value){setResolved(value);setFailed(false);}}).catch(()=>{});return()=>{current=false;};},[failed,id,src]);
  return <span className={`avatar${large?' large':''}`}>{resolved&&!failed?<img src={resolved} alt={`${name||'用户'}的头像`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:name.slice(0,1).toUpperCase()||<UserRound size={18}/>}</span>;
}
export function Loading({label='正在读取…'}:{label?:string}) {return <div className="panel-state" role="status"><LoaderCircle className="spin" size={24}/><span>{label}</span></div>;}
export function ErrorState({error,onRetry}:{error:string;onRetry?:()=>void}) {return <div className="panel-state error" role="alert"><CircleAlert size={26}/><p>{error}</p>{onRetry&&<button className="secondary-button" onClick={onRetry}>重新读取</button>}</div>;}
export function Empty({children}:{children:ReactNode}) {return <div className="panel-state muted">{children}</div>;}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const panel=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
  useEffect(()=>{const before=document.activeElement as HTMLElement|null;panel.current?.querySelector<HTMLElement>('[autofocus],input,textarea,select,button')?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close.current();}if(event.key==='Tab'){const nodes=[...panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')||[]],first=nodes[0],last=nodes[nodes.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}};window.addEventListener('keydown',key);return()=>{window.removeEventListener('keydown',key);before?.focus();};},[]);
  return <div className="dialog-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section ref={panel} className={`parity-dialog${wide?' wide':''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><IconButton label="关闭" onClick={onClose}><X size={19}/></IconButton></header>{children}</section></div>;
}
export const errorMessage=(error:unknown)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''):'操作未完成，请重试。';
export function dateLabel(value:string,full=false) {const date=new Date(value);if(!value||Number.isNaN(date.getTime()))return value||'';if(full)return date.toLocaleString('zh-CN');const seconds=Math.max(0,(Date.now()-date.getTime())/1000);return seconds<60?'刚刚':seconds<3600?`${Math.floor(seconds/60)} 分钟前`:seconds<86400?`${Math.floor(seconds/3600)} 小时前`:date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});}
