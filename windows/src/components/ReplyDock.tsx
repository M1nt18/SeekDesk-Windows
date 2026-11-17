import { ChevronDown, LoaderCircle, MessageSquare, Send, X } from 'lucide-react';
import type { AccountState } from '../../shared/types';
import type { StickerItem } from '../../shared/parity';
import type { MarkdownComposerProps } from '../MarkdownComposer';
import { MarkdownComposer } from '../MarkdownComposer';
import { IconButton } from './shared-ui';

type ReplyDockProps = {
  postId:string;
  accountId?:number;
  accountStatus:AccountState['status'];
  reply:string;
  expanded:boolean;
  focusRequest:number;
  restriction?:string;
  canInteract:boolean;
  actionBusy:string;
  composerUploading:boolean;
  sendShortcut:'ctrl-enter'|'enter'|'button-only';
  stickers:StickerItem[];
  imageWidths:Record<string,number>;
  onToggle:()=>void;
  onClose:()=>void;
  onChange:(value:string)=>void;
  onClear:()=>void;
  onSend:()=>void;
  onUpload:MarkdownComposerProps['onUpload'];
  onImageWidths:(value:Record<string,number>)=>void;
  onImportStickers:()=>void;
  onMediaSettings:()=>void;
  onOpenOfficial:()=>void;
  draftError?:string;
  onRetryDraft?:()=>void;
};

export function ReplyDock({postId,accountId,accountStatus,reply,expanded,focusRequest,restriction,canInteract,actionBusy,composerUploading,sendShortcut,stickers,imageWidths,onToggle,onClose,onChange,onClear,onSend,onUpload,onImageWidths,onImportStickers,onMediaSettings,onOpenOfficial,draftError,onRetryDraft}:ReplyDockProps) {
  return <section className={`fixed-reply${expanded?' expanded':''}`} aria-label="回复帖子">
    <header>
      <button className={`reply-expand${!expanded?' reply-open-button':''}`} aria-label={expanded?'收起回复':'写回复'} aria-expanded={expanded} onClick={onToggle}><MessageSquare size={18}/><span>{expanded?'收起回复':'写回复'}</span><ChevronDown className={expanded?'reply-chevron-open':''} size={16}/></button>
      <div className="reply-heading-actions">{reply&&<small>本机草稿 · {reply.length} 字</small>}{expanded&&<IconButton label="关闭回复编辑器" onClick={onClose}><X size={18}/></IconButton>}</div>
    </header>
    {expanded&&<>
      {canInteract&&!restriction?<>
        {draftError&&<p className="desktop-settings-error" role="alert">草稿读取失败：{draftError} {onRetryDraft&&<button className="text-button" onClick={onRetryDraft}>重试草稿读取</button>}</p>}
        <MarkdownComposer key={String(accountId)+':reply:'+postId} value={reply} focusRequest={focusRequest} onChange={onChange} onSubmit={onSend} disabled={Boolean(actionBusy)} busy={actionBusy===`reply:${postId}`} label="回复帖子" placeholder="写下你的回复…" initialMode="edit" sendShortcut={sendShortcut} onUpload={onUpload} stickers={stickers} onImportStickers={onImportStickers} onMediaSettings={onMediaSettings} imageWidths={imageWidths} onImageWidthsChange={onImageWidths}/>
        <div className="reply-toolbar"><span>{sendShortcut==='enter'?'Enter 发送 · Shift+Enter 换行':sendShortcut==='button-only'?'点击按钮发送':'Ctrl+Enter 发送'}</span><button className="text-button" disabled={!reply||Boolean(actionBusy)} onClick={onClear}>清空</button><button data-testid="submit-reply" className="primary-button" disabled={!reply.trim()||Boolean(actionBusy)||composerUploading||reply.length>20000||Boolean(draftError)} onClick={onSend}>{actionBusy===`reply:${postId}`?<LoaderCircle className="spin" size={17}/>:<Send size={17}/>}回复</button></div>
      </>:<div className="reply-unavailable"><p>{restriction||(accountStatus!=='signed-in'?'登录后参与讨论。':'当前为公开摘要，请刷新读取完整官方正文。')}</p><button className="secondary-button" onClick={onOpenOfficial}>{accountStatus==='signed-in'?'打开官方页面':'官方网页登录'}</button></div>}
    </>}
  </section>;
}
