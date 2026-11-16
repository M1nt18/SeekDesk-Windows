import {useEffect,useRef,useState} from 'react';
import {ShieldBan} from 'lucide-react';
import {errorMessage} from './shared-ui';

/** Explicit account actions; this never changes the local reading filter. */
export function OfficialBlockControls({memberId,name,ownerId}:{memberId:number;name:string;ownerId:number}) {
  const [choice,setChoice]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const mounted=useRef(true),inFlight=useRef(false);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  async function submit() {
    if(choice===null||inFlight.current)return;
    inFlight.current=true;setBusy(true);setMessage('');setError('');
    try {
      const result=await window.seekdesk.forumAction({kind:'block',memberId,block:choice},ownerId);
      if(mounted.current){setMessage(result.message);setChoice(null);}
    }catch(reason){if(mounted.current)setError(errorMessage(reason));}
    finally{inFlight.current=false;if(mounted.current)setBusy(false);}
  }
  return <details className="profile-official-block">
    <summary><ShieldBan size={15} aria-hidden="true"/>官网黑名单</summary>
    <p>操作会同步到当前 NodeSeek 账号，本地屏蔽单独管理。</p>
    {choice===null?<div className="profile-block-actions"><button className="secondary-button" onClick={()=>{setMessage('');setError('');setChoice(true);}}>加入官网黑名单</button><button className="secondary-button" onClick={()=>{setMessage('');setError('');setChoice(false);}}>移出官网黑名单</button></div>:<div className="profile-block-confirm">
      <p>{choice?'确认将':'确认从官网黑名单移除'} {name}（UID {memberId}）{choice?' 加入官网黑名单？':'？'}</p>
      <div className="profile-block-actions"><button className="secondary-button" disabled={busy} onClick={()=>{setChoice(null);setError('');}}>取消</button><button className={choice?'danger-button':'primary-button'} disabled={busy} onClick={()=>void submit()}>{busy?'正在提交…':choice?'确认加入':'确认移出'}</button></div>
    </div>}
    {message&&<p role="status">{message}</p>}{error&&<p className="user-profile-error" role="alert">{error}</p>}
  </details>;
}
