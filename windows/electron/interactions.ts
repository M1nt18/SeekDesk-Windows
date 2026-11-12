import type {ForumActionRequest} from '../shared/types';
import {normalizePostUrl} from './forum';

const MAX_CONTENT=20_000;
function member(value:unknown): number {
  if(typeof value!=='number' || !Number.isSafeInteger(value) || value<=0) throw new Error('用户编号无效');
  return value;
}
function content(value:unknown): string {
  if(typeof value!=='string' || !value.trim() || value.length>MAX_CONTENT) throw new Error('内容不能为空，且最多 20,000 个字符');
  return value;
}

/** Strip renderer-supplied extras before interpolating a request into page JS. */
export function validateActionRequest(input:unknown): ForumActionRequest {
  if(!input || typeof input!=='object') throw new Error('操作参数无效');
  const value=input as Record<string,unknown>;
  switch(value.kind) {
    case 'reply': return {kind:'reply',url:normalizePostUrl(value.url),content:content(value.content)};
    case 'message': return {kind:'message',memberId:member(value.memberId),content:content(value.content)};
    case 'follow':
      if(typeof value.follow!=='boolean') throw new Error('关注操作参数无效');
      return {kind:'follow',memberId:member(value.memberId),follow:value.follow};
    case 'react': {
      if(typeof value.commentId!=='string' || !/^(?:0|[1-9]\d{0,8})$/.test(value.commentId) || !['like','chicken','dislike'].includes(String(value.reaction)) ||
        value.approval!==undefined && !['quote','free','paid'].includes(String(value.approval))) throw new Error('楼层互动参数无效');
      return {kind:'react',url:normalizePostUrl(value.url),commentId:value.commentId,reaction:value.reaction as 'like'|'chicken'|'dislike',
        ...(value.approval!==undefined?{approval:value.approval as 'quote'|'free'|'paid'}:{})};
    }
    default: throw new Error('不支持的论坛操作');
  }
}

/**
 * Runs only in an authenticated, official, same-origin page. No cookies or
 * passwords leave Chromium. Request routes/body semantics follow the upstream
 * ForumThread/ForumReaction/ForumAccountData and the official public profile JS.
 */
export function createActionScript(input:unknown,expectedAccountId:number): string {
  const request=validateActionRequest(input);
  const owner=member(expectedAccountId);
  return `(async()=>{const request=${JSON.stringify(request)},owner=${owner};`+String.raw`
    const signedIn=()=>Number(window.__config__?.user?.member_id)===owner;
    if(location.protocol!=='https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) throw new Error('请从官方页面完成操作');
    if(!signedIn()) throw new Error('账号会话已变化，请重新登录后再操作');
    const tokenKey=JSON.stringify([owner,request.kind,request.url,request.commentId,request.memberId]);
    const pending=window.__seekdeskPendingActions ||= new Set();
    if(pending.has(tokenKey)) throw new Error('操作正在提交，请勿重复点击');
    pending.add(tokenKey);
    let wrote=false;
    const options={credentials:'same-origin',redirect:'error',cache:'no-store'};
    const integer=value=>value!=null && value!=='' && Number.isSafeInteger(Number(value))?Number(value):undefined;
    const checkResponse=async response=>{
      if(response.headers.get('cf-mitigated')==='challenge') throw new Error('需要完成站点验证，请打开官方页面');
      if(response.status===401) throw new Error('登录已失效，请重新登录');
      const data=await response.json().catch(()=>null);
      const message=typeof data?.message==='string'?data.message.slice(0,500):'';
      if(/未登录|登录后|请登录|not logged in|unauthoriz/i.test(message)) throw new Error(message || '登录已失效');
      if(!response.ok || data?.success!==true) throw new Error(message || (data?.success===false?'站点拒绝了本次操作':wrote?'站点未确认操作结果，请刷新核实，勿重复提交':'暂时无法读取操作状态'));
      if(!signedIn()) throw new Error('账号会话已变化，操作结果请在原页面核实');
      return data;
    };
    const post=async(path,body,headers={})=>{
      if(!signedIn()) throw new Error('账号会话已变化，请重新登录后再操作');
      wrote=true;
      let response;
      try {response=await fetch(path,{...options,method:'POST',signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});}
      catch {throw new Error('未收到站点确认，操作可能已提交，请先刷新核实，勿重复提交');}
      return checkResponse(response);
    };
    try {
      if(request.kind==='follow') {
        if(request.memberId===owner) throw new Error('不能关注自己');
        await post(request.follow?'/api/fans/add':'/api/fans/del',{followed_member_id:request.memberId});
        return {message:request.follow?'已关注该用户':'已取消关注'};
      }
      if(request.kind==='message') {
        if(request.memberId===owner) throw new Error('不能给自己发送私信');
        await post('/api/notification/message/send',{receiverUid:request.memberId,content:request.content,markdown:true});
        return {message:'私信已发送'};
      }
      const target=new URL(request.url),route=new RegExp('^/post-([1-9][0-9]*)-[1-9][0-9]*/?$').exec(location.pathname);
      const targetId=Number(target.pathname.match(new RegExp('^/post-([1-9][0-9]*)-'))?.[1]);
      if(!route || Number(route[1])!==targetId || !document.querySelector('.nsk-post-wrapper .post-title-link')) throw new Error('当前页面与操作的帖子不一致，请刷新后重试');
      if(request.kind==='reply') {
        const title=document.querySelector('.nsk-post-wrapper .post-title-link')?.closest('h1');
        if([...title?.querySelectorAll('span')||[]].some(node=>/^(只读|已锁定|禁止回复)$/.test(node.textContent.trim()))) throw new Error('此帖已限制回复');
        const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const token=Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>alphabet[v%alphabet.length]).join('');
        const data=await post('/api/content/new-comment',{postId:targetId,content:request.content,mode:'new-comment'},{'csrf-token':token});
        const floorFrom=value=>typeof value==='string'?value.match(/^(?:#)?(?:comment-)?([1-9][0-9]{0,8})$/)?.[1]:undefined;
        const returnedFloor=floorFrom(data.redirectHash);
        let destination;
        if(typeof data.redirect==='string'&&data.redirect.length<=4096){
          try{
            const url=new URL(data.redirect,location.origin),match=url.pathname.match(/^\/post-([1-9][0-9]*)-([1-9][0-9]*)\/?$/),page=Number(match?.[2]);
            if(url.protocol==='https:'&&['www.nodeseek.com','nodeseek.com'].includes(url.hostname)&&!url.username&&!url.password&&!url.port&&Number(match?.[1])===targetId&&Number.isSafeInteger(page)&&page<=100000){
              const floor=floorFrom(url.hash)||returnedFloor;
              destination={url:location.origin+'/post-'+targetId+'-'+page+(floor?'#'+floor:''),page,...(floor?{floor}:{})};
            }
          }catch{}
        }
        if(!destination&&returnedFloor){
          const configuredSize=integer(window.__config__?.commmentPerPage),size=configuredSize&&configuredSize>0&&configuredSize<=1000?configuredSize:10,page=Math.floor((Number(returnedFloor)-1)/size)+1;
          if(page<=100000)destination={url:location.origin+'/post-'+targetId+'-'+page+'#'+returnedFloor,page,floor:returnedFloor};
        }
        return {message:'回复已发布',...(destination?{destination}:{})};
      }
      const postData=window.__config__?.postData;
      const row=Number(postData?.postId)===targetId && Array.isArray(postData.comments)?postData.comments.find(item=>Number(item.floorIndex)===Number(request.commentId)):null;
      const commentId=integer(row?.commentId);
      if(!commentId || commentId<=0) throw new Error('无法确认该楼层的真实评论编号，请刷新后重试');
      const names={like:['upvote','upvoted','upvoteCount'],chicken:['like','liked','likeCount'],dislike:['dislike','disliked','dislikeCount']};
      const [kind,flag,counter]=names[request.reaction];
      if([true,1,'1'].includes(row[flag])) return {message:'已经完成过此项互动',count:integer(row[counter])};
      if(request.reaction==='dislike' && request.approval!=='paid') return {message:'点踩将消耗你 2 个鸡腿，并扣除对方 1 个；提交后不可撤回。',confirmation:'paid'};
      if(request.reaction==='chicken' && request.approval!=='paid') {
        let response;
        try {response=await fetch('/api/progress/today?scope=freelike',{...options,signal:AbortSignal.timeout(12000)});} catch {throw new Error('暂时无法核对免费鸡腿额度，请稍后重试');}
        if(response.headers.get('cf-mitigated')==='challenge') throw new Error('需要完成站点验证，请打开官方页面');
        if(response.status===401) throw new Error('登录已失效，请重新登录');
        const quota=await response.json().catch(()=>null),limit=integer(quota?.maxFreeLike),used=integer(quota?.freeLikeUsed);
        if(!signedIn()) throw new Error('账号会话已变化，请重新登录后再操作');
        if(!response.ok || limit===undefined || used===undefined) throw new Error('暂时无法核对免费鸡腿额度，请稍后重试');
        const free=limit>used;
        if(request.approval!=='free' || !free) return {message:free?'本次可使用免费鸡腿额度，确认送出？':'免费额度已用完，本次会消耗你 1 个鸡腿，确认送出？',confirmation:free?'free':'paid'};
      }
      const data=await post('/api/statistics/'+kind,{commentId,action:'add'});
      return {message:request.reaction==='like'?'已点赞':request.reaction==='chicken'?'已送出鸡腿':'已点踩',count:integer(data.current),coin:integer(data.coin)};
    } finally {pending.delete(tokenKey);}
  })()`;
}
