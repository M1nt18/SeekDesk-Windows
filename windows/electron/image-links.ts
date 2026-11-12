import MarkdownIt from 'markdown-it';

const parser=new MarkdownIt({html:true});
// Keep source maps for reference definitions; rendering does not need these tokens.
parser.core.ruler.disable('strip_references',true);
export interface ImageLink {url:string;start:number;end:number;angle:boolean}
interface ReferenceUse {start:number;end:number;title:string}
interface FoundLink extends ImageLink {format:'markdown'|'html'|'reference';quote?:string;uses?:ReferenceUse[]}
interface Reference {href:string;title:string}
interface Span {start:number;end:number;html:boolean}
const whitespace=(text:string,index:number)=>/[\t\n\r ]/.test(text[index]||'x');
const decodeEntities=(text:string)=>text.replace(/&(?:#[xX][\da-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]+);/g,entity=>parser.utils.unescapeAll(entity));
function destination(source:string,start:number,max:number) {
  const parsed=parser.helpers.parseLinkDestination(source,start,max);if(!parsed.ok)return;
  const angle=source[start]==='<';
  return {url:parser.normalizeLink(parsed.str),start:start+(angle?1:0),end:parsed.pos-(angle?1:0),angle,after:parsed.pos};
}
function htmlImage(source:string,start:number):{link?:FoundLink;after:number}|undefined {
  const tag=/^<([a-zA-Z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(source.slice(start));if(!tag)return;
  const after=start+tag[0].length;if(tag[1].toLowerCase()!=='img')return {after};
  const attribute=/(?:\s)src\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(tag[0]);if(!attribute)return {after};
  const value=attribute[1]??attribute[2]??attribute[3],quote=attribute[1]!==undefined?'"':attribute[2]!==undefined?"'":'';
  const local=attribute.index+attribute[0].length-value.length-(quote?1:0),url=parser.normalizeLink(decodeEntities(value));
  return {after,link:{url,start:start+local,end:start+local+value.length,angle:false,format:'html',quote}};
}
function scanDetailed(markdown:string):FoundLink[] {
  if(typeof markdown!=='string'||!markdown)return [];
  const env:{references?:Record<string,Reference>}={},tokens=parser.parse(markdown,env),lineStarts=[0];
  for(let i=0;i<markdown.length;i++)if(markdown[i]==='\n')lineStarts.push(i+1);
  const spans:Span[]=[],scopes:{start:number;end:number}[]=[],definitions=new Map<string,FoundLink>();
  for(const token of tokens){
    if(!token.map)continue;const start=lineStarts[token.map[0]]??markdown.length,end=lineStarts[token.map[1]]??markdown.length;
    if(['fence','code_block','html_block'].includes(token.type))spans.push({start,end,html:token.type==='html_block'});
    if(token.type==='inline'||token.type==='table_open')scopes.push({start,end});
    if(token.type==='reference_definition'&&typeof token.meta?.label==='string'){
      const opening=markdown.indexOf('[',start);if(opening<start||opening>=end)continue;
      const state=new parser.inline.State(markdown,parser,env,[]);state.posMax=end;
      const closing=parser.helpers.parseLinkLabel(state,opening);if(closing<0||markdown[closing+1]!==':')continue;
      let offset=closing+2;while(offset<end&&whitespace(markdown,offset))offset++;
      const value=destination(markdown,offset,end),label=token.meta.label;
      if(value&&!definitions.has(label))definitions.set(label,{url:value.url,start:value.start,end:value.end,angle:value.angle,format:'reference',uses:[]});
    }
  }
  spans.sort((a,b)=>a.start-b.start||b.end-a.end);
  scopes.sort((a,b)=>a.start-b.start||a.end-b.end);
  const found:FoundLink[]=[];let spanIndex=0,scopeIndex=0;
  const state=new parser.inline.State(markdown,parser,env,[]);
  for(let index=0;index<markdown.length;){
    while(spanIndex<spans.length&&spans[spanIndex].end<=index)spanIndex++;
    const span=spans[spanIndex],inside=span&&span.start<=index&&index<span.end;
    if(inside&&!span.html){index=span.end;continue;}
    if(markdown.startsWith('<!--',index)){const close=markdown.indexOf('-->',index+4);index=close<0?markdown.length:close+3;continue;}
    if(markdown[index]==='<'){
      const opening=/^<(script|style|pre|code|textarea)\b/i.exec(markdown.slice(index));
      if(opening){const close=new RegExp('</'+opening[1]+'\\s*>','ig');close.lastIndex=index+opening[0].length;const end=close.exec(markdown);index=end?end.index+end[0].length:markdown.length;continue;}
      const html=htmlImage(markdown,index);if(html){if(html.link)found.push(html.link);index=html.after;continue;}
    }
    if(inside&&span.html){index++;continue;}
    while(scopeIndex<scopes.length&&scopes[scopeIndex].end<=index)scopeIndex++;
    const scope=scopes[scopeIndex];if(!scope||index<scope.start){index++;continue;}
    if(markdown[index]==='\\'){index+=2;continue;}
    if(markdown[index]==='`'){
      let count=1;while(markdown[index+count]==='`')count++;
      const pattern=new RegExp('`{'+count+'}','g');pattern.lastIndex=index+count;let close:RegExpExecArray|null;
      do{close=pattern.exec(markdown);}while(close&&close.index<scope.end&&(markdown[close.index-1]==='`'||markdown[close.index+count]==='`'));
      if(close&&close.index>=scope.end)close=null;
      index=close?close.index+count:index+count;continue;
    }
    if(markdown[index]!=='!'||markdown[index+1]!=='['){index++;continue;}
    state.pos=index;state.posMax=scope.end;
    const labelEnd=parser.helpers.parseLinkLabel(state,index+1,false);
    if(labelEnd<0){index+=2;continue;}
    let offset=labelEnd+1;
    if(markdown[offset]==='('){
      offset++;while(offset<scope.end&&whitespace(markdown,offset))offset++;
      const value=destination(markdown,offset,scope.end);if(!value){index=labelEnd+1;continue;}
      let closing=value.after;while(closing<scope.end&&whitespace(markdown,closing))closing++;
      const title=parser.helpers.parseLinkTitle(markdown,closing,scope.end);
      if(closing>value.after&&title.ok){closing=title.pos;while(closing<scope.end&&whitespace(markdown,closing))closing++;}
      if(markdown[closing]!==')'||/\n[\t ]*\n/.test(markdown.slice(index,closing+1))){index=labelEnd+1;continue;}
      if(parser.validateLink(value.url))found.push({url:value.url,start:value.start,end:value.end,angle:value.angle,format:'markdown'});
      index=closing+1;continue;
    }
    let label=markdown.slice(index+2,labelEnd),suffixEnd=labelEnd+1;
    if(markdown[offset]==='['){const end=parser.helpers.parseLinkLabel(state,offset);if(end>=0){label=markdown.slice(offset+1,end)||label;suffixEnd=end+1;}}
    const key=parser.utils.normalizeReference(label),reference=env.references?.[key],definition=definitions.get(key);
    if(reference&&definition){definition.uses!.push({start:labelEnd+1,end:suffixEnd,title:reference.title});index=suffixEnd;}
    else index=labelEnd+1;
  }
  for(const definition of definitions.values())if(definition.uses?.length)found.push(definition);
  return found.sort((a,b)=>a.start-b.start);
}

/** Character offsets cover only the raw destination, excluding angle brackets/quotes.
 * Reference images point to the shared definition; replacement expands image uses
 * inline so that ordinary reference links keep their original destination. */
export function scanImageLinks(markdown:string):ImageLink[] {
  return scanDetailed(markdown).map(({url,start,end,angle})=>({url,start,end,angle}));
}
function markdownUrl(url:string,angle:boolean) {
  const escaped=url.replace(/&/g,'&amp;').replace(/[<>\s]/g,character=>encodeURIComponent(character)).replace(/\\/g,'\\\\');
  return angle?escaped:escaped.replace(/[()]/g,'\\$&');
}
export function replaceImageLinks(markdown:string,replacements:Record<string,string>):string {
  const edits:{start:number;end:number;text:string}[]=[];
  for(const link of scanDetailed(markdown)){
    if(!Object.hasOwn(replacements,link.url))continue;const replacement=replacements[link.url];
    if(typeof replacement!=='string'||!replacement||replacement===link.url)continue;
    if(link.format==='reference'){
      for(const use of link.uses||[]){const title=use.title?' "'+use.title.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"':'';edits.push({start:use.start,end:use.end,text:'(<'+markdownUrl(replacement,true)+'>'+title+')'});}
    }else if(link.format==='html'){
      const text=link.quote?replacement.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(link.quote==='"'?/"/g:/'/g,link.quote==='"'?'&quot;':'&#39;'):
        replacement.replace(/&/g,'&amp;').replace(/[\s"'`=<>]/g,character=>encodeURIComponent(character).replace(/'/g,'%27'));
      edits.push({start:link.start,end:link.end,text});
    }else edits.push({start:link.start,end:link.end,text:markdownUrl(replacement,link.angle)});
  }
  let result=markdown;for(const edit of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
  return result;
}
