import {useEffect,useState} from 'react';
import type {ProCredentials,ProService,ProState} from '../../shared/pro';
import {Modal,errorMessage} from './shared-ui';

export function ProStatus(){
  const [state,setState]=useState<ProState>({status:'disabled'});
  useEffect(()=>{let active=true,event=false;const stop=window.seekdesk.onProState?.(value=>{event=true;if(active)setState(value);});void window.seekdesk.getProState?.().then(value=>{if(active&&!event)setState(value);}).catch(()=>{});return()=>{active=false;stop?.();};},[]);
  return <p className="section-description pro-status" role="status" title={state.message}>脚本状态：{({disabled:'未在官网页运行',preparing:'准备中',running:'已在官网页运行',verification:'官网待验证',unsupported:'当前页不支持',failed:'加载失败'})[state.status]}{state.message?' · '+state.message:''}</p>;
}
export function ProCredentialsDialog({onClose}:{onClose:()=>void}){
  const [state,setState]=useState<ProCredentials>(),[keys,setKeys]=useState({ai:'',nodeimage:''}),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let active=true;void window.seekdesk.getProCredentials().then(value=>{if(active)setState(value);}).catch(()=>setMessage('无法读取凭据状态，请关闭后重试'));return()=>{active=false;};},[]);
  const save=async(service:ProService,clear=false)=>{if(busy)return;setBusy(true);setMessage('');try{const next=await window.seekdesk.saveProCredential(clear?{service,clear:true}:{service,apiKey:keys[service]});setState(next);setKeys(previous=>({...previous,[service]:''}));setMessage(clear?'密钥已清除':'密钥已加密保存');}catch(error){setMessage(errorMessage(error));}finally{setBusy(false);}};
  return <Modal title="NodeSeek Pro 凭据" onClose={onClose}>
    <p className="section-description">仅在本机客户端录入，官网表单只显示配置状态。支持标准 OpenAI 聊天接口和 NodeImage 上传；不支持自定义服务和官网自动取 Key。</p>
    {state?.warning&&<p role="alert">{state.warning}</p>}
    {(['nodeimage','ai'] as const).map(service=>{const title=service==='ai'?'OpenAI':'NodeImage',configured=service==='ai'?state?.aiConfigured:state?.nodeimageConfigured;return <section className="pro-credential-row" key={service}><label>{title} 密钥 <span>{configured?'已配置':'未配置'}</span><input type="password" autoComplete="new-password" aria-label={title+' 新密钥'} placeholder={configured?'填写新密钥以替换，留空保留':'输入密钥'} value={keys[service]} onChange={event=>setKeys(previous=>({...previous,[service]:event.target.value}))}/></label><div className="session-actions"><button className="primary-button" disabled={busy||!state||!keys[service].trim()} onClick={()=>void save(service)}>保存 {title} 密钥</button><button className="text-button danger-text" disabled={busy||!configured} onClick={()=>void save(service,true)}>清除 {title} 密钥</button></div></section>;})}
    <button className="secondary-button" disabled={busy||!state} onClick={()=>{setBusy(true);void window.seekdesk.exportProPreferences().then(result=>setMessage(result.canceled?'已取消导出':'去密脚本偏好已写入文件')).catch(error=>setMessage(errorMessage(error))).finally(()=>setBusy(false));}}>导出去密的脚本偏好</button>
    <p className="section-description">导出不含 API 密钥、Cookie、官网本地数据或私信。Pro 偏好、凭据和搜索历史在当前 Windows 用户的本机配置中共享；回复草稿、联系人和阅读资料库按已确认账号隔离。</p>
    {message&&<p role="status">{message}</p>}
  </Modal>;
}
