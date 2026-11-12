import fs from 'node:fs/promises';
import path from 'node:path';
import type {ConversationContact,DraftValue,ExtensionsState,ParitySettings,SearchHistory} from '../shared/parity';
import {defaultExtensions,sanitizeExtensions} from './extensions';

export const appearanceDefaults:ParitySettings={brand:'blue',readerGradient:true,sidebarWidth:250,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'split',notificationPolling:true,autoRefresh:true,autoLoadOlder:false};
export function validateAppearance(input:unknown):ParitySettings{
  if(!input||typeof input!=='object')throw new Error('外观设置无效');const row=input as Record<string,unknown>,result={...appearanceDefaults};
  const numbers={sidebarWidth:[190,390],listWidth:[280,640],listFontSize:[14,28],authorFontSize:[80,160],boardFontSize:[13,24],rankingFontSize:[13,24],nqScale:[25,200],tqScale:[50,200]} as const;
  for(const [key,[min,max]] of Object.entries(numbers)){const value=row[key]??appearanceDefaults[key as keyof ParitySettings];if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw new Error('外观尺寸无效');(result as unknown as Record<string,unknown>)[key]=value;}
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
  constructor(private directory:string){}
  async load(){try{const row=JSON.parse(await fs.readFile(path.join(this.directory,'workspace-features.json'),'utf8'));try{this.appearance=validateAppearance(row.appearance);}catch{}try{this.extensions=sanitizeExtensions(row.extensions);}catch{}try{this.history=validateHistory(row.history);}catch{}if(row.drafts&&typeof row.drafts==='object')for(const [owner,drafts] of Object.entries(row.drafts)){if(!/^[1-9]\d{0,9}$/.test(owner)||!drafts||typeof drafts!=='object')continue;const valid:Record<string,DraftValue>=Object.create(null);for(const [key,value] of Object.entries(drafts).slice(-100)){try{this.key(key);const draft=validateDraft(value);if(draft)valid[key]=draft;}catch{}}this.drafts[owner]=valid;}if(row.contacts&&typeof row.contacts==='object')for(const [owner,contacts] of Object.entries(row.contacts)){if(!/^[1-9]\d{0,9}$/.test(owner)||!Array.isArray(contacts))continue;const seen=new Set<number>();this.contacts[owner]=contacts.flatMap(contact=>{try{const valid=this.contact(contact);if(valid.id===Number(owner)||seen.has(valid.id))return [];seen.add(valid.id);return [valid];}catch{return [];}}).slice(0,500);}}catch{}}
  private key(key:unknown):asserts key is string{if(typeof key!=='string'||!key||key.length>240||/[\x00-\x1f]/.test(key))throw new Error('草稿位置无效');}
  loadDraft(owner:number|undefined,key:string){this.key(key);const rows=owner?this.drafts[String(owner)]:undefined;return rows&&Object.hasOwn(rows,key)?structuredClone(rows[key]):null;}
  async saveDraft(owner:number|undefined,key:string,input:unknown){this.key(key);if(!owner)throw new Error('请确认登录账号后保存草稿');const draft=validateDraft(input),id=String(owner);this.drafts[id]??=Object.create(null);if(draft)Object.defineProperty(this.drafts[id],key,{value:draft,writable:true,enumerable:true,configurable:true});else delete this.drafts[id][key];const keys=Object.keys(this.drafts[id]);for(const stale of keys.slice(0,Math.max(0,keys.length-100)))delete this.drafts[id][stale];await this.save();}
  private contact(input:unknown):ConversationContact{if(!input||typeof input!=='object')throw new Error('私信联系人无效');const row=input as Record<string,unknown>;if(!Number.isSafeInteger(row.id)||Number(row.id)<1||Number(row.id)>9999999999||typeof row.name!=='string'||row.name.length>200||/[\x00-\x1f]/.test(row.name))throw new Error('私信联系人无效');return {id:Number(row.id),name:row.name.trim()};}
  readConversationContacts(owner:number|undefined):ConversationContact[]{return owner?structuredClone(this.contacts[String(owner)]||[]):[];}
  async rememberConversationContact(owner:number|undefined,input:unknown):Promise<ConversationContact[]>{if(!Number.isSafeInteger(owner)||!owner||owner<1||owner>9999999999)throw new Error('请确认登录账号后保存联系人');const contact=this.contact(input);if(contact.id===owner)return this.readConversationContacts(owner);const key=String(owner),previous=this.contacts[key]||[],known=previous.find(row=>row.id===contact.id);if(!contact.name&&known)contact.name=known.name;const next=[contact,...previous.filter(row=>row.id!==contact.id)].slice(0,500);if(JSON.stringify(next)!==JSON.stringify(previous)){this.contacts[key]=next;await this.save();}return this.readConversationContacts(owner);}
  save(){const snapshot=JSON.stringify({appearance:this.appearance,extensions:this.extensions,history:this.history,drafts:this.drafts,contacts:this.contacts});this.queue=this.queue.catch(()=>{}).then(async()=>{await fs.mkdir(this.directory,{recursive:true});const target=path.join(this.directory,'workspace-features.json');await fs.writeFile(target+'.tmp',snapshot);await fs.rename(target+'.tmp',target);});return this.queue;}
}
