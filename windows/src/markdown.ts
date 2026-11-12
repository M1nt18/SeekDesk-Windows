import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

export function officialStickerUrl(code:string):string|undefined{
  const match=/^(ac|yct|xhj|emoji)(\d{2,4})$/.exec(code);if(!match)return;
  const [,group,raw]=match,n=Number(raw);
  const valid=group==='ac'?(n>=1&&n<=54||n>=1001&&n<=1040||n>=2001&&n<=2055):group==='yct'?n>=1&&n<=22:group==='xhj'?n>=1&&n<=32:n>=0&&n<=48;
  if(!valid)return;const extension=group==='yct'||group==='xhj'&&![1,2,3,5,6,7,11,22,24,25,31,32].includes(n)?'gif':'png';
  return 'https://www.nodeseek.com/static/image/sticker/'+group+'/'+raw+'.'+extension;
}
const markdown=new MarkdownIt({html:false,linkify:true,breaks:true,typographer:false});
markdown.validateLink=url=>{try{const value=new URL(url,'https://www.nodeseek.com');return ['https:','http:','mailto:'].includes(value.protocol)&&!value.username&&!value.password;}catch{return false;}};
markdown.inline.ruler.before('text','forum_sticker',(state,silent)=>{
  if(state.src.charCodeAt(state.pos)!==58)return false;const match=/^:((?:ac|yct|xhj|emoji)\d{2,4}):/.exec(state.src.slice(state.pos));if(!match)return false;
  const url=officialStickerUrl(match[1]);if(!url)return false;
  if(!silent){const token=state.push('html_inline','',0);token.content='<img class="sticker" src="'+url+'" alt="'+match[0]+'" loading="lazy">';}state.pos+=match[0].length;return true;
});
const image=markdown.renderer.rules.image!;
markdown.renderer.rules.image=(tokens,index,options,env,self)=>{
  const token=tokens[index],url=String(token.attrGet('src')||'');if(!/^https:\/\//i.test(url))return '<span>图片链接需使用 HTTPS</span>';
  token.attrSet('loading','lazy');token.attrSet('referrerpolicy','no-referrer');
  const width=Number((env as {imageWidths?:Record<string,number>}|undefined)?.imageWidths?.[url]);if(Number.isFinite(width)&&width>=32&&width<=8192)token.attrSet('style','width:'+Math.round(width)+'px;max-width:100%;height:auto');
  return image(tokens,index,options,env,self);
};
const linkOpen=markdown.renderer.rules.link_open||((tokens,index,options,_env,self)=>self.renderToken(tokens,index,options));
markdown.renderer.rules.link_open=(tokens,index,options,env,self)=>{tokens[index].attrSet('target','_blank');tokens[index].attrSet('rel','noopener noreferrer');return linkOpen(tokens,index,options,env,self);};
export function renderMarkdown(value:string,imageWidths:Record<string,number>={}):string{
  return DOMPurify.sanitize(markdown.render(value||'',{imageWidths}),{USE_PROFILES:{html:true},FORBID_TAGS:['style','form','input','iframe','object','embed'],FORBID_ATTR:['srcset'],ADD_ATTR:['target','rel','loading','referrerpolicy']});
}

export type MarkdownCommand='heading'|'bold'|'italic'|'strike'|'code'|'quote'|'bullets'|'numbers'|'codeBlock'|'table'|'divider'|'link'|'image';
export interface MarkdownEdit {text:string;start:number;end:number}
/** A single editor transaction, shared by buttons and keyboard shortcuts. */
export function applyMarkdownCommand(value:string,start:number,end:number,command:MarkdownCommand):MarkdownEdit{
  start=Math.max(0,Math.min(value.length,start));end=Math.max(start,Math.min(value.length,end));const selected=value.slice(start,end);
  let replacement='',selectionStart=0,selectionLength=0;
  const wrap=(before:string,after:string,placeholder:string)=>{replacement=before+(selected||placeholder)+after;selectionStart=before.length;selectionLength=(selected||placeholder).length;};
  const lines=(prefix:(index:number)=>string)=>{const lineStart=value.lastIndexOf('\n',Math.max(0,start-1))+1;const lineEnd=value.indexOf('\n',end);start=lineStart;end=lineEnd<0?value.length:lineEnd;replacement=value.slice(start,end).split('\n').map((row,index)=>prefix(index)+row).join('\n');selectionLength=replacement.length;};
  switch(command){
    case 'bold':wrap('**','**','加粗文字');break;case 'italic':wrap('*','*','斜体文字');break;case 'strike':wrap('~~','~~','删除线文字');break;case 'code':wrap('`','`','代码');break;
    case 'heading':lines(()=> '## ');break;case 'quote':lines(()=>'> ');break;case 'bullets':lines(()=>'- ');break;case 'numbers':lines(index=>(index+1)+'. ');break;
    case 'codeBlock':wrap('\n```\n','\n```\n','代码内容');break;
    case 'table':replacement='\n| 列一 | 列二 |\n| --- | --- |\n| 内容 | 内容 |\n';selectionStart=3;selectionLength=2;break;
    case 'divider':replacement='\n\n---\n\n';break;
    case 'link':replacement='['+(selected||'链接文字')+'](https://)';selectionStart=(selected||'链接文字').length+3;selectionLength=8;break;
    case 'image':replacement='!['+(selected||'图片说明')+'](https://)';selectionStart=(selected||'图片说明').length+4;selectionLength=8;break;
  }
  return {text:value.slice(0,start)+replacement+value.slice(end),start:start+selectionStart,end:start+selectionStart+selectionLength};
}
