import {useEffect,useRef,useState} from 'react';
import type {ThreadResult} from '../shared/types';
import type {UserProfileOutcome} from '../shared/profiles';

/** Author metadata stays separate from the document so arrivals never reset its scroll. */
export function useThreadProfiles(result:ThreadResult|undefined,enabled:boolean,scope:number) {
  const [snapshots,setSnapshots]=useState<{scope:number;values:Record<number,UserProfileOutcome>}>({scope,values:{}});
  const [loading,setLoading]=useState<Set<number>>(new Set());
  const [retryRevision,setRetryRevision]=useState(0);
  const retryMembers=useRef<Set<number>>(new Set());
  const relationships=useRef(new Map<number,boolean>());
  const lastScope=useRef(scope);
  useEffect(()=>{relationships.current.clear();retryMembers.current.clear();setSnapshots({scope,values:{}});},[scope]);
  useEffect(()=>{
    if(lastScope.current!==scope){lastScope.current=scope;relationships.current.clear();}
    if(!enabled||result?.source!=='web'||!window.seekdesk.readUserProfiles){setLoading(new Set());return;}
    const ids=[...new Set(result.comments.map(comment=>comment.authorId).filter((id):id is number=>Number.isSafeInteger(id)&&Number(id)>0))];
    const forced=new Set(retryMembers.current);retryMembers.current.clear();
    const queue=ids;
    let current=true,cursor=0;
    setLoading(new Set(queue));
    const worker=async()=>{
      while(current&&cursor<queue.length){
        const memberId=queue[cursor++];
        let outcome:UserProfileOutcome;
        try {outcome=(await window.seekdesk.readUserProfiles({memberIds:[memberId],force:forced.has(memberId)})).outcomes[0]||{memberId,status:'failed',reason:'invalid-response'};}
        catch {outcome={memberId,status:'failed',reason:'network'};}
        if(!current)return;
        if(outcome.memberId!==memberId)outcome={memberId,status:'failed',reason:'invalid-response'};
        const following=relationships.current.get(memberId);
        if(outcome.profile&&following!==undefined)outcome={...outcome,profile:{...outcome.profile,following}};
        setSnapshots(previous=>({scope,values:{...(previous.scope===scope?previous.values:{}),[memberId]:outcome}}));
        setLoading(previous=>{const next=new Set(previous);next.delete(memberId);return next;});
      }
    };
    void Promise.all(Array.from({length:Math.min(3,queue.length)},()=>worker()));
    return()=>{current=false;};
  },[result,enabled,scope,retryRevision]);
  const retry=(ids:number[])=>{retryMembers.current=new Set(ids);setRetryRevision(value=>value+1);};
  const updateFollowing=(memberId:number,value:boolean)=>{
    relationships.current.set(memberId,value);
    setSnapshots(previous=>{
      const outcome=previous.scope===scope?previous.values[memberId]:undefined;
      return outcome?.profile?{scope,values:{...previous.values,[memberId]:{...outcome,profile:{...outcome.profile,following:value}}}}:previous;
    });
  };
  const followingOverride=(memberId:number)=>lastScope.current===scope?relationships.current.get(memberId):undefined;
  return {profiles:snapshots.scope===scope?snapshots.values:{},loading,retry,updateFollowing,followingOverride};
}
