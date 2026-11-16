import {useEffect,useMemo,useRef,useState,type KeyboardEvent as ReactKeyboardEvent} from 'react';
import {Bookmark,BookOpen,Check,Clock,Copy,FileText,History,RefreshCw,Search,Settings2,Trash2,Zap} from 'lucide-react';
import type {Post} from '../../shared/types';
import type {ReadingLibraryMutation,ReadingLibraryState} from '../../shared/library';
import {matchesSearch} from '../search';
import {Empty,ErrorState,Loading,Modal,dateLabel} from './shared-ui';
import './reading-library.css';

export type ReadingLibraryMode='bookmarks'|'history'|'commands'|'changes';
export type ReadingCommand='search'|'bookmark'|'refresh-thread'|'refresh-list'|'settings';
export interface ReadingLibraryPanelProps {
  state:ReadingLibraryState;
  mode:ReadingLibraryMode;
  loading:boolean;
  error?:string;
  busy?:boolean;
  onModeChange:(mode:ReadingLibraryMode)=>void;
  onClose:()=>void;
  onRetry:()=>void;
  onOpen:(post:Post)=>void;
  onMutate:(request:ReadingLibraryMutation)=>Promise<unknown>;
  onCommand:(command:ReadingCommand)=>void;
  onCopy:()=>Promise<unknown>;
}

const modes:{id:ReadingLibraryMode;label:string;icon:typeof Bookmark}[]=[
  {id:'bookmarks',label:'本地书签',icon:Bookmark},
  {id:'history',label:'阅读历史',icon:History},
  {id:'commands',label:'快捷操作',icon:Zap},
  {id:'changes',label:'更新内容',icon:BookOpen},
];
const commands:{id:ReadingCommand;label:string;detail:string;shortcut?:string;icon:typeof Search}[]=[
  {id:'search',label:'全局搜索',detail:'搜索论坛帖子或用户',shortcut:'Ctrl K',icon:Search},
  {id:'bookmark',label:'收藏当前帖子',detail:'将当前阅读位置加入本地书签',shortcut:'Ctrl Shift B',icon:Bookmark},
  {id:'refresh-thread',label:'刷新当前帖子',detail:'重新读取当前阅读的帖子',icon:RefreshCw},
  {id:'refresh-list',label:'刷新帖子列表',detail:'读取当前论坛版块的新帖子',icon:RefreshCw},
  {id:'settings',label:'打开设置',detail:'阅读、外观、账号与更新设置',shortcut:'Ctrl ,',icon:Settings2},
];
const changes=[
  {title:'本地阅读资料库',text:'按账号保存本地书签与最近 200 条阅读历史，支持搜索、移除、清空和 JSON 复制，不修改论坛收藏。'},
  {title:'连续阅读与等宽标签',text:'评论接近底部时自动追加下一页，保留数字分页和阅读位置；帖子标签统一宽度，长标题可悬停查看。'},
  {title:'个人资料与通知',text:'个人介绍、签名和 README 使用 Markdown 排版，统计卡保留背景；通知与私信保持分栏，预览和标已读分开。'},
  {title:'发送与草稿保护',text:'图片上传期间阻止提前发送，提交成功后的旧草稿不会覆盖新输入；离开编辑器时保存本地草稿。'},
  {title:'桌面与更新',text:'安装版支持应用内下载、校验、保存草稿和安装重启；侧栏尺寸与原版规则对齐，并保留已有有效设置。'},
];

/** The library consumes application state and callbacks, never rendered-title guesses. */
export function ReadingLibraryPanel({state,mode,loading,error,busy=false,onModeChange,onClose,onRetry,onOpen,onMutate,onCommand,onCopy}:ReadingLibraryPanelProps) {
  const [query,setQuery]=useState(''),[pending,setPending]=useState(false),[actionError,setActionError]=useState(''),[copied,setCopied]=useState(false);
  const [confirmation,setConfirmation]=useState<'clear-bookmarks'|'clear-history'|null>(null);
  const search=useRef<HTMLInputElement>(null),list=useRef<HTMLDivElement>(null),cancel=useRef<HTMLButtonElement>(null),mounted=useRef(true),actionScope=useRef(0),pendingRef=useRef(false);
  const locked=busy||pending;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{++actionScope.current;setQuery('');setConfirmation(null);setActionError('');setCopied(false);},[mode]);
  useEffect(()=>{
    const frame=requestAnimationFrame(()=>confirmation?cancel.current?.focus():search.current?.focus());
    return()=>cancelAnimationFrame(frame);
  },[confirmation,mode]);
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopImmediatePropagation();
      if(confirmation)setConfirmation(null);else onClose();
    };
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[confirmation,onClose]);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2400);return()=>clearTimeout(timer);},[copied]);

  const entries=mode==='history'?state.history:state.bookmarks;
  const filtered=useMemo(()=>{
    const number=query.normalize('NFKD').trim().replace(/^#/,'');
    if(/^\d+$/.test(number))return entries.filter(entry=>[entry.post.id,entry.post.title,entry.post.author].some(value=>value.normalize('NFKD').includes(number)));
    return entries.filter(entry=>matchesSearch(query,[entry.post.title,entry.post.author,'帖子 '+entry.post.id]));
  },[entries,query]);
  const visibleCommands=useMemo(()=>commands.filter(command=>matchesSearch(query,[command.label,command.detail,command.shortcut||''])),[query]);
  async function run(operation:()=>Promise<unknown>,message:string):Promise<boolean> {
    if(busy||pendingRef.current)return false;
    pendingRef.current=true;
    const scope=actionScope.current;setPending(true);setActionError('');setCopied(false);
    try{await operation();return true;}
    catch{if(mounted.current&&scope===actionScope.current)setActionError(message);return false;}
    finally{pendingRef.current=false;if(mounted.current)setPending(false);}
  }
  const clear=async()=>{
    if(!confirmation)return;
    const request={kind:confirmation} as const;
    if(await run(()=>onMutate(request),'清空未完成，记录已保留，请稍后重试。'))if(mounted.current)setConfirmation(null);
  };
  const copy=async()=>{if(await run(onCopy,'复制资料库失败，请重试。'))if(mounted.current)setCopied(true);};
  const close=()=>confirmation?setConfirmation(null):onClose();
  const open=(post:Post)=>{onClose();onOpen(post);};
  const command=(id:ReadingCommand)=>{onClose();onCommand(id);};
  const searchKey=(event:ReactKeyboardEvent<HTMLInputElement>)=>{
    if(event.nativeEvent.isComposing)return;
    if(event.key==='Enter'){
      if(mode==='commands'&&visibleCommands[0]&&!locked){event.preventDefault();command(visibleCommands[0].id);}
      else if(!loading&&!error&&(mode==='bookmarks'||mode==='history')&&filtered[0]){event.preventDefault();open(filtered[0].post);}
    }else if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      const buttons=list.current?.querySelectorAll<HTMLButtonElement>('.reading-command-row:not(:disabled),.reading-library-open:not(:disabled)');
      const button=event.key==='ArrowUp'?buttons?.[buttons.length-1]:buttons?.[0];if(button){event.preventDefault();button.focus();}
    }
  };
  const listKey=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key)||!(event.target instanceof Element)||!event.target.closest('.reading-command-row,.reading-library-open'))return;
    const buttons=[...list.current?.querySelectorAll<HTMLButtonElement>('.reading-command-row:not(:disabled),.reading-library-open:not(:disabled)')||[]],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
    if(index<0)return;event.preventDefault();event.stopPropagation();
    if(event.key==='ArrowUp'&&index===0){search.current?.focus();return;}
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:Math.min(buttons.length-1,Math.max(0,index+(event.key==='ArrowDown'?1:-1)));buttons[next]?.focus();buttons[next]?.scrollIntoView({block:'nearest'});
  };

  return <Modal title="阅读资料库" onClose={close} wide><div className="reading-library" data-testid="reading-library-panel">
    {confirmation?<section className="reading-library-confirm" role="alertdialog" aria-label={confirmation==='clear-bookmarks'?'清空本地书签':'清空阅读历史'}>
      <Trash2 size={24} aria-hidden="true"/><h3>{confirmation==='clear-bookmarks'?'清空当前账号的本地书签？':'清空当前账号的阅读历史？'}</h3>
      <p>此操作只移除本机记录，无法撤销。</p>
      <div><button ref={cancel} className="secondary-button" disabled={locked} onClick={()=>setConfirmation(null)}>取消</button><button className="primary-button destructive" disabled={locked} onClick={()=>void clear()}>{pending?'正在清空…':'确认清空'}</button></div>
    </section>:<>
      <nav className="reading-library-tabs" aria-label="资料库分类">{modes.map(({id,label,icon:Icon})=><button key={id} className={mode===id?'selected':''} aria-pressed={mode===id} disabled={locked} onClick={()=>onModeChange(id)}><Icon size={16} aria-hidden="true"/>{label}</button>)}</nav>
      {mode!=='changes'&&<label className="reading-library-search"><Search size={16} aria-hidden="true"/><input ref={search} aria-label={mode==='commands'?'搜索快捷操作':'搜索资料库'} placeholder={mode==='commands'?'搜索快捷操作…':'搜索标题、作者或帖子编号…'} value={query} onChange={event=>setQuery(event.target.value)} onKeyDown={searchKey}/></label>}
      <div ref={list} className="reading-library-list" aria-busy={loading&&mode!=='commands'&&mode!=='changes'} onKeyDown={listKey}>
        {mode==='commands'?<>{visibleCommands.length?visibleCommands.map(({id,label,detail,shortcut,icon:Icon})=><button className="reading-command-row" key={id} disabled={locked} onClick={()=>command(id)}><Icon size={18} aria-hidden="true"/><span><strong>{label}</strong><small>{detail}</small></span>{shortcut&&<kbd>{shortcut}</kbd>}</button>):<Empty>没有匹配的快捷操作</Empty>}</>:mode==='changes'?<section className="reading-library-changes" aria-label="本轮更新内容">{changes.map(change=><section key={change.title}><h3>{change.title}</h3><p>{change.text}</p></section>)}</section>:loading?<Loading label="正在读取本机资料库…"/>:error?<ErrorState error="暂时无法读取资料库，请确认当前会话后重试。" onRetry={onRetry}/>:filtered.length?filtered.map(entry=><article className="reading-library-row" key={entry.post.id} data-post-id={entry.post.id}>
          <button className="reading-library-open" title={entry.post.title+'\n'+entry.post.url} onClick={()=>open(entry.post)}><FileText size={18} aria-hidden="true"/><span><strong>{entry.post.title}</strong><small><span>帖子 #{entry.post.id}{entry.post.author?' · '+entry.post.author:''}</span><time dateTime={entry.visitedAt} title={dateLabel(entry.visitedAt,true)}><Clock size={12} aria-hidden="true"/>{mode==='bookmarks'?'收藏于':'阅读于'} {dateLabel(entry.visitedAt)}</time></small></span></button>
          <button className="reading-library-remove" title={'移除 '+entry.post.title} aria-label={'移除 '+entry.post.title} disabled={locked} onClick={()=>void run(()=>onMutate({kind:mode==='bookmarks'?'bookmark-remove':'history-remove',postId:entry.post.id}),'移除未完成，记录已保留，请重试。')}><Trash2 size={16}/><span>移除</span></button>
        </article>):<div className="reading-library-empty"><Bookmark size={28} aria-hidden="true"/><h3>{query?'没有匹配记录':mode==='bookmarks'?'还没有本地书签':'还没有阅读记录'}</h3><p>{query?'可以换一个标题、作者或帖子编号。':mode==='bookmarks'?'阅读帖子时按 Ctrl + Shift + B 收藏。':'打开帖子后，最近的阅读记录会保存在这里。'}</p></div>}
      </div>
      <footer className="reading-library-footer"><div><button className="secondary-button" disabled={locked||loading||Boolean(error)} onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>}<span>{copied?'已复制 JSON':'复制资料库 JSON'}</span></button>{(mode==='bookmarks'||mode==='history')&&<button className="text-button reading-library-clear" disabled={locked||loading||Boolean(error)||!entries.length} onClick={()=>setConfirmation(mode==='bookmarks'?'clear-bookmarks':'clear-history')}>清空当前列表</button>}</div>{(mode==='bookmarks'||mode==='history')&&!loading&&!error&&<span className="reading-library-count">{query?`${filtered.length} 条匹配 / `:''}共 {entries.length} 条{mode==='history'?' · 最近 200 条':''}</span>}<p>保存在本机，按账号区分；不修改论坛收藏。复制包含当前账号的书签和阅读历史。</p></footer>
    </>}
    {actionError&&<p className="reading-library-error" role="alert">{actionError}</p>}
    {copied&&<span className="reading-library-status" role="status">资料库 JSON 已复制</span>}
  </div></Modal>;
}
