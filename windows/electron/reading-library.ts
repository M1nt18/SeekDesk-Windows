import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {Post} from '../shared/types';
import type {LibraryEntry,ReadingLibraryMutation,ReadingLibraryState} from '../shared/library';
import {READING_BOOKMARK_LIMIT,READING_HISTORY_LIMIT} from '../shared/library';
import {normalizePostUrl} from './forum';

type LibraryFileSystem=Pick<typeof fs,'mkdir'|'lstat'|'readFile'|'writeFile'|'rename'|'unlink'>;
interface LibraryOptions {fileSystem?:LibraryFileSystem;now?:()=>number}
const filename='reading-library.json';
const maxFileBytes=32*1024*1024;
const empty=():ReadingLibraryState=>({bookmarks:[],history:[]});
const validId=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d{0,14}$/.test(value);
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const code=(error:unknown)=>String((error as {code?:unknown})?.code||'');

function ownerScope(owner:number|undefined):string {
  if(owner===undefined)return 'public';
  if(!Number.isSafeInteger(owner)||owner<1||owner>9_999_999_999)throw new Error('资料库所属账号无效');
  return 'user:'+owner;
}
function text(value:unknown,label:string,max:number,required=false):string {
  if(value===undefined&&!required)return '';
  if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))throw new Error(label+'无效');
  const cleaned=value.replace(/\s+/g,' ').trim();
  if(required&&!cleaned)throw new Error(label+'无效');
  return cleaned;
}

/** Never retain page HTML, avatars, account fields or renderer-provided extras. */
export function validateLibraryPost(input:unknown):Post {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('资料库帖子无效');
  const row=input as Record<string,unknown>;
  if(!validId(row.id))throw new Error('资料库帖子编号无效');
  let url:string;
  try{url=normalizePostUrl(row.url);}catch{throw new Error('资料库仅支持 NodeSeek 官方 HTTPS 帖子链接');}
  const location=new URL(url),route=/^\/post-([1-9]\d*)-([1-9]\d*)$/.exec(location.pathname);
  if(route?.[1]!==row.id||Number(route[2])>100000)throw new Error('资料库帖子与链接不一致');
  const title=text(row.title,'帖子标题',500,true),author=text(row.author,'作者名称',200),category=text(row.category,'帖子版块',64);
  const rawPublished=text(row.published,'帖子时间',80),published=rawPublished&&Number.isFinite(Date.parse(rawPublished))?new Date(rawPublished).toISOString():'';
  return {id:row.id,url,title,author,category,published,summary:''};
}
export function validateLibraryMutation(input:unknown):ReadingLibraryMutation {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('资料库操作无效');
  const row=input as Record<string,unknown>;
  if(row.kind==='visit'||row.kind==='bookmark-add'||row.kind==='bookmark-toggle')return {kind:row.kind,post:validateLibraryPost(row.post)};
  if(row.kind==='bookmark-remove'||row.kind==='history-remove'){
    if(!validId(row.postId))throw new Error('资料库帖子编号无效');
    return {kind:row.kind,postId:row.postId};
  }
  if(row.kind==='clear-bookmarks'||row.kind==='clear-history')return {kind:row.kind};
  throw new Error('资料库操作无效');
}
function readEntry(input:unknown):LibraryEntry {
  if(!input||typeof input!=='object')throw new Error('资料库记录无效');
  const row=input as Record<string,unknown>;
  if(typeof row.visitedAt!=='string'||row.visitedAt.length>80||!Number.isFinite(Date.parse(row.visitedAt)))throw new Error('资料库记录时间无效');
  return {post:validateLibraryPost(row.post),visitedAt:new Date(row.visitedAt).toISOString()};
}
function readState(input:unknown):ReadingLibraryState {
  if(!input||typeof input!=='object')throw new Error('资料库内容无效');
  const row=input as Record<string,unknown>;
  const list=(value:unknown,limit:number):LibraryEntry[]=>{
    if(!Array.isArray(value)||value.length>limit)throw new Error('资料库记录数量无效');
    // The persisted array is authoritative MRU order even if the system clock
    // moved backwards between visits. Timestamps describe, rather than reorder it.
    const entries=value.map(readEntry),seen=new Set<string>();
    return entries.filter(entry=>{if(seen.has(entry.post.id))return false;seen.add(entry.post.id);return true;});
  };
  return {bookmarks:list(row.bookmarks,READING_BOOKMARK_LIMIT),history:list(row.history,READING_HISTORY_LIMIT)};
}

/** One process serializes local transactions. Main-process session checks remain at IPC. */
export class ReadingLibraryStore {
  private libraries=new Map<string,ReadingLibraryState>();
  private readonly io:LibraryFileSystem;
  private readonly now:()=>number;
  private readonly target:string;
  private queue:Promise<unknown>=Promise.resolve();
  private loading:Promise<void>|undefined;
  private loaded=false;
  private problem:string|undefined;
  private diskHash:string|undefined;
  constructor(private readonly directory:string,options:LibraryOptions={}) {
    if(!path.isAbsolute(directory))throw new Error('资料库保存位置无效');
    this.io=options.fileSystem||fs;this.now=options.now||Date.now;this.target=path.join(directory,filename);
  }
  load():Promise<void> {
    if(this.loading)return this.loading;
    if(this.loaded&&!this.problem)return Promise.resolve();
    const task=this.loadFile().finally(()=>{if(this.loading===task)this.loading=undefined;});
    this.loading=task;return task;
  }
  private async loadFile():Promise<void> {
    try{
      const contents=await this.readTarget();
      const next=new Map<string,ReadingLibraryState>();
      if(contents!==undefined){
        const input=JSON.parse(contents) as {version?:unknown;libraries?:unknown};
        if(input?.version!==1||!input.libraries||typeof input.libraries!=='object'||Array.isArray(input.libraries))throw new Error('invalid library');
        for(const [scope,state] of Object.entries(input.libraries)){
          if(scope!=='public'&&!/^user:[1-9]\d{0,9}$/.test(scope))throw new Error('invalid library owner');
          next.set(scope,readState(state));
        }
      }
      this.libraries=next;this.diskHash=contents===undefined?undefined:digest(contents);this.problem=undefined;
    }catch{this.problem='本地资料库无法读取，原文件已保留；请修复文件后重试或重新启动应用';}
    this.loaded=true;
  }
  read(owner:number|undefined):ReadingLibraryState {
    const key=ownerScope(owner);
    if(!this.loaded)throw new Error('本地资料库尚未就绪，请稍后重试');
    if(this.problem)throw new Error(this.problem);
    return structuredClone(this.libraries.get(key)||empty());
  }
  async mutate(owner:number|undefined,input:ReadingLibraryMutation|unknown):Promise<ReadingLibraryState> {
    const key=ownerScope(owner),request=validateLibraryMutation(input);
    await this.load();
    const task=this.queue.catch(()=>{}).then(async()=>{
      if(this.problem)throw new Error(this.problem);
      const state=structuredClone(this.libraries.get(key)||empty());
      const at=this.now();if(!Number.isFinite(at)||!Number.isFinite(new Date(at).getTime()))throw new Error('资料库记录时间无效');
      const stamp=new Date(at).toISOString();
      switch(request.kind){
        case 'visit':{
          state.history=[{post:request.post,visitedAt:stamp},...state.history.filter(entry=>entry.post.id!==request.post.id)].slice(0,READING_HISTORY_LIMIT);
          break;
        }
        case 'bookmark-add':{
          const known=state.bookmarks.some(entry=>entry.post.id===request.post.id);
          if(!known&&state.bookmarks.length>=READING_BOOKMARK_LIMIT)throw new Error('本地书签已达 500 条，请先移除一些书签');
          if(!known)state.bookmarks=[{post:request.post,visitedAt:stamp},...state.bookmarks];
          break;
        }
        case 'bookmark-toggle':{
          const known=state.bookmarks.some(entry=>entry.post.id===request.post.id);
          if(!known&&state.bookmarks.length>=READING_BOOKMARK_LIMIT)throw new Error('本地书签已达 500 条，请先移除一些书签');
          state.bookmarks=known?state.bookmarks.filter(entry=>entry.post.id!==request.post.id):[{post:request.post,visitedAt:stamp},...state.bookmarks];
          break;
        }
        case 'bookmark-remove':state.bookmarks=state.bookmarks.filter(entry=>entry.post.id!==request.postId);break;
        case 'history-remove':state.history=state.history.filter(entry=>entry.post.id!==request.postId);break;
        case 'clear-bookmarks':state.bookmarks=[];break;
        case 'clear-history':state.history=[];break;
      }
      const next=new Map(this.libraries);next.set(key,state);
      const snapshot=JSON.stringify({version:1,libraries:Object.fromEntries(next)});
      if(Buffer.byteLength(snapshot,'utf8')>maxFileBytes)throw new Error('本地资料库过大，请先清理部分记录');
      await this.persist(snapshot);
      this.libraries=next;this.diskHash=digest(snapshot);
      return structuredClone(state);
    });
    this.queue=task;return task;
  }
  private async readTarget():Promise<string|undefined> {
    let stat;try{stat=await this.io.lstat(this.target);}catch(error){if(code(error)==='ENOENT')return;throw error;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>maxFileBytes)throw new Error('invalid library file');
    return this.io.readFile(this.target,'utf8');
  }
  private async persist(snapshot:string):Promise<void> {
    const temporary=this.target+'.next-'+randomUUID();
    try{
      await this.io.mkdir(this.directory,{recursive:true});
      const previous=await this.readTarget();
      if((previous===undefined?undefined:digest(previous))!==this.diskHash)throw new Error('library changed');
      await this.io.writeFile(temporary,snapshot,{encoding:'utf8',flag:'wx'});
      await this.io.rename(temporary,this.target);
    }catch{throw new Error('本地资料库未能保存，原资料已保留；请重试，若文件已在其他位置改变请重新启动应用');}
    finally{await this.io.unlink(temporary).catch(()=>{});}
  }
}
