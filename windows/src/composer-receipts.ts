import {useSyncExternalStore} from 'react';
import type {DraftValue} from '../shared/parity';

export type ComposerReceiptState='none'|'pending'|'accepted';
export interface ComposerSubmission {readonly id:number;readonly owner:number;readonly key:string;readonly startedAt:number;readonly fingerprint:string}
interface SubmissionRecord extends ComposerSubmission {state:'pending'|'accepted';snapshot:DraftValue}
interface RememberedDraft {snapshot:DraftValue;intent:number;origin:'loaded'|'edited'|'accepted'}
const submissions=new Map<number,SubmissionRecord>();
const drafts=new Map<string,RememberedDraft>();
const listeners=new Set<()=>void>();
let sequence=0;
const subscribe=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const notify=()=>{for(const listener of listeners)listener();};
const scope=(owner:number,key:string)=>owner+':'+key;
const valid=(owner:unknown,key:unknown):owner is number=>Number.isSafeInteger(owner)&&Number(owner)>0&&typeof key==='string'&&key.length>0&&key.length<=500;

function copy(snapshot:DraftValue):DraftValue {
  return {content:snapshot.content,...(snapshot.title!==undefined?{title:snapshot.title}:{}),...(snapshot.category!==undefined?{category:snapshot.category}:{}),...(snapshot.rank!==undefined?{rank:snapshot.rank}:{}),...(snapshot.markdown!==undefined?{markdown:snapshot.markdown}:{}),...(snapshot.imageWidths?{imageWidths:{...snapshot.imageWidths}}:{})};
}
function fingerprint(snapshot:DraftValue):string {
  return JSON.stringify({content:snapshot.content,title:snapshot.title??'',category:snapshot.category??'',rank:snapshot.rank??0,markdown:snapshot.markdown!==false,widths:Object.entries(snapshot.imageWidths||{}).sort(([a],[b])=>a.localeCompare(b))});
}
export function sameComposerSnapshot(a:DraftValue|null|undefined,b:DraftValue|null|undefined):boolean {return Boolean(a&&b&&fingerprint(a)===fingerprint(b));}

/** Call only for deliberate edits, never for loading or accepted-result cleanup. */
export function newComposerIntent():number {return ++sequence;}
export function editComposerDraft(owner:number,key:string,snapshot:DraftValue):number {
  const intent=newComposerIntent();
  if(valid(owner,key)){drafts.set(scope(owner,key),{snapshot:copy(snapshot),intent,origin:'edited'});notify();}
  return intent;
}

/** An in-memory edited draft wins over a delayed disk read from an older view. */
export function restoreComposerDraft(owner:number,key:string,fallback:DraftValue,options?:{authoritativeEdit?:DraftValue}):{snapshot:DraftValue;intent:number} {
  if(!valid(owner,key))return {snapshot:copy(fallback),intent:0};
  const current=drafts.get(scope(owner,key));
  if(current&&(current.origin==='edited'||current.origin==='accepted'&&!key.startsWith('edit:')))return {snapshot:copy(current.snapshot),intent:current.intent};
  if(current?.origin==='accepted'&&key.startsWith('edit:')){const restored={snapshot:copy(options?.authoritativeEdit||current.snapshot),intent:0,origin:'accepted' as const};drafts.set(scope(owner,key),restored);return {snapshot:copy(restored.snapshot),intent:0};}
  const restored={snapshot:copy(fallback),intent:0,origin:'loaded' as const};drafts.set(scope(owner,key),restored);
  return {snapshot:copy(restored.snapshot),intent:restored.intent};
}

export function composerReceiptState(owner:number|undefined,key:string,snapshot:DraftValue,intent=0):ComposerReceiptState {
  if(!valid(owner,key))return 'none';
  const value=fingerprint(snapshot);let accepted=false;
  for(const submission of submissions.values()){
    if(submission.owner!==owner||submission.key!==key||submission.fingerprint!==value)continue;
    if(submission.state==='pending')return 'pending';
    if(intent<=submission.startedAt)accepted=true;
  }
  return accepted?'accepted':'none';
}

export function useComposerReceipt(owner:number|undefined,key:string,snapshot:DraftValue,intent=0):ComposerReceiptState {
  return useSyncExternalStore(subscribe,()=>composerReceiptState(owner,key,snapshot,intent),()=> 'none');
}

export function beginComposerSubmission(owner:number,key:string,snapshot:DraftValue,intent=0):ComposerSubmission|undefined {
  if(!valid(owner,key)||composerReceiptState(owner,key,snapshot,intent)!=='none')return;
  const startedAt=++sequence,ticket=Object.freeze({id:startedAt,owner,key,startedAt,fingerprint:fingerprint(snapshot)});
  submissions.set(ticket.id,{...ticket,state:'pending',snapshot:copy(snapshot)});notify();return ticket;
}

/** Record acceptance before deciding whether the originating view still owns UI. */
export function acceptComposerSubmission(ticket:ComposerSubmission):void {
  const record=submissions.get(ticket.id);if(!record||record.state==='accepted')return;
  record.state='accepted';
  const current=drafts.get(scope(record.owner,record.key));
  if(!current||current.intent<=record.startedAt&&sameComposerSnapshot(current.snapshot,record.snapshot)){
    const snapshot=record.key.startsWith('edit:')?copy(record.snapshot):{...copy(record.snapshot),content:'',...(record.snapshot.title!==undefined?{title:''}:{}),imageWidths:{}};
    drafts.set(scope(record.owner,record.key),{snapshot,intent:0,origin:'accepted'});
  }
  notify();
}
export function rejectComposerSubmission(ticket:ComposerSubmission):void {
  const record=submissions.get(ticket.id);if(record?.state==='pending'){submissions.delete(ticket.id);notify();}
}
export function getPendingComposerSubmissionCount():number {let count=0;for(const value of submissions.values())if(value.state==='pending')count++;return count;}
