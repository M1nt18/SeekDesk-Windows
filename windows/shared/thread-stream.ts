import type {Comment,ThreadResult} from './types';

const origin='https://www.nodeseek.com';
const maxPage=100000;
const validPage=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=1&&value<=maxPage;
const validCount=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const present=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

export function isThreadCommentVisible(comment:Comment,rootAuthorId:number|undefined,authorOnly:boolean,replyTarget?:string):boolean {
  return !authorOnly||comment.id==='0'||comment.isAuthor===true||Boolean(rootAuthorId&&comment.authorId===rootAuthorId)||comment.id===replyTarget;
}

export function countAddedVisibleComments(current:ThreadResult,merged:ThreadResult,authorOnly:boolean,replyTarget?:string):number {
  const previous=new Set(current.comments.filter(comment=>isThreadCommentVisible(comment,current.rootAuthorId,authorOnly,replyTarget)).map(comment=>comment.id));
  return merged.comments.filter(comment=>!previous.has(comment.id)&&isThreadCommentVisible(comment,merged.rootAuthorId,authorOnly,replyTarget)).length;
}

function postLocation(value:unknown,id:string,relative=false):{page:number;url:URL}|undefined {
  if(typeof value!=='string'||!value||value.length>4096)return;
  try {
    const url=relative?new URL(value,origin):new URL(value);
    const match=/^\/post-([1-9]\d*)-([1-9]\d*)\/?$/.exec(url.pathname),page=Number(match?.[2]);
    if(url.protocol!=='https:'||!['www.nodeseek.com','nodeseek.com'].includes(url.hostname)||url.username||url.password||url.port||match?.[1]!==id||!validPage(page))return;
    return {page,url};
  } catch {return;}
}

function assertThread(value:ThreadResult) {
  if(!value||value.source!=='web')throw new Error('仅支持追加完整官网分页，请重新读取帖子后重试');
  if(typeof value.id!=='string'||!/^[1-9]\d*$/.test(value.id)||!validPage(value.page)||postLocation(value.url,value.id)?.page!==value.page)throw new Error('帖子分页位置不一致，请刷新后重试');
  if(!Array.isArray(value.comments)||value.comments.some(comment=>!comment||typeof comment.id!=='string'||!/^(?:0|[1-9]\d*)$/.test(comment.id)||!Number.isSafeInteger(Number(comment.id))||typeof comment.html!=='string'))throw new Error('帖子分页内容无效，请刷新后重试');
}

function completeText(previous:string|undefined,incoming:string|undefined):string|undefined {
  if(!present(incoming))return previous;
  return present(previous)&&previous.length>incoming.length?previous:incoming;
}

function author(previous:string,incoming:string):string {
  if(!present(incoming))return previous;
  const generic=(value:string)=>['NodeSeek 用户','社区成员','匿名用户','用户'].includes(value.trim());
  return present(previous)&&!generic(previous)&&generic(incoming)?previous:incoming;
}

function actionLocation(comment:Comment,id:string) {
  const location=postLocation(comment.actionUrl,id,true);
  if(!location||!new RegExp('^#(?:comment-)?'+comment.id+'$').test(location.url.hash))return;
  if(comment.sourcePage!==undefined&&(!validPage(comment.sourcePage)||comment.sourcePage!==location.page))return;
  return location;
}

/** Only changed duplicate floors get new objects; unchanged DOM inputs stay stable. */
function mergeComment(previous:Comment,incoming:Comment,id:string):Comment {
  let merged=previous;
  const assign=<K extends keyof Comment>(key:K,value:Comment[K])=>{
    if(value===undefined||Object.is(value,merged[key]))return;
    if(merged===previous)merged={...previous};
    merged[key]=value;
  };
  assign('author',author(previous.author,incoming.author));
  assign('html',completeText(previous.html,incoming.html)??'');
  if(present(incoming.date)&&(!present(previous.date)||Number.isFinite(Date.parse(incoming.date))||!Number.isFinite(Date.parse(previous.date))))assign('date',incoming.date);
  if(present(incoming.floor))assign('floor',incoming.floor);
  for(const key of ['avatar','role'] as const)if(present(incoming[key]))assign(key,incoming[key]);
  for(const key of ['signature','signatureHtml'] as const)assign(key,completeText(previous[key],incoming[key]));
  if(validCount(incoming.authorId)&&incoming.authorId>0)assign('authorId',incoming.authorId);
  if(validCount(incoming.level))assign('level',incoming.level);
  for(const key of ['likes','chicken','dislikes'] as const)if(validCount(incoming[key]))assign(key,incoming[key]);
  for(const key of ['liked','gaveChicken','disliked','following'] as const)if(typeof incoming[key]==='boolean')assign(key,incoming[key]);
  // A cross-page HOT copy can omit stable identity/badge flags. Do not erase a
  // known flag while still accepting real reaction counts and false states above.
  for(const key of ['isAuthor','isOwn','isHot','isPinned'] as const)if(typeof incoming[key]==='boolean')assign(key,previous[key]===true||incoming[key]);
  const nextAction=actionLocation(incoming,id),oldAction=actionLocation(previous,id);
  if(nextAction){assign('actionUrl',incoming.actionUrl);assign('sourcePage',nextAction.page);}
  else if(!oldAction&&validPage(incoming.sourcePage))assign('sourcePage',incoming.sourcePage);
  return merged;
}

/** Append exactly the advertised next official page without duplicating OP/HOT. */
export function mergeThreadPage(current:ThreadResult,incoming:ThreadResult):ThreadResult {
  assertThread(current);assertThread(incoming);
  if(current.id!==incoming.id)throw new Error('下一页属于其他帖子，已停止追加');
  if(!validPage(current.nextPage)||incoming.page!==current.nextPage||incoming.page<=current.page)throw new Error('返回页码不是待加载的下一页，请刷新后重试');
  if(incoming.accessStatus==='private')return {...incoming,comments:[],nextPage:null};

  const comments:Comment[]=[],positions=new Map<string,number>();
  for(const comment of [...current.comments,...incoming.comments]){
    const position=positions.get(comment.id);
    if(position===undefined){positions.set(comment.id,comments.length);comments.push(comment);}
    else comments[position]=mergeComment(comments[position],comment,current.id);
  }
  const nextPage=validPage(incoming.nextPage)&&incoming.nextPage>incoming.page?incoming.nextPage:null;
  const trustedTotal=(value:unknown):value is number=>validPage(value)&&value>=incoming.page&&(nextPage===null||value>=nextPage);
  const totalPages=trustedTotal(incoming.totalPages)?incoming.totalPages:trustedTotal(current.totalPages)?current.totalPages:undefined;
  const pages=new Map<number,string>();
  for(const result of [current,incoming]){
    for(const link of result.pages||[]){
      const location=postLocation(link?.url,current.id,true);
      if(location&&validPage(link.number)&&location.page===link.number&&(totalPages===undefined||link.number<=totalPages))pages.set(link.number,origin+'/post-'+current.id+'-'+link.number);
    }
    pages.set(result.page,origin+'/post-'+current.id+'-'+result.page);
  }
  const metadata=<K extends 'title'|'notice'|'replyRestriction'|'category'>(key:K)=>present(incoming[key])?incoming[key]:current[key];
  return {...current,...incoming,url:incoming.url,page:incoming.page,source:'web',comments,nextPage,
    title:metadata('title')??'',notice:metadata('notice'),replyRestriction:metadata('replyRestriction'),category:metadata('category'),
    rootAuthorId:validCount(incoming.rootAuthorId)&&incoming.rootAuthorId>0?incoming.rootAuthorId:current.rootAuthorId,
    pages:[...pages].sort(([a],[b])=>a-b).map(([number,url])=>({number,url})),totalPages};
}
