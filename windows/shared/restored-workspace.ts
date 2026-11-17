import type {SavedWorkspace} from './types';

/** Saved locations do not prove the current session can still read their metadata. */
export function restoredWorkspace(workspace:SavedWorkspace):SavedWorkspace {
  return {
    tabs:workspace.tabs.map(post=>({id:post.id,url:post.url,title:`帖子 #${post.id}`,author:'',category:'',published:'',summary:''})),
    activeId:workspace.activeId,
    overviewOpen:workspace.overviewOpen,
    listHidden:workspace.listHidden,
    scrollPositions:{...workspace.scrollPositions},
    readingAnchors:structuredClone(workspace.readingAnchors||{}),
  };
}
