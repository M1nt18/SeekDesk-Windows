import type {SavedReadingAnchor} from '../shared/types';
export type ThreadScrollAnchor=SavedReadingAnchor;
const fingerprint=(node:HTMLElement)=>{let hash=2166136261;for(const char of (node.dataset.readerImage||(node.textContent||'').slice(0,256)))hash=Math.imul(hash^char.charCodeAt(0),16777619);return node.tagName+':'+(hash>>>0).toString(16);};
function target(reader:HTMLElement,anchor:ThreadScrollAnchor){
  const article=[...reader.querySelectorAll<HTMLElement>('article.comment[data-floor]')].find(node=>node.dataset.floor===anchor.floor);if(!article)return;
  let block:HTMLElement|undefined=article;for(const index of anchor.blockPath||[])block=block?.children[index] as HTMLElement|undefined;
  if(anchor.blockPath?.length&&block&&anchor.blockOffset!==undefined&&fingerprint(block)===anchor.blockFingerprint)return {node:block,offset:anchor.blockOffset};
  return {node:article,offset:anchor.offset};
}

export function captureThreadAnchor(reader:HTMLElement):ThreadScrollAnchor|undefined {
  const bounds=reader.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return;
  const point=reader.ownerDocument.elementFromPoint?.(bounds.left+bounds.width/2,bounds.top+Math.min(40,bounds.height/3));
  let article=point?.closest<HTMLElement>('article.comment[data-floor]');
  if(!article||!reader.contains(article))article=[...reader.querySelectorAll<HTMLElement>('article.comment[data-floor]')].find(node=>node.getBoundingClientRect().bottom>bounds.top+10);
  const floor=article?.dataset.floor,page=Number(article?.dataset.streamPage);
  if(!article||!floor||!/^\d+$/.test(floor)||!Number.isSafeInteger(page)||page<1||page>100000)return;
  const selector='.reader-rich-content p,.reader-rich-content pre,.reader-rich-content li,.reader-rich-content h1,.reader-rich-content h2,.reader-rich-content h3,.reader-image-frame';
  const block=point?.closest<HTMLElement>(selector)||[...article.querySelectorAll<HTMLElement>(selector)].find(node=>{const rect=node.getBoundingClientRect();return rect.height>0&&rect.bottom>bounds.top+10;});
  const path:number[]=[];let child=block;
  if(block&&article.contains(block)){while(child&&child!==article&&path.length<12){const parent=child.parentElement;if(!parent)break;path.unshift([...parent.children].indexOf(child));child=parent;}}
  return {floor,page,offset:article.getBoundingClientRect().top-bounds.top,...(block&&child===article&&path.length?{blockPath:path,blockOffset:block.getBoundingClientRect().top-bounds.top,blockFingerprint:fingerprint(block)}:{})};
}

export function restoreThreadAnchor(reader:HTMLElement,anchor:ThreadScrollAnchor):void {
  const item=target(reader,anchor);if(item)reader.scrollTop+=item.node.getBoundingClientRect().top-reader.getBoundingClientRect().top-item.offset;
}

/** Correct late layout changes for a bounded time, stopping on any user intent. */
export function keepReadingPosition(reader:HTMLElement,position:number,anchor:ThreadScrollAnchor|undefined,onPosition:(position:number)=>void,onFinish:()=>void){
  let stopped=false,frame=0;
  const apply=()=>{if(stopped)return;if(anchor){const requested=target(reader,anchor);if(requested?.node.matches('.reader-image-frame')){requested.node.dataset.restoreRequested='1';requested.node.dispatchEvent(new Event('seekdesk-image-restore'));}restoreThreadAnchor(reader,anchor);const item=target(reader,anchor);if(item&&Math.abs(item.node.getBoundingClientRect().top-reader.getBoundingClientRect().top-item.offset)<3)onPosition(reader.scrollTop);}else{reader.scrollTop=position;if(Math.abs(reader.scrollTop-position)<3)onPosition(reader.scrollTop);}};
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(apply);};
  const finish=()=>{if(stopped)return;dispose();onFinish();};
  const key=(event:KeyboardEvent)=>{if(!['Shift','Control','Alt','Meta'].includes(event.key))finish();};
  const observer=new ResizeObserver(schedule);observer.observe(reader.querySelector('.reader-document')||reader);
  const timer=setTimeout(finish,35000);
  function dispose(){stopped=true;clearTimeout(timer);cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('wheel',finish,true);window.removeEventListener('touchstart',finish,true);window.removeEventListener('pointerdown',finish,true);window.removeEventListener('keydown',key,true);}
  window.addEventListener('wheel',finish,{capture:true,passive:true});window.addEventListener('touchstart',finish,{capture:true,passive:true});window.addEventListener('pointerdown',finish,true);window.addEventListener('keydown',key,true);apply();return dispose;
}
