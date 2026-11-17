import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, Fragment } from 'react';
import {flushSync} from 'react-dom';
import {flushUpdateDrafts,useUpdateDraftSaver} from './update-drafts';
import {useComposerUploads,getComposerUploadCount} from './composer-uploads';
import {getPendingComposerSubmissionCount} from './composer-receipts';
import './source-parity.css';
import './update-install.css';
import './thread-stream.css';
import {mergeThreadPage,isThreadCommentVisible,countAddedVisibleComments} from '../shared/thread-stream';
import {captureThreadAnchor,restoreThreadAnchor,type ThreadScrollAnchor} from './thread-scroll';
import {SIDEBAR_STANDARD,clampSidebarWidth} from '../shared/layout';
import type {ReadingLibraryState,ReadingLibraryMutation} from '../shared/library';
import {ReadingLibraryPanel,type ReadingLibraryMode,type ReadingCommand} from './components/ReadingLibraryPanel';
import type { CSSProperties, FormEvent, MouseEvent, ReactNode } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Bell, Calculator, BookOpen, Check, CircleAlert, Diamond, FileText, Home, Info, Link, LoaderCircle, LockKeyhole, Minus, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelTop, Plus, RefreshCw, Search, ShieldCheck, Square, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import type { AccountState, Comment, ForumActionRequest, ForumActionResult, ListingResult, OfficialViewState, Post, Settings, ThreadResult } from '../shared/types';
import type { ExtensionsState, ForumQueryResult, KeywordHit, MemberProfile, ParitySettings, RankingPeriod, RankingResult, SearchHistory, StickerItem, UnreadCounts } from '../shared/parity';
import { AccountPanel, ExtensionsPanel, FriendsPanel, NotificationsPanel, RankingPanel, RulingsDialog, SearchPanel, TopicComposerPanel } from './parity-panels';
import { Avatar, IconButton, Modal, avatarURL, dateLabel, errorMessage } from './components/shared-ui';
import { PreferencesPanel, appearanceDefaults, palettes } from './components/PreferencesPanel';
import { ReaderContent } from './ReaderContent';
import { ComposerMediaPanel } from './ComposerMediaPanel';
import { matchesSearch } from './search';
import { renderMarkdown } from './markdown';
import { Quote, Reply } from 'lucide-react';
import {ThreadPagination} from './components/ThreadPagination';
import {hasThreadPagination} from '../shared/thread-pages';
import {AuthorBadges} from './components/AuthorBadges';
import {useThreadProfiles} from './useThreadProfiles';
import {UserProfileCard,type ProfileCardMember} from './components/UserProfileCard';
import {PostListPanel} from './components/PostListPanel';
import {Sidebar} from './components/Sidebar';
import {ReplyDock} from './components/ReplyDock';
import {TabBar} from './components/TabBar';
import { boardName } from './boards';

const extensionsDefaults:ExtensionsState={installed:[],enabled:[],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作台',officeButton:'返回',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:true,authorOnly:false,blocked:[],hits:[],unread:0};
const defaults: Settings = {theme:'system',uiFontSize:16,fontSize:18,compact:false,restoreTabs:true,defaultSource:'auto',nodeSeekPro:false};
type ThreadState = {loading:boolean;result?:ThreadResult;error?:string;requestedPage:number;visitRevision?:number;appendLoading?:boolean;appendError?:string;appendPaused?:boolean;emptyPageCount?:number;streamStartPage?:number;streamFloorPages?:Record<string,number>};
type ReactionConfirmation = {request:Extract<ForumActionRequest,{kind:'react'}>;approval:'free'|'paid';message:string};
type ToastTone = 'info'|'success'|'error';
const emptyLibrary:ReadingLibraryState={bookmarks:[],history:[]};

function postFromUrl(value:string):Post|null {
  try {
    const url=new URL(value),match=url.pathname.match(/^\/post-([1-9]\d*)(?:-([1-9]\d*))?\/?$/);
    if (url.protocol!=='https:' || !['www.nodeseek.com','nodeseek.com'].includes(url.hostname) || url.username || url.password || url.port || !match) return null;
    return {id:match[1],title:`帖子 #${match[1]}`,url:`https://www.nodeseek.com/post-${match[1]}-${match[2]||1}${url.hash}`,author:'',category:'',published:'',summary:''};
  } catch {return null;}
}
function Notice({children,action,warning=false}:{children:ReactNode;action?:ReactNode;warning?:boolean}) {
  return <div data-testid="notice" className={`notice${warning?' warning':''}`} role="status"><CircleAlert size={17}/><span>{children}</span>{action}</div>;
}
function prioritizeComments(comments:Comment[]):Comment[]{
  const rank=(comment:Comment)=>comment.id==='0'?0:comment.isHot||comment.isPinned||(comment.chicken||0)>0?1:2;
  return [...comments].sort((left,right)=>rank(left)-rank(right));
}

export default function App() {
  const [ready,setReady]=useState(false),[bootError,setBootError]=useState('');
  const [updatePreparing,setUpdatePreparing]=useState(false),updatePreparingRef=useRef(false),draftsOwner=useRef<number|undefined>(undefined),updateOwner=useRef<number|undefined>(undefined);
  updatePreparingRef.current=updatePreparing;
  const [settings,setSettings]=useState<Settings>(defaults),[version,setVersion]=useState('0.1.0');
  const [buildNumber,setBuildNumber]=useState<string>();
  const [account,setAccount]=useState<AccountState>({status:'unknown'});
  updateOwner.current=account.id;
  const [official,setOfficial]=useState<OfficialViewState>({visible:false,url:'',loading:false,purpose:'login'});
  const [accountRevision,setAccountRevision]=useState(0),confirmedIdentity=useRef<string|null>(null);
  const [category,setCategory]=useState(''),[order,setOrder]=useState<'postTime'|'replyTime'>('postTime'),[page,setPage]=useState(1);
  const [listing,setListing]=useState<ListingResult|null>(null),[listingLoading,setListingLoading]=useState(true),[listingError,setListingError]=useState('');
  const [query,setQuery]=useState(''),[tabs,setTabs]=useState<Post[]>([]),[activeId,setActiveId]=useState<string|null>(null);
  const [overviewOpen,setOverviewOpen]=useState(true),[threads,setThreads]=useState<Record<string,ThreadState>>({});
  const [showSettings,setShowSettings]=useState(false),[listHidden,setListHidden]=useState(false);
  const [narrowListHidden,setNarrowListHidden]=useState(false);
  const effectiveListHidden=listHidden||narrowListHidden;
  const [toast,setToast]=useState<{message:string;tone:ToastTone}|null>(null);
  const [libraryMode,setLibraryMode]=useState<ReadingLibraryMode|null>(null),[librarySnapshot,setLibrarySnapshot]=useState<{scope:string;data:ReadingLibraryState}>({scope:'',data:emptyLibrary}),[libraryLoading,setLibraryLoading]=useState(false),[libraryBusy,setLibraryBusy]=useState(false),[libraryError,setLibraryError]=useState('');
  const libraryRequest=useRef(0),libraryQueue=useRef<Promise<unknown>>(Promise.resolve()),libraryWrites=useRef(0),libraryBookmarks=useRef(new Set<string>()),libraryVisible=useRef(false),lastLibraryVisit=useRef(''),explicitLibraryWrites=useRef(new Set<{scope:string;epoch:number;task:Promise<unknown>}>());
  libraryVisible.current=libraryMode!==null;
  const [scrollRevision,setScrollRevision]=useState(0);const scrollSaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const [accountBusy,setAccountBusy]=useState(false),[confirmClear,setConfirmClear]=useState(false);
  const [blockedUsers,setBlockedUsers]=useState<number[]>([]),[expandedBlocked,setExpandedBlocked]=useState<string[]>([]);
  const [following,setFollowing]=useState<number[]>([]),[drafts,setDrafts]=useState<Record<string,string>>({});
  const [actionBusy,setActionBusy]=useState('');
  const composerUploading=useComposerUploads();
  const [ownSignature,setOwnSignature]=useState<{owner:number;signature:string}|null>(null);
  const [postContext,setPostContext]=useState<{post:Post;x:number;y:number;tab?:boolean}|null>(null);
  const [inlineEdit,setInlineEdit]=useState<{postId:string;url:string;floor:string}|null>(null);
  const [floorNotice,setFloorNotice]=useState<{postId:string;floor:string;text:string;error?:boolean}|null>(null);
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
  const [userCardMember,setUserCardMember]=useState<ProfileCardMember|null>(null);
  const [rulingMember,setRulingMember]=useState<{id:number;name:string}|null>(null),[keywordAlerts,setKeywordAlerts]=useState<KeywordHit[]>([]);const seenHits=useRef<Set<string>|null>(null);
  const parityReady=useRef(false),prefetchedSearch=useRef(false);
  const draggedTab=useRef<string|null>(null),draftReady=useRef(''),appearanceRequest=useRef(0),replyWidths=useRef<Record<string,number>>({});
  const listRequest=useRef(0),threadRequests=useRef(new Map<string,number>()),settingsRequest=useRef(0),actionEpoch=useRef(0);
  const searchRef=useRef<HTMLInputElement>(null),readerRef=useRef<HTMLDivElement>(null),replyRef=useRef<HTMLTextAreaElement>(null);
  const scrollPositions=useRef(new Map<string,number>());
  const streamLocations=useRef(new Map<string,{url:string;anchor:ThreadScrollAnchor}>()),restoredAnchors=useRef(new Map<string,ThreadScrollAnchor>()),appendAnchors=useRef(new Map<string,ThreadScrollAnchor>()),appendLocks=useRef(new Map<string,number>()),nextPageSentinel=useRef<HTMLDivElement>(null);
  const activeIdRef=useRef(activeId);activeIdRef.current=activeId;
  const latestDrafts=useRef(drafts);latestDrafts.current=drafts;
  const replySubmission=useRef<number|null>(null);
  const rankingRequest=useRef(0),summaryRequest=useRef(0);
  const libraryOwner=account.status==='signed-in'?account.id:undefined;
  const libraryScope=libraryOwner?'user:'+libraryOwner:account.id===undefined&&account.status!=='signed-in'?'public':'unconfirmed';
  const libraryScopeRef=useRef(libraryScope);libraryScopeRef.current=libraryScope;
  const libraryData=librarySnapshot.scope===libraryScope?librarySnapshot.data:emptyLibrary;
  const activePost=tabs.find(tab=>tab.id===activeId),activeThread=activeId?threads[activeId]:undefined;
  const activeComments=activeThread?.result?.comments;
  const libraryReadIdentity=useRef('');libraryReadIdentity.current=activePost?libraryScope+':'+activePost.id+':'+String(activeThread?.loading?threadRequests.current.get(activePost.id)||0:activeThread?.visitRevision||0):'';
  const authorProfiles=useThreadProfiles(activeThread?.result,ready&&!activeThread?.loading&&!showSettings&&!official.visible&&view==='forum',accountRevision);
  const profileAuthorIds=useMemo(()=>[...new Set(activeComments?.flatMap(comment=>comment.authorId?[comment.authorId]:[])||[])],[activeComments]);
  const failedProfileIds=useMemo(()=>profileAuthorIds.filter(id=>authorProfiles.profiles[id]?.status==='failed'||authorProfiles.profiles[id]?.status==='stale'),[profileAuthorIds,authorProfiles.profiles]);
  const profileVerification=failedProfileIds.some(id=>['verification','signed-out'].includes(authorProfiles.profiles[id]?.reason||''));
  const firstComment=activeThread?.result?.comments[0];
  const firstFloorHasAuthor=firstComment?.id==='0'&&Boolean(firstComment?.author.trim()&&!['NodeSeek 用户','社区成员'].includes(firstComment.author));
  const showThreadOwner=Boolean(activePost?.author)&&!firstFloorHasAuthor;

  const workspaceSnapshot=()=>({tabs:tabs.map(tab=>streamLocations.current.has(tab.id)?{...tab,url:streamLocations.current.get(tab.id)!.url}:tab),activeId,overviewOpen,listHidden,scrollPositions:Object.fromEntries(tabs.map(tab=>[tab.id,streamLocations.current.has(tab.id)||restoredAnchors.current.has(tab.id)?0:scrollPositions.current.get(tab.id)||0])),readingAnchors:Object.fromEntries(tabs.flatMap(tab=>{const anchor=streamLocations.current.get(tab.id)?.anchor||restoredAnchors.current.get(tab.id);return anchor?[[tab.id,anchor]]:[];}))});
  const rememberStreamLocation=(reader:HTMLElement)=>{if(!activePost||!activeThread?.result||activeThread.loading||!activeThread.streamStartPage||activeThread.result.page<=activeThread.streamStartPage)return;const anchor=captureThreadAnchor(reader);if(anchor)streamLocations.current.set(activePost.id,{url:`https://www.nodeseek.com/post-${activePost.id}-${anchor.page}#${anchor.floor}`,anchor});};
  useEffect(()=>{if(!activeId||draggedTab.current)return;const frame=requestAnimationFrame(()=>{if(!draggedTab.current)[...document.querySelectorAll<HTMLElement>('.reading-tab[data-tab-id]')].find(tab=>tab.dataset.tabId===activeId)?.scrollIntoView({block:'nearest',inline:'nearest'});});return()=>cancelAnimationFrame(frame);},[activeId,showSettings,official.visible,view]);
  useEffect(()=>{if(!postContext)return;const before=document.activeElement as HTMLElement|null;const frame=requestAnimationFrame(()=>document.querySelector<HTMLElement>('.post-context-menu button:not(:disabled)')?.focus());const close=(event:Event)=>{const target=event.target;if(!(target instanceof Element)||!target.closest('.post-context-menu'))setPostContext(null);};const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setPostContext(null);}else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();event.stopPropagation();const items=[...document.querySelectorAll<HTMLElement>('.post-context-menu button:not(:disabled)')],index=items.indexOf(document.activeElement as HTMLElement),next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;items[next]?.focus();}};window.addEventListener('pointerdown',close,true);window.addEventListener('keydown',key,true);window.addEventListener('resize',close);return()=>{cancelAnimationFrame(frame);window.removeEventListener('pointerdown',close,true);window.removeEventListener('keydown',key,true);window.removeEventListener('resize',close);if(before?.isConnected&&document.hasFocus()&&document.activeElement===document.body)before.focus();};},[postContext]);
  const notify=useCallback((message:string,tone:ToastTone='info')=>setToast({message,tone}),[]);
  const action=useCallback(async(operation:()=>Promise<unknown>)=>{try{await operation();}catch(error){notify(errorMessage(error),'error');}},[notify]);
  const leaveOfficial=useCallback((next?:()=>void)=>{
    if(!official.visible){next?.();return;}
    void action(async()=>{await window.seekdesk.closeOfficial();next?.();});
  },[official.visible,action]);
  const loadLibrary=useCallback(async()=>{
    const token=++libraryRequest.current,epoch=actionEpoch.current,scope=libraryScope,owner=libraryOwner;
    setLibraryLoading(true);setLibraryError('');
    try{
      if(scope==='unconfirmed')throw new Error('当前会话尚未确认，请先在官方页面完成验证');
      await libraryQueue.current.catch(()=>{});
      if(token!==libraryRequest.current||epoch!==actionEpoch.current||scope!==libraryScopeRef.current)return;
      const data=await window.seekdesk.readReadingLibrary(owner);
      if(token===libraryRequest.current&&epoch===actionEpoch.current&&scope===libraryScopeRef.current)setLibrarySnapshot({scope,data});
    }catch(error){if(token===libraryRequest.current&&epoch===actionEpoch.current&&scope===libraryScopeRef.current)setLibraryError(errorMessage(error));}
    finally{if(token===libraryRequest.current)setLibraryLoading(false);}
  },[libraryScope,libraryOwner]);
  const mutateLibrary=useCallback((request:ReadingLibraryMutation):Promise<ReadingLibraryState>=>{
    const token=++libraryRequest.current,epoch=actionEpoch.current,scope=libraryScope,owner=libraryOwner;
    libraryWrites.current++;setLibraryBusy(true);
    const operation=libraryQueue.current.catch(()=>{}).then(async()=>{
      if(scope==='unconfirmed'||epoch!==actionEpoch.current||scope!==libraryScopeRef.current)throw new Error('资料库所属会话已变化');
      const data=await window.seekdesk.mutateReadingLibrary(request,owner);
      if(epoch===actionEpoch.current&&scope===libraryScopeRef.current&&(request.kind==='clear-history'||request.kind==='history-remove'&&request.postId===activeIdRef.current))lastLibraryVisit.current=libraryReadIdentity.current;
      if(token===libraryRequest.current&&epoch===actionEpoch.current&&scope===libraryScopeRef.current){setLibrarySnapshot({scope,data});setLibraryError('');}
      return data;
    });
    libraryQueue.current=operation;
    let explicit:{scope:string;epoch:number;task:Promise<unknown>}|undefined;
    const completed=operation.catch(error=>{if(request.kind!=='visit'&&epoch===actionEpoch.current&&scope===libraryScopeRef.current)notify('资料库操作未保存，原记录已保留，请重试。','error');throw error;}).finally(()=>{if(explicit)explicitLibraryWrites.current.delete(explicit);libraryWrites.current--;if(libraryWrites.current===0)setLibraryBusy(false);if(token===libraryRequest.current)setLibraryLoading(false);});
    if(request.kind!=='visit'){explicit={scope,epoch,task:completed};explicitLibraryWrites.current.add(explicit);}
    return completed;
  },[libraryScope,libraryOwner,notify]);
  const currentLibraryPost=():Post|null=>{
    const result=activeThread?.result;if(!activePost||!result||activeThread?.loading)return null;
    const rootComment=result.comments.find(comment=>comment.id==='0');
    const url=workspaceSnapshot().tabs.find(post=>post.id===activePost.id)?.url||result.url;
    return {id:activePost.id,url,title:result.title||activePost.title,author:rootComment?.author||activePost.author,category:result.category||activePost.category,published:activePost.published,summary:''};
  };
  const bookmarkCurrent=async()=>{
    const post=currentLibraryPost();if(!post){notify('请先打开一篇帖子。');return;}
    if(libraryData.bookmarks.some(entry=>entry.post.id===post.id)){notify('此帖子已在本地书签中。');return;}
    const key=libraryScope+':'+post.id;if(libraryBookmarks.current.has(key))return;libraryBookmarks.current.add(key);
    try{await mutateLibrary({kind:'bookmark-add',post});notify('已保存到本地书签。','success');}catch(error){notify(errorMessage(error),'error');}finally{libraryBookmarks.current.delete(key);}
  };
  const openLibrary=(mode:ReadingLibraryMode='bookmarks')=>leaveOfficial(()=>{setPostContext(null);setLibraryMode(mode);});
  useEffect(()=>{if(libraryMode!==null)void loadLibrary();},[libraryMode!==null,loadLibrary]);
  useEffect(()=>{
    if(!ready||updatePreparingRef.current||libraryMode!==null||showSettings||official.visible||view!=='forum'||activeThread?.loading||activeThread?.error)return;
    const post=currentLibraryPost();if(!post||libraryScope==='unconfirmed')return;
    const visit=libraryScope+':'+post.id+':'+String(activeThread?.visitRevision||0);
    if(lastLibraryVisit.current===visit)return;lastLibraryVisit.current=visit;
    void mutateLibrary({kind:'visit',post}).catch(()=>{});
  },[ready,activeId,activeThread?.result,activeThread?.loading,libraryScope,libraryMode!==null,showSettings,official.visible,view,mutateLibrary]);
  useEffect(()=>{
    const keys=(event:KeyboardEvent)=>{
      if(!ready||updatePreparingRef.current)return;
      if((event.ctrlKey||event.metaKey)&&event.shiftKey&&!event.altKey&&['b','l','p'].includes(event.key.toLowerCase())){
        event.preventDefault();event.stopImmediatePropagation();if(event.repeat)return;
        const key=event.key.toLowerCase();if(key==='b')void bookmarkCurrent();else openLibrary(key==='l'?'bookmarks':'commands');return;
      }
      if(libraryMode!==null&&(event.ctrlKey||event.metaKey)&&['w','k',','].includes(event.key.toLowerCase())){
        event.preventDefault();event.stopImmediatePropagation();setLibraryMode(null);
        if(event.key.toLowerCase()==='k')setSearchOpen(true);else if(event.key===','){setShowSettings(true);setView('forum');}
      }
    };
    window.addEventListener('keydown',keys,true);return()=>window.removeEventListener('keydown',keys,true);
  },[ready,libraryMode,libraryData,activePost,activeThread,libraryScope,mutateLibrary,leaveOfficial]);
  const boot=useCallback(async()=>{
    try {
      setBootError('');
      if(!window.seekdesk)throw new Error('桌面连接未建立，请从调试启动器打开客户端。');
      const data=await window.seekdesk.bootstrap();
      setSettings(data.settings);setAccount(data.account);setVersion(data.version);setBuildNumber(data.buildNumber);setOfficial(data.official);setBlockedUsers(data.blockedUsers||[]);
      confirmedIdentity.current=data.account.status==='signed-in'?String(data.account.id||data.account.name):data.account.status==='signed-out'?'signed-out':null;
      if(data.settings.restoreTabs){scrollPositions.current=new Map(Object.entries(data.workspace.scrollPositions||{}));restoredAnchors.current=new Map(Object.entries(data.workspace.readingAnchors||{}));setTabs(data.workspace.tabs.map(post=>({...post,title:post.title||`帖子 #${post.id}`})));setActiveId(data.workspace.activeId);setOverviewOpen(data.workspace.overviewOpen!==false);}
      setListHidden(data.workspace.listHidden===true);
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
  const refreshSummary=useCallback(async()=>{const token=++summaryRequest.current,epoch=actionEpoch.current;if(account.status!=='signed-in'){setProfile(null);setUnread({mentions:0,replies:0,messages:0});return;}try{const data=await window.seekdesk.queryForum({kind:'account'});if(epoch!==actionEpoch.current||token!==summaryRequest.current)return;setProfile(data.profile||null);setUnread(data.unread||{mentions:0,replies:0,messages:0});}catch{}},[account.id,account.status]);
  useEffect(()=>{if(!ready)return;void refreshSummary();if(!appearance.notificationPolling||account.status!=='signed-in')return;const timer=setInterval(()=>void refreshSummary(),60000);return()=>clearInterval(timer);},[ready,refreshSummary,appearance.notificationPolling]);
  useEffect(()=>{if(!ready)return;const cleanup=window.seekdesk.onExtensionsChange(setExtensions),boss=window.seekdesk.onBossKey(setBossMode);return()=>{cleanup();boss();};},[ready]);
  useEffect(()=>{const current=new Set(extensions.hits.map(hit=>`${hit.post.id}:${hit.date}`));if(parityReady.current&&seenHits.current&&extensions.enabled.includes('keywords')){const added=extensions.hits.filter(hit=>!seenHits.current!.has(`${hit.post.id}:${hit.date}`));if(added.length)setKeywordAlerts(value=>[...added,...value].slice(0,20));}seenHits.current=current;},[extensions.hits,extensions.enabled]);
  useEffect(()=>{
    if(!keywordAlerts.length||official.visible)return;
    let timer:ReturnType<typeof setTimeout>|undefined;
    const update=()=>{clearTimeout(timer);if(document.hasFocus()&&document.visibilityState==='visible')timer=setTimeout(()=>setKeywordAlerts([]),12000);};
    update();window.addEventListener('focus',update);window.addEventListener('blur',update);document.addEventListener('visibilitychange',update);
    return()=>{clearTimeout(timer);window.removeEventListener('focus',update);window.removeEventListener('blur',update);document.removeEventListener('visibilitychange',update);};
  },[keywordAlerts,official.visible]);
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
          draftsOwner.current=undefined;streamLocations.current.clear();if(previous!==null)restoredAnchors.current.clear();appendLocks.current.clear();appendAnchors.current.clear();setThreads({});setDrafts({});setOwnSignature(null);setPostContext(null);setLibraryMode(null);++libraryRequest.current;setLibrarySnapshot({scope:'',data:emptyLibrary});setLibraryError('');setLibraryLoading(false);setInlineEdit(null);setFloorNotice(null);setUserCardMember(null);setFollowing([]);setActionBusy('');setReplyTargets({});setReplyStatus(null);setExpandedBlocked([]);setReactionConfirmation(null);setMessageTarget(null);setMessageContent('');setProfile(null);setInitialPeer(undefined);setView('forum');setMediaOpen(false);setSearchOpen(false);
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
    const timer=setTimeout(()=>{void window.seekdesk.saveWorkspace(workspaceSnapshot()).catch(error=>notify(errorMessage(error),'error'));},250);
    return()=>clearTimeout(timer);
  },[ready,tabs,activeId,overviewOpen,listHidden,scrollRevision,notify]);
  useEffect(()=>()=>clearTimeout(scrollSaveTimer.current),[]);

  const loadListing=useCallback(async()=>{
    const token=++listRequest.current;setListingLoading(true);setListingError('');
    try{const result=serverSearch?await window.seekdesk.queryForum({kind:'search',term:serverSearch.term,categories:serverSearch.categories,page}).then(result=>({posts:result.posts||[],source:'web' as const,fetchedAt:new Date().toISOString(),nextPage:result.nextPage||null})):await window.seekdesk.listPosts({category,order,page});if(token===listRequest.current)setListing(result);}
    catch(error){if(token===listRequest.current)setListingError(errorMessage(error));}
    finally{if(token===listRequest.current)setListingLoading(false);}
  },[category,order,page,serverSearch]);
  useEffect(()=>{if(ready){if(prefetchedSearch.current){prefetchedSearch.current=false;return;}setListing(null);void loadListing();}},[ready,loadListing,settings.defaultSource,accountRevision]);
  const loadThread=useCallback(async(post:Post,targetPage=1,returnAnchor?:ThreadScrollAnchor)=>{
    const token=(threadRequests.current.get(post.id)||0)+1;threadRequests.current.set(post.id,token);
    appendLocks.current.delete(post.id);appendAnchors.current.delete(post.id);streamLocations.current.delete(post.id);
    setThreads(current=>({...current,[post.id]:{...current[post.id],loading:true,error:undefined,appendLoading:false,appendError:undefined,appendPaused:false,emptyPageCount:0,requestedPage:targetPage}}));
    try{
      const result=await window.seekdesk.readThread(post,targetPage);
      if(threadRequests.current.get(post.id)!==token)return null;
      streamLocations.current.delete(post.id);appendAnchors.current.delete(post.id);if(returnAnchor){appendAnchors.current.set(post.id,returnAnchor);restoredAnchors.current.set(post.id,returnAnchor);}
      setThreads(current=>({...current,[post.id]:{loading:false,result,requestedPage:targetPage,visitRevision:token,streamStartPage:result.page,streamFloorPages:Object.fromEntries(result.comments.map(comment=>[comment.id,result.page]))}}));
      setFollowing(current=>{const next=new Set(current);for(const comment of result.comments){if(comment.authorId&&comment.following===true)next.add(comment.authorId);else if(comment.authorId&&comment.following===false)next.delete(comment.authorId);}return [...next];});
      setTabs(current=>current.map(tab=>{if(tab.id!==post.id)return tab;let hash='';try{const location=new URL(post.url);if(Number(location.pathname.match(/-(\d+)\/?$/)?.[1]||1)===targetPage)hash=location.hash;}catch{}return {...tab,title:result.title||tab.title,url:result.url.split('#')[0]+hash};}));
      return result;
    }catch(error){if(threadRequests.current.get(post.id)===token)setThreads(current=>({...current,[post.id]:{...current[post.id],loading:false,error:errorMessage(error),requestedPage:targetPage}}));return null;}
  },[]);
  const refreshVisibleThread=useCallback(()=>{
    if(!activePost||activeThread?.loading)return Promise.resolve(null);
    const anchor=readerRef.current?captureThreadAnchor(readerRef.current):undefined;
    if(!anchor)return loadThread(activePost,activeThread?.requestedPage||1);
    const url='https://www.nodeseek.com/post-'+activePost.id+'-'+anchor.page+'#'+anchor.floor;
    return loadThread({...activePost,url},anchor.page,anchor);
  },[activePost,activeThread?.loading,activeThread?.requestedPage,loadThread]);
  const changeThreadPage=useCallback((page:number)=>{
    if(!activePost||activeThread?.loading)return;
    const destination=new URL(activeThread?.result?.url||activePost.url);destination.hash='';destination.pathname=`/post-${activePost.id}-${page}`;
    restoredAnchors.current.delete(activePost.id);scrollPositions.current.delete(activePost.id);
    readerRef.current?.scrollTo(0,0);
    void loadThread({...activePost,url:destination.href},page);
  },[activePost,activeThread?.loading,activeThread?.result?.url,loadThread]);
  const loadNextComments=useCallback(async(force=false)=>{
    const result=activeThread?.result,post=activePost;
    if(libraryVisible.current||!post||activeIdRef.current!==post.id||!readerRef.current||!nextPageSentinel.current||updatePreparingRef.current||!result||result.source!=='web'||!result.nextPage||activeThread.loading||appendLocks.current.has(post.id)||((activeThread.appendError||activeThread.appendPaused)&&!force)||view!=='forum'||showSettings||official.visible||updatePreparing||libraryMode!==null)return;
    const targetPage=result.nextPage,epoch=actionEpoch.current,token=(threadRequests.current.get(post.id)||0)+1;
    threadRequests.current.set(post.id,token);appendLocks.current.set(post.id,token);
    setThreads(current=>({...current,[post.id]:{...current[post.id],appendLoading:true,appendError:undefined}}));
    try{
      const incoming=await window.seekdesk.readThread({...post,url:'https://www.nodeseek.com/post-'+post.id+'-'+targetPage},targetPage);
      if(epoch!==actionEpoch.current||threadRequests.current.get(post.id)!==token)return;
      if(updatePreparingRef.current){setThreads(current=>({...current,[post.id]:{...current[post.id],appendLoading:false}}));return;}
      const merged=mergeThreadPage(result,incoming);
      const filtering=extensions.installed.includes('authorOnly')&&extensions.enabled.includes('authorOnly')&&extensions.authorOnly;
      const added=countAddedVisibleComments(result,merged,filtering,replyTargets[post.id]);
      const emptyPages=added?0:(force?0:activeThread.emptyPageCount||0)+1;
      const reader=activeIdRef.current===post.id?readerRef.current:null;
      if(reader){const anchor=captureThreadAnchor(reader);if(anchor)appendAnchors.current.set(post.id,anchor);scrollPositions.current.set(post.id,reader.scrollTop);}
      setThreads(current=>{
        const previous=current[post.id];if(previous?.result!==result)return current;
        const pages={...previous.streamFloorPages};for(const comment of incoming.comments)if(pages[comment.id]===undefined)pages[comment.id]=incoming.page;
        return {...current,[post.id]:{...previous,result:merged,requestedPage:incoming.page,appendLoading:false,appendError:undefined,appendPaused:emptyPages>=2&&merged.nextPage!==null,emptyPageCount:emptyPages,streamStartPage:previous.streamStartPage||result.page,streamFloorPages:pages}};
      });
      setTabs(current=>current.map(tab=>tab.id===post.id?{...tab,url:tab.url.split('#')[0]}:tab));
      setFollowing(current=>{const next=new Set(current);for(const comment of incoming.comments){if(comment.authorId&&comment.following===true)next.add(comment.authorId);else if(comment.authorId&&comment.following===false)next.delete(comment.authorId);}return [...next];});
    }catch(error){if(epoch===actionEpoch.current&&threadRequests.current.get(post.id)===token)setThreads(current=>({...current,[post.id]:{...current[post.id],appendLoading:false,appendError:errorMessage(error)}}));}
    finally{if(appendLocks.current.get(post.id)===token)appendLocks.current.delete(post.id);}
  },[activePost,activeThread,view,showSettings,official.visible,updatePreparing,libraryMode,extensions,replyTargets]);
  useEffect(()=>{
    const target=nextPageSentinel.current,reader=readerRef.current;
    if(!target||!reader||view!=='forum'||showSettings||official.visible||updatePreparing||libraryMode!==null||activeThread?.loading||activeThread?.appendLoading||activeThread?.appendError||activeThread?.appendPaused||!activeThread?.result?.nextPage||activeThread.result.source!=='web')return;
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting))void loadNextComments();},{root:reader,rootMargin:'0px 0px 450px 0px'});
    observer.observe(target);return()=>observer.disconnect();
  },[activeId,activeThread,view,showSettings,official.visible,updatePreparing,libraryMode,loadNextComments]);
  useEffect(()=>{if(activePost&&!threads[activePost.id])void loadThread(activePost,Number(new URL(activePost.url).pathname.match(/-(\d+)\/?$/)?.[1]||1));},[activePost,threads,loadThread]);
  useEffect(()=>{const resized=()=>{if(window.innerWidth>=1050)setNarrowListHidden(false);};window.addEventListener('resize',resized);return()=>window.removeEventListener('resize',resized);},[]);
  useEffect(()=>{setReplyExpanded(false);setInlineEdit(null);},[activeId]);
  useEffect(()=>{if(!floorNotice)return;const timer=setTimeout(()=>setFloorNotice(null),6500);return()=>clearTimeout(timer);},[floorNotice]);
  useEffect(()=>{if(replyStatus&&activeThread?.result?.id===replyStatus.postId&&activeThread.result.source==='web'&&activeThread.result.comments.some(comment=>comment.id===replyStatus.floor))setReplyStatus(null);},[activeThread?.result,replyStatus]);
  useLayoutEffect(()=>{const reader=readerRef.current;if(!reader)return;const anchor=appendAnchors.current.get(activeId||'');if(anchor&&view==='forum'&&!showSettings&&!official.visible){restoreThreadAnchor(reader,anchor);appendAnchors.current.delete(activeId||'');scrollPositions.current.set(activeId||'',reader.scrollTop);}else reader.scrollTop=scrollPositions.current.get(activeId||'')||0;},[activeId,activeThread?.result,showSettings,official.visible,view]);
  useEffect(()=>{
    if(!activePost||!activeThread?.result||showSettings||official.visible)return;
    const hash=new URL(activePost.url).hash;
    if(!/^#(?:comment-)?\d+$/.test(hash))return;
    const id=hash.replace(/^#(?:comment-)?/,'');
    const frame=requestAnimationFrame(()=>{const saved=restoredAnchors.current.get(activePost.id),reader=readerRef.current;if(saved&&reader&&saved.floor===id&&saved.page===activeThread.result?.page){restoreThreadAnchor(reader,saved);restoredAnchors.current.delete(activePost.id);scrollPositions.current.set(activePost.id,reader.scrollTop);setTabs(current=>current.map(tab=>tab.id===activePost.id?{...tab,url:tab.url.split('#')[0]}:tab));}else document.getElementById(`comment-${id}`)?.scrollIntoView({block:'start',behavior:'auto'});});
    return()=>cancelAnimationFrame(frame);
  },[activePost?.url,activeThread?.result,showSettings,official.visible]);
  const openPost=useCallback((post:Post,background=false,explicit=false)=>{
    if(!tabs.some(tab=>tab.id===post.id)&&tabs.length>=30){notify('已打开 30 个标签，请先关闭一些标签。');return;}
    const open=()=>{
      setTabs(current=>current.some(tab=>tab.id===post.id)?current.map(tab=>tab.id===post.id&&explicit?{...tab,url:post.url}:tab):[...current,post]);
      if(explicit){restoredAnchors.current.delete(post.id);scrollPositions.current.delete(post.id);void loadThread(post,Number(new URL(post.url).pathname.match(/-(\d+)\/?$/)?.[1]||1));}
      if(!background){setActiveId(post.id);setShowSettings(false);setView('forum');if(window.innerWidth<1050)setNarrowListHidden(true);}
    };
    if(background)open();else leaveOfficial(open);
  },[tabs,notify,loadThread,leaveOfficial]);
  const closeTab=useCallback((id:string)=>{
    setTabs(current=>{const index=current.findIndex(tab=>tab.id===id);if(activeId===id)setActiveId(current[index+1]?.id||current[index-1]?.id||null);return current.filter(tab=>tab.id!==id);});
    threadRequests.current.set(id,(threadRequests.current.get(id)||0)+1);
    scrollPositions.current.delete(id);restoredAnchors.current.delete(id);streamLocations.current.delete(id);appendLocks.current.delete(id);appendAnchors.current.delete(id);
    setThreads(current=>{const next={...current};delete next[id];return next;});
  },[activeId]);
  const closeAllTabs=()=>{for(const [id,token] of threadRequests.current)threadRequests.current.set(id,token+1);setTabs([]);setThreads({});setActiveId(null);setInlineEdit(null);scrollPositions.current.clear();streamLocations.current.clear();restoredAnchors.current.clear();appendLocks.current.clear();appendAnchors.current.clear();};
  const moveContextTab=(direction:number)=>{if(!postContext)return;const id=postContext.post.id;setTabs(current=>{const from=current.findIndex(tab=>tab.id===id),to=from+direction;if(from<0||to<0||to>=current.length)return current;const next=[...current];[next[from],next[to]]=[next[to],next[from]];return next;});setPostContext(null);if(activeIdRef.current===id)requestAnimationFrame(()=>[...document.querySelectorAll<HTMLElement>('.reading-tab[data-tab-id]')].find(tab=>tab.dataset.tabId===id)?.scrollIntoView({block:'nearest',inline:'nearest'}));};
  const closeOverview=useCallback(()=>{setOverviewOpen(false);if(!activeId&&tabs.length)setActiveId(tabs[0].id);},[activeId,tabs]);
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if((event.ctrlKey||event.metaKey)&&event.key===','){event.preventDefault();leaveOfficial(()=>{setShowSettings(true);setView('forum');});}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();leaveOfficial(()=>setSearchOpen(true));}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='r'){event.preventDefault();if(activePost&&effectiveListHidden)void refreshVisibleThread();else void loadListing();}
      if(event.ctrlKey&&event.key==='Tab'){event.preventDefault();if(tabs.length){const index=tabs.findIndex(tab=>tab.id===activeId),next=(index+(event.shiftKey?-1:1)+tabs.length)%tabs.length;leaveOfficial(()=>{setActiveId(tabs[next].id);setShowSettings(false);setView('forum');});}}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='w'){
        if(official.visible){event.preventDefault();leaveOfficial();}else if(activeId){event.preventDefault();closeTab(activeId);}else if(overviewOpen){event.preventDefault();closeOverview();}
      }
      if((confirmClear||reactionConfirmation||messageTarget)&&event.key==='Tab'){
        const buttons=[...document.querySelectorAll<HTMLElement>('.confirm-dialog button:not(:disabled), .message-dialog button:not(:disabled), .message-dialog textarea')],first=buttons[0],last=buttons[buttons.length-1];
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
      if(event.key==='Escape'){if(searchOpen)setSearchOpen(false);else if(mediaOpen)setMediaOpen(false);else if(messageTarget)setMessageTarget(null);else if(reactionConfirmation)setReactionConfirmation(null);else if(confirmClear)setConfirmClear(false);else if(showSettings)setShowSettings(false);else if(view!=='forum')setView('forum');else{setListHidden(false);setNarrowListHidden(false);setActiveId(null);setOverviewOpen(true);}}
    };
    window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);
  },[activeId,closeTab,showSettings,confirmClear,leaveOfficial,official.visible,overviewOpen,closeOverview,reactionConfirmation,messageTarget,searchOpen,mediaOpen,view,tabs,activePost,effectiveListHidden,activeThread?.requestedPage,loadListing,loadThread,refreshVisibleThread]);

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
      streamLocations.current.clear();restoredAnchors.current.clear();appendLocks.current.clear();appendAnchors.current.clear();setAccount({status:'signed-out'});setThreads({});setTabs([]);setActiveId(null);setDrafts({});setListing(null);notify('本机 NodeSeek 会话已清除。','success');await loadListing();
    }catch(error){notify(errorMessage(error),'error');}finally{setAccountBusy(false);}
  };
  const changeBoard=(id:string)=>leaveOfficial(()=>{setCategory(id);setPage(1);setQuery('');setServerSearch(null);setShowSettings(false);setView('forum');setListHidden(false);setNarrowListHidden(false);setSelectedIndex(0);});
  const handleSearch=(event:FormEvent)=>{event.preventDefault();if(/^https?:\/\//i.test(query.trim())){const post=postFromUrl(query.trim());if(post){openPost(post,false,true);setQuery('');}else notify('请粘贴 NodeSeek 官方帖子链接。');}};
  const contentClick=(event:MouseEvent<HTMLDivElement>)=>{
    const anchor=(event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');if(!anchor)return;event.preventDefault();
    const post=postFromUrl(anchor.href);if(post){openPost(post,event.ctrlKey||event.metaKey,true);return;}
    try{const url=new URL(anchor.href);if(!['https:','http:'].includes(url.protocol))return;void action(()=>['www.nodeseek.com','nodeseek.com'].includes(url.hostname)?window.seekdesk.openOfficial(url.href):window.seekdesk.openExternal(url.href));}catch{}
  };
  const toggleBlock=async(id?:number,authorName?:string)=>{
    const name=(authorName||activeThread?.result?.comments.find(comment=>comment.authorId===id)?.author||`UID ${id}`).trim();
    const matches=(user:{memberId?:number;name:string})=>id?user.memberId===id:user.name.trim().toLocaleLowerCase()===name.toLocaleLowerCase();
    const remove=Boolean(id&&blockedUsers.includes(id))||extensions.blocked.some(matches);
    try{const value=await window.seekdesk.saveExtensions({...extensions,blocked:remove?extensions.blocked.filter(user=>!matches(user)):[...extensions.blocked,{...(id?{memberId:id}:{}),name}],installed:[...new Set([...extensions.installed,'block' as const])],enabled:[...new Set([...extensions.enabled,'block' as const])]});setExtensions(value);const ids=value.blocked.flatMap(user=>user.memberId?[user.memberId]:[]);setBlockedUsers(await window.seekdesk.setBlockedUsers(ids));notify(remove?'已解除本机屏蔽。':'已在本机屏蔽此用户。','success');}catch(error){notify(errorMessage(error),'error');}
  };
  const performForumAction=async(request:ForumActionRequest,key:string):Promise<ForumActionResult|null>=>{
    if(account.status!=='signed-in'||!account.id){await action(()=>window.seekdesk.openOfficial(account.status==='verification'?activePost?.url:undefined));return null;}if((request.kind==='reply'||request.kind==='message')&&getComposerUploadCount()>0){notify('请等待图片上传完成。');return null;}const epoch=actionEpoch.current;setActionBusy(key);
    try{
      const result=await window.seekdesk.forumAction(request,account.id!);if(epoch!==actionEpoch.current)return null;
      if(request.kind==='react'&&result.confirmation){setReactionConfirmation({request,approval:result.confirmation,message:result.message});return null;}
      if(result.coin!==undefined&&Number.isFinite(result.coin)){setAccount(current=>({...current,coin:result.coin}));setProfile(current=>current?{...current,coin:result.coin}:current);}
      if(request.kind==='react')void refreshSummary();
      if(request.kind==='react'){const post=postFromUrl(request.url);if(post)setFloorNotice({postId:post.id,floor:request.commentId,text:result.message});}else notify(result.message,'success');return result;
    }
    catch(error){if(epoch===actionEpoch.current){if(request.kind==='react'){const post=postFromUrl(request.url);if(post)setFloorNotice({postId:post.id,floor:request.commentId,text:errorMessage(error),error:true});}else notify(errorMessage(error),'error');}return null;}
    finally{if(epoch===actionEpoch.current&&(request.kind!=='reply'||replySubmission.current!==epoch))setActionBusy('');}
  };
  const sendReply=async()=>{
    if(!activePost||!account.id||getComposerUploadCount()>0||replySubmission.current===actionEpoch.current)return;
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
    if(account.status!=='signed-in'){void action(()=>window.seekdesk.openOfficial(account.status==='verification'?activePost?.url:undefined));return;}
    if(!activePost||!/^\d+$/.test(comment.id))return;
    const destination=new URL(comment.actionUrl||activeThread?.result?.url||activePost.url);destination.hash=comment.id;
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
    const follow=!(authorProfiles.followingOverride(id)??authorProfiles.profiles[id]?.profile?.following??following.includes(id));
    if(await performForumAction({kind:'follow',memberId:id,follow},`follow:${id}`)){authorProfiles.updateFollowing(id,follow);setFollowing(current=>follow?[...new Set([...current,id])]:current.filter(value=>value!==id));}
  };
  const openInlineEditor=(comment:Comment)=>{if(!activePost||actionBusy||inlineEdit||getComposerUploadCount()>0)return;const url=new URL(comment.actionUrl||activeThread?.result?.url||activePost.url);url.hash=comment.id;setReplyExpanded(false);setInlineEdit({postId:activePost.id,url:url.href,floor:comment.id});};
  const finishInlineEdit=()=>{if(!inlineEdit||!activePost)return;const target=inlineEdit;setInlineEdit(null);if(activeIdRef.current!==target.postId)return;scrollPositions.current.delete(target.postId);restoredAnchors.current.delete(target.postId);void loadThread({...activePost,url:target.url},Number(new URL(target.url).pathname.match(/-(\d+)$/)?.[1]||1));};
  const reactToComment=async(request:Extract<ForumActionRequest,{kind:'react'}>)=>{
    if(await performForumAction(request,`${request.reaction}:${request.commentId}`)){
      if(activePost&&activeIdRef.current===activePost.id)await refreshVisibleThread();
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
  const libraryCommand=(command:ReadingCommand)=>{
    setLibraryMode(null);
    if(command==='search')leaveOfficial(()=>setSearchOpen(true));
    else if(command==='bookmark')void bookmarkCurrent();
    else if(command==='refresh-list')void loadListing();
    else if(command==='refresh-thread'){if(activePost)void refreshVisibleThread();else notify('请先打开一篇帖子。');}
    else leaveOfficial(()=>{setShowSettings(true);setView('forum');});
  };
  const copyLibrary=async()=>{
    if(libraryScope==='unconfirmed'||librarySnapshot.scope!==libraryScope)throw new Error('当前资料库尚未读取完成');
    await window.seekdesk.copyText(JSON.stringify({version:1,...libraryData},null,2));
  };
  const upload=async(file:File,width?:number)=>{const image=await window.seekdesk.uploadImage({name:file.name,mime:file.type,bytes:Array.from(new Uint8Array(await file.arrayBuffer())),width});return image.url;};
  const mediaChanged=()=>void window.seekdesk.getStickers().then(setStickers).catch(error=>notify(errorMessage(error),'error'));
  const saveHistory=(value:SearchHistory[])=>{setHistory(value);void window.seekdesk.saveSearchHistory(value).catch(error=>notify(errorMessage(error),'error'));};
  const startResize=(event:React.PointerEvent<HTMLDivElement>,kind:'sidebarWidth'|'listWidth')=>{event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);const start=event.clientX,initial=appearance[kind],target=event.currentTarget;let value=initial;const move=(next:PointerEvent)=>{value=kind==='sidebarWidth'?clampSidebarWidth(initial+next.clientX-start,window.innerWidth):Math.min(640,Math.max(280,initial+next.clientX-start));setAppearance(current=>({...current,[kind]:value}));};const end=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',end);target.removeEventListener('pointercancel',end);void saveAppearance({...appearance,[kind]:value});};target.addEventListener('pointermove',move);target.addEventListener('pointerup',end);target.addEventListener('pointercancel',end);};
  const isBlocked=(id?:number,name?:string)=>extensions.enabled.includes('block')&&extensions.installed.includes('block')&&Boolean((id&&blockedUsers.includes(id))||extensions.blocked.some(user=>id&&user.memberId?user.memberId===id:user.name.toLocaleLowerCase()===(name||'').toLocaleLowerCase()));
  const filtered=useMemo(()=>(listing?.posts||[]).filter(post=>matchesSearch(query,[post.title,post.author,boardName(post.category)])),[listing?.posts,query]);
  const accountRenderEpoch=actionEpoch.current;
  const accountLabel=account.status==='signed-in'?'已登录':account.status==='verification'?'需要网页验证':account.status==='signed-out'?'未登录':'会话待检测';
  const canUseFloorActions=activeThread?.result?.source==='web'&&!activeThread.loading;
  const canInteract=account.status==='signed-in'&&canUseFloorActions;
  const fontScale=(settings.uiFontSize||16)/16;
  const reply=(activePost&&drafts[activePost.id])||'';
  const fullPage=showSettings||official.visible||view!=='forum';
  const sharedComposerProps={appearance,stickers,onUpload:upload,onStickers:()=>setMediaOpen(true),onMedia:()=>setMediaOpen(true)};
  const onlyAuthor=extensions.installed.includes('authorOnly')&&extensions.enabled.includes('authorOnly')&&extensions.authorOnly;
  const visibleComments=useMemo(()=>activeThread?.result?prioritizeComments(activeThread.result.comments).filter(comment=>isThreadCommentVisible(comment,activeThread.result?.rootAuthorId,onlyAuthor,activePost?replyTargets[activePost.id]:undefined)):[],[activeComments,activeThread?.result?.rootAuthorId,onlyAuthor,activePost?.id,replyTargets]);
  const renderDiscussionHeader=()=>{
    const result=activeThread?.result;if(!result||result.source!=='web')return null;
    const replies=result.comments.filter(comment=>comment.id!=='0'&&isThreadCommentVisible(comment,result.rootAuthorId,onlyAuthor,activePost?replyTargets[activePost.id]:undefined));
    return <section className="discussion-heading" aria-label="楼层回复"><header><h2>楼层回复</h2><div>{extensions.installed.includes('authorOnly')&&extensions.enabled.includes('authorOnly')&&<button className="author-only-toggle" aria-pressed={onlyAuthor} onClick={()=>void saveExtensions({...extensions,authorOnly:!extensions.authorOnly}).catch(error=>notify(errorMessage(error),'error'))}><span aria-hidden="true"/>只看楼主</button>}{hasThreadPagination(result)&&<small>第 {result.page} 页</small>}</div></header><ThreadPagination {...result} loading={activeThread.loading} onPage={changeThreadPage} label="帖子顶部分页"/>{!replies.length&&<p className="discussion-empty">{onlyAuthor?'当前已加载页面中暂无楼主回复。':result.nextPage?'本页暂未显示回复，继续向下可读取下一页。':'还没有回复。'}</p>}</section>;
  };
  const loadOlder=async()=>{if(!listing?.nextPage||loadingOlder)return;setLoadingOlder(true);const token=listRequest.current;try{const next=serverSearch?await window.seekdesk.queryForum({kind:'search',term:serverSearch.term,categories:serverSearch.categories,page:listing.nextPage}).then(result=>({posts:result.posts||[],source:'web' as const,fetchedAt:new Date().toISOString(),nextPage:result.nextPage||null})):await window.seekdesk.listPosts({category,order,page:listing.nextPage});if(token===listRequest.current)setListing(current=>current?{...next,posts:[...current.posts,...next.posts.filter(post=>!current.posts.some(item=>item.id===post.id))]}:next);}catch(error){notify(errorMessage(error),'error');}finally{setLoadingOlder(false);}};
  useEffect(()=>{if(!ready||!activePost||!account.id)return;const key=`reply:${activePost.id}`,initial=latestDrafts.current[activePost.id];let current=true;draftReady.current='';void window.seekdesk.loadDraft(key,account.id).then(value=>{if(current){replyWidths.current=value?.imageWidths||{};draftsOwner.current=account.id;draftReady.current=key;setDrafts(drafts=>drafts[activePost.id]!==initial?drafts:{...drafts,[activePost.id]:value?.content??drafts[activePost.id]??''});}}).catch(()=>{if(current){draftsOwner.current=account.id;draftReady.current=key;}});return()=>{current=false;};},[activePost?.id,account.id,ready]);
  useEffect(()=>{if(!activePost||!account.id||draftReady.current!==`reply:${activePost.id}`)return;const timer=setTimeout(()=>void window.seekdesk.saveDraft(`reply:${activePost.id}`,{content:reply,imageWidths:replyWidths.current},account.id).catch(()=>{}),500);return()=>clearTimeout(timer);},[activePost?.id,reply,account.id]);
  useEffect(()=>{if(!ready||!appearance.autoRefresh)return;const timer=setInterval(()=>{if(view==='forum'&&!activeId&&!official.visible&&!document.hidden)void loadListing();},60000);return()=>clearInterval(timer);},[ready,appearance.autoRefresh,view,activeId,official.visible,loadListing]);
  useEffect(()=>ready?window.seekdesk.onOpenPost(post=>openPost(post)):undefined,[ready,openPost]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')||view!=='forum'||showSettings||official.visible||searchOpen||mediaOpen)return;if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setSelectedIndex(index=>{const next=Math.min(filtered.length-1,Math.max(0,index+(event.key==='ArrowDown'?1:-1)));requestAnimationFrame(()=>document.querySelectorAll<HTMLElement>('[data-testid="post-row"]')[next]?.scrollIntoView({block:'nearest'}));return next;});}else if(event.key==='Enter'&&filtered[selectedIndex]){event.preventDefault();openPost(filtered[selectedIndex],event.ctrlKey||event.metaKey);}};window.addEventListener('keydown',onKey);return()=>window.removeEventListener('keydown',onKey);},[view,showSettings,official.visible,searchOpen,mediaOpen,filtered,selectedIndex,openPost]);

  useUpdateDraftSaver(async()=>{
    if(!ready)throw new Error('客户端尚未就绪');
    if(actionBusy||replySubmission.current!==null||getComposerUploadCount()>0||getPendingComposerSubmissionCount()>0)throw new Error('请等待当前操作或图片上传结束');
    const owner=account.id,epoch=actionEpoch.current;
    const explicit=[...explicitLibraryWrites.current];
    await Promise.all(explicit.map(async write=>{try{await write.task;}catch(error){if(write.scope===libraryScopeRef.current&&write.epoch===actionEpoch.current)throw error;}}));
    await libraryQueue.current.catch(()=>{});
    const hasReply=Object.values(latestDrafts.current).some(value=>value.trim());
    if(owner&&hasReply&&(draftsOwner.current!==owner||Boolean(activePost&&latestDrafts.current[activePost.id]?.trim()&&draftReady.current!==`reply:${activePost.id}`)))throw new Error('回复草稿尚未读取完成，请稍后更新');
    if(owner&&draftsOwner.current===owner){
      await Promise.all(Object.entries(latestDrafts.current).map(async([id,content])=>{
        const key='reply:'+id;
        const previous=id===activePost?.id?undefined:await window.seekdesk.loadDraft(key,owner);
        if(epoch!==actionEpoch.current||draftsOwner.current!==owner)throw new Error('草稿所属账号已变化');
        await window.seekdesk.saveDraft(key,{content,imageWidths:id===activePost?.id?replyWidths.current:previous?.imageWidths||{}},owner);
      }));
    }
    if(epoch!==actionEpoch.current)throw new Error('账号已变化');
    await window.seekdesk.saveWorkspace(workspaceSnapshot());
  });
  useEffect(()=>{
    if(!ready||!window.seekdesk.onBeforeUpdateInstall)return;
    const prepare=window.seekdesk.onBeforeUpdateInstall(async()=>{
      flushSync(()=>setUpdatePreparing(true));
      try{await flushUpdateDrafts({owner:updateOwner.current});}
      catch(error){flushSync(()=>setUpdatePreparing(false));throw error;}
    });
    const changed=window.seekdesk.onUpdateChange(state=>{if(state.status!=='installing')setUpdatePreparing(false);});
    return()=>{prepare();changed();};
  },[ready]);
  return <><div inert={updatePreparing||undefined} className={`app-shell brand-${appearance.brand}${appearance.readerGradient?' reader-gradient':''}`} style={{'--reader-font-size':`${settings.fontSize*fontScale}px`,'--list-font-size':`${appearance.listFontSize*fontScale}px`,'--board-font-size':`${appearance.boardFontSize*fontScale}px`,'--ranking-font-size':`${appearance.rankingFontSize*fontScale}px`,'--author-scale':appearance.authorFontSize/100,'--sidebar-width':`${appearance.sidebarWidth}px`,'--list-width':`${appearance.listWidth}px`,'--accent':palettes.find(item=>item.id===appearance.brand)?.color} as CSSProperties}>
    <header className="titlebar">
      <div className="toolbar-brand"><IconButton label={sidebarHidden?'展开侧栏':'收起侧栏'} onClick={()=>setSidebarHidden(!sidebarHidden)}>{sidebarHidden?<PanelLeftOpen size={20}/>:<PanelLeftClose size={20}/>}</IconButton><img src={`./brands/${appearance.brand}.png`} alt=""/><strong>SeekDesk</strong></div>
      <div className="toolbar-tools"><button className="toolbar-library" aria-label="阅读资料库" title="本地书签与阅读历史 · Ctrl+Shift+L" onClick={()=>openLibrary()}><BookOpen size={18}/><span>资料库</span></button><button className="toolbar-search" onClick={()=>leaveOfficial(()=>setSearchOpen(true))}><Search size={16}/><span>搜索</span><kbd>Ctrl K</kbd></button><details className="layout-menu"><summary title="布局" aria-label="布局"><PanelTop size={20}/></summary><div className="user-menu-items" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}><button onClick={()=>{setSidebarHidden(false);setListHidden(false);setNarrowListHidden(false);}}>三栏阅读</button><button onClick={()=>{setSidebarHidden(true);setListHidden(false);setNarrowListHidden(false);}}>列表与正文</button><button onClick={()=>{setSidebarHidden(true);setListHidden(true);}}>专注阅读</button><button onClick={()=>void saveAppearance({...appearance,listWidth:370,sidebarWidth:SIDEBAR_STANDARD})}>恢复默认栏宽</button></div></details><button className="notification-button icon-button" aria-label={`通知，${unread.mentions+unread.replies+unread.messages}条未读`} title="通知与私信" onClick={()=>{setInitialPeer(undefined);navigate('notifications');}}><Bell size={20}/>{unread.mentions+unread.replies+unread.messages>0&&<b>{Math.min(99,unread.mentions+unread.replies+unread.messages)}</b>}</button><button data-testid="account-button" className="toolbar-account" onClick={()=>account.status==='signed-in'?navigate('mine'):void action(()=>window.seekdesk.openOfficial())}><Avatar name={account.name||''} src={account.avatar||avatarURL(account.id)} large/><span><strong>{account.name||'登录 NodeSeek'}</strong><small>{account.id?`UID ${account.id} · Lv ${account.level??'—'}`:accountLabel}</small></span>{account.status==='signed-in'&&<span className="chicken-balance">🍗 {profile?.coin??'—'}</span>}</button></div>
      <div className="window-controls"><IconButton label="最小化" onClick={()=>window.seekdesk?.windowAction('minimize')}><Minus size={17}/></IconButton><IconButton label="最大化或还原" onClick={()=>window.seekdesk?.windowAction('maximize')}><Square size={13}/></IconButton><IconButton label="关闭窗口" className="window-close" onClick={()=>window.seekdesk?.windowAction('close')}><X size={18}/></IconButton></div>
    </header>
    {!ready?<main className="boot-screen"><img className="boot-logo" src="./assets/app-icon.png" alt="SeekDesk"/><h1>SeekDesk</h1>{bootError?<><p role="alert">{bootError}</p><button className="primary-button" onClick={()=>void boot()}>重新连接</button></>:<LoaderCircle className="spin" size={24}/>}</main>:<div className={`workspace${sidebarHidden?' sidebar-hidden':''}${view==='compose'?' compose-view':''}`}>
      <Sidebar view={view} category={category} searchActive={Boolean(serverSearch)} settingsOpen={showSettings} sidebarGroup={sidebarGroup} onSidebarGroup={setSidebarGroup}
        extensions={extensions} rankingPeriod={rankingPeriod} onRankingPeriod={setRankingPeriod} rankingLoading={rankingLoading} ranking={ranking} rankingError={rankingError} onLoadRanking={loadRanking}
        onCompose={()=>{setEditSource(undefined);navigate('compose');}} onBoard={changeBoard} onNavigate={navigate}
        onSearch={()=>leaveOfficial(()=>setSearchOpen(true))} onNotifications={()=>{setInitialPeer(undefined);navigate('notifications');}}
        onOfficial={url=>void action(()=>window.seekdesk.openOfficial(url))} onBossKey={()=>void action(()=>window.seekdesk.toggleBossKey())} onMedia={()=>setMediaOpen(true)}
        onSettings={()=>leaveOfficial(()=>{setShowSettings(true);setView('forum');})} onOpenPost={openPost}
      /><div className="pane-resizer sidebar-resizer" role="separator" aria-label="调整侧栏宽度" aria-orientation="vertical" onPointerDown={event=>startResize(event,'sidebarWidth')}/>
      <div className="main-workspace">
        <TabBar tabs={tabs} activeId={activeId} fullPage={fullPage} overviewOpen={overviewOpen} effectiveListHidden={effectiveListHidden} official={official} draggedTab={draggedTab}
          onOverview={()=>leaveOfficial(()=>{setActiveId(null);setOverviewOpen(true);setShowSettings(false);setView('forum');setListHidden(false);setNarrowListHidden(false);})}
          onSelectOverview={()=>leaveOfficial(()=>{setActiveId(null);setView('forum');setShowSettings(false);})}
          onCloseOverview={closeOverview}
          onToggleList={()=>{setNarrowListHidden(false);setListHidden(!effectiveListHidden);}}
          onSelectTab={id=>leaveOfficial(()=>{setActiveId(id);setShowSettings(false);setView('forum');})}
          onCloseTab={closeTab}
          onCloseAll={()=>{tabs.forEach(tab=>threadRequests.current.set(tab.id,(threadRequests.current.get(tab.id)||0)+1));setTabs([]);setActiveId(null);setThreads({});}}
          onReorder={(source,destination)=>setTabs(current=>{const target=current.findIndex(item=>item.id===destination),next=current.filter(item=>item.id!==source),moving=current.find(item=>item.id===source);if(moving)next.splice(target,0,moving);return next;})}
          onContextMenu={setPostContext}
          onOpenTabList={id=>{setActiveId(id);navigate('forum');}}
        />
        <div className={`content-area${effectiveListHidden?' list-hidden':''}${fullPage?' full-page-area':''}`}>
          {official.visible?<OfficialPanel state={official} scriptEnabled={settings.nodeSeekPro} onScriptSettings={()=>void action(()=>window.seekdesk.openScriptSettings())} onClose={()=>leaveOfficial(()=>setShowSettings(false))} onReload={()=>void action(()=>window.seekdesk.reloadOfficial())}/>:showSettings?<PreferencesPanel settings={settings} appearance={appearance} onAppearance={saveAppearance} version={version} buildNumber={buildNumber} account={account} accountBusy={accountBusy} blockedUsers={blockedUsers} onUpdate={updateSettings} onBack={()=>setShowSettings(false)} onCheck={checkAccount} onClear={()=>setConfirmClear(true)} onUnblock={id=>void toggleBlock(id)} onOfficial={()=>void action(()=>window.seekdesk.openOfficial())} onScriptSettings={()=>void action(()=>window.seekdesk.openScriptSettings())} onExternal={url=>void action(()=>window.seekdesk.openExternal(url))} onMedia={()=>setMediaOpen(true)} onNotify={notify}/>:view==='mine'||view==='space'?<AccountPanel onFollowingSaved={(id,value)=>{if(updateOwner.current!==account.id||actionEpoch.current!==accountRenderEpoch)return;authorProfiles.updateFollowing(id,value);setFollowing(current=>value?[...new Set([...current,id])]:current.filter(member=>member!==id));}} onIntroductionSaved={signature=>{if(account.id&&updateOwner.current===account.id&&actionEpoch.current===accountRenderEpoch)setOwnSignature({owner:account.id,signature});}} onAccountSettings={()=>leaveOfficial(()=>{setShowSettings(true);setView('forum');})} account={account} memberId={view==='space'?memberId:undefined} onBack={()=>navigate('forum')} onOpenPost={openPost} onMember={showMember} onMessage={showMessages} onLogin={()=>void action(()=>window.seekdesk.openOfficial())} onNotify={notify} revision={accountRevision} {...sharedComposerProps}/>:view==='notifications'?<NotificationsPanel account={account} unread={unread} onBack={()=>navigate('forum')} onOpenPost={openPost} onMember={showMember} onLogin={()=>void action(()=>window.seekdesk.openOfficial())} onNotify={notify} onRead={()=>void refreshSummary()} initialPeer={initialPeer} {...sharedComposerProps}/>:view==='compose'?<TopicComposerPanel account={account} source={editSource} onBack={()=>navigate('forum')} onPublished={post=>{openPost(post,false,true);void loadListing();}} onNotify={notify} onLogin={()=>void action(()=>window.seekdesk.openOfficial())} {...sharedComposerProps}/>:view==='extensions'?<ExtensionsPanel account={account} state={extensions} onChange={saveExtensions} onBack={()=>navigate('forum')} onNotify={notify} onOpenRanking={()=>navigate('ranking')} onOpenPost={openPost} onMember={showMember}/>:view==='ranking'?<RankingPanel period={rankingPeriod} showScore={extensions.hotShowScore} refreshSeconds={extensions.hotRefreshSeconds} onOpenPost={openPost} onBack={()=>navigate('forum')}/>:view==='friends'?<FriendsPanel onBack={()=>navigate('forum')}/>:<>
            <PostListPanel compact={settings.compact} title={serverSearch?`搜索：${serverSearch.term}`:category?boardName(category):'最新帖子'} listing={listing} listingLoading={listingLoading} listingError={listingError} order={order}
              onOrder={value=>{setOrder(value);setPage(1);}} searching={Boolean(serverSearch)} onExitSearch={()=>changeBoard(category)} query={query} onQuery={setQuery} searchRef={searchRef}
              onFilter={handleSearch} onRefresh={()=>void loadListing()} onLoadOlder={()=>void loadOlder()} loadingOlder={loadingOlder} autoLoadOlder={appearance.autoLoadOlder}
              posts={filtered} activeId={activeId} selectedIndex={selectedIndex} onSelectedIndex={setSelectedIndex} isBlocked={isBlocked} onOpenPost={openPost} onContextMenu={setPostContext}
              onOpenOfficial={()=>void action(()=>window.seekdesk.openOfficial())}
            /><div className="pane-resizer list-resizer" role="separator" aria-label="调整帖子栏宽度" aria-orientation="vertical" onPointerDown={event=>startResize(event,'listWidth')}/>
            <main className="reading-panel">{activePost?<><div className="reader-toolbar"><span className="category-tag" data-category={activeThread?.result?.category||activePost.category}>{boardName(activeThread?.result?.category||activePost.category)}</span>{activePost.featured&&<Diamond size={15} className="featured-badge" aria-label="精品帖子"/>}{activePost.readingRank!==undefined&&<span className="access-badge" title={activePost.readingRank===255?'私有帖子':'阅读权限 Lv '+activePost.readingRank}><LockKeyhole size={12}/>{activePost.readingRank===255?'私有':'Lv '+activePost.readingRank}</span>}{activeThread?.result?.replyRestriction&&<span className="thread-restriction"><LockKeyhole size={14}/>{activeThread.result.replyRestriction}</span>}<div className="reader-toolbar-actions">{extensions.installed.includes('value')&&extensions.enabled.includes('value')&&<button className="text-button" onClick={()=>{void action(()=>window.seekdesk.openCalculator());}}><Calculator size={16}/>剩余价值</button>}<IconButton label="复制帖子链接" onClick={()=>void action(async()=>{await window.seekdesk.copyText(currentLibraryPost()?.url||activePost.url);notify('帖子链接已复制','success');})}><Link size={17}/></IconButton><IconButton label="缩小正文字号" disabled={settings.fontSize<=14} onClick={()=>void updateSettings({fontSize:Math.max(14,settings.fontSize-1)})}><span className="type-size small">A</span></IconButton><IconButton label="增大正文字号" disabled={settings.fontSize>=40} onClick={()=>void updateSettings({fontSize:Math.min(40,settings.fontSize+1)})}><span className="type-size">A</span></IconButton><IconButton label="刷新当前帖子" disabled={activeThread?.loading} onClick={()=>void refreshVisibleThread()}><RefreshCw size={17} className={activeThread?.loading?'spin':''}/></IconButton><IconButton label="官方原帖" onClick={()=>void action(()=>window.seekdesk.openOfficial(currentLibraryPost()?.url||activePost.url))}><ArrowUpRight size={18}/></IconButton></div></div><div className="reader-scroll" ref={readerRef} onScroll={event=>{if(activeId){scrollPositions.current.set(activeId,event.currentTarget.scrollTop);rememberStreamLocation(event.currentTarget);clearTimeout(scrollSaveTimer.current);scrollSaveTimer.current=setTimeout(()=>setScrollRevision(value=>value+1),250);}}}><div className="reader-document"><header className="thread-heading"><h1>{activeThread?.result?.title||activePost.title}</h1>{showThreadOwner&&<div className="thread-meta"><Avatar name={activePost.author} src={activePost.avatar||avatarURL(activePost.authorId)}/><button className="text-button" onClick={()=>activePost.authorId&&setUserCardMember({id:activePost.authorId,name:activePost.author,avatar:activePost.avatar})}>{activePost.author}</button><time>{dateLabel(activePost.published,true)}</time></div>}</header>{activeThread?.loading&&!activeThread.result&&<div data-testid="thread-loading" className="reader-loading" role="status"><LoaderCircle className="spin" size={25}/><span>正在读取帖子…</span></div>}{activeThread?.error&&<div className="reader-error" role="alert"><CircleAlert size={24}/><h2>这篇帖子暂时无法读取</h2><p>{activeThread.error}</p><div><button className="primary-button" onClick={()=>void action(()=>window.seekdesk.openOfficial(activePost.url))}>官方页面验证 / 查看<ArrowUpRight size={16}/></button><button className="secondary-button" onClick={()=>void action(()=>window.seekdesk.openExternal(activePost.url))}>在浏览器查看原帖<ArrowUpRight size={16}/></button><button className="secondary-button" onClick={()=>void loadThread(activePost,activeThread.requestedPage)}>重新读取</button></div></div>}{activeThread?.result?.notice&&<Notice warning={activeThread.result.source==='rss'}>{activeThread.result.notice}</Notice>}
              {activeThread?.result&&!activeThread.result.comments.some(comment=>comment.id==='0')&&renderDiscussionHeader()}{activeThread?.result?.source==='web'&&(authorProfiles.loading.size>0||failedProfileIds.length>0)&&<div className="profile-load-status" role="status">{authorProfiles.loading.size>0?`正在读取用户等级（剩余 ${authorProfiles.loading.size} 位）`:profileVerification?'用户资料接口需要登录或官网验证':`${failedProfileIds.length} 位用户资料暂未读到`}{failedProfileIds.length>0&&<button disabled={authorProfiles.loading.size>0} onClick={()=>authorProfiles.retry(failedProfileIds)}>重试资料</button>}{profileVerification&&<button onClick={()=>void action(()=>window.seekdesk.openOfficial(account.status==='signed-in'?activePost.url:undefined))}>官方页面验证</button>}</div>}{replyStatus?.postId===activePost.id&&<Notice warning={!replyStatus.waiting} action={!replyStatus.waiting&&<button className="text-button" onClick={()=>void loadThread({...activePost,url:replyStatus.url},Number(new URL(replyStatus.url).pathname.match(/-(\d+)\/?$/)?.[1]||1))}>刷新新回复</button>}>{replyStatus.message}</Notice>}{activeThread?.result&&visibleComments.map((originalComment,index)=>{const metadata=originalComment.authorId?authorProfiles.profiles[originalComment.authorId]:undefined;const comment={...originalComment,signatureHtml:ownSignature&&ownSignature.owner===account.id&&originalComment.authorId===account.id?undefined:originalComment.signatureHtml,signature:ownSignature&&ownSignature.owner===account.id&&originalComment.authorId===account.id?ownSignature.signature:originalComment.signature||metadata?.profile?.signature,following:(originalComment.authorId?authorProfiles.followingOverride(originalComment.authorId):undefined)??metadata?.profile?.following??originalComment.following};const blocked=isBlocked(comment.authorId,comment.author),expanded=expandedBlocked.includes(`${activePost.id}:${comment.id}`);return <Fragment key={`${activePost.id}-${comment.id}`}><article data-floor={comment.id} data-stream-page={activeThread.streamFloorPages?.[comment.id]||activeThread.result!.page} className={`comment ${comment.id==='0'?'thread-original':'floor-reply'}${blocked?' blocked-comment':''}`} id={`comment-${comment.id}`} key={`${activePost.id}-${comment.id}`}><div className="comment-heading"><button className="author-avatar-button" onClick={()=>comment.authorId&&setUserCardMember({id:comment.authorId,name:comment.author,avatar:comment.avatar,tags:comment.role?[comment.role]:[]})}><Avatar name={comment.author} src={comment.avatar||avatarURL(comment.authorId)} large/></button><div className="author-info"><div><button className="author-name" onClick={()=>comment.authorId&&setUserCardMember({id:comment.authorId,name:comment.author,avatar:comment.avatar,tags:comment.role?[comment.role]:[]})}>{comment.author||'社区成员'}</button><AuthorBadges comment={comment} outcome={metadata} loading={Boolean(comment.authorId&&authorProfiles.loading.has(comment.authorId))} onRetry={()=>comment.authorId&&authorProfiles.retry([comment.authorId])}/>{comment.isAuthor&&<span className="op-badge">楼主</span>}</div><time title={comment.date}>{dateLabel(comment.date,true)}</time></div>{comment.id!=='0'&&(comment.isHot||(comment.chicken||0)>0)&&<span className="comment-hot-badge" aria-label="热门回复" title="热门回复">HOT</span>}<span className="floor">{comment.floor||`#${index}`}</span>{(comment.authorId||comment.author.trim())&&<details className="user-menu"><summary aria-label={`${comment.author}的用户操作`}><MoreHorizontal size={19}/></summary><div className="user-menu-items" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}><button disabled={!comment.authorId} onClick={()=>showMember(comment.authorId!)}>查看个人资料</button>{(!comment.authorId||comment.authorId!==account.id)&&<><button disabled={!comment.authorId||account.status!=='signed-in'||Boolean(actionBusy)} onClick={()=>void followUser(comment.authorId!)}>{(comment.following??following.includes(comment.authorId||0))?'取消关注':'加好友 / 关注'}</button><button disabled={!comment.authorId||account.status!=='signed-in'} onClick={()=>showMessages(comment.authorId!,comment.author)}>发送私信</button><button onClick={()=>void toggleBlock(comment.authorId,comment.author)}>{blocked?'解除屏蔽':'屏蔽用户'}</button></>}{(comment.isOwn||Boolean(account.id&&comment.authorId===account.id))&&<button disabled={Boolean(inlineEdit)||Boolean(actionBusy)||composerUploading} onClick={()=>{openInlineEditor(comment);}}>编辑{comment.isAuthor?'帖子':'回复'}</button>}{extensions.installed.includes('rulings')&&extensions.enabled.includes('rulings')&&<button onClick={()=>setRulingMember({id:comment.authorId||0,name:comment.author})}>查询管理记录</button>}</div></details>}</div>{blocked&&!expanded?<div className="blocked-content"><ShieldCheck size={18}/><span>已屏蔽此用户的内容。</span><button className="text-button" onClick={()=>setExpandedBlocked(current=>[...current,`${activePost.id}:${comment.id}`])}>临时展开</button></div>:<><div data-testid="reader-content"><ReaderContent html={comment.html||'<p class="muted">原站未显示这层的正文。</p>'} nqScale={appearance.nqScale} tqScale={appearance.tqScale} onReportScale={(kind,value)=>void saveAppearance({...appearance,[kind==='nq'?'nqScale':'tqScale']:value})} onNavigate={url=>{const post=postFromUrl(url);if(post)openPost(post,false,true);else void action(()=>/^https:\/\/(www\.)?nodeseek\.com\//.test(url)?window.seekdesk.openOfficial(url):window.seekdesk.openExternal(url));}}/></div>{blocked&&expanded&&<button className="text-button" onClick={()=>setExpandedBlocked(current=>current.filter(key=>key!==`${activePost.id}:${comment.id}`))}>收起已屏蔽内容</button>}{(comment.signatureHtml||comment.signature)&&<aside className="comment-signature" aria-label={`${comment.author}的个人签名`}><div className="signature-content"><ReaderContent html={comment.signatureHtml||renderMarkdown(comment.signature||'')} onNavigate={url=>{const post=postFromUrl(url);if(post)openPost(post,false,true);else void action(()=>window.seekdesk.openExternal(url));}}/></div></aside>}<div className="comment-actions">{comment.likes!==undefined&&<button disabled={!canUseFloorActions||Boolean(actionBusy)||comment.liked===true} className={comment.liked?'active':''} onClick={()=>void reactToComment({kind:'react',url:comment.actionUrl||activePost.url,commentId:comment.id,reaction:'like'})}><ThumbsUp size={16}/>{comment.likes}</button>}{comment.chicken!==undefined&&<button disabled={!canUseFloorActions||Boolean(actionBusy)||comment.gaveChicken===true} className={comment.gaveChicken?'active':''} onClick={()=>void reactToComment({kind:'react',url:comment.actionUrl||activePost.url,commentId:comment.id,reaction:'chicken'})}>🍗 {comment.chicken}</button>}{comment.dislikes!==undefined&&<button disabled={!canUseFloorActions||Boolean(actionBusy)||comment.disliked===true} className={comment.disliked?'active':''} onClick={()=>void reactToComment({kind:'react',url:comment.actionUrl||activePost.url,commentId:comment.id,reaction:'dislike'})}><ThumbsDown size={16}/>{comment.dislikes}</button>}{activeThread.result?.source==='web'&&!activeThread.result.replyRestriction&&<><button disabled={!canUseFloorActions||Boolean(actionBusy)||Boolean(activeThread.result?.replyRestriction)} aria-label={`引用第${comment.id}楼`} onClick={()=>insertFloorReference(comment,true)}><Quote size={16}/>引用</button><button disabled={!canUseFloorActions||Boolean(actionBusy)||Boolean(activeThread.result?.replyRestriction)} aria-label={`回复第${comment.id}楼`} onClick={()=>insertFloorReference(comment,false)}><Reply size={16}/>回复</button></>}{(comment.isOwn||Boolean(account.id&&comment.authorId===account.id))&&<button disabled={Boolean(inlineEdit)||Boolean(actionBusy)||composerUploading} onClick={()=>{openInlineEditor(comment);}}>编辑</button>}</div></>}{floorNotice?.postId===activePost.id&&floorNotice.floor===comment.id&&<p role="status" className={'floor-action-notice'+(floorNotice.error?' error':'')}>{floorNotice.text}</p>}{inlineEdit?.postId===activePost.id&&inlineEdit.floor===comment.id&&<TopicComposerPanel inline key={account.id+':edit:'+inlineEdit.url} source={{url:inlineEdit.url,floor:inlineEdit.floor}} account={account} onBack={()=>setInlineEdit(null)} onPublished={finishInlineEdit} onNotify={notify} onLogin={()=>void action(()=>window.seekdesk.openOfficial())} {...sharedComposerProps}/>}</article>{comment.id==='0'&&renderDiscussionHeader()}</Fragment>;})}
              {activeThread?.result?.source==='web'&&Boolean(activeThread.result.nextPage||activeThread.appendLoading||activeThread.appendError||activeThread.appendPaused||(activeThread.streamStartPage&&activeThread.result.page>activeThread.streamStartPage))&&<div ref={nextPageSentinel} className={'thread-auto-load'+(activeThread.appendError?' thread-auto-load-error':'')} aria-label="评论自动翻页" role="status">{activeThread.appendLoading?<><LoaderCircle size={17} className="spin"/>正在加载第 {activeThread.result.nextPage} 页评论…</>:activeThread.appendError?<><span>下一页暂未读到，已读评论已保留。</span><button onClick={()=>void loadNextComments(true)}>重试加载</button><button onClick={()=>void action(()=>window.seekdesk.openOfficial(activeThread.result!.url))}>官方页面验证</button></>:activeThread.appendPaused?<><span>连续两页没有新增可见评论，已暂停自动加载。</span><button onClick={()=>void loadNextComments(true)}>继续加载</button></>:<span>{activeThread.streamStartPage&&activeThread.result.page>activeThread.streamStartPage?'已加载第 '+activeThread.streamStartPage+'–'+activeThread.result.page+' 页 · ':''}{activeThread.result.nextPage?'继续向下滚动，自动加载下一页':'已到最后一页'}</span>}</div>}{activeThread?.result&&hasThreadPagination(activeThread.result)&&<footer className="thread-footer"><ThreadPagination {...activeThread.result} loading={activeThread.loading} onPage={changeThreadPage} label="帖子底部分页"/></footer>}
            </div></div>{!activeThread?.result?.replyRestriction&&<ReplyDock postId={activePost.id} accountId={account.id} accountStatus={account.status} reply={reply} expanded={replyExpanded} focusRequest={replyFocusRequest} restriction={activeThread?.result?.replyRestriction} canInteract={canInteract} actionBusy={actionBusy} composerUploading={composerUploading} sendShortcut={appearance.sendShortcut} stickers={stickers} imageWidths={replyWidths.current}
              onToggle={()=>{setReplyExpanded(!replyExpanded);if(!replyExpanded)setReplyFocusRequest(request=>request+1);}} onClose={()=>setReplyExpanded(false)}
              onChange={value=>setDrafts(current=>({...current,[activePost.id]:value}))} onClear={()=>setDrafts(current=>({...current,[activePost.id]:''}))} onSend={()=>void sendReply()}
              onUpload={upload} onImageWidths={value=>{replyWidths.current=value;}} onImportStickers={()=>setMediaOpen(true)} onMediaSettings={()=>setMediaOpen(true)}
              onOpenOfficial={()=>void action(()=>window.seekdesk.openOfficial(account.status==='signed-in'?activePost.url:undefined))}
            />}</>:overviewOpen?<div data-testid="reading-overview" className="overview real-overview"><header><img src="./assets/app-icon.png" alt=""/><h1>阅读总览</h1><IconButton label="关闭阅读总览" onClick={closeOverview}><X size={18}/></IconButton></header><p>{tabs.length?`已打开 ${tabs.length} 篇帖子，选择标签继续阅读。`:'从帖子列表打开讨论，保留多个标签同时阅读。'}</p><div className="overview-topics">{tabs.map(post=><button key={post.id} className="activity-row" onClick={()=>openPost(post)}><FileText size={18}/><span><strong>{post.title}</strong><small>{post.author} · {boardName(post.category)}</small></span><ArrowRight size={17}/></button>)}</div><div className="overview-shortcuts"><span><kbd>Ctrl K</kbd>搜索帖子和用户</span><span><kbd>Ctrl Tab</kbd>切换阅读标签</span><span><kbd>Ctrl W</kbd>关闭当前标签</span></div><button className="primary-button" onClick={()=>{setEditSource(undefined);navigate('compose');}}><Plus size={18}/>发表新帖</button></div>:<div className="reader-empty"><BookOpen size={34}/><h1>选择帖子开始阅读</h1><button className="secondary-button" onClick={()=>setOverviewOpen(true)}>打开阅读总览</button></div>}</main>
          </>}
        </div>
      </div>
    </div>}
    {postContext&&!official.visible&&<div className="post-context-menu user-menu-items" role="menu" aria-label={postContext.tab?'标签操作':'帖子操作'} style={{left:Math.max(6,postContext.x),top:Math.max(42,postContext.y)}}>{postContext.tab?<>{tabs.findIndex(tab=>tab.id===postContext.post.id)>0&&<button role="menuitem" onClick={()=>moveContextTab(-1)}>向左移动</button>}{tabs.findIndex(tab=>tab.id===postContext.post.id)<tabs.length-1&&<button role="menuitem" onClick={()=>moveContextTab(1)}>向右移动</button>}<button role="menuitem" onClick={()=>{closeAllTabs();setPostContext(null);}}>关闭全部标签</button></>:<><button role="menuitem" onClick={()=>{openPost(postContext.post,true);setPostContext(null);}}>在后台打开</button><button role="menuitem" onClick={()=>{void action(()=>window.seekdesk.openExternal(postContext.post.url));setPostContext(null);}}>在浏览器打开</button>{extensions.installed.includes('rulings')&&extensions.enabled.includes('rulings')&&<button role="menuitem" onClick={()=>{setRulingMember({id:postContext.post.authorId||0,name:postContext.post.author});setPostContext(null);}}>查询作者管理记录</button>}<button role="menuitem" disabled={!postContext.post.authorId&&!postContext.post.author.trim()} onClick={()=>{void toggleBlock(postContext.post.authorId,postContext.post.author);setPostContext(null);}}>{isBlocked(postContext.post.authorId,postContext.post.author)?'解除屏蔽作者':'屏蔽作者'}</button></>}</div>}
    {toast&&<div className={`toast toast-${toast.tone}`} role={toast.tone==='error'?'alert':'status'}>{toast.tone==='error'?<CircleAlert size={19}/>:toast.tone==='success'?<Check size={19}/>:<Info size={19}/>}<span>{toast.message}</span><IconButton label="关闭提示" onClick={()=>setToast(null)}><X size={17}/></IconButton></div>}
    {confirmClear&&<div className="dialog-backdrop"><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-title"><h2 id="clear-title">清除本机登录会话？</h2><p>客户端将清除保存的 NodeSeek 会话与阅读标签，下次需要重新登录。</p><div><button autoFocus className="secondary-button" onClick={()=>setConfirmClear(false)}>保留会话</button><button className="danger-button" onClick={()=>void clearSession()}>清除会话</button></div></section></div>}
    {reactionConfirmation&&<div className="dialog-backdrop"><section data-testid="reaction-confirmation" className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="reaction-title"><h2 id="reaction-title">{reactionConfirmation.request.reaction==='dislike'?'确认点踩':'确认赠送鸡腿'}</h2><p>{reactionConfirmation.message}</p><div><button autoFocus className="secondary-button" onClick={()=>setReactionConfirmation(null)}>取消</button><button className={reactionConfirmation.approval==='paid'?'danger-button':'primary-button'} onClick={()=>{const pending=reactionConfirmation;setReactionConfirmation(null);void reactToComment({...pending.request,approval:pending.approval});}}>确认{reactionConfirmation.approval==='paid'?'付费':''}{reactionConfirmation.request.reaction==='dislike'?'点踩':'赠送'}</button></div></section></div>}
    {libraryMode!==null&&!official.visible&&<ReadingLibraryPanel key={libraryScope} state={libraryData} mode={libraryMode} onModeChange={setLibraryMode} loading={libraryLoading} error={libraryError} busy={libraryBusy} onClose={()=>setLibraryMode(null)} onRetry={()=>void loadLibrary()} onOpen={post=>openPost(post,false,true)} onMutate={mutateLibrary} onCommand={libraryCommand} onCopy={copyLibrary}/>}
    {searchOpen&&!official.visible&&<SearchPanel history={history} onHistory={saveHistory} onClose={()=>setSearchOpen(false)} onMember={showMember} onOpenPost={openPost} onPosts={(result,term,categories)=>{++listRequest.current;prefetchedSearch.current=true;setServerSearch({term,categories});setListing({posts:result.posts||[],source:'web',fetchedAt:new Date().toISOString(),nextPage:result.nextPage||null});setPage(1);setQuery('');setListingError('');setListingLoading(false);setView('forum');setShowSettings(false);setListHidden(false);setNarrowListHidden(false);}}/>}
    {userCardMember&&!official.visible&&<UserProfileCard member={userCardMember} revision={accountRevision} ownerId={account.status==='signed-in'?account.id:undefined} canMessage={account.status==='signed-in'&&userCardMember.id!==account.id} onClose={()=>setUserCardMember(null)} onOpenSpace={()=>{const member=userCardMember;setUserCardMember(null);showMember(member.id);}} onMessage={(id,name)=>{setUserCardMember(null);showMessages(id,name);}}/>}
    {rulingMember&&!official.visible&&<RulingsDialog member={rulingMember} onClose={()=>setRulingMember(null)}/>}
    {keywordAlerts.length>0&&!official.visible&&<aside className="keyword-alerts" aria-label="关键词监控提醒"><header><strong>关键词监控 · {keywordAlerts.length} 条新命中</strong><IconButton label="关闭关键词提醒" onClick={()=>setKeywordAlerts([])}><X size={17}/></IconButton></header><div>{keywordAlerts.map(hit=><button className="activity-row" key={`${hit.post.id}:${hit.date}`} onClick={()=>{openPost(hit.post);setKeywordAlerts([]);}}><Bell size={18}/><span><strong>{hit.post.title}</strong><small>{hit.words.join(" · ")}</small></span><ArrowRight size={17}/></button>)}</div></aside>}
    {mediaOpen&&!official.visible&&<ComposerMediaPanel onClose={()=>setMediaOpen(false)} onChanged={mediaChanged}/>}
    {bossMode&&<div className="office-surface"><header><strong>{extensions.officeTitle||'工作台'}</strong><button className="secondary-button" onClick={()=>void action(()=>window.seekdesk.toggleBossKey())}>{extensions.officeButton||'返回'}</button></header><nav>文件　编辑　查看　插入　格式　工具　帮助</nav><div className="office-document"><h1>项目工作计划</h1><p>工作进展记录与任务安排</p><table><thead><tr><th>事项</th><th>负责人</th><th>开始日期</th><th>截止日期</th><th>状态</th><th>备注</th></tr></thead><tbody>{Array.from({length:24},(_,index)=><tr key={index}><td>{index+1}</td><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/><td contentEditable suppressContentEditableWarning/></tr>)}</tbody></table></div></div>}
  </div>{updatePreparing&&<div className="update-install-overlay" role="alertdialog" aria-modal="true" aria-labelledby="update-install-title" tabIndex={-1} ref={node=>node?.focus()}><section><h2 id="update-install-title">正在准备更新</h2><p>正在保存编辑内容，随后后台替换程序文件并重新打开应用，请稍候…</p><progress aria-label="正在准备重启更新"/></section></div>}</>;
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
