import {useSyncExternalStore} from 'react';

let count=0;
const listeners=new Set<()=>void>();
const notify=()=>{for(const listener of listeners)listener();};
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};

/** The counter is synchronous so two events cannot submit between React renders. */
export function beginComposerUpload():()=>void {
  count++;notify();let finished=false;
  return ()=>{if(finished)return;finished=true;count--;notify();};
}

export function getComposerUploadCount():number {return count;}
export function useComposerUploads():boolean {return useSyncExternalStore(subscribe,getComposerUploadCount,getComposerUploadCount)>0;}
