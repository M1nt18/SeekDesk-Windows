import { ArrowUpRight, ChevronRight, Compass, Diamond, Flame, Gift, Globe2, Image, Link, List, LoaderCircle, LockKeyhole, Mail, Monitor, Plus, Puzzle, Search, Settings2, ShieldCheck, UserPlus, UserRound } from 'lucide-react';
import type { Post } from '../../shared/types';
import type { ExtensionsState, RankingPeriod, RankingResult } from '../../shared/parity';
import { RankingRow } from '../parity-panels';
import { boards } from '../boards';
import { IconButton } from './shared-ui';

type ForumView = 'forum'|'mine'|'space'|'extensions'|'notifications'|'compose'|'ranking'|'friends';

type SidebarProps = {
  view:ForumView;
  category:string;
  searchActive:boolean;
  settingsOpen:boolean;
  sidebarGroup:'boards'|'shortcuts'|'ranking'|null;
  onSidebarGroup:(value:'boards'|'shortcuts'|'ranking'|null)=>void;
  extensions:ExtensionsState;
  rankingPeriod:RankingPeriod;
  onRankingPeriod:(value:RankingPeriod)=>void;
  rankingLoading:boolean;
  ranking:RankingResult|null;
  rankingError:string;
  onLoadRanking:(force?:boolean)=>void;
  onCompose:()=>void;
  onBoard:(id:string)=>void;
  onNavigate:(view:ForumView)=>void;
  onSearch:()=>void;
  onNotifications:()=>void;
  onOfficial:(url?:string)=>void;
  onBossKey:()=>void;
  onMedia:()=>void;
  onSettings:()=>void;
  onOpenPost:(post:Post)=>void;
};

export function Sidebar({view,category,searchActive,settingsOpen,sidebarGroup,onSidebarGroup,extensions,rankingPeriod,onRankingPeriod,rankingLoading,ranking,rankingError,onLoadRanking,onCompose,onBoard,onNavigate,onSearch,onNotifications,onOfficial,onBossKey,onMedia,onSettings,onOpenPost}:SidebarProps) {
  const toggleGroup=(group:'boards'|'shortcuts'|'ranking')=>onSidebarGroup(sidebarGroup===group?null:group);
  return <aside className="sidebar" aria-label="论坛导航">
    <button className="new-topic-button" data-testid="new-topic-button" onClick={onCompose}><Plus size={22}/>发帖</button>
    <button className={`board-link${view==='forum'&&!category&&!searchActive&&!settingsOpen?' selected':''}`} onClick={()=>onBoard('')}><Compass size={19}/><span>最新帖子</span></button>
    <div className="sidebar-scroll">
      <button className="sidebar-group-button" aria-expanded={sidebarGroup==='boards'} onClick={()=>toggleGroup('boards')}><span className="sidebar-group-label"><List size={17}/><span>论坛版块</span></span><ChevronRight className={sidebarGroup==='boards'?'rotated':''} size={15}/></button>
      {sidebarGroup==='boards'&&<nav className="board-nav" aria-label="论坛版块">{boards.slice(1).map(({id,name,icon:Icon})=><button key={id} data-category={id} className={`board-link${category===id&&view==='forum'&&!settingsOpen?' selected':''}`} onClick={()=>onBoard(id)}><Icon size={18}/><span>{name}</span>{id==='inside'&&<LockKeyhole size={12} className="board-hint"/>}</button>)}</nav>}
      <button className="sidebar-group-button" aria-expanded={sidebarGroup==='shortcuts'} onClick={()=>toggleGroup('shortcuts')}><span className="sidebar-group-label"><Gift size={17}/><span>快捷功能区</span></span><ChevronRight className={sidebarGroup==='shortcuts'?'rotated':''} size={15}/></button>
      {sidebarGroup==='shortcuts'&&<nav className="board-nav">
        <button data-category="award" className={`board-link${category==='award'&&view==='forum'?' selected':''}`} onClick={()=>onBoard('award')}><Diamond size={18}/><span>精品区</span></button>
        <button className="board-link" onClick={()=>onOfficial('https://www.nodeseek.com/ruling')}><ShieldCheck size={18}/><span>管理记录</span></button>
        <button className="board-link" onClick={()=>onOfficial('https://www.nodeseek.com/lucky')}><Gift size={18}/><span>幸运抽奖</span></button>
        <button className="board-link" onClick={()=>onOfficial('https://www.nodeseek.com/invite')}><UserPlus size={18}/><span>邀请好友</span></button>
        <button className="board-link" onClick={onSearch}><Search size={18}/><span>搜索帖子与用户</span></button>
        <button className="board-link" onClick={onNotifications}><Mail size={18}/><span>通知与私信</span></button>
        <button className="board-link" onClick={()=>onOfficial()}><Globe2 size={18}/><span>官方网页</span><ArrowUpRight size={13}/></button>
        {extensions.installed.includes('office')&&extensions.enabled.includes('office')&&<button className="board-link" onClick={onBossKey}><Monitor size={18}/><span>摸鱼老板键</span></button>}
        <button className="board-link" onClick={onMedia}><Image size={18}/><span>图床与表情库</span></button>
      </nav>}
      <button className="sidebar-group-button" aria-expanded={sidebarGroup==='ranking'} onClick={()=>toggleGroup('ranking')}><span className="sidebar-group-label"><Flame size={17}/><span>热榜</span></span><ChevronRight className={sidebarGroup==='ranking'?'rotated':''} size={15}/></button>
      {sidebarGroup==='ranking'&&<div className="sidebar-ranking">{extensions.installed.includes('hot')&&extensions.enabled.includes('hot')?<>
        <div className="ranking-period-row"><div className="segmented ranking-period">{([['realtime','实时'],['daily','日榜'],['weekly','周榜']] as const).map(([id,label])=><button key={id} className={rankingPeriod===id?'selected':''} onClick={()=>onRankingPeriod(id)}>{label}</button>)}</div><IconButton label="打开完整热榜" className="ranking-open" onClick={()=>onNavigate('ranking')}><ArrowUpRight size={17}/></IconButton></div>
        <div className="ranking-list">{rankingLoading&&!ranking?<div className="sidebar-ranking-state"><LoaderCircle size={17} className="spin"/>正在读取热榜</div>:<>{rankingError&&<div className="sidebar-ranking-state"><p>{rankingError}</p><button className="text-button" onClick={()=>onLoadRanking(true)}>重新读取</button></div>}{ranking?.items.slice(0,extensions.hotSidebarCount).map(item=><RankingRow key={item.id} item={item} showScore={extensions.hotShowScore} onClick={()=>onOpenPost({...item,published:'',summary:''})}/>)}</>}</div>
        <footer className="ranking-footer"><time dateTime={ranking?.fetchedAt}>{ranking?.fetchedAt?new Date(ranking.fetchedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—'}</time><span className="ranking-count">共 {ranking?.items.length||0} 条</span></footer>
      </>:<div className="sidebar-ranking-state"><Flame size={20}/><p>在扩展中心安装并启用 NodeSeek 热榜。</p><button className="text-button" onClick={()=>onNavigate('extensions')}>打开扩展中心</button></div>}</div>}
    </div>
    <div className="sidebar-bottom">
      <button className={`board-link${view==='friends'?' selected':''}`} onClick={()=>onNavigate('friends')}><Link size={18}/><span>友情链接</span></button>
      <button className={`board-link${view==='mine'?' selected':''}`} onClick={()=>onNavigate('mine')}><UserRound size={18}/><span>我的</span></button>
      <button className={`board-link${view==='extensions'?' selected':''}`} onClick={()=>onNavigate('extensions')}><Puzzle size={18}/><span>扩展中心</span>{extensions.unread>0&&<span className="sidebar-badge">{extensions.unread}</span>}</button>
      <button data-testid="settings-button" className={`board-link${settingsOpen?' selected':''}`} onClick={onSettings}><Settings2 size={18}/><span>设置</span></button>
    </div>
  </aside>;
}
