import type { Dispatch, FormEvent, RefObject, SetStateAction } from 'react';
import { BookOpen, ChevronDown, CircleAlert, Compass, LoaderCircle, RefreshCw, Search, X } from 'lucide-react';
import type { ListingResult, Post } from '../../shared/types';
import type { PostRowContextMenu } from './PostRow';
import { PostRow } from './PostRow';
import { IconButton } from './shared-ui';

type PostListPanelProps = {
  compact:boolean;
  title:string;
  listing:ListingResult|null;
  listingLoading:boolean;
  listingError:string;
  order:'postTime'|'replyTime';
  onOrder:(order:'postTime'|'replyTime')=>void;
  searching:boolean;
  onExitSearch:()=>void;
  query:string;
  onQuery:(value:string)=>void;
  searchRef:RefObject<HTMLInputElement|null>;
  onFilter:(event:FormEvent)=>void;
  onRefresh:()=>void;
  onLoadOlder:()=>void;
  loadingOlder:boolean;
  autoLoadOlder:boolean;
  posts:Post[];
  activeId:string|null;
  selectedIndex:number;
  onSelectedIndex:Dispatch<SetStateAction<number>>;
  isBlocked:(id?:number,name?:string)=>boolean;
  onOpenPost:(post:Post,background?:boolean)=>void;
  onContextMenu:Dispatch<SetStateAction<PostRowContextMenu|null>>;
  onOpenOfficial:()=>void;
};

export function PostListPanel({compact,title,listing,listingLoading,listingError,order,onOrder,searching,onExitSearch,query,onQuery,searchRef,onFilter,onRefresh,onLoadOlder,loadingOlder,autoLoadOlder,posts,activeId,selectedIndex,onSelectedIndex,isBlocked,onOpenPost,onContextMenu,onOpenOfficial}:PostListPanelProps) {
  return <section className={`post-list-panel${compact?' compact':''}`} aria-label="帖子列表">
    <div className="list-heading"><h1><Compass size={20}/>{title}</h1><IconButton label="刷新帖子列表" disabled={listingLoading} onClick={onRefresh}><RefreshCw size={18} className={listingLoading?'spin':''}/></IconButton></div>
    <div className="list-toolbar">
      <div className="segmented"><button className={order==='postTime'?'selected':''} onClick={()=>onOrder('postTime')}>最新帖子</button><button className={order==='replyTime'?'selected':''} onClick={()=>onOrder('replyTime')}>最新回复</button></div>
      {searching&&<IconButton label="退出搜索" onClick={onExitSearch}><X size={17}/></IconButton>}
    </div>
    <form className="list-filter" onSubmit={onFilter}><Search size={15}/><input ref={searchRef} aria-label="筛选当前列表" value={query} onChange={event=>onQuery(event.target.value)} placeholder="筛选当前列表…"/>{query&&<IconButton label="清空筛选" onClick={()=>onQuery('')}><X size={14}/></IconButton>}</form>
    {listing?.notice&&<div className="list-notice"><CircleAlert size={14}/><span>{listing.notice}</span></div>}
    <div className="list-scroll" aria-busy={listingLoading} onScroll={event=>{if(autoLoadOlder&&event.currentTarget.scrollHeight-event.currentTarget.scrollTop-event.currentTarget.clientHeight<90)onLoadOlder();}}>
      {listingError?<div data-testid="list-error" className="list-error" role="alert"><CircleAlert size={24}/><strong>暂时无法读取列表</strong><p>{listingError}</p><button className="secondary-button" onClick={onRefresh}>重新读取</button><button className="text-button" onClick={onOpenOfficial}>打开官方页面</button></div>:<>
        {listingLoading&&!listing&&Array.from({length:8},(_,index)=><div className="skeleton-row" key={index}><span className="skeleton skeleton-title"/><span className="skeleton skeleton-meta"/></div>)}
        {!listingLoading&&!posts.length&&<div className="list-empty"><BookOpen size={25}/><p>{query?'没有匹配的帖子':'暂时没有可显示的帖子'}</p></div>}
        {posts.map((post,index)=><PostRow key={post.id} post={post} index={index} selected={activeId===post.id} keyboardSelected={selectedIndex===index} blocked={isBlocked(post.authorId,post.author)} onOpen={onOpenPost} onSelect={onSelectedIndex} onContextMenu={onContextMenu}/>)}
        {listing?.nextPage&&<button className="load-older" disabled={loadingOlder} onClick={onLoadOlder}>{loadingOlder?<LoaderCircle size={16} className="spin"/>:<ChevronDown size={16}/>}加载更早的帖子</button>}
      </>}
    </div>
    <footer className="list-footer"><span>{posts.length} 篇帖子 · <span data-testid="list-source" className={`source-label ${listing?.source||''}`}>{listing?.source==='rss'?'公开 RSS':'官方页面'}</span></span><time>{listing?new Date(listing.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''}</time></footer>
  </section>;
}
