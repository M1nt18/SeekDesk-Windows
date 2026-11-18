import { ArrowLeft, BookOpen, FileText, Globe2, List, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import type { OfficialViewState, Post } from '../../shared/types';
import { IconButton } from './shared-ui';
import type { PostRowContextMenu } from './PostRow';

type TabBarProps = {
  tabs:Post[];
  activeId:string|null;
  fullPage:boolean;
  overviewOpen:boolean;
  effectiveListHidden:boolean;
  official:OfficialViewState;
  draggedTab:{current:string|null};
  onOverview:()=>void;
  onSelectOverview:()=>void;
  onCloseOverview:()=>void;
  onToggleList:()=>void;
  onSelectTab:(id:string)=>void;
  onCloseTab:(id:string)=>void;
  onCloseAll:()=>void;
  onReorder:(source:string,destination:string)=>void;
  onContextMenu:(menu:PostRowContextMenu)=>void;
  onOpenTabList:(id:string)=>void;
};

export function TabBar({tabs,activeId,fullPage,overviewOpen,effectiveListHidden,official,draggedTab,onOverview,onSelectOverview,onCloseOverview,onToggleList,onSelectTab,onCloseTab,onCloseAll,onReorder,onContextMenu,onOpenTabList}:TabBarProps) {
  return <div className="tab-bar">
    <button className="tab-utility" aria-label="返回总览" onClick={onOverview}><ArrowLeft size={16}/><span>返回总览</span></button>
    <button className="tab-utility list-toggle" aria-label={effectiveListHidden?'展开列表':'收起列表'} aria-expanded={!effectiveListHidden} onClick={onToggleList}>{effectiveListHidden?<PanelLeftOpen size={17}/>:<PanelLeftClose size={17}/>}<span>{effectiveListHidden?'展开列表':'收起列表'}</span></button>
    <div className="tabs" role="tablist" aria-label="已打开的帖子">
      {overviewOpen&&<div className={`overview-tab-wrap${!activeId&&!fullPage?' current':''}`}>
        <button role="tab" aria-label="阅读总览" aria-selected={!activeId&&!fullPage} className="overview-tab" onClick={onSelectOverview}><BookOpen size={16}/><span>阅读总览</span></button>
        <IconButton label="关闭阅读总览" onClick={onCloseOverview}><X size={14}/></IconButton>
      </div>}
      {tabs.map(tab=><div key={tab.id} draggable
        onDragStart={event=>{draggedTab.current=tab.id;event.dataTransfer.effectAllowed='move';}}
        onDragEnd={()=>{draggedTab.current=null;}}
        onDragOver={event=>event.preventDefault()}
        onDrop={event=>{event.preventDefault();const source=draggedTab.current;if(source&&source!==tab.id)onReorder(source,tab.id);draggedTab.current=null;}}
        data-tab-id={tab.id}
        onContextMenu={event=>{event.preventDefault();const rect=event.currentTarget.getBoundingClientRect();onContextMenu({post:tab,tab:true,x:Math.min(event.clientX||rect.left,window.innerWidth-230),y:Math.min(event.clientY||rect.bottom,window.innerHeight-190)});}}
        className={`reading-tab${activeId===tab.id&&!fullPage?' current':''}`}>
        <button role="tab" aria-selected={activeId===tab.id&&!fullPage} title={tab.title} onClick={()=>onSelectTab(tab.id)}><FileText size={15}/><span>{tab.title}</span></button>
        <IconButton label={`关闭标签：${tab.title}`} onClick={()=>onCloseTab(tab.id)}><X size={14}/></IconButton>
      </div>)}
      {official.visible&&<span className="official-tab current"><Globe2 size={16}/>{official.purpose==='calculator'?'剩余价值计算器':official.purpose==='login'?'官方网页登录':'官方网页'}</span>}
    </div>
    {tabs.length>0&&<>
      <IconButton label="关闭全部帖子标签" onClick={onCloseAll}><X size={17}/></IconButton>
      <details className="tab-menu"><summary title="已打开的帖子" aria-label="已打开的帖子"><List size={18}/></summary><div className="user-menu-items" onClick={event=>{if((event.target as HTMLElement).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}>{tabs.map(tab=><button key={tab.id} onClick={()=>onOpenTabList(tab.id)}>{tab.title}</button>)}</div></details>
    </>}
  </div>;
}
