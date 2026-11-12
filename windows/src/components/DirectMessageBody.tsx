import type {PrivateMessage} from '../../shared/parity';
import {renderMarkdown} from '../markdown';

export function DirectMessageBody({message,onNavigate}:{message:Pick<PrivateMessage,'text'|'markdown'>;onNavigate?:(url:string)=>void}) {
  if(!message.markdown)return <div className="private-message-text" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{message.text}</div>;
  return <div className="prose private-message-markdown" onClick={event=>{const link=(event.target as HTMLElement).closest('a[href]');if(link){event.preventDefault();const url=link.getAttribute('href')||'';if(onNavigate)onNavigate(url);else void window.seekdesk.openExternal(url);}}} dangerouslySetInnerHTML={{__html:renderMarkdown(message.text)}}/>;
}
