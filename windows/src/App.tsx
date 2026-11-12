import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, MouseEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bell, Calculator, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Diamond, Gift, UserPlus, Code2, Coffee, Compass, ExternalLink, FileText, Flame, Globe2, Home, Image, Info, Leaf, Link, List, LoaderCircle, LockKeyhole, Mail, Megaphone, MessageSquare, Minus, Monitor, Moon, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelTop, Plus, Puzzle, Radio, RefreshCw, Search, Send, Settings2, ShieldCheck, ShoppingBag, Square, Sun, Tag, Terminal, ThumbsDown, ThumbsUp, Trash2, UserRound, Users, X } from 'lucide-react';
import type { AccountState, Comment, ForumActionRequest, ForumActionResult, ListingResult, OfficialViewState, Post, Settings, ThreadResult } from '../shared/types';
import type { ExtensionsState, ForumQueryResult, KeywordHit, MemberProfile, ParitySettings, RankingPeriod, RankingResult, SearchHistory, StickerItem, UnreadCounts } from '../shared/parity';
import { AccountPanel, ExtensionsPanel, FriendsPanel, NotificationsPanel, RankingPanel, RankingRow, RulingsDialog, SearchPanel, TopicComposerPanel } from './parity-panels';
import { Modal } from './components/shared-ui';
import { PreferencesPanel, appearanceDefaults, palettes } from './components/PreferencesPanel';
import { MarkdownComposer } from './MarkdownComposer';
import { ReaderContent } from './ReaderContent';
import { ComposerMediaPanel } from './ComposerMediaPanel';
import { matchesSearch } from './search';
import { renderMarkdown } from './markdown';
import { Quote, Reply } from 'lucide-react';

const boards = [
  {id:'',name:'最新帖子',icon:Compass}, {id:'daily',name:'日常',icon:Coffee}, {id:'tech',name:'技术',icon:Code2},
  {id:'info',name:'情报',icon:Radio}, {id:'review',name:'测评',icon:Monitor}, {id:'trade',name:'交易',icon:Tag},
  {id:'carpool',name:'拼车',icon:Users}, {id:'dev',name:'Dev',icon:Terminal}, {id:'photo-share',name:'贴图',icon:Image},
  {id:'promotion',name:'推广',icon:Megaphone}, {id:'life',name:'生活',icon:Leaf}, {id:'inside',name:'内版',icon:LockKeyhole},
  {id:'sandbox',name:'沙盒',icon:ShoppingBag}, {id:'expose',name:'曝光',icon:ShieldCheck},
];
const extensionsDefaults:ExtensionsState={installed:[],enabled:[],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作台',officeButton:'返回',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:true,authorOnly:false,blocked:[],hits:[],unread:0};
const defaults: Settings = {theme:'system',uiFontSize:16,fontSize:18,compact:false,restoreTabs:true,defaultSource:'auto',nodeSeekPro:false};
type ThreadState = {loading:boolean;result?:ThreadResult;error?:string;requestedPage:number};
type ReactionConfirmation = {request:Extract<ForumActionRequest,{kind:'react'}>;approval:'free'|'paid';message:string};
type ToastTone = 'info'|'success'|'error';
const boardName = (id:string) => id==='award'?'精品区':boards.find(board=>board.id===id)?.name || id || '社区';
const errorMessage = (error:unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '操作未完成，请重试。';
const avatarUrl = (id?:number) => id ? `https://www.nodeseek.com/avatar/${id}.png` : undefined;

function dateLabel(value:string,full=false) {
  const date=new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '';
  if (full) return date.toLocaleString('zh-CN',{month:'long',day:'numeric',hour:'2-digit',minute:'2-digit'});
  const delta=Math.max(0,(Date.now()-date.getTime())/1000);
  if (delta<60) return '刚刚';
  if (delta<3600) return `${Math.floor(delta/60)} 分钟前`;
  if (delta<86400) return `${Math.floor(delta/3600)} 小时前`;
  return date.toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'});
}
function postFromUrl(value:string):Post|null {
  try {
    const url=new URL(value),match=url.pathname.match(/^\/post-([1-9]\d*)(?:-([1-9]\d*))?\/?$/);
    if (url.protocol!=='https:' || !['www.nodeseek.com','nodeseek.com'].includes(url.hostname) || url.username || url.password || url.port || !match) return null;
    return {id:match[1],title:`帖子 #${match[1]}`,url:`https://www.nodeseek.com/post-${match[1]}-${match[2]||1}${url.hash}`,author:'',category:'',published:'',summary:''};
  } catch {return null;}
}
function IconButton({label,children,onClick,disabled,className=''}:{label:string;children:ReactNode;onClick:()=>void;disabled?:boolean;className?:string}) {
  return <button type="button" className={`icon-button ${className}`} aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}
function Avatar({name,src,large=false}:{name:string;src?:string;large?:boolean}) {
  const [failed,setFailed]=useState(false);
  const [resolved,setResolved]=useState(src);
  const attempted=useRef(false);
  useEffect(()=>{attempted.current=false;setFailed(false);setResolved(src);},[src]);
  useEffect(()=>{
    if(!failed||attempted.current||!src||!window.seekdesk?.loadAvatar)return;
    const id=src.match(/\/avatar\/(\d+)(?:\.|\/|$)/)?.[1];
    if(!id)return;
    attempted.current=true;let current=true;
    void window.seekdesk.loadAvatar(Number(id)).then(value=>{if(current&&value){setResolved(value);setFailed(false);}}).catch(()=>{});
    return()=>{current=false;};
  },[failed,src]);
  const shade=[...name].reduce((v,char)=>v+char.charCodeAt(0),0)%5;
  return <span className={`avatar avatar-${shade}${large?' large':''}`}>{resolved&&!failed?<img src={resolved} alt={`${name||'用户'}的头像`} loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:name.slice(0,1).toUpperCase()||<UserRound size={18}/>}</span>;
}
function Notice({children,action,warning=false}:{children:ReactNode;action?:ReactNode;warning?:boolean}) {
  return <div data-testid="notice" className={`notice${warning?' warning':''}`} role="status"><CircleAlert size={17}/><span>{children}</span>{action}</div>;
}

export default function App() {
  const [ready,setReady]=useState(false),[bootError,setBootError]=useState('');
  const [settings,setSettings]=useState<Settings>(defaults),[version,setVersion]=useState('0.1.0');
  const [buildNumber,setBuildNumber]=useState<string>();
  const [account,setAccount]=useState<AccountState>({status:'unknown'});
  const [official,setOfficial]=useState<OfficialViewState>({visible:false,url:'',loading:false,purpose:'login'});
  const [accountRevision,setAccountRevision]=useState(0),confirmedIdentity=useRef<string|null>(null);
  const [category,setCategory]=useState(''),[order,setOrder]=useState<'postTime'|'replyTime'>('postTime'),[page,setPage]=useState(1);
  const [listing,setListing]=useState<ListingResult|null>(null),[listingLoading,setListingLoading]=useState(true),[listingError,setListingError]=useState('');
  const [query,setQuery]=useState(''),[tabs,setTabs]=useState<Post[]>([]),[activeId,setActiveId]=useState<string|null>(null);
  const [overviewOpen,setOverviewOpen]=useState(true),[threads,setThreads]=useState<Record<string,ThreadState>>({});
  const [showSettings,setShowSettings]=useState(false),[listHidden,setListHidden]=useState(false);
  const [toast,setToast]=useState<{message:string;tone:ToastTone}|null>(null);
  const [scrollRevision,setScrollRevision]=useState(0);const scrollSaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [accountBusy,setAccountBusy]=useState(false),[confirmClear,setConfirmClear]=useState(false);
  const [blockedUsers,setBlockedUsers]=useState<number[]>([]),[expandedBlocked,setExpandedBlocked]=useState<string[]>([]);
  const [following,setFollowing]=useState<number[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({});
  const [actionBusy,setActionBusy]=useState('');
  const [replyFocusRequest,setReplyFocusRequest]=useState(0);
  const [reactionConfirmation,setReactionConfirmation]=useState<ReactionConfirmation|null>(null);
  const [messageTarget,setMessageTarget]=useState<{id:number;name:string}|null>(null),[messageContent,setMessageContent]=useState('');
  const [view,setView]=useState<'forum'|'mine'|'space'|'extensions'|'notifications'|'compose'|'ranking'|'friends'>('forum');
  const [appearance,setAppearance]=useState<ParitySettings>(appearanceDefaults),[extensions,setExtensions]=useState<ExtensionsState>(extensionsDefaults),[stickers,setStickers]=useState<StickerItem[]>([]),[history,setHistory]=useState<SearchHistory[]>([]);
  const [profile,setProfile]=useState<MemberProfile|null>(null),[unread,setUnread]=useState<UnreadCounts>({mentions:0,replies:0,messages:0}),[memberId,setMemberId]=useState<number|undefined>(),[initialPeer,setInitialPeer]=useState<{id:number;name:string}|undefined>();
  const [searchOpen,setSearchOpen]=useState(false),[mediaOpen,setMediaOpen]=useState(false),[sidebarHidden,setSidebarHidden]=useState(false),[sidebarGroup,setSidebarGroup]=useState<'boards'|'shortcuts'|'ranking'|null>('ranking');
  const [rankingPeriod,setRankingPeriod]=useState<RankingPeriod>('realtime'),[ranking,setRanking]=useState<RankingResult|null>(null),[rankingError,setRankingError]=useState(''),[rankingLoading,setRankingLoading]=useState(false),[editSource,setEditSource]=useState<{url:string;floor:string}|undefined>();
  const [serverSearch,setServerSearch]=useState<{term:string;categories:string[]}|null>(null),[selectedIndex,setSelectedIndex]=useState(0),[loadingOlder,setLoadingOlder]=useState(false),[replyExpanded,setReplyExpanded]=useState(false),[bossMode,setBossMode]=useState(false);
  const [replyTargets,setReplyTargets]=useState<Record<string,string>>({});
  const [replyStatus,setReplyStatus]=useState<{postId:string;url:string;floor:string;message:string;waiting:boolean}|null>(null);
  const [rulingMember,setRulingMember]=useState<{id:number;name:string}|null>(null),[keywordAlerts,setKeywordAlerts]=useState<KeywordHit[]>([]);const seenHits=useRef<Set<string>|null>(null);
  const parityReady=useRef(false),prefetchedSearch=useRef(false);
  const draggedTab=useRef<string|null>(null),draftReady=useRef(''),appearanceRequest=useRef(0),replyWidths=useRef<Record<string,number>>({});
  const listRequest=useRef(0),threadRequests=useRef(new Map<string,number>()),settingsRequest=useRef(0),actionEpoch=useRef(0);
  const searchRef=useRef<HTMLInputElement>(null),readerRef=useRef<HTMLDivElement>(null),replyRef=useRef<HTMLTextAreaElement>(null);
  const scrollPositions=useRef(new Map<string,number>());
  const activeIdRef=useRef(activeId);activeIdRef.current=activeId;
  const latestDrafts=useRef(drafts);latestDrafts.current=drafts;
  const replySubmission=useRef<number|null>(null);
  const rankingRequest=useRef(0);
  const activePost=tabs.find(tab=>tab.id===activeId),activeThread=activeId?threads[activeId]:undefined;
  const firstComment=activeThread?.result?.comments[0];
  const firstFloorHasAuthor=activeThread?.result?.page===1&&Boolean(firstComment?.author.trim()&&!['NodeSeek 用户','社区成员'].includes(firstComment.author));
  const showThreadOwner=Boolean(activePost?.author)&&!firstFloorHasAuthor;

  const notify=useCallback((message:string,tone:ToastTone='info')=>setToast({message,tone}),[]);
  const action=useCallback(async(operation:()=>Promise<unknown>)=>{try{await operation();}catch(error){notify(errorMessage(error),'error');}},[notify]);
  const leaveOfficial=useCallback((next?:()=>void)=>{
    if(!official.visible){next?.();return;}
    void action(async()=>{await window.seekdesk.closeOfficial();next?.();});
  },[official.visible,action]);
  const boot=useCallback(async()=>{
    try {
      setBootError('');
      if(!window.seekdesk)throw new Error('桌面连接未建立，请从调试启动器打开客户端。');
      const data=await window.seekdesk.bootstrap();
      setSettings(data.settings);setAccount(data.account);setVersion(data.version);setBuildNumber(data.buildNumber);setOfficial(data.official);setBlockedUsers(data.blockedUsers||[]);
      confirmedIdentity.current=data.account.status==='signed-in'?String(data.account.id||data.account.name):data.account.status==='signed-out'?'signed-out':null;
      if(data.settings.restoreTabs){scrollPositions.current=new Map(Object.entries(data.workspace.scrollPositions||{}));setTabs(data.workspace.tabs);setActiveId(data.workspace.activeId);setOverviewOpen(data.workspace.overviewOpen!==false);}
      setReady(true);
    } catch(error){setBootError(errorMessage(error));}
  },[]);
  useEffect(()=>{void boot();},[boot]);
  useEffect(()=>{
    const selector='details.user-menu[open], details.layout-menu[open], details.tab-menu[open]';
    const dismiss=(event:Event)=>{const target=event.target;if(!(target instanceof Node))return;for(const menu of document.querySelectorAll<HTMLDetailsElement>(selector))if(!menu.contains(target))menu.open=false;};
    const escape=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;const menus=document.querySelectorAll<HTMLDetailsElement>(selector);if(!menus.length)return;for(const menu of menus){menu.open=false;menu.querySelector<HTMLElement>('summary')?.focus();}event.preventDefault();event.stopPropagation();};
    const exclusive=(event:Event)=>{const opened=event.target;if(!(opened instanceof HTMLDetailsElement)||!opened.open||!opened.matches('details.user-menu,details.layout-menu,details.tab-menu'))return;for(const menu of document.querySelectorAll<HTMLDetailsElement>(selector))if(menu!==opened)menu.open=false;};
    document.addEventListener('pointerdown',dismiss,true);document.addEventListener('focusin',dismiss,true);document.addEventListener('keydown',escape,true);document.addEventListener('toggle',exclusive,true);
    return()=>{document.removeEventListener('pointerdown',dismiss,true);document.removeEventListener('focusin',dismiss,true);document.removeEventListener('keydown',escape,true);document.removeEventListener('toggle',exclusive,true);};
  },[]);
  useEffect(()=>{if(!ready)return;let current=true;void window.seekdesk.parityBootstrap().then(data=>{if(!current)return;setAppearance({...appearanceDefaults,...data.appearance});seenHits.current=new Set(data.extensions.hits.map(hit=>`${hit.post.id}:${hit.date}`));parityReady.current=true;setExtensions({...data.extensions,blocked:[...data.extensions.blocked,...blockedUsers.filter(id=>!data.extensions.blocked.some(user=>user.memberId===id)).map(id=>({memberId:id,name:`UID ${id}`}))]});setStickers(data.stickers);setHistory(data.searchHistory);}).catch(error=>notify(errorMessage(error),'error'));return()=>{current=false;};},[ready,notify]);
  const refreshSummary=useCallback(async()=>{if(account.status!=='signed-in'){setProfile(null);setUnread({mentions:0,replies:0,messages:0});return;}try{const data=await window.seekdesk.queryForum({kind:'account'});setProfile(data.profile||null);setUnread(data.unread||{mentions:0,replies:0,messages:0});}catch{}},[account.id,account.status]);
  useEffect(()=>{if(!ready)return;void refreshSummary();if(!appearance.notificationPolling||account.status!=='signed-in')return;const timer=setInterval(()=>void refreshSummary(),60000);return()=>clearInterval(timer);},[ready,refreshSummary,appearance.notificationPolling]);
  useEffect(()=>{if(!ready)return;const cleanup=window.seekdesk.onExtensionsChange(setExtensions),boss=window.seekdesk.onBossKey(setBossMode);return()=>{cleanup();boss();};},[ready]);
  useEffect(()=>{const current=new Set(extensions.hits.map(hit=>`${hit.post.id}:${hit.date}`));if(parityReady.current&&seenHits.current&&extensions.enabled.includes('keywords')){const added=extensions.hits.filter(hit=>!seenHits.current!.has(`${hit.post.id}:${hit.date}`));if(added.length)setKeywordAlerts(value=>[...added,...value].slice(0,20));}seenHits.current=current;},[extensions.hits,extensions.enabled]);
  const loadRanking=useCallback(async(force=false)=>{const token=++rankingRequest.current;setRankingLoading(true);setRankingError('');try{const value=await window.seekdesk.getHotRanking(rankingPeriod,force);if(token===rankingRequest.current){setRanking(value);setRankingError(value.error||'');}}catch(error){if(token===rankingRequest.current)setRankingError(errorMessage(error));}finally{if(token===rankingRequest.current)setRankingLoading(false);}},[rankingPeriod]);
  useEffect(()=>setRankingPeriod(extensions.hotDefaultPeriod),[extensions.hotDefaultPeriod]);
  useEffect(()=>{if(!ready||!extensions.installed.includes('hot')||!extensions.enabled.includes('hot'))return;void loadRanking();const timer=setInterval(()=>void loadRanking(),extensions.hotRefreshSeconds*1000);return()=>{++rankingRequest.current;clearInterval(timer);};},[ready,loadRanking,extensions.installed,extensions.enabled,extensions.hotRefreshSeconds]);
  useEffect(()=>{
    if(!ready)return;
    return window.seekdesk.onAccountChange(next=>{
      if(next.status==='signed-in'||next.status==='signed-out'){
        const identity=next.status==='signed-in'?String(next.id||next.name):'signed-out';
        const previous=confirmedIdentity.current;
        if(previous!==identity&&(previous!==null||next.status==='signed-in')){
          ++listRequest.current;++actionEpoch.current;
          for(const[id,token]of threadRequests.current)threadRequests.current.set(id,token+1);
          setThreads({});setDrafts({});setFollowing([]);setActionBusy('');setReplyTargets({});setReplyStatus(null);setExpandedBlocked([]);setReactionConfirmation(null);setMessageTarget(null);setMessageContent('');setProfile(null);setInitialPeer(undefined);setView('forum');setMediaOpen(false);setSearchOpen(false);
          // Guest public URLs can stay open after login; an actual account
          // boundary discards all previously opened private reading metadata.
          if(previous!==null&&previous!=='signed-out'){setTabs([]);setActiveId(null);}
          setListing(null);setListingError('');setListingLoading(true);setAccountRevision(v=>v+1);
          if(next.status==='signed-in'){setShowSettings(false);notify(`已登录 ${next.name||'NodeSeek'}，正在刷新内容。`,'success');}
        }
        confirmedIdentity.current=identity;
      }
      setAccount(next);
    });
  },[ready,notify]);
  useEffect(()=>ready?window.seekdesk.onOfficialChange(setOfficial):undefined,[ready]);
  useEffect(()=>{
    document.documentElement.style.setProperty('--ui-font-size',`${settings.uiFontSize||16}px`);
    const media=window.matchMedia('(prefers-color-scheme: dark)');
    const update=()=>{document.documentElement.dataset.theme=settings.theme==='system'?(media.matches?'dark':'light'):settings.theme;};
    update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);
  },[settings.theme,settings.uiFontSize]);
  useEffect(()=>{if(toast){const timer=setTimeout(()=>setToast(null),5500);return()=>clearTimeout(timer);}},[toast]);
  useEffect(()=>{
    if(!ready)return;
    const timer=setTimeout(()=>{void window.seekdesk.saveWorkspace({tabs,activeId,overviewOpen,scrollPositions:Object.fromEntries(tabs.map(tab=>[tab.id,scrollPositions.current.get(tab.id)||0]))}).catch(error=>notify(errorMessage(error),'error'));},250);
    return()=>clearTimeout(timer);
  },[ready,tabs,activeId,overviewOpen,scrollRevision,notify]);
  useEffect(()=>()=>clearTimeout(scrollSaveTimer.current),[]);

  const loadListing=useCallback(async()=>{
    const token=++listRequest.current;setListingLoading(true);setListingError('');
    try{const result=serverSearch?await window.seekdesk.queryForum({kind:'search',term:serverSearch.term,categories:serverSearch.categories,page}).then(result=>({posts:result.posts||[],source:'web' as const,fetchedAt:new Date().toISOString(),nextPage:result.nextPage||null})):await window.seekdesk.listPosts({category,order,page});if(token===listRequest.current)setListing(result);}
    catch(error){if(token===listRequest.current)setListingError(errorMessage(error));}
    finally{if(token===listRequest.current)setListingLoading(false);}
  },[category,order,page,serverSearch]);
  useEffect(()=>{if(ready){if(prefetchedSearch.current){prefetchedSearch.current=false;return;}setListing(null);void loadListing();}},[ready,loadListing,settings.defaultSource,accountRevision]);
  const loadThread=useCallback(async(post:Post,targetPage=1)=>{
    const token=(threadRequests.current.get(post.id)||0)+1;threadRequests.current.set(post.id,token);
    setThreads(current=>({...current,[post.id]:{...current[post.id],loading:true,error:undefined,requestedPage:targetPage}}));
    try{
      const result=await window.seekdesk.readThread(post,targetPage);
      if(threadRequests.current.get(post.id)!==token)return null;
      setThreads(current=>({...current,[post.id]:{loading:false,result,requestedPage:targetPage}}));
      setFollowing(current=>{const next=new Set(current);for(const comment of result.comments){if(comment.authorId&&comment.following===true)next.add(comment.authorId);else if(comment.authorId&&comment.following===false)next.delete(comment.authorId);}return [...next];});
      setTabs(current=>current.map(tab=>{if(tab.id!==post.id)return tab;let hash='';try{const location=new URL(post.url);if(Number(location.pathname.match(/-(\d+)\/?$/)?.[1]||1)===targetPage)hash=location.hash;}catch{}return {...tab,title:result.title||tab.title,url:result.url.split('#')[0]+hash};}));
      return result;
    }catch(error){if(threadRequests.current.get(post.id)===token)setThreads(current=>({...current,[post.id]:{...current[post.id],loading:false,error:errorMessage(error),requestedPage:targetPage}}));return null;}
  },[]);
  useEffect(()=>{if(activePost&&!threads[activePost.id])void loadThread(activePost,Number(new URL(activePost.url).pathname.match(/-(\d+)\/?$/)?.[1]||1));},[activePost,threads,loadThread]);
  useEffect(()=>setReplyExpanded(false),[activeId]);
  useEffect(()=>{if(replyStatus&&activeThread?.result?.id===replyStatus.postId&&activeThread.result.source==='web'&&activeThread.result.comments.some(comment=>comment.id===replyStatus.floor))setReplyStatus(null);},[activeThread?.result,replyStatus]);
  useLayoutEffect(()=>{if(readerRef.current)readerRef.current.scrollTop=scrollPositions.current.get(activeId||'')||0;},[activeId,activeThread?.result,showSettings,official.visible,view]);
  useEffect(()=>{
    if(!activePost||!activeThread?.result||showSettings||official.visible)return;
    const hash=new URL(activePost.url).hash;
    if(!/^#(?:comment-)?\d+$/.test(hash))return;
    const id=hash.replace(/^#(?:comment-)?/,'');
    const frame=requestAnimationFrame(()=>document.getElementById(`comment-${id}`)?.scrollIntoView({block:'start',behavior:'auto'}));
    return()=>cancelAnimationFrame(frame);
  },[activePost?.url,activeThread?.result,showSettings,official.visible]);
  const openPost=useCallback((post:Post,background=false,explicit=false)=>{
    if(!tabs.some(tab=>tab.id===post.id)&&tabs.length>=30){notify('已打开 30 个标签，请先关闭一些标签。');return;}
    const open=()=>{
      setTabs(current=>current.some(tab=>tab.id===post.id)?current.map(tab=>tab.id===post.id&&explicit?{...tab,url:post.url}:tab):[...current,post]);
      if(explicit){scrollPositions.current.delete(post.id);void loadThread(post,Number(new URL(post.url).pathname.match(/-(\d+)\/?$/)?.[1]||1));}
      if(!background){setActiveId(post.id);setShowSettings(false);setView('forum');if(window.innerWidth<1050)setListHidden(true);}
    };
    if(background)open();else leaveOfficial(open);
  },[tabs,notify,loadThread,leaveOfficial]);
  const closeTab=useCallback((id:string)=>{
    setTabs(current=>{const index=current.findIndex(tab=>tab.id===id);if(activeId===id)setActiveId(current[index+1]?.id||current[index-1]?.id||null);return current.filter(tab=>tab.id!==id);});
    threadRequests.current.set(id,(threadRequests.current.get(id)||0)+1);
    scrollPositions.current.delete(id);
    setThreads(current=>{const next={...current};delete next[id];return next;});
  },[activeId]);
  const closeOverview=useCallback(()=>{setOverviewOpen(false);if(!activeId&&tabs.length)setActiveId(tabs[0].id);},[activeId,tabs]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key===','){event.preventDefault();leaveOfficial(()=>{setShowSettings(true);setView('forum');});}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();leaveOfficial(()=>setSearchOpen(true));}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='r'){event.preventDefault();if(activePost&&listHidden)void loadThread(activePost,activeThread?.requestedPage||1);else void loadListing();}
      if(event.ctrlKey&&event.key==='Tab'){event.preventDefault();if(tabs.length){const index=tabs.findIndex(tab=>tab.id===activeId),next=(index+(event.shiftKey?-1:1)+tabs.length)%tabs.length;leaveOfficial(()=>{setActiveId(tabs[next].id);setShowSettings(false);setView('forum');});}}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='w'){
        if(official.visible){event.preventDefault();leaveOfficial();}else if(activeId){event.preventDefault();closeTab(activeId);}else if(overviewOpen){event.preventDefault();closeOverview();}
      }
      if((confirmClear||reactionConfirmation||messageTarget)&&event.key==='Tab'){
        const buttons=[...document.querySelectorAll<HTMLElement>('.confirm-dialog button:not(:disabled), .message-dialog button:not(:disabled), .message-dialog textarea')],first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
      if(event.key==='Escape'){if(searchOpen)setSearchOpen(false);else if(mediaOpen)setMediaOpen(false);else if(messageTarget)setMessageTarget(null);else if(reactionConfirmation)setReactionConfirmation(null);else if(confirmClear)setConfirmClear(false);else if(showSettings)setShowSettings(false);else if(view!=='forum')setView('forum');else{setListHidden(false);setActiveId(null);setOverviewOpen(true);}}
    };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[activeId,closeTab,showSettings,confirmClear,leaveOfficial,official.visible,overviewOpen,closeOverview,reactionConfirmation,messageTarget,searchOpen,mediaOpen,view,tabs,activePost,listHidden,activeThread?.requestedPage,loadListing,loadThread]);

  const updateSettings=async(patch:Partial<Settings>)=>{
    const previous=settings,next={...settings,...patch},token=++settingsRequest.current;setSettings(next);
    try{const saved=await window.seekdesk.saveSettings(next);if(token===settingsRequest.current){setSettings(saved);notify('设置已保存','success');}}
    catch(error){if(token===settingsRequest.current)setSettings(previous);notify(`设置保存失败：${errorMessage(error)}`,'error');}
  };
  const checkAccount=async()=>{
    setAccountBusy(true);try{const value=await window.seekdesk.checkAccount();setAccount(value);notify(value.status==='signed-in'?`已连接 ${value.name||'NodeSeek 账号'}`:value.status==='verification'?'请在官方页面完成验证。':value.status==='signed-out'?'当前未登录，可打开官方网页登录。':'暂未识别账号，请在官方页面查看。',value.status==='signed-in'?'success':'info');}
    catch(error){notify(errorMessage(error),'error');}finally{setAccountBusy(false);}
  };
  const clearSession=async()=>{
    setConfirmClear(false);setAccountBusy(true);
    try{
      await window.seekdesk.clearSession();++listRequest.current;++actionEpoch.current;
      for(const[id,token]of threadRequests.current)threadRequests.current.set(id,token+1);
      setAccount({status:'signed-out'});setThreads({});setTabs([]);setActiveId(null);setDrafts({});setListing(null);notify('本机 NodeSeek 会话已清除。','success');await loadListing();
    }catch(error){notify(errorMessage(error),'error');}finally{setAccountBusy(false);}
  };
  const changeBoard=(id:string)=>leaveOfficial(()=>{setCategory(id);setPage(1);setQuery('');setServerSearch(null);setShowSettings(false);setView('forum');setListHidden(false);setSelectedIndex(0);});
  const handleSearch=(event:FormEvent)=>{event.preventDefault();if(/^https?:\/\//i.test(query.trim())){const post=postFromUrl(query.trim());if(post){openPost(post,false,true);setQuery('');}else notify('请粘贴 NodeSeek 官方帖子链接。');}};
  const contentClick=(event:MouseEvent<HTMLDivElement>)=>{
    const anchor=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');if(!anchor)return;event.preventDefault();
    const post=postFromUrl(anchor.href);if(post){openPost(post,event.ctrlKey||event.metaKey,true);return;}
    try{const url=new URL(anchor.href);if(!['https:','http:'].includes(url.protocol))return;void action(()=>['www.nodeseek.com','nodeseek.com'].includes(url.hostname)?window.seekdesk.openOfficial(url.href):window.seekdesk.openExternal(url.href));}catch{}
  };
  const toggleBlock=async(id:number)=>{
    const remove=blockedUsers.includes(id)||extensions.blocked.some(user=>user.memberId===id),name=activeThread?.result?.comments.find(comment=>comment.authorId===id)?.author||`UID ${id}`;
    try{const value=await window.seekdesk.saveExtensions({...extensions,blocked:remove?extensions.blocked.filter(user=>user.memberId!==id):[...extensions.blocked,{memberId:id,name}],installed:[...new Set([...extensions.installed,'block' as const])],enabled:[...new Set([...extensions.enabled,'block' as const])]});setExtensions(value);const ids=value.blocked.flatMap(user=>user.memberId?[user.memberId]:[]);setBlockedUsers(await window.seekdesk.setBlockedUsers(ids));notify(remove?'已解除本机屏蔽。':'已在本机屏蔽此用户。','success');}catch(error){notify(errorMessage(error),'error');}
  };
  const performForumAction=async(request:ForumActionRequest,key:string):Promise<ForumActionResult|null>=>{
    if(!account.id){notify('请先登录 NodeSeek。');return null;}const epoch=actionEpoch.current;setActionBusy(key);
    try{
      const result=await window.seekdesk.forumAction(request,account.id!);if(epoch!==actionEpoch.current)return null;
      if(request.kind==='react'&&result.confirmation){setReactionConfirmation({request,approval:result.confirmation,message:result.message});return null;}
      notify(result.message,'success');return result;
    }
    catch(error){if(epoch===actionEpoch.current)notify(errorMessage(error),'error');return null;}
    finally{if(epoch===actionEpoch.current&&(request.kind!=='reply'||replySubmission.current!==epoch))setActionBusy('');}
  };
  const sendReply=async()=>{
    if(!activePost||!account.id||replySubmission.current===actionEpoch.current)return;
    const post=activePost,owner=account.id,epoch=actionEpoch.current,raw=(drafts[post.id]||'').trim();if(!raw)return;
    if(raw.length>20000){notify('回复不能超过 20,000 字，请精简后再提交。');return;}
    replySubmission.current=epoch;setActionBusy(`reply:${post.id}`);
    try{
      const content=await window.seekdesk.prepareImages(raw,replyWidths.current);
      if(epoch!==actionEpoch.current)return;
      const result=await performForumAction({kind:'reply',url:post.url,content},`reply:${post.id}`);if(!result||epoch!==actionEpoch.current)return;
      if((latestDrafts.current[post.id]||'').trim()===raw){setDrafts(current=>({...current,[post.id]:current[post.id]?.trim()===raw?'':current[post.id]}));void window.seekdesk.saveDraft(`reply:${post.id}`,null,owner).catch(()=>{});}
      if(activeIdRef.current!==post.id)return;
      setReplyExpanded(false);
      const destination=result.destination,targetPost=destination?{...post,url:destination.url}:post,targetPage=destination?.page||activeThread?.result?.page||1;
      if(destination?.floor){setReplyTargets(current=>({...current,[post.id]:destination.floor!}));setReplyStatus({postId:post.id,url:destination.url,floor:destination.floor,message:'回复已发布，正在读取新楼层…',waiting:true});}
      for(let attempt=0;attempt<(destination?.floor?3:1);attempt++){
        if(attempt)await new Promise(resolve=>setTimeout(resolve,attempt===1?700:1600));
        if(epoch!==actionEpoch.current||activeIdRef.current!==post.id)return;
        const refreshed=await loadThread(targetPost,targetPage);
        if(epoch!==actionEpoch.current||activeIdRef.current!==post.id)return;
        if(refreshed?.source==='web'&&(!destination?.floor||refreshed.comments.some(comment=>comment.id===destination.floor))){setReplyStatus(null);return;}
        if(!refreshed||refreshed.source!=='web')break;
      }
      if(destination?.floor)setReplyStatus({postId:post.id,url:destination.url,floor:destination.floor,message:'回复已发布，站点暂未同步新楼层。请稍后刷新，勿重复提交。',waiting:false});
    }catch(error){if(epoch===actionEpoch.current)notify(errorMessage(error),'error');}
    finally{if(replySubmission.current===epoch)replySubmission.current=null;if(epoch===actionEpoch.current)setActionBusy('');}
  };
  const insertFloorReference=(comment:Comment,quoting:boolean)=>{
    if(!activePost||!/^\d+$/.test(comment.id))return;
    const destination=new URL(activeThread?.result?.url||activePost.url);destination.hash=comment.id;
    const heading=`@${comment.author.replace(/[\r\n]+/g,' ')} [#${comment.id}](${destination.href})`;
    const element=document.createElement('div');element.innerHTML=comment.html;
    element.querySelectorAll('br').forEach(node=>node.replaceWith('\n'));
    element.querySelectorAll('p,div,li,blockquote,pre,h1,h2,h3,h4,h5,h6').forEach(node=>node.append('\n'));
    const plain=(element.textContent||'').trim(),excerpt=plain.slice(0,1600)+(plain.length>1600?'…':'');
    const insertion=quoting?`> ${heading}${excerpt?'\n>\n'+excerpt.split('\n').map(line=>`> ${line}`).join('\n'):''}\n\n`:`${heading}\n\n`;
    const current=drafts[activePost.id]||'',gap=!current||current.endsWith('\n\n')?'':current.endsWith('\n')?'\n':'\n\n';
    if(current.length+gap.length+insertion.length>20000){notify('加入楼层内容后超过 20,000 字，请先精简回复内容。');return;}
    setDrafts(drafts=>{const latest=drafts[activePost.id]||'',separator=!latest||latest.endsWith('\n\n')?'':latest.endsWith('\n')?'\n':'\n\n';return {...drafts,[activePost.id]:latest+separator+insertion};});
    setReplyExpanded(true);setReplyFocusRequest(request=>request+1);
  };
  const followUser=async(id:number)=>{
    const follow=!following.includes(id);
    if(await performForumAction({kind:'follow',memberId:id,follow},`follow:${id}`))setFollowing(current=>follow?[...new Set([...current,id])]:current.filter(value=>value!==id));
  };
  const reactToComment=async(request:Extract<ForumActionRequest,{kind:'react'}>)=>{
    if(await performForumAction(request,`${request.reaction}:${request.commentId}`)){
      if(activePost)await loadThread(activePost,activeThread?.result?.page||1);
    }
  };
  const sendMessage=async()=>{
    if(!messageTarget||!messageContent.trim())return;
    if(messageContent.trim().length>20000){notify('私信不能超过 20,000 字。');return;}
    if(await performForumAction({kind:'message',memberId:messageTarget.id,content:messageContent.trim()},`message:${messageTarget.id}`)){setMessageTarget(null);setMessageContent('');}
  };
  const navigate=(next:typeof view)=>leaveOfficial(()=>{setShowSettings(false);setView(next);});
  const showMember=(id:number)=>{setMemberId(id);navigate(id===account.id?'mine':'space');};
  const showMessages=(id:number,name:string)=>{setInitialPeer({id,name});navigate('notifications');};
  const saveAppearance=async(next:ParitySettings)=>{const previous=appearance,token=++appearanceRequest.current;setAppearance(next);try{const result=await window.seekdesk.saveAppearance(next);if(token===appearanceRequest.current)setAppearance(result);}catch(error){if(token===appearanceRequest.current)setAppearance(previous);notify(errorMessage(error),'error');}};
  const saveExtensions=async(next:ExtensionsState)=>{const saved=await window.seekdesk.saveExtensions(next);setExtensions(saved);const ids=saved.blocked.flatMap(user=>user.memberId?[user.memberId]:[]);if(JSON.stringify(ids)!==JSON.stringify(blockedUsers))setBlockedUsers(await window.seekdesk.setBlockedUsers(ids));};
  const upload=async(file:File,width?:number)=>{const image=await window.seekdesk.uploadImage({name:file.name,mime:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),width});return image.url;};
  const mediaChanged=()=>void window.seekdesk.getStickers().then(setStickers).catch(error=>notify(errorMessage(error),'error'));
  const saveHistory=(value:SearchHistory[])=>{setHistory(value);void window.seekdesk.saveSearchHistory(value).catch(error=>notify(errorMessage(error),'error'));};
  const startResize=(event:React.PointerEvent<HTMLDivElement>,kind:'sidebarWidth'|'listWidth')=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const start=event.clientX,initial=appearance[kind],target=event.currentTarget;let value=initial;const move=(next:PointerEvent)=>{value=Math.min(kind==='sidebarWidth'?390:640,Math.max(kind==='sidebarWidth'?190:280,initial+next.clientX-start));setAppearance(current=>({...current,[kind]:value}));};const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);void saveAppearance({...appearance,[kind]:value});};target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);};
  const isBlocked=(id?:number,name?:string)=>extensions.enabled.includes('block')&&extensions.installed.includes('block')&&Boolean((id&&blockedUsers.includes(id))||extensions.blocked.some(user=>id&&user.memberId?user.memberId===id:user.name.toLocaleLowerCase()===(name||'').toLocaleLowerCase()));
  const filtered=(listing?.posts||[]).filter(post=>!isBlocked(post.authorId,post.author)&&matchesSearch(query,[post.title,post.author,boardName(post.category)]));
  const accountLabel=account.status==='signed-in'?'已登录':account.status==='verification'?'需要网页验证':account.status==='signed-out'?'未登录':'会话待检测';
  const canInteract=account.status==='signed-in'&&activeThread?.result?.source==='web'&&!activeThread.loading;
  const fontScale=(settings.uiFontSize||16)/16;
  const reply=(activePost&&drafts[activePost.id])||'';
  const fullPage=showSettings||official.visible||view!=='forum';
  const sharedComposerProps={appearance,stickers,onUpload:upload,onStickers:()=>setMediaOpen(true),onMedia:()=>setMediaOpen(true)};
  const onlyAuthor=extensions.installed.includes('authorOnly')&&extensions.enabled.includes('authorOnly')&&extensions.authorOnly;
  const loadOlder=async()=>{if(!listing?.nextPage||loadingOlder)return;setLoadingOlder(true);const token=listRequest.current;try{const next=serverSearch?await window.seekdesk.queryForum({kind:'search',term:serverSearch.term,categories:serverSearch.categories,page:listing.nextPage}).then(result=>({posts:result.posts||[],source:'web' as const,fetchedAt:new Date().toISOString(),nextPage:result.nextPage||null})):await window.seekdesk.listPosts({category,order,page:listing.nextPage});if(token===listRequest.current)setListing(current=>current?{...next,posts:[...current.posts,...next.posts.filter(post=>!current.posts.some(item=>item.id===post.id))]}:next);}catch(error){notify(errorMessage(error),'error');}finally{setLoadingOlder(false);}};
  useEffect(()=>{if(!ready||!activePost||!account.id)return;const key=`reply:${activePost.id}`;let current=true;draftReady.current='';void window.seekdesk.loadDraft(key,account.id).then(value=>{if(current){replyWidths.current=value?.imageWidths||{};draftReady.current=key;setDrafts(drafts=>({...drafts,[activePost.id]:value?.content??drafts[activePost.id]??''}));}}).catch(()=>{if(current)draftReady.current=key;});return()=>{current=false;};},[activePost?.id,account.id,ready]);
  useEffect(()=>{if(!activePost||!account.id||draftReady.current!==`reply:${activePost.id}`)return;const timer=setTimeout(()=>void window.seekdesk.saveDraft(`reply:${activePost.id}`,{content:reply,imageWidths:replyWidths.current},account.id).catch(()=>{}),500);return()=>clearTimeout(timer);},[activePost?.id,reply,account.id]);
  useEffect(()=>{if(!ready||!appearance.autoRefresh)return;const timer=setInterval(()=>{if(view==='forum'&&!activeId&&!official.visible&&!document.hidden)void loadListing();},60000);return()=>clearInterval(timer);},[ready,appearance.autoRefresh,view,activeId,official.visible,loadListing]);
  useEffect(()=>ready?window.seekdesk.onOpenPost(post=>openPost(post)):undefined,[ready,openPost]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')||view!=='forum'||showSettings||official.visible||searchOpen||mediaOpen)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSelectedIndex(index=>{const next=Math.min(filtered.length-1,Math.max(0,index+(event.key==='ArrowDown'?1:-1)));requestAnimationFrame(()=>document.querySelectorAll<HTMLElement>('[data-testid="post-row"]')[next]?.scrollIntoView({block:'nearest'}));return next;});}else if(event.key==='Enter'&&filtered[selectedIndex]){event.preventDefault();openPost(filtered[selectedIndex],event.ctrlKey||event.metaKey);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[view,showSettings,official.visible,searchOpen,mediaOpen,filtered,selectedIndex,openPost]);

  return <div className={`app-shell brand-${appearance.brand}${appearance.readerGradient?' reader-gradient':''}`} style={{'--reader-font-size':`${settings.fontSize*fontScale}px`,'--list-font-size':`${appearance.listFontSize*fontScale}px`,'--board-font-size':`${appearance.boardFontSize*fontScale}px`,'--ranking-font-size':`${appearance.rankingFontSize*fontScale}px`,'--author-scale':appearance.authorFontSize/100,'--sidebar-width':`${appearance.sidebarWidth}px`,'--list-width':`${appearance.listWidth}px`,'--accent':palettes.find(item=>item.id===appearance.brand)?.color} as CSSProperties}>
    <header className="titlebar">
      <div className="toolbar-brand"><IconButton label={sidebarHidden?'展开侧栏':'收起侧栏'} onClick={()=>setSidebarHidden(!sidebarHidden)}>{sidebarHidden?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}</IconButton><img src={`./brands/${appearance.brand}.png`} alt=""/><strong>SeekDesk</strong></div>
      <div className="toolbar-tools"><button className="toolbar-search" onClick={()=>leaveOfficial(()=>setSearchOpen(true))}><Search size={16}/><span>搜索</span><kbd>Ctrl K</kbd></button><details className="layout-menu"><summary title="布局" aria-label="布局"><PanelTop size={20}/></summary><div className="user-menu-items" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}><button onClick={()=>{setSidebarHidden(false);setListHidden(false);}}>三栏阅读</button><button onClick={()=>{setSidebarHidden(true);setListHidden(false);}}>列表与正文</button><button onClick={()=>{setSidebarHidden(true);setListHidden(true);}}>专注阅读</button><button onClick={()=>void saveAppearance({...appearance,listWidth:370,sidebarWidth:250})}>恢复默认栏宽</button></div></details><button className="notification-button icon-button" aria-label={`通知，${unread.mentions+unread.replies+unread.messages}条未读`} title="通知与私信" onClick={()=>{setInitialPeer(undefined);navigate('notifications');}}><Bell size={20}/>{unread.mentions+unread.replies+unread.messages>0&&<b>{Math.min(99,unread.mentions+unread.replies+unread.messages)}</b>}</button><button data-testid="account-button" className="toolbar-account" onClick={()=>account.status==='signed-in'?navigate('mine'):void action(()=>window.seekdesk.openOfficial())}><Avatar name={account.name||''} src={account.avatar||avatarUrl(account.id)} large/><span><strong>{account.name||'登录 NodeSeek'}</strong><small>{account.id?`UID ${account.id} · Lv ${account.level??'—'}`:accountLabel}</small></span>{account.status==='signed-in'&&<span className="chicken-balance">🍗 {profile?.coin??'—'}</span>}</button></div>
      <div className="window-controls"><IconButton label="最小化" onClick={()=>window.seekdesk?.windowAction('minimize')}><Minus size={17}/></IconButton><IconButton label="最大化或还原" onClick={()=>window.seekdesk?.windowAction('maximize')}><Square size={13}/></IconButton><IconButton label="关闭窗口" className="window-close" onClick={()=>window.seekdesk?.windowAction('close')}><X size={18}/></IconButton></div>
    </header>
    {!ready?<main className="boot-screen"><img className="boot-logo" src="./assets/app-icon.png" alt="SeekDesk"/><h1>SeekDesk</h1>{bootError?<><p role="alert">{bootError}</p><button className="primary-button" onClick={()=>void boot()}>重新连接</button></>:<LoaderCircle className="spin" size={24}/>}</main>:<div className={`workspace${sidebarHidden?' sidebar-hidden':''}${view==='compose'?' compose-view':''}`}>
      <aside className="sidebar" aria-label="论坛导航">
        <button className="new-topic-button" data-testid="new-topic-button" onClick={()=>{setEditSource(undefined);navigate('compose');}}><Plus size={22}/>发帖</button>
        <button className={`board-link${view==='forum'&&!category&&!serverSearch&&!showSettings?' selected':''}`} onClick={()=>changeBoard('')}><Compass size={19}/><span>最新帖子</span></button>
        <div className="sidebar-scroll">
          <button className="sidebar-group-button" aria-expanded={sidebarGroup==='boards'} onClick={()=>setSidebarGroup(sidebarGroup==='boards'?null:'boards')}><span className="sidebar-group-label"><List size={17}/><span>论坛版块</span></span><ChevronRight className={sidebarGroup==='boards'?'rotated':''} size={15}/></button>
          {sidebarGroup==='boards'&&<nav className="board-nav" aria-label="论坛版块">{boards.slice(1).map(({id,name,icon:Icon})=><button key={id} data-category={id} className={`board-link${category===id&&view==='forum'&&!showSettings?' selected':''}`} onClick={()=>changeBoard(id)}><Icon size={18}/><span>{name}</span>{id==='inside'&&<LockKeyhole size={12} className="board-hint"/>}</button>)}</nav>}
          <button className="sidebar-group-button" aria-expanded={sidebarGroup==='shortcuts'} onClick={()=>setSidebarGroup(sidebarGroup==='shortcuts'?null:'shortcuts')}><span className="sidebar-group-label"><Gift size={17}/><span>快捷功能区</span></span><ChevronRight className={sidebarGroup==='shortcuts'?'rotated':''} size={15}/></button>
          {sidebarGroup==='shortcuts'&&<nav className="board-nav"><button data-category="award" className={`board-link${category==='award'&&view==='forum'?' selected':''}`} onClick={()=>changeBoard('award')}><Diamond size={18}/><span>精品区</span></button><button className="board-link" onClick={()=>void action(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/ruling'))}><ShieldCheck size={18}/><span>管理记录</span></button><button className="board-link" onClick={()=>void action(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/lucky'))}><Gift size={18}/><span>幸运抽奖</span></button><button className="board-link" onClick={()=>void action(()=>window.seekdesk.openOfficial('https://www.nodeseek.com/invite'))}><UserPlus size={18}/><span>邀请好友</span></button><button className="board-link" onClick={()=>leaveOfficial(()=>setSearchOpen(true))}><Search size={18}/><span>搜索帖子与用户</span></button><button className="board-link" onClick={()=>{setInitialPeer(undefined);navigate('notifications');}}><Mail size={18}/><span>通知与私信</span></button><button className="board-link" onClick={()=>void action(()=>window.seekdesk.openOfficial())}><Globe2 size={18}/><span>官方网页</span><ArrowUpRight size={13}/></button>{extensions.installed.includes('office')&&extensions.enabled.includes('office')&&<button className="board-link" onClick={()=>void action(()=>window.seekdesk.toggleBossKey())}><Monitor size={18}/><span>摸鱼老板键</span></button>}<button className="board-link" onClick={()=>setMediaOpen(true)}><Image size={18}/><span>图床与表情库</span></button></nav>}
          <button className="sidebar-group-button" aria-expanded={sidebarGroup==='ranking'} onClick={()=>setSidebarGroup(sidebarGroup==='ranking'?null:'ranking')}><span className="sidebar-group-label"><Flame size={17}/><span>热榜</span></span><ChevronRight className={sidebarGroup==='ranking'?'rotated':''} size={15}/></button>
          {sidebarGroup==='ranking'&&<div className="sidebar-ranking">{extensions.installed.includes('hot')&&extensions.enabled.includes('hot')?<>
            <div className="ranking-period-row"><div className="segmented ranking-period">{([['realtime','实时'],['daily','日榜'],['weekly','周榜']] as const).map(([id,label])=><button key={id} className={rankingPeriod===id?'selected':''} onClick={()=>setRankingPeriod(id)}>{label}</button>)}</div><IconButton label="打开完整热榜" className="ranking-open" onClick={()=>navigate('ranking')}><ArrowUpRight size={17}/></IconButton></div>
            <div className="ranking-list">{rankingLoading&&!ranking?<div className="sidebar-ranking-state"><LoaderCircle size={17} className="spin"/>正在读取热榜</div>:<>{rankingError&&<div className="sidebar-ranking-state"><p>{rankingError}</p><button className="text-button" onClick={()=>void loadRanking(true)}>重新读取</button></div>}{ranking?.items.slice(0,extensions.hotSidebarCount).map(item=><RankingRow item={item} showScore={extensions.hotShowScore} key={item.id} onClick={()=>openPost({...item,published:'',summary:''})}/>)}</>}</div>
            <footer className="ranking-footer"><time dateTime={ranking?.fetchedAt}>刷新 {ranking?.fetchedAt?new Date(ranking.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}</time><span className="ranking-count">共 {ranking?.items.length||0} 条</span></footer>
          </>:<div className="sidebar-ranking-state"><Flame size={20}/><p>在扩展中心安装并启用 NodeSeek 热榜。</p><button className="text-button" onClick={()=>navigate('extensions')}>打开扩展中心</button></div>}</div>}
        </div>
        <div className="sidebar-bottom"><button className={`board-link${view==='friends'?' selected':''}`} onClick={()=>navigate('friends')}><Link size={18}/><span>友情链接</span></button><button className={`board-link${view==='mine'?' selected':''}`} onClick={()=>navigate('mine')}><UserRound size={18}/><span>我的</span></button><button className={`board-link${view==='extensions'?' selected':''}`} onClick={()=>navigate('extensions')}><Puzzle size={18}/><span>扩展中心</span>{extensions.unread>0&&<span className="sidebar-badge">{extensions.unread}</span>}</button><button data-testid="settings-button" className={`board-link${showSettings?' selected':''}`} onClick={()=>leaveOfficial(()=>{setShowSettings(true);setView('forum');})}><Settings2 size={18}/><span>设置</span></button></div>
      </aside><div className="pane-resizer sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" onPointerDown={event=>startResize(event,'sidebarWidth')}/>
      <div className="main-workspace">
        <div className="tab-bar"><button className="tab-utility" onClick={()=>leaveOfficial(()=>{setActiveId(null);setOverviewOpen(true);setShowSettings(false);setView('forum');setListHidden(false);})}><ArrowLeft size={16}/><span>返回总览</span></button><button className="tab-utility list-toggle" onClick={()=>setListHidden(!listHidden)}>{listHidden?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}<span>{listHidden?'展开列表':'收起列表'}</span></button><div className="tabs" role="tablist" aria-label="已打开的帖子">{overviewOpen&&<div className={`overview-tab-wrap${!activeId&&!fullPage?' current':''}`}><button role="tab" aria-selected={!activeId&&!fullPage} className="overview-tab" onClick={()=>leaveOfficial(()=>{setActiveId(null);setView('forum');setShowSettings(false);})}><BookOpen size={16}/><span>阅读总览</span></button><IconButton label="关闭阅读总览" onClick={closeOverview}><X size={14}/></IconButton></div>}{tabs.map(tab=><div key={tab.id} draggable onDragStart={event=>{draggedTab.current=tab.id;event.dataTransfer.effectAllowed='move';}} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();const source=draggedTab.current;if(source&&source!==tab.id)setTabs(current=>{const destination=current.findIndex(item=>item.id===tab.id),next=current.filter(item=>item.id!==source),moving=current.find(item=>item.id===source);if(moving)next.splice(destination,0,moving);return next;});draggedTab.current=null;}} className={`reading-tab${activeId===tab.id&&!fullPage?' current':''}`}><button role="tab" aria-selected={activeId===tab.id&&!fullPage} title={tab.title} onClick={()=>leaveOfficial(()=>{setActiveId(tab.id);setShowSettings(false);setView('forum');})}><FileText size={15}/><span>{tab.title}</span></button><IconButton label={`关闭标签：${tab.title}`} onClick={()=>closeTab(tab.id)}><X size={14}/></IconButton></div>)}{official.visible&&<span className="official-tab current"><Globe2 size={16}/>{official.purpose==='calculator'?'剩余价值计算器':official.purpose==='login'?'官方网页登录':'官方网页'}</span>}</div>{tabs.length>0&&<><IconButton label="关闭全部帖子标签" onClick={()=>{tabs.forEach(tab=>threadRequests.current.set(tab.id,(threadRequests.current.get(tab.id)||0)+1));setTabs([]);setActiveId(null);setThreads({});}}><X size={17}/></IconButton><details className="tab-menu"><summary title="已打开的帖子"><List size={18}/></summary><div className="user-menu-items" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}>{tabs.map(tab=><button key={tab.id} onClick={()=>{setActiveId(tab.id);navigate('forum');}}>{tab.title}</button>)}</div></details></>}</div>
        <div className={`content-area${listHidden?' list-hidden':''}${fullPage?' full-page-area':''}`}>
          {official.visible?<OfficialPanel state={official} scriptEnabled={settings.nodeSeekPro} onScriptSettings={()=>void action(()=>window.seekdesk.openScriptSettings())} onClose={()=>leaveOfficial(()=>setShowSettings(false))} onReload={()=>void action(()=>window.seekdesk.reloadOfficial())}/>:showSettings?<PreferencesPanel settings={settings} appearance={appearance} onAppearance={saveAppearance} version={version} buildNumber={buildNumber} account={account} accountBusy={accountBusy} blockedUsers={blockedUsers} onUpdate={updateSettings} onBack={()=>setShowSettings(false)} onCheck={checkAccount} onClear={()=>setConfirmClear(true)} onUnblock={id=>void toggleBlock(id)} onOfficial={()=>void action(()=>window.seekdesk.openOfficial())} onScriptSettings={()=>void action(()=>window.seekdesk.openScriptSettings())} onExternal={url=>void action(()=>window.seekdesk.openExternal(url))} onMedia={()=>setMediaOpen(true)} onNotify={notify}/>:view==='mine'||view==='space'?<AccountPanel account={account} memberId={view==='space'?memberId:undefined} onBack={()=>navigate('forum')} onOpenPost={openPost} onMember={showMember} onMessage={showMessages} onLogin={()=>void action(()=>window.seekdesk.openOfficial())} onNotify={notify} revision={accountRevision} {...sharedComposerProps}/>:view==='notifications'?<NotificationsPanel account={account} onBack={()=>navigate('forum')} onOpenPost={openPost} onMember={showMember} onLogin={()=>void action(()=>window.seekdesk.openOfficial())} onNotify={notify} onRead={()=>void refreshSummary()} initialPeer={initialPeer} {...sharedComposerProps}/>:view==='compose'?<TopicComposerPanel account={account} source={editSource} onBack={()=>navigate('forum')} onPublished={post=>{openPost(post,false,true);void loadListing();}} onNotify={notify} onLogin={()=>void action(()=>window.seekdesk.openOfficial())} {...sharedComposerProps}/>:view==='extensions'?<ExtensionsPanel account={account} state={extensions} onChange={saveExtensions} onBack={()=>navigate('forum')} onNotify={notify} onOpenRanking={()=>navigate('ranking')} onOpenPost={openPost} onMember={showMember}/>:view==='ranking'?<RankingPanel period={rankingPeriod} showScore={extensions.hotShowScore} refreshSeconds={extensions.hotRefreshSeconds} onOpenPost={openPost} onBack={()=>navigate('forum')}/>:view==='friends'?<FriendsPanel onBack={()=>navigate('forum')}/>:<>
            <section className={`post-list-panel${settings.compact?' compact':''}`} aria-label="帖子列表"><div className="list-heading"><h1><Compass size={20}/>{serverSearch?`搜索：${serverSearch.term}`:category?boardName(category):'最新帖子'}</h1><IconButton label="刷新帖子列表" disabled={listingLoading} onClick={()=>void loadListing()}><RefreshCw size={18} className={listingLoading?'spin':''}/></IconButton></div><div className="list-toolbar"><div className="segmented"><button className={order==='postTime'?'selected':''} onClick={()=>{setOrder('postTime');setPage(1);}}>最新帖子</button><button className={order==='replyTime'?'selected':''} onClick={()=>{setOrder('replyTime');setPage(1);}}>最新回复</button></div>{serverSearch&&<IconButton label="退出搜索" onClick={()=>changeBoard(category)}><X size={17}/></IconButton>}</div><form className="list-filter" onSubmit={handleSearch}><Search size={15}/><input ref={searchRef} aria-label="筛选当前列表" value={query} onChange={event=>setQuery(event.target.value)} placeholder="筛选当前列表…"/>{query&&<IconButton label="清空筛选" onClick={()=>setQuery('')}><X size={14}/></IconButton>}</form>{listing?.notice&&<div className="list-notice"><CircleAlert size={14}/><span>{listing.notice}</span></div>}<div className="list-scroll" aria-busy={listingLoading} onScroll={event=>{if(appearance.autoLoadOlder&&event.currentTarget.scrollHeight-event.currentTarget.scrollTop-event.currentTarget.clientHeight<90)void loadOlder();}}>{listingError?<div data-testid="list-error" className="list-error" role="alert"><CircleAlert size={24}/><strong>暂时无法读取列表</strong><p>{listingError}</p><button className="secondary-button" onClick={()=>void loadListing()}>重新读取</button><button className="text-button" onClick={()=>void action(()=>window.seekdesk.openOfficial())}>打开官方页面</button></div>:<>{listingLoading&&!listing&&Array.from({length:8},(_,i)=><div className="skeleton-row" key={i}><span className="skeleton skeleton-title"/><span className="skeleton skeleton-meta"/></div>)}{!listingLoading&&!filtered.length&&<div className="list-empty"><BookOpen size={25}/><p>{query?'没有匹配的帖子':'暂时没有可显示的帖子'}</p></div>}{filtered.map((post,index)=><button data-testid="post-row" key={post.id} className={`post-row${activeId===post.id?' selected':''}${selectedIndex===index?' keyboard-selected':''}`} onClick={event=>{setSelectedIndex(index);openPost(post,event.ctrlKey||event.metaKey);}} onAuxClick={event=>{if(event.button===1){event.preventDefault();openPost(post,true);}}} title={`${post.title}\nCtrl + 点击在后台打开`}><Avatar name={post.author} src={post.avatar||avatarUrl(post.authorId)} large/><span className="post-row-main"><h2><span className="post-title-text">{post.title}</span>{post.featured&&<Diamond className="featured-badge" size={14} aria-label="精品帖子"/>}{post.readingRank?<span className="access-badge"><LockKeyhole size={12}/>{post.readingRank}</span>:null}</h2><span className="post-row-meta"><span className="post-author">{post.author||'社区成员'}</span><time>{dateLabel(post.published)}</time><span className="category-tag" data-category={post.category}>{boardName(post.category)}</span></span></span>{post.replies!==undefined&&<span className="reply-count">{post.replies}</span>}</button>)}{listing?.nextPage&&<button className="load-older" disabled={loadingOlder} onClick={()=>void loadOlder()}>{loadingOlder?<LoaderCircle size={16} className="spin"/>:<ChevronDown size={16}/>}加载更早的帖子</button>}</>}</div><footer className="list-footer"><span>{filtered.length} 篇帖子 · <span data-testid="list-source" className={`source-label ${listing?.source||''}`}>{listing?.source==='rss'?'公开 RSS':'官方页面'}</span></span><time>{listing?new Date(listing.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''}</time></footer></section><div className="pane-resizer list-resizer" role="separator" aria-label="调整帖子栏宽度" aria-orientation="vertical" onPointerDown={event=>startResize(event,'listWidth')}/>
            <main className="reading-panel">{activePost?<><div className="reader-toolbar"><span className="category-tag" data-category={activePost.category}>{boardName(activePost.category)}</span><div className="reader-toolbar-actions">{extensions.installed.includes('value')&&extensions.enabled.includes('value')&&<button className="text-button" onClick={()=>{void action(()=>window.seekdesk.openCalculator());}}><Calculator size={16}/>剩余价值</button>}{extensions.installed.includes('authorOnly')&&extensions.enabled.includes('authorOnly')&&<button className={`text-button${onlyAuthor?' active':''}`} onClick={()=>void saveExtensions({...extensions,authorOnly:!extensions.authorOnly}).catch(error=>notify(errorMessage(error),'error'))}>只看楼主{onlyAuthor&&<Check size={14}/>}</button>}<IconButton label="复制帖子链接" onClick={()=>void action(async()=>{await window.seekdesk.copyText(activeThread?.result?.url||activePost.url);notify('帖子链接已复制','success');})}><Link size={17}/></IconButton><IconButton label="缩小正文字号" disabled={settings.fontSize<=14} onClick={()=>void updateSettings({fontSize:Math.max(14,settings.fontSize-1)})}><span className="type-size small">A</span></IconButton><IconButton label="增大正文字号" disabled={settings.fontSize>=40} onClick={()=>void updateSettings({fontSize:Math.min(40,settings.fontSize+1)})}><span className="type-size">A</span></IconButton><IconButton label="刷新当前帖子" disabled={activeThread?.loading} onClick={()=>void loadThread(activePost,activeThread?.requestedPage||1)}><RefreshCw size={17} className={activeThread?.loading?'spin':''}/></IconButton><IconButton label="官方原帖" onClick={()=>void action(()=>window.seekdesk.openOfficial(activeThread?.result?.url||activePost.url))}><ArrowUpRight size={18}/></IconButton></div></div><div className="reader-scroll" ref={readerRef} onScroll={event=>{if(activeId){scrollPositions.current.set(activeId,event.currentTarget.scrollTop);clearTimeout(scrollSaveTimer.current);scrollSaveTimer.current=setTimeout(()=>setScrollRevision(value=>value+1),250);}}}><div className="reader-document"><header className="thread-heading"><h1>{activeThread?.result?.title||activePost.title}</h1>{showThreadOwner&&<div className="thread-meta"><Avatar name={activePost.author} src={activePost.avatar||avatarUrl(activePost.authorId)}/><button className="text-button" onClick={()=>activePost.authorId&&showMember(activePost.authorId)}>{activePost.author}</button><time>{dateLabel(activePost.published,true)}</time></div>}</header>{activeThread?.loading&&!activeThread.result&&<div data-testid="thread-loading" className="reader-loading" role="status"><LoaderCircle className="spin" size={25}/><span>正在读取帖子…</span></div>}{activeThread?.error&&<div className="reader-error" role="alert"><CircleAlert size={24}/><h2>这篇帖子暂时无法读取</h2><p>{activeThread.error}</p><div><button className="primary-button" onClick={()=>void action(()=>window.seekdesk.openOfficial(activePost.url))}>官方页面验证 / 查看<ArrowUpRight size={16}/></button><button className="secondary-button" onClick={()=>void loadThread(activePost,activeThread.requestedPage)}>重新读取</button></div></div>}{activeThread?.result?.notice&&<Notice warning={activeThread.result.source==='rss'}>{activeThread.result.notice}</Notice>}
              {replyStatus?.postId===activePost.id&&<Notice warning={!replyStatus.waiting} action={!replyStatus.waiting&&<button className="text-button" onClick={()=>void loadThread({...activePost,url:replyStatus.url},Number(new URL(replyStatus.url).pathname.match(/-(\d+)\/?$/)?.[1]||1))}>刷新新回复</button>}>{replyStatus.message}</Notice>}{activeThread?.result?.comments.filter(comment=>!onlyAuthor||comment.isAuthor||comment.authorId===activeThread.result?.rootAuthorId||replyTargets[activePost.id]===comment.id).map((comment,index)=>{const blocked=isBlocked(comment.authorId,comment.author),expanded=expandedBlocked.includes(`${activePost.id}:${comment.id}`);return <article data-floor={comment.id} className={`comment ${comment.id==='0'?'thread-original':'floor-reply'}${blocked?' blocked-comment':''}`} id={`comment-${comment.id}`} key={`${activeThread.result!.page}-${comment.id}`}><div className="comment-heading"><button className="author-avatar-button" onClick={()=>comment.authorId&&showMember(comment.authorId)}><Avatar name={comment.author} src={comment.avatar||avatarUrl(comment.authorId)} large/></button><div className="author-info"><div><button className="author-name" onClick={()=>comment.authorId&&showMember(comment.authorId)}>{comment.author||'社区成员'}</button>{comment.level!==undefined&&<span className="level-badge" data-level={comment.level}>Lv {comment.level}</span>}{comment.role&&<span className="role-badge" data-role={comment.role}>{comment.role}</span>}{comment.isAuthor&&<span className="op-badge">楼主</span>}</div><time>{dateLabel(comment.date,true)}</time></div><span className="floor">{comment.floor||`#${index}`}</span>{comment.authorId&&<details className="user-menu"><summary aria-label={`${comment.author}的用户操作`}><MoreHorizontal size={19}/></summary><div className="user-menu-items" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}><button onClick={()=>showMember(comment.authorId!)}>查看个人资料</button>{comment.authorId!==account.id&&<><button disabled={account.status!=='signed-in'||Boolean(actionBusy)} onClick={()=>void followUser(comment.authorId!)}>{following.includes(comment.authorId)?'取消关注':'加好友 / 关注'}</button><button disabled={account.status!=='signed-in'} onClick={()=>showMessages(comment.authorId!,comment.author)}>发送私信</button><button onClick={()=>void toggleBlock(comment.authorId!)}>{blocked?'解除屏蔽':'屏蔽用户'}</button></>}{(comment.isOwn||Boolean(account.id&&comment.authorId===account.id))&&<button onClick={()=>{setEditSource({url:activeThread.result?.url||activePost.url,floor:comment.id});navigate('compose');}}>编辑{comment.isAuthor?'帖子':'回复'}</button>}{extensions.installed.includes('rulings')&&<button onClick={()=>setRulingMember({id:comment.authorId!,name:comment.author})}>查询管理记录</button>}</div></details>}</div>{blocked&&!expanded?<div className="blocked-content"><ShieldCheck size={18}/><span>已屏蔽此用户的内容。</span><button className="text-button" onClick={()=>setExpandedBlocked(current=>[...current,`${activePost.id}:${comment.id}`])}>临时展开</button></div>:<><div data-testid="reader-content"><ReaderContent html={comment.html} nqScale={appearance.nqScale} tqScale={appearance.tqScale} onReportScale={(kind,value)=>void saveAppearance({...appearance,[kind==='nq'?'nqScale':'tqScale']:value})} onNavigate={url=>{const post=postFromUrl(url);if(post)openPost(post,false,true);else void action(()=>/^https:\/\/(www\.)?nodeseek\.com\//.test(url)?window.seekdesk.openOfficial(url):window.seekdesk.openExternal(url));}}/></div>{(comment.signatureHtml||comment.signature)&&<aside className="comment-signature" aria-label={`${comment.author}的个人签名`}><div className="signature-content"><ReaderContent html={comment.signatureHtml||renderMarkdown(comment.signature||'')} onNavigate={url=>{const post=postFromUrl(url);if(post)openPost(post,false,true);else void action(()=>window.seekdesk.openExternal(url));}}/></div></aside>}<div className="comment-actions"><button disabled={!canInteract||Boolean(actionBusy)} className={comment.liked?'active':''} onClick={()=>void reactToComment({kind:'react',url:activePost.url,commentId:comment.id,reaction:'like'})}><ThumbsUp size={16}/>{comment.likes??0}</button><button disabled={!canInteract||Boolean(actionBusy)} className={comment.gaveChicken?'active':''} onClick={()=>void reactToComment({kind:'react',url:activePost.url,commentId:comment.id,reaction:'chicken'})}>🍗 {comment.chicken??0}</button><button disabled={!canInteract||Boolean(actionBusy)} className={comment.disliked?'active':''} onClick={()=>void reactToComment({kind:'react',url:activePost.url,commentId:comment.id,reaction:'dislike'})}><ThumbsDown size={16}/>{comment.dislikes??0}</button><button disabled={!canInteract||Boolean(actionBusy)} aria-label={`引用第${comment.id}楼`} onClick={()=>insertFloorReference(comment,true)}><Quote size={16}/>引用</button><button disabled={!canInteract||Boolean(actionBusy)} aria-label={`回复第${comment.id}楼`} onClick={()=>insertFloorReference(comment,false)}><Reply size={16}/>回复</button>{(comment.isOwn||Boolean(account.id&&comment.authorId===account.id))&&<button onClick={()=>{setEditSource({url:activeThread.result?.url||activePost.url,floor:comment.id});navigate('compose');}}>编辑</button>}</div></>}</article>;})}
              {activeThread?.result&&<footer className="thread-footer"><div className="thread-pagination"><button className="secondary-button" disabled={activeThread.loading||activeThread.result.page<=1} onClick={()=>{void loadThread(activePost,activeThread.result!.page-1);readerRef.current?.scrollTo(0,0);}}><ChevronLeft size={16}/>上一页</button><span>第 {activeThread.result.page} 页</span><button className="secondary-button" disabled={activeThread.loading||!activeThread.result.nextPage} onClick={()=>{void loadThread(activePost,activeThread.result!.nextPage!);readerRef.current?.scrollTo(0,0);}}>下一页<ChevronRight size={16}/></button></div></footer>}
            </div></div><section className={`fixed-reply${replyExpanded?' expanded':''}`} aria-label="回复帖子"><header><button className={`reply-expand${!replyExpanded?' reply-open-button':''}`} aria-label={replyExpanded?'收起回复':'写回复'} aria-expanded={replyExpanded} onClick={()=>{setReplyExpanded(!replyExpanded);if(!replyExpanded)setReplyFocusRequest(request=>request+1);}}><MessageSquare size={18}/><span>{replyExpanded?'收起回复':'写回复'}</span><ChevronDown className={replyExpanded?'reply-chevron-open':''} size={16}/></button>{reply&&<small>草稿已自动保存 · {reply.length} 字</small>}</header>{replyExpanded&&<>{canInteract&&!activeThread?.result?.replyRestriction?<><MarkdownComposer value={reply} focusRequest={replyFocusRequest} onChange={value=>setDrafts(current=>({...current,[activePost.id]:value}))} onSubmit={()=>void sendReply()} disabled={Boolean(actionBusy)} busy={actionBusy===`reply:${activePost.id}`} label="回复帖子" placeholder="写下你的回复…" initialMode="edit" sendShortcut={appearance.sendShortcut} onUpload={upload} stickers={stickers} onImportStickers={()=>setMediaOpen(true)} onMediaSettings={()=>setMediaOpen(true)} imageWidths={replyWidths.current} onImageWidthsChange={value=>{replyWidths.current=value;}}/><div className="reply-toolbar"><span>{appearance.sendShortcut==='enter'?'Enter 发送 · Shift+Enter 换行':'Ctrl+Enter 发送'}</span><button className="text-button" disabled={!reply||Boolean(actionBusy)} onClick={()=>setDrafts(current=>({...current,[activePost.id]:''}))}>清空</button><button data-testid="submit-reply" className="primary-button" disabled={!reply.trim()||Boolean(actionBusy)||reply.length>20000} onClick={()=>void sendReply()}>{actionBusy===`reply:${activePost.id}`?<LoaderCircle className="spin" size={17}/>:<Send size={17}/>}回复</button></div></>:<div className="reply-unavailable"><p>{activeThread?.result?.replyRestriction|| (account.status!=='signed-in'?'登录后参与讨论。':'当前为公开摘要，请刷新读取完整官方正文。')}</p><button className="secondary-button" onClick={()=>void action(()=>window.seekdesk.openOfficial(account.status==='signed-in'?activePost.url:undefined))}>{account.status==='signed-in'?'打开官方页面':'官方网页登录'}</button></div>}</>}</section></>:overviewOpen?<div data-testid="reading-overview" className="overview real-overview"><header><img src="./assets/app-icon.png" alt=""/><h1>阅读总览</h1><IconButton label="关闭阅读总览" onClick={closeOverview}><X size={18}/></IconButton></header><p>{tabs.length?`已打开 ${tabs.length} 篇帖子，选择标签继续阅读。`:'从帖子列表打开讨论，保留多个标签同时阅读。'}</p><div className="overview-topics">{tabs.map(post=><button key={post.id} className="activity-row" onClick={()=>openPost(post)}><FileText size={18}/><span><strong>{post.title}</strong><small>{post.author} · {boardName(post.category)}</small></span><ArrowRight size={17}/></button>)}</div><div className="overview-shortcuts"><span><kbd>Ctrl K</kbd>搜索帖子和用户</span><span><kbd>Ctrl Tab</kbd>切换阅读标签</span><span><kbd>Ctrl W</kbd>关闭当前标签</span></div><button className="primary-button" onClick={()=>{setEditSource(undefined);navigate('compose');}}><Plus size={18}/>发表新帖</button></div>:<div className="reader-empty"><BookOpen size={34}/><h1>选择帖子开始阅读</h1><button className="secondary-button" onClick={()=>setOverviewOpen(true)}>打开阅读总览</button></div>}</main>
          </>}
        </div>
      </div>
    </div>}
    {toast&&<div className={`toast toast-${toast.tone}`} role={toast.tone==='error'?'alert':'status'}>{toast.tone==='error'?<CircleAlert size={19}/>:toast.tone==='success'?<Check size={19}/>:<Info size={19}/>}<span>{toast.message}</span><IconButton label="关闭提示" onClick={()=>setToast(null)}><X size={17}/></IconButton></div>}
    {confirmClear&&<div className="dialog-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title"><h2 id="clear-title">清除本机登录会话？</h2><p>客户端将清除保存的 NodeSeek 会话与阅读标签，下次需要重新登录。</p><div><button autoFocus className="secondary-button" onClick={()=>setConfirmClear(false)}>保留会话</button><button className="danger-button" onClick={()=>void clearSession()}>清除会话</button></div></section></div>}
    {reactionConfirmation&&<div className="dialog-backdrop"><section data-testid="reaction-confirmation" className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reaction-title"><h2 id="reaction-title">{reactionConfirmation.request.reaction==='dislike'?'确认点踩':'确认赠送鸡腿'}</h2><p>{reactionConfirmation.message}</p><div><button autoFocus className="secondary-button" onClick={()=>setReactionConfirmation(null)}>取消</button><button className={reactionConfirmation.approval==='paid'?'danger-button':'primary-button'} onClick={()=>{const pending=reactionConfirmation;setReactionConfirmation(null);void reactToComment({...pending.request,approval:pending.approval});}}>确认{reactionConfirmation.approval==='paid'?'付费':''}{reactionConfirmation.request.reaction==='dislike'?'点踩':'赠送'}</button></div></section></div>}
    {searchOpen&&!official.visible&&<SearchPanel history={history} onHistory={saveHistory} onClose={()=>setSearchOpen(false)} onMember={showMember} onOpenPost={openPost} onPosts={(result,term,categories)=>{++listRequest.current;prefetchedSearch.current=true;setServerSearch({term,categories});setListing({posts:result.posts||[],source:'web',fetchedAt:new Date().toISOString(),nextPage:result.nextPage||null});setPage(1);setQuery('');setListingError('');setListingLoading(false);setView('forum');setShowSettings(false);setListHidden(false);}}/>}
    {rulingMember&&!official.visible&&<RulingsDialog member={rulingMember} onClose={()=>setRulingMember(null)}/>}
    {keywordAlerts.length>0&&!official.visible&&<Modal title={`关键词监控 · ${keywordAlerts.length} 条新命中`} onClose={()=>setKeywordAlerts([])} wide>{keywordAlerts.map(hit=><button className="activity-row" key={`${hit.post.id}:${hit.date}`} onClick={()=>{openPost(hit.post);setKeywordAlerts([]);}}><Bell size={18}/><span><strong>{hit.post.title}</strong><small>{hit.words.join(" · ")}</small></span><ArrowRight size={17}/></button>)}</Modal>}
    {mediaOpen&&!official.visible&&<ComposerMediaPanel onClose={()=>setMediaOpen(false)} onChanged={mediaChanged}/>}
    {bossMode&&<div className="office-surface"><header><strong>{extensions.officeTitle||'工作台'}</strong><button className="secondary-button" onClick={()=>void action(()=>window.seekdesk.toggleBossKey())}>{extensions.officeButton||'返回'}</button></header><nav>文件　编辑　查看　插入　格式　工具　帮助</nav><div className="office-document"><h1>项目工作计划</h1><p>工作进展记录与任务安排</p><table><thead><tr><th>事项</th><th>负责人</th><th>开始日期</th><th>截止日期</th><th>状态</th><th>备注</th></tr></thead><tbody>{Array.from({length:24},(_,index)=><tr key={index}><td>{index+1}</td><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/></tr>)}</tbody></table></div></div>}
  </div>;
}

function OfficialPanel({state,scriptEnabled,onScriptSettings,onClose,onReload}:{state:OfficialViewState;scriptEnabled:boolean;onScriptSettings:()=>void;onClose:()=>void;onReload:()=>void}) {
  const host=useRef<HTMLDivElement>(null);
  const calculator=state.purpose==='calculator';
  useLayoutEffect(()=>{
    const element=host.current;if(!element)return;let frame=0;
    const publish=()=>{const rect=element.getBoundingClientRect();if(rect.width>0&&rect.height>0)void window.seekdesk.setOfficialBounds({x:Math.round(rect.x),y:Math.round(rect.y),width:Math.round(rect.width),height:Math.round(rect.height)}).catch(()=>{});};
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(publish);};
    const observer=new ResizeObserver(schedule);observer.observe(element);window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);publish();
    return()=>{observer.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);};
  },[state.error,state.purpose]);
  let address='www.nodeseek.com';try{const url=new URL(state.url);address=url.hostname+url.pathname;}catch{}
  return <section data-testid="official-panel" className="official-panel" aria-label={calculator?'剩余价值计算器':state.purpose==='login'?'官方网页登录':'官方网页'}><div className="official-toolbar"><div className="official-location">{calculator?<Calculator size={19}/>:<ShieldCheck size={19}/>}<div><strong>{calculator?'剩余价值计算器':state.purpose==='login'?'官方网页登录':'NodeSeek 官方网页'}</strong><span title={state.url}>{address}</span></div></div><div className="official-actions">{scriptEnabled&&!calculator&&<button className="text-button" onClick={onScriptSettings}>脚本设置</button>}<IconButton label={calculator?'刷新计算器':'刷新官方页面'} disabled={state.loading} onClick={onReload}><RefreshCw size={18} className={state.loading?'spin':''}/></IconButton><button data-testid="close-official" className="secondary-button" onClick={onClose}><ArrowLeft size={17}/>返回阅读</button></div></div>{state.error&&<div className="official-error" role="alert"><CircleAlert size={18}/><span>{state.error}</span><button className="text-button" onClick={onReload}>重新加载</button></div>}<div data-testid="official-host" className="official-host" ref={host} aria-label={calculator?'sy.3xme.com 计算器内容':'NodeSeek 官方页面内容'}><div className="official-opening" role="status"><LoaderCircle size={24} className="spin"/><span>{calculator?'正在打开计算器…':'正在打开官方页面…'}</span></div></div></section>;
}
