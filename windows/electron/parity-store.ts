import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {ConversationContact,DraftValue,ExtensionsState,ParitySettings,SearchHistory} from '../shared/parity';
import {defaultExtensions,sanitizeExtensions} from './extensions';
import {SIDEBAR_STANDARD,SIDEBAR_MIN,SIDEBAR_MAX,clampSidebarWidth} from '../shared/layout';

export const appearanceDefaults:ParitySettings={brand:'blue',readerGradient:true,sidebarWidth:SIDEBAR_STANDARD,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'split',notificationPolling:true,autoRefresh:true,autoLoadOlder:false};
export function validateAppearance(input:unknown):ParitySettings{
  if(!input||typeof input!=='object')throw new Error('外观设置无效');const row=input as Record<string,unknown>,result={...appearanceDefaults};
  const numbers={sidebarWidth:[SIDEBAR_MIN,SIDEBAR_MAX],listWidth:[280,640],listFontSize:[14,28],authorFontSize:[80,160],boardFontSize:[13,24],rankingFontSize:[13,24],nqScale:[25,200],tqScale:[50,200]} as const;
  for(const [key,[min,max]] of Object.entries(numbers)){const raw=row[key]??appearanceDefaults[key as keyof ParitySettings],value=key==='sidebarWidth'&&typeof raw==='number'&&Number.isFinite(raw)?clampSidebarWidth(raw):raw;if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('外观尺寸无效');(result as unknown as Record<string,unknown>)[key]=value;}
  for(const key of ['readerGradient','notificationPolling','autoRefresh','autoLoadOlder'] as const){if(row[key]!==undefined&&typeof row[key]!=='boolean')throw new Error('外观开关无效');result[key]=(row[key]??appearanceDefaults[key]) as boolean;}
  if(row.brand!==undefined&&!['blue','teal','green','purple','orange','red'].includes(String(row.brand)))throw new Error('图标颜色无效');
  if(row.sendShortcut!==undefined&&!['ctrl-enter','enter','button-only'].includes(String(row.sendShortcut)))throw new Error('发送快捷键无效');
  if(row.composerMode!==undefined&&!['edit','split','preview'].includes(String(row.composerMode)))throw new Error('编辑模式无效');
  return {...result,brand:(row.brand??result.brand) as ParitySettings['brand'],sendShortcut:(row.sendShortcut??result.sendShortcut) as ParitySettings['sendShortcut'],composerMode:(row.composerMode??result.composerMode) as ParitySettings['composerMode']};
}
export function validateHistory(input:unknown):SearchHistory[]{
  if(!Array.isArray(input)||input.length>30)throw new Error('搜索历史无效');
  return input.map(row=>{if(!row||typeof row.term!=='string'||row.term.length>240||!['posts','users'].includes(row.mode)||!Array.isArray(row.categories)||row.categories.length>30||row.categories.some((item:unknown)=>typeof item!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(item)))throw new Error('搜索历史无效');return {term:row.term,mode:row.mode,categories:[...new Set<string>(row.categories)],date:typeof row.date==='string'?row.date.slice(0,40):new Date().toISOString()};});
}
export function validateDraft(input:unknown):DraftValue|null{
  if(input===null)return null;if(!input||typeof input!=='object')throw new Error('草稿无效');const row=input as Record<string,unknown>;
  if(typeof row.content!=='string'||row.content.length>200000)throw new Error('草稿正文过长');
  const result:DraftValue={content:row.content,updatedAt:new Date().toISOString()};
  for(const key of ['title','category'] as const){if(row[key]!==undefined){if(typeof row[key]!=='string'||(row[key] as string).length>(key==='title'?500:64))throw new Error('草稿参数无效');result[key]=row[key] as string;}}
  if(row.rank!==undefined){if(!Number.isInteger(row.rank)||Number(row.rank)<0||Number(row.rank)>255)throw new Error('草稿等级无效');result.rank=Number(row.rank);}
  if(row.markdown!==undefined){if(typeof row.markdown!=='boolean')throw new Error('草稿格式无效');result.markdown=row.markdown;}
  if(row.imageWidths!==undefined){if(!row.imageWidths||typeof row.imageWidths!=='object'||Object.keys(row.imageWidths).length>100)throw new Error('图片尺寸无效');result.imageWidths={};for(const [url,width] of Object.entries(row.imageWidths)){if(url.length>4096||typeof width!=='number'||!Number.isInteger(width)||width<32||width>8192)throw new Error('图片尺寸无效');result.imageWidths[url]=width;}}
  return result;
}
export class ParityStore{
  appearance={...appearanceDefaults};extensions:ExtensionsState=defaultExtensions();history:SearchHistory[]=[];
  private drafts:Record<string,Record<string,DraftValue>>=Object.create(null);private contacts:Record<string,ConversationContact[]>=Object.create(null);private queue:Promise<unknown>=Promise.resolve();
  private problem:string|undefined;
  private receiptProblem?:string;
  private receipts:Record<string,{hash:string;submittedAt:number;acceptedAt:number}>=Object.create(null);
  private pendingReceipts=new Map<string,{hash:string;submittedAt:number;acceptedAt:number}>();
  get storageWarning(){return this.problem||this.receiptProblem;}
  private assertReadable(){if(this.problem)throw new Error(this.problem);}
  constructor(private directory:string,private readonly io:Pick<typeof fs,'mkdir'|'writeFile'|'rename'|'readFile'>=fs){}
  async load(){try{const row=JSON.parse(await this.io.readFile(path.join(this.directory,'workspace-features.json'),'utf8'));if(!row||typeof row!=='object'||Array.isArray(row))throw Error('invalid workspace file');try{this.appearance=validateAppearance(row.appearance);}catch{}try{this.extensions=sanitizeExtensions(row.extensions);}catch{}try{this.history=validateHistory(row.history);}catch{}if(row.drafts&&typeof row.drafts==='object')for(const [owner,drafts] of Object.entries(row.drafts)){if(!/^[1-9]\d{0,9}$/.test(owner)||!drafts||typeof drafts!=='object')continue;const valid:Record<string,DraftValue>=Object.create(null);for(const [key,value] of Object.entries(drafts).slice(-100)){try{this.key(key);const draft=validateDraft(value);if(draft){if(value&&typeof value==='object'&&typeof (value as DraftValue).updatedAt==='string')draft.updatedAt=(value as DraftValue).updatedAt;valid[key]=draft;}}catch{}}this.drafts[owner]=valid;}if(row.contacts&&typeof row.contacts==='object')for(const [owner,contacts] of Object.entries(row.contacts)){if(!/^[1-9]\d{0,9}$/.test(owner)||!Array.isArray(contacts))continue;const seen=new Set<number>();this.contacts[owner]=contacts.flatMap(contact=>{try{const valid=this.contact(contact);if(valid.id===Number(owner)||seen.has(valid.id))return [];seen.add(valid.id);return [valid];}catch{return [];}}).slice(0,500);}this.problem=undefined;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.problem='工作区配置无法读取，原文件已保留；草稿和设置暂停保存，请修复文件后重新启动应用';}}
  private key(key:unknown):asserts key is string{if(typeof key!=='string'||!key||key.length>240||/[\x00-\x1f]/.test(key))throw new Error('草稿位置无效');}
  loadDraft(owner:number|undefined,key:string){this.assertReadable();if(this.receiptProblem)throw Error(this.receiptProblem);this.key(key);const rows=owner?this.drafts[String(owner)]:undefined,value=rows&&Object.hasOwn(rows,key)?rows[key]:undefined;return value&&!this.wasSubmitted(owner!,key,value)?structuredClone(value):null;}
  async saveDraft(owner:number|undefined,key:string,input:unknown){
    this.assertReadable();this.key(key);if(!owner)throw new Error('请确认登录账号后保存草稿');
    const draft=validateDraft(input),id=String(owner);
    const task=this.queue.catch(()=>{}).then(async()=>{
      const rows={...this.drafts[id]};if(draft)Object.defineProperty(rows,key,{value:draft,writable:true,enumerable:true,configurable:true});else delete rows[key];
      for(const stale of Object.keys(rows).slice(0,Math.max(0,Object.keys(rows).length-100)))delete rows[stale];
      const next={...this.drafts,[id]:rows};await this.persist({drafts:next});this.drafts=next;
    });this.queue=task;return task;
  }
  private contact(input:unknown):ConversationContact{if(!input||typeof input!=='object')throw new Error('私信联系人无效');const row=input as Record<string,unknown>;if(!Number.isSafeInteger(row.id)||Number(row.id)<1||Number(row.id)>9999999999||typeof row.name!=='string'||row.name.length>200||/[\x00-\x1f]/.test(row.name))throw new Error('私信联系人无效');return {id:Number(row.id),name:row.name.trim()};}
  readConversationContacts(owner:number|undefined):ConversationContact[]{this.assertReadable();return owner?structuredClone(this.contacts[String(owner)]||[]):[];}
  async rememberConversationContact(owner:number|undefined,input:unknown):Promise<ConversationContact[]>{
    this.assertReadable();if(!Number.isSafeInteger(owner)||!owner||owner<1||owner>9999999999)throw new Error('请确认登录账号后保存联系人');const candidate=this.contact(input);
    const task=this.queue.catch(()=>{}).then(async()=>{
      if(candidate.id===owner)return this.readConversationContacts(owner);
      const key=String(owner),previous=this.contacts[key]||[],contact={...candidate},known=previous.find(row=>row.id===contact.id);
      if(!contact.name&&known)contact.name=known.name;
      const rows=[contact,...previous.filter(row=>row.id!==contact.id)].slice(0,500),next={...this.contacts,[key]:rows};
      if(JSON.stringify(rows)!==JSON.stringify(previous)){await this.persist({contacts:next});this.contacts=next;}
      return this.readConversationContacts(owner);
    });this.queue=task;return task;
  }
  commitHistory(input:unknown){const next=validateHistory(input);const task=this.queue.catch(()=>{}).then(async()=>{await this.persist({history:next});this.history=next;});this.queue=task;return task;}
  async loadReceipts(){
    try{const row=JSON.parse(await this.io.readFile(path.join(this.directory,'reply-receipts.json'),'utf8'));if(row?.version!==1||!row.entries||typeof row.entries!=='object'||Array.isArray(row.entries))throw Error('invalid receipt');
      for(const [key,value] of Object.entries(row.entries) as [string,{hash:string;submittedAt:number;acceptedAt:number}][]){if(!/^[1-9]\d{0,9}:reply:[1-9]\d{0,239}$/.test(key)||!value||!/^[a-f0-9]{64}$/.test(value.hash)||!Number.isFinite(value.submittedAt)||!Number.isFinite(value.acceptedAt)||value.submittedAt>value.acceptedAt)throw Error('invalid receipt');this.receipts[key]=value;}
    }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.receiptProblem='回复回执无法读取，原文件已保留；请修复后重启，避免把已发布内容误认为未发送草稿';}
  }
  private draftHash(draft:DraftValue){return createHash('sha256').update(JSON.stringify([draft.content,Object.entries(draft.imageWidths||{}).sort(([a],[b])=>a.localeCompare(b))])).digest('hex');}
  private wasSubmitted(owner:number,key:string,draft:DraftValue){const receipt=this.receipts[owner+':'+key]||this.pendingReceipts.get(owner+':'+key);if(!receipt)return false;const edited=Date.parse(draft.updatedAt||'')||0;return edited<=receipt.submittedAt||edited<=receipt.acceptedAt&&this.draftHash(draft)===receipt.hash;}
  markReplySubmitted(owner:number,key:string,draft:DraftValue,submittedAt:number){
    this.key(key);const scope=owner+':'+key,receipt={hash:this.draftHash(draft),submittedAt,acceptedAt:Math.max(submittedAt,Date.now())};this.pendingReceipts.set(scope,receipt);
    return this.persistPendingReceipt(scope);
  }
  private persistPendingReceipt(_scope:string){const task=this.queue.catch(()=>{}).then(()=>this.flushReceipts());this.queue=task;return task;}
  private async flushReceipts(){
    if(!this.pendingReceipts.size)return;if(this.receiptProblem)throw Error(this.receiptProblem);
    const pending=new Map(this.pendingReceipts),next={...this.receipts,...Object.fromEntries(pending)},entries=Object.fromEntries(Object.entries(next).sort(([,a],[,b])=>b.acceptedAt-a.acceptedAt).filter(([scope],index)=>index<2000||Boolean(this.drafts[scope.slice(0,scope.indexOf(':'))]?.[scope.slice(scope.indexOf(':')+1)])));
    await this.io.mkdir(this.directory,{recursive:true});const target=path.join(this.directory,'reply-receipts.json');await this.io.writeFile(target+'.tmp',JSON.stringify({version:1,entries}));await this.io.rename(target+'.tmp',target);this.receipts=entries;for(const [scope,receipt]of pending)if(this.pendingReceipts.get(scope)===receipt)this.pendingReceipts.delete(scope);
  }
  async retryReplyCleanup(owner:number,key:string){this.key(key);await this.persistPendingReceipt(owner+':'+key);const draft=this.drafts[String(owner)]?.[key];if(draft&&this.wasSubmitted(owner,key,draft))await this.saveDraft(owner,key,null);}
  save(){this.queue=this.queue.catch(()=>{}).then(()=>this.persist());return this.queue;}
  commitAppearance(input:unknown){
    const next=validateAppearance(input);
    const task=this.queue.catch(()=>{}).then(async()=>{await this.persist({appearance:next});this.appearance=next;return {...next};});
    this.queue=task;return task;
  }
  commitExtensions(input:ExtensionsState){
    const next=sanitizeExtensions(input);
    const task=this.queue.catch(()=>{}).then(async()=>{await this.persist({extensions:next});this.extensions=next;return structuredClone(next);});
    this.queue=task;return task;
  }
  private async persist(overrides:{appearance?:ParitySettings;extensions?:ExtensionsState;drafts?:Record<string,Record<string,DraftValue>>;contacts?:Record<string,ConversationContact[]>;history?:SearchHistory[]}={}){
    this.assertReadable();
    await this.flushReceipts();
    const snapshot=JSON.stringify({appearance:overrides.appearance??this.appearance,extensions:overrides.extensions??this.extensions,history:overrides.history??this.history,drafts:overrides.drafts??this.drafts,contacts:overrides.contacts??this.contacts});
    await this.io.mkdir(this.directory,{recursive:true});const target=path.join(this.directory,'workspace-features.json');
    await this.io.writeFile(target+'.tmp',snapshot);await this.io.rename(target+'.tmp',target);
  }
}
