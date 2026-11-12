import type {ForumQueryRequest,ForumWriteRequest,Introduction,StickerItem} from '../shared/parity';
import {FORUM_ORIGIN,normalizePostUrl} from './forum';

const positive=(value:unknown,label='用户编号')=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>Number.MAX_SAFE_INTEGER)throw new Error(label+'无效');return value;};
const string=(value:unknown,max:number,label:string,empty=false)=>{if(typeof value!=='string'||value.length>max||!empty&&!value.trim())throw new Error(label+'无效');return value;};
const page=(value:unknown)=>value===undefined?1:positive(value,'页码');
const category=(value:unknown)=>{const result=string(value,64,'版块');if(!/^[a-z][a-z0-9-]{0,63}$/.test(result))throw new Error('版块无效');return result;};
const floor=(value:unknown)=>{if(typeof value!=='string'||!/^(?:0|[1-9]\d{0,8})$/.test(value))throw new Error('楼层无效');return value;};
const section=(value:unknown,allowed:string[])=>{if(!allowed.includes(String(value)))throw new Error('列表分类无效');return value;};
const introduction=(value:unknown):Introduction=>{if(!value||typeof value!=='object')throw new Error('简介内容无效');const row=value as Record<string,unknown>;return {bio:string(row.bio,20000,'简介',true),signature:string(row.signature,20000,'签名',true),readme:string(row.readme,200000,'个人自述',true)};};

/** Reconstruct a narrow request before any renderer value reaches the page. */
export function validateQueryRequest(input:unknown):ForumQueryRequest{
  if(!input||typeof input!=='object')throw new Error('读取参数无效');const row=input as Record<string,unknown>;
  switch(row.kind){
    case 'account':case 'attendance-status':case 'composer-options':case 'stickers':return {kind:row.kind};
    case 'introduction':return {kind:row.kind,...(row.memberId===undefined?{}:{memberId:positive(row.memberId)})};
    case 'notifications':return {kind:row.kind,category:section(row.category,['mentions','replies','messages']) as 'mentions'|'replies'|'messages'};
    case 'conversation':return {kind:row.kind,memberId:positive(row.memberId)};
    case 'space':return {kind:row.kind,memberId:positive(row.memberId),section:section(row.section,['topics','comments','followers','following']) as 'topics'|'comments'|'followers'|'following',page:page(row.page)};
    case 'publication-dates':{
      if(!Array.isArray(row.postIds)||row.postIds.length>4)throw new Error('发帖时间读取参数无效');
      return {kind:row.kind,postIds:[...new Set(row.postIds.map(value=>positive(value,'帖子编号')))]};
    }
    case 'directory':return {kind:row.kind,memberId:positive(row.memberId),section:section(row.section,['followers','following']) as 'followers'|'following',page:page(row.page)};
    case 'search-users':return {kind:row.kind,term:string(row.term,240,'用户名')};
    case 'search':{
      if(row.categories!==undefined&&(!Array.isArray(row.categories)||row.categories.length>30))throw new Error('搜索版块无效');
      return {kind:row.kind,term:string(row.term,240,'搜索内容'),page:page(row.page),categories:Array.isArray(row.categories)?[...new Set(row.categories.map(category))]:[]};
    }
    case 'edit-source':return {kind:row.kind,url:normalizePostUrl(row.url),floor:floor(row.floor)};
    default:throw new Error('不支持的读取操作');
  }
}
export function validateWriteRequest(input:unknown):ForumWriteRequest{
  if(!input||typeof input!=='object')throw new Error('提交参数无效');const row=input as Record<string,unknown>;
  switch(row.kind){
    case 'new-topic':{
      if(typeof row.rank!=='number'||!Number.isInteger(row.rank)||row.rank<0||row.rank>255)throw new Error('阅读等级无效');
      return {kind:row.kind,title:string(row.title,500,'标题'),content:string(row.content,200000,'正文'),category:category(row.category),rank:row.rank,confirmed:row.confirmed===true};
    }
    case 'edit':return {kind:row.kind,url:normalizePostUrl(row.url),floor:floor(row.floor),content:string(row.content,200000,'正文'),...(row.title===undefined?{}:{title:string(row.title,500,'标题')})};
    case 'profile':return {kind:row.kind,original:introduction(row.original),draft:introduction(row.draft)};
    case 'mark-read':return {kind:row.kind,category:section(row.category,['mentions','replies','messages']) as 'mentions'|'replies'|'messages',id:positive(row.id,'通知编号')};
    case 'attendance':return {kind:row.kind,mode:section(row.mode,['fixed','random']) as 'fixed'|'random'};
    default:throw new Error('不支持的提交操作');
  }
}

/** These routes are copied from upstream Forum/NewDiscussion, never API guesses. */
export function requestPage(input:ForumQueryRequest|ForumWriteRequest):string{
  if(input.kind==='composer-options'||input.kind==='new-topic')return FORUM_ORIGIN+'/new-discussion';
  if(input.kind==='edit-source'||input.kind==='edit')return normalizePostUrl(input.url);
  if(input.kind==='search')return FORUM_ORIGIN+'/search'+((input.page||1)>1?'/page-'+input.page:'')+'?q='+encodeURIComponent(input.term);
  return FORUM_ORIGIN+'/';
}

export function officialStickers():StickerItem[]{
  const groups:Record<string,string[]>={ac:[...Array.from({length:54},(_,i)=>String(i+1).padStart(2,'0')+'.png'),...Array.from({length:40},(_,i)=>String(i+1001)+'.png'),...Array.from({length:55},(_,i)=>String(i+2001)+'.png')],yct:Array.from({length:22},(_,i)=>String(i+1).padStart(3,'0')+'.gif'),xhj:Array.from({length:32},(_,i)=>String(i+1).padStart(3,'0')+([1,2,3,5,6,7,11,22,24,25,31,32].includes(i+1)?'.png':'.gif')),emoji:Array.from({length:49},(_,i)=>String(i).padStart(2,'0')+'.png')};
  return Object.entries(groups).flatMap(([group,files])=>files.map(file=>({id:group+file.replace(/\..+$/,''),name:':'+group+file.replace(/\..+$/,'')+':',group,url:FORUM_ORIGIN+'/static/image/sticker/'+group+'/'+file,official:true})));
}

const common=String.raw`
  if(location.protocol!=='https:'||!['www.nodeseek.com','nodeseek.com'].includes(location.host))throw new Error('请从 NodeSeek 官方页面操作');
  const integer=value=>value!==null&&value!==undefined&&value!==''&&Number.isSafeInteger(Number(value))?Number(value):undefined;
  const text=value=>typeof value==='string'?value:'';
  const flag=value=>value===true||value===1||value==='1';
  const self=integer(window.__config__?.user?.member_id);
  const signedIn=()=>owner?Number(window.__config__?.user?.member_id)===owner:true;
  const requireOwner=()=>{if(!owner||!self||!signedIn())throw new Error('账号会话已变化，请重新登录后操作');};
  if(!signedIn())throw new Error('账号会话已变化，请重新登录后操作');
  const options={credentials:'same-origin',redirect:'error',cache:'no-store'};
  const parse=async(response,allowNoSuccess=false)=>{
    if(response.headers.get('cf-mitigated')==='challenge')throw new Error('需要完成站点验证，请打开官方页面');
    if(response.status===401)throw new Error('登录已失效，请重新登录');
    const data=await response.json().catch(()=>null),message=text(data?.message).slice(0,500);
    if(/未登录|登录后|请登录|not logged in|unauthoriz/i.test(message))throw new Error(message||'登录已失效');
    if(!signedIn())throw new Error('账号会话已变化，请重新登录后操作');
    if(!response.ok||!data||data.success!==true&&!(allowNoSuccess&&data.success!==false))throw new Error(message||(wrote?'未收到站点确认，请刷新核实，勿重复提交':'暂时无法读取官方数据'));
    return data;
  };
  let wrote=false;
  const get=async(path,allowNoSuccess=false)=>{
    let response;try{response=await fetch(path,{...options,signal:AbortSignal.timeout(15000)});}catch{throw new Error('暂时无法连接 NodeSeek，请稍后重试');}
    return parse(response,allowNoSuccess);
  };
  const profile=detail=>{
    const id=integer(detail?.member_id);if(!id||!text(detail?.member_name))throw new Error('站点返回的用户资料无效');
    const roles=Array.isArray(detail.roles)?[...new Set(detail.roles.map(role=>text(role?.display_text)).filter(Boolean))].slice(0,4):[];
    return {id,name:text(detail.member_name),rank:integer(detail.rank),roles,avatar:location.origin+'/avatar/'+id+'.png',joined:text(detail.created_at_str||detail.created_at),bio:text(detail.bio),topics:integer(detail.nPost),replies:integer(detail.nComment),following:integer(detail.follows),followers:integer(detail.fans),coin:integer(detail.coin),...(typeof detail.followed==='boolean'?{followed:detail.followed}:{})};
  };
  const intro=detail=>({bio:text(detail.bio),signature:text(detail.signature_markdown),readme:text(detail.readme)});
  const floors=integer(window.__config__?.commmentPerPage)||10;
  const postUrl=(id,floor=0)=>location.origin+'/post-'+id+'-'+(floor>0?Math.floor((floor-1)/floors)+1:1)+(floor>0?'#'+floor:'');
  const editable=()=>{
    requireOwner();const route=/^\/post-([1-9][0-9]*)-[1-9][0-9]*\/?$/.exec(location.pathname);
    const target=Number(new URL(request.url).pathname.match(/^\/post-([1-9][0-9]*)-/)?.[1]),data=window.__config__?.postData;
    if(!route||Number(route[1])!==target||Number(data?.postId)!==target||!Array.isArray(data.comments))throw new Error('当前官方页面与编辑的帖子不一致');
    const item=data.comments.find(row=>Number(row.floorIndex)===Number(request.floor));
    if(!item||item.poster?.isMe!==true)throw new Error('只能编辑当前账号发布的内容');
    return {data,item,target};
  };
`;

export function createQueryScript(input:unknown,expectedUid?:number):string{
  const request=validateQueryRequest(input),owner=expectedUid===undefined?null:positive(expectedUid);
  return `(async()=>{const request=${JSON.stringify(request)},owner=${JSON.stringify(owner)};${common}`+String.raw`
    if(request.kind==='stickers')return {stickers:STICKERS};
    if(request.kind==='attendance-status'){requireOwner();return {attendance:{kind:'ready',date:new Date(Date.now()+8*3600000).toISOString().slice(0,10),message:'尚未在本机确认今日签到'}};}
    if(request.kind==='account'){
      requireOwner();const [data,counts]=await Promise.all([get('/api/account/getInfo/'+owner),get('/api/notification/unread-count')]);
      if(Number(data.detail?.member_id)!==owner)throw new Error('站点返回的账号不一致');
      const count=key=>Math.min(99999,Math.max(0,Math.floor(Number(counts.unreadCount?.[key])||0)));
      return {profile:profile(data.detail),unread:{mentions:count('atMe'),replies:count('reply'),messages:count('message')}};
    }
    if(request.kind==='introduction'){
      const id=request.memberId||owner;if(!id)throw new Error('请先登录');
      const data=await get('/api/account/getInfo/'+id+'?readme=1&signature=1');if(Number(data.detail?.member_id)!==id)throw new Error('用户资料编号不一致');
      return {profile:profile(data.detail),introduction:intro(data.detail)};
    }
    if(request.kind==='publication-dates'){
      const dates=await Promise.all(request.postIds.map(async id=>{
        const path='/post-'+id+'-1',controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
        try{
          const response=await fetch(path,{...options,signal:controller.signal});
          if(!signedIn())throw new Error('账号会话已变化，请重新登录后操作');
          if(!response.ok||response.headers.get('cf-mitigated')==='challenge')return null;
          const url=new URL(response.url);if(url.origin!==location.origin||url.pathname!==path||url.search||url.hash)return null;
          // An inert template reads the original post date without running its scripts or loading media.
          const template=document.createElement('template');template.innerHTML=await response.text();
          const value=template.content.querySelector('.nsk-post-wrapper .content-item[id="0"] > .nsk-content-meta-info .date-created time[datetime]')?.getAttribute('datetime'),timestamp=Date.parse(value||'');
          return Number.isFinite(timestamp)?[id,new Date(timestamp).toISOString()]:null;
        }catch{return null;}finally{clearTimeout(timer);}
      }));
      if(!signedIn())throw new Error('账号会话已变化，请重新登录后操作');
      return {publicationDates:Object.fromEntries(dates.filter(Boolean))};
    }
    if(request.kind==='notifications'){
      requireOwner();const paths={mentions:'at-me',replies:'reply-to-me',messages:'message'},data=await get('/api/notification/'+paths[request.category]+'/list');
      if(request.category==='messages'){
        if(!Array.isArray(data.msgArray))throw new Error('私信列表格式已变化');const peers=new Map();
        for(const item of data.msgArray){const sender=integer(item.sender_id),receiver=integer(item.receiver_id);if(sender!==owner&&receiver!==owner)continue;const mine=sender===owner,id=mine?receiver:sender;if(!id||id===owner)continue;
          const row={id,name:text(mine?item.receiver_name:item.sender_name),preview:text(item.content),date:text(item.created_at),unread:!mine&&!flag(item.viewed)},previous=peers.get(id),unread=row.unread||Boolean(previous?.unread);
          if(!previous||row.date>previous.date)peers.set(id,{...row,unread});else previous.unread=unread;
        }
        return {conversations:[...peers.values()].sort((a,b)=>b.date.localeCompare(a.date))};
      }
      if(!Array.isArray(data.data))throw new Error('通知列表格式已变化');
      return {notices:data.data.flatMap((item,index)=>{const id=integer(item.post_id),floor=integer(item.floor_id);if(!id||floor===undefined||floor<0)return [];return [{id:String(item.id??id+'-'+floor+'-'+index),author:text(item.commenter_name),authorId:integer(item.commenter_id),title:text(item.title),date:text(item.created_at),unread:!flag(item.viewed),postId:id,floor,url:postUrl(id,floor)}];})};
    }
    if(request.kind==='conversation'){
      requireOwner();const data=await get('/api/notification/message/with/'+request.memberId);if(!Array.isArray(data.msgArray))throw new Error('私信内容格式已变化');
      return {messages:data.msgArray.flatMap((item,index)=>{const sender=integer(item.sender_id),receiver=integer(item.receiver_id);if(!((sender===owner&&receiver===request.memberId)||(sender===request.memberId&&receiver===owner)))return [];return [{id:String(item.id??index),text:text(item.content),date:text(item.created_at),mine:sender===owner,markdown:flag(item.is_markdown),peerName:text(sender===owner?item.receiver_name:item.sender_name)}];})};
    }
    if(request.kind==='search-users'){
      requireOwner();const response=await fetch('/api/account/find/'+encodeURIComponent(request.term),{...options,signal:AbortSignal.timeout(12000)});
      if(response.headers.get('cf-mitigated')==='challenge')throw new Error('需要完成站点验证，请打开官方页面');
      const data=await response.json().catch(()=>null);if(!signedIn())throw new Error('账号会话已变化');
      if(response.status===401||/未登录|请登录|not logged in/i.test(data?.message||''))throw new Error('请先登录');
      if(/USER NOT FOUND|未找到.{0,12}用户|没有.{0,12}用户/i.test(data?.message||''))return {users:[]};
      if(!response.ok||data?.success!==true||!Array.isArray(data.memberList))throw new Error(text(data?.message)||'暂时无法搜索用户');
      return {users:data.memberList.flatMap(row=>{const id=integer(row.member_id);return id&&text(row.member_name)?[{id,name:row.member_name,avatar:location.origin+'/avatar/'+id+'.png'}]:[];})};
    }
    if(request.kind==='space'||request.kind==='directory'){
      const result={page:request.page||1,nextPage:null};
      if(['followers','following'].includes(request.section)){
        requireOwner();if(request.memberId!==owner)throw new Error('站点只开放当前账号的关注和粉丝列表');
        const data=await get('/api/fans/'+(request.section==='followers'?'fans':'follow'),true);if(!Array.isArray(data.memberList))throw new Error('用户列表格式已变化');
        return {...result,users:data.memberList.flatMap(row=>{const id=integer(row.member_id);return id&&text(row.member_name)?[{id,name:row.member_name,avatar:location.origin+'/avatar/'+id+'.png'}]:[];})};
      }
      const route=request.section==='topics'?'discussions':'comments',data=await get('/api/content/list-'+route+'?uid='+request.memberId+'&page='+result.page,true),rows=data[route];
      if(!Array.isArray(rows))throw new Error('用户动态格式已变化');
      const escape=value=>text(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
      return {...result,nextPage:rows.length>=15?result.page+1:null,activity:rows.flatMap(row=>{const id=integer(row.post_id),floor=integer(row.floor_id)||0;if(!id||floor<0)return [];return [{id:id+'-'+floor,title:text(row.title)||'查看回复',url:postUrl(id,floor),date:text(row.created_at),floor,html:escape(row.text)}];})};
    }
    if(request.kind==='composer-options'){
      requireOwner();if(location.pathname!=='/new-discussion'||!document.querySelector('#editor'))throw new Error('请等待官方发帖编辑器加载');
      for(let attempt=0;!document.querySelector('select#category')&&attempt<20;attempt++)await new Promise(resolve=>setTimeout(resolve,120));requireOwner();
      const categories=[...(document.querySelector('select#category')?.options||[])].filter(option=>!option.disabled&&/^[a-z][a-z0-9-]{0,63}$/.test(option.value)).map(option=>({id:option.value,title:option.textContent.trim()}));
      if(!categories.length)throw new Error('无法取得当前账号可发帖的版块');
      const maxRank=Math.min(254,Math.max(0,integer(window.__config__.user.rank)||0));
      return {options:{categories,ranks:[...Array.from({length:maxRank+1},(_,value)=>({value,title:value===0?'公开':'Lv.'+value+' 以上'})),{value:255,title:'私有'}],defaultCategory:document.querySelector('select#category')?.value||categories[0].id,canPost:true}};
    }
    if(request.kind==='edit-source'){
      const {data,item}=editable();if(typeof item.markdown!=='string')throw new Error('无法读取原始 Markdown，请在官方页面编辑');
      return {edit:{url:request.url,floor:request.floor,content:item.markdown,title:Number(request.floor)===0?text(data.title):undefined,rank:integer(data.rank),mode:Number(request.floor)===0?'edit-post':'edit-comment',editable:true}};
    }
    if(request.kind==='search'){
      if(!/^\/search(?:\/page-[1-9][0-9]*)?\/?$/.test(location.pathname)||new URLSearchParams(location.search).get('q')!==request.term)throw new Error('搜索页面与当前请求不一致');
      const main=document.querySelector('#nsk-body-left')||document.querySelector('#nsk-frame');if(!main)throw new Error('搜索页面尚未就绪');
      const seen=new Set(),posts=[...main.querySelectorAll('.post-list-item')].flatMap(row=>{
        const link=row.querySelector('.post-title a[href^="/post-"],a[href^="/post-"]');if(!link)return [];const url=new URL(link.href,location.href),match=/^\/post-([1-9][0-9]*)-([1-9][0-9]*)\/?$/.exec(url.pathname);if(url.origin!==location.origin||!match||seen.has(match[1]))return [];seen.add(match[1]);
        const author=row.querySelector('.info-author a,a[href^="/space/"]'),cat=row.querySelector('.post-category,a[href^="/categories/"]'),category=cat?.getAttribute('href')?.split('/').filter(Boolean).pop()||'',authorId=integer(author?.getAttribute('href')?.match(/^\/space\/([1-9][0-9]*)\/?$/)?.[1]),photo=row.querySelector('img.avatar-normal');
        return [{id:match[1],url:url.href,title:link.textContent.trim(),author:author?.textContent?.trim()||'',authorId,category,published:row.querySelector('time')?.getAttribute('datetime')||'',summary:'',featured:Boolean(link.closest('.post-title')?.querySelector('a[href="/award"] use[href="#diamonds"]')),avatar:authorId?location.origin+'/avatar/'+authorId+'.png':undefined}];
      });
      const next=[...main.querySelectorAll('a[href]')].some(link=>{try{const url=new URL(link.href,location.href),query=url.searchParams.get('q');return url.origin===location.origin&&url.pathname==='/search/page-'+((request.page||1)+1)&&(!query||query===request.term);}catch{return false;}});
      return {posts:request.categories?.length?posts.filter(row=>request.categories.includes(row.category)):posts,page:request.page||1,nextPage:next?(request.page||1)+1:null};
    }
    throw new Error('不支持的读取操作');
  })()`.replace('STICKERS',JSON.stringify(officialStickers()));
}

export function createWriteScript(input:unknown,expectedUid:number):string{
  const request=validateWriteRequest(input),owner=positive(expectedUid);
  return `(async()=>{const request=${JSON.stringify(request)},owner=${owner};${common}`+String.raw`
    requireOwner();
    const key=JSON.stringify([owner,request.kind,request.url,request.floor,request.id]),pending=window.__seekdeskPendingActions||=new Set();
    if(pending.has(key))throw new Error('操作正在提交，请勿重复点击');pending.add(key);
    const token=()=>{const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';return Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>alphabet[n%alphabet.length]).join('');};
    const post=async(path,body,csrf=false)=>{
      requireOwner();wrote=true;let response;
      try{response=await fetch(path,{...options,method:'POST',signal:AbortSignal.timeout(22000),headers:{'Content-Type':'application/json',...(csrf?{'csrf-token':token()}: {})},body:JSON.stringify(body)});}catch{throw new Error('未收到站点确认，操作可能已提交，请先刷新核实，勿重复提交；草稿已保留');}
      return parse(response);
    };
    try{
      if(request.kind==='new-topic'){
        if(location.pathname!=='/new-discussion'||!document.querySelector('#editor'))throw new Error('官方发帖页面尚未就绪');
        const option=[...(document.querySelector('select#category')?.options||[])].find(option=>option.value===request.category&&!option.disabled),maxRank=Number(window.__config__.user.rank)||0;
        if(!option||request.rank!==255&&request.rank>maxRank)throw new Error('请重新选择当前账号可发帖的版块和阅读权限');
        const data=await post('/api/content/new-discussion',{mode:'new-discussion',title:request.title,content:request.content,category:request.category,rank:request.rank},true);
        let url;try{const value=new URL(data.redirect,location.href),route=/^\/post-([1-9][0-9]*)(?:-([1-9][0-9]*))?\/?$/.exec(value.pathname);if(value.protocol==='https:'&&['www.nodeseek.com','nodeseek.com'].includes(value.host)&&!value.username&&!value.password&&route)url='https://www.nodeseek.com/post-'+route[1]+'-'+(route[2]||'1');}catch{}
        return {message:'帖子已发布',...(url?{url,postId:Number(url.match(/\/post-([0-9]+)-/)[1])}: {})};
      }
      if(request.kind==='edit'){
        const {data,item,target}=editable();const root=Number(request.floor)===0;
        if(root&&!request.title?.trim())throw new Error('帖子标题不能为空');
        const commentId=integer(item.commentId);if(!root&&(!commentId||commentId<1))throw new Error('无法确认此回复的真实编号');
        await post(root?'/api/content/edit-discussion':'/api/content/edit-comment',root?{mode:'edit-discussion',content:request.content,postId:target,title:request.title,rank:data.rank}:{mode:'edit-comment',content:request.content,commentId},true);
        return {message:root?'帖子已更新':'回复已更新',url:request.url,postId:target,floor:Number(request.floor)};
      }
      if(request.kind==='profile'){
        const read=await get('/api/account/getInfo/'+owner+'?readme=1&signature=1');if(Number(read.detail?.member_id)!==owner)throw new Error('无法确认当前账号资料');
        const latest=intro(read.detail),updates=['bio','signature','readme'].filter(field=>request.original[field]!==request.draft[field]);
        for(const field of updates)if(latest[field]!==request.original[field]&&latest[field]!==request.draft[field])throw new Error('该'+({bio:'简介',signature:'签名',readme:'个人自述'}[field])+'已在其他页面更新，请重新读取后合并修改');
        if(updates.includes('signature')&&request.draft.signature){
          if([...request.draft.signature].some(character=>character.length>1))throw new Error('NodeSeek 签名不支持扩展表情或字符');
          if(typeof window.markdownit!=='function')throw new Error('官方 Markdown 校验器尚未加载，请稍后再试');
          const rendered=new window.markdownit().render(request.draft.signature);if(/<blockquote\b|<img\b/i.test(rendered))throw new Error('NodeSeek 签名不支持图片或引用');
        }
        const next={...latest};for(const field of updates)next[field]=request.draft[field];
        if(updates.length)await post('/api/account/introduction',next);return {message:updates.length?'个人资料已保存':'没有需要保存的修改',introduction:next};
      }
      if(request.kind==='mark-read'){
        let ids=[request.id];if(request.category==='messages'){
          const data=await get('/api/notification/message/with/'+request.id);if(!Array.isArray(data.msgArray))throw new Error('无法确认私信记录');
          ids=[...new Set(data.msgArray.filter(row=>Number(row.sender_id)===request.id&&Number(row.receiver_id)===owner&&[0,'0',false].includes(row.viewed)).map(row=>integer(row.id)).filter(id=>id&&id>0))];
        }
        if(!ids.length)return {message:'消息已读'};
        const paths={mentions:['at-me','atMe'],replies:['reply-to-me','replys'],messages:['message','messages']},[path,field]=paths[request.category];
        await post('/api/notification/'+path+'/markViewed',{[field]:ids});return {message:'已标记为已读'};
      }
      if(request.kind==='attendance'){
        requireOwner();wrote=true;let response;
        try{response=await fetch('/api/attendance?random='+String(request.mode==='random'),{...options,method:'POST',signal:AbortSignal.timeout(12000),headers:{'Content-Type':'application/json'},body:'{}'});}catch{throw new Error('未收到签到结果，请刷新核实，勿重复提交');}
        if(response.headers.get('cf-mitigated')==='challenge')throw new Error('签到需要完成官方页面验证');
        const data=await response.json().catch(()=>null),message=text(data?.message),date=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
        if(response.status===401||/未登录|请登录|not logged in/i.test(message))throw new Error('请先登录后签到');requireOwner();
        if(response.ok&&data?.success===true){const gain=integer(data.gain)??integer(message.match(/(?:获得|领取|奖励)\s*[：:]?\s*(\d+)\s*(?:个|枚)?\s*鸡腿/)?.[1]),current=integer(data.current);return {message:message||'今日签到成功',attendance:{kind:'completed',gain,current,date}};}
        if(/已签到|已签过|已经签到|已经签过|已完成签到|重复签到|already.{0,24}(checked|signed)/i.test(message))return {message:message||'今日已经签到',attendance:{kind:'alreadyCompleted',date,current:integer(data?.current)}};
        throw new Error(message||'站点尚未确认签到结果，请刷新核实');
      }
      throw new Error('不支持的提交操作');
    }finally{pending.delete(key);}
  })()`;
}
