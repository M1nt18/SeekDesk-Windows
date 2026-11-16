import {useEffect,useRef} from 'react';
import type {DraftValue} from '../shared/parity';

type UpdateDraftSaver=()=>Promise<unknown>;
interface DraftRegistration {
  save:UpdateDraftSaver;
  owner:()=>number|undefined;
  isCurrent:()=>boolean;
  pending?:Promise<unknown>;
}
export interface UpdateDraftSaverOptions {
  owner?:number;
  saveOnUnmount?:boolean;
  isCurrent?:()=>boolean;
}
const savers=new Set<DraftRegistration>();
const detached=new Set<DraftRegistration>();
let flushing:Promise<void>|undefined;

function startSave(entry:DraftRegistration):Promise<unknown> {
  if(entry.pending)return entry.pending;
  const task=Promise.resolve().then(()=>entry.isCurrent()?entry.save():undefined);
  entry.pending=task;
  // Both branches handle the promise; a failed unmount save remains retryable.
  void task.then(()=>{entry.pending=undefined;detached.delete(entry);},()=>{entry.pending=undefined;});
  return task;
}

/** Keep the callback current without replacing its registration on each keystroke. */
export function useUpdateDraftSaver(saver:UpdateDraftSaver,options:UpdateDraftSaverOptions={}):void {
  const latest=useRef({saver,options});latest.current={saver,options};
  useEffect(()=>{
    const entry:DraftRegistration={save:()=>latest.current.saver(),owner:()=>latest.current.options.owner,isCurrent:()=>latest.current.options.isCurrent?.()!==false};
    savers.add(entry);
    return()=>{
      savers.delete(entry);
      const snapshot=latest.current;
      if(!snapshot.options.saveOnUnmount)return;
      entry.save=snapshot.saver;entry.owner=()=>snapshot.options.owner;entry.isCurrent=()=>snapshot.options.isCurrent?.()!==false;
      detached.add(entry);void startSave(entry);
    };
  },[]);
}

/** Concurrent install requests wait for the same set of pending local writes. */
export function flushUpdateDrafts(options?:{owner?:number}):Promise<void> {
  if(flushing)return flushing;
  const matches=(entry:DraftRegistration)=>!options||entry.owner()===undefined||entry.owner()===options.owner;
  for(const entry of detached)if(!matches(entry))detached.delete(entry);
  const seen=new Set<DraftRegistration>();
  const task=(async()=>{
    let entries=[...detached,...savers].filter(matches),failed=false;
    while(entries.length){
      for(const entry of entries)seen.add(entry);
      const results=await Promise.allSettled(entries.map(startSave));
      failed ||= results.some(result=>result.status==='rejected');
      entries=[...detached].filter(entry=>matches(entry)&&!seen.has(entry));
    }
    if(failed)throw new Error('部分草稿未能保存，请稍后重试更新');
  })().finally(()=>{if(flushing===task)flushing=undefined;});
  flushing=task;
  return task;
}

export interface UpdateDraftSnapshot {
  owner?:number;
  key:string;
  scope:string;
  ready:boolean;
  readOnly?:boolean;
  value:DraftValue;
}

/** Save only the current editable account draft, never an unloaded or sending one. */
export async function saveUpdateDraft(
  snapshot:UpdateDraftSnapshot,
  current:{scope:()=>string;busy:()=>boolean},
  save:(key:string,value:DraftValue,owner:number)=>Promise<void>,
):Promise<void> {
  if(!snapshot.owner||snapshot.readOnly)return;
  if(snapshot.scope!==current.scope())throw new Error('草稿所属账号或页面已变化，请稍后更新');
  if(current.busy())throw new Error('内容正在发送或发布，请完成后再更新');
  if(!snapshot.ready){
    if(snapshot.value.content||snapshot.value.title)throw new Error('草稿尚未读取完成，请稍后更新');
    return;
  }
  await save(snapshot.key,snapshot.value,snapshot.owner);
  if(snapshot.scope!==current.scope()||current.busy())throw new Error('草稿状态已变化，请稍后重试更新');
}
