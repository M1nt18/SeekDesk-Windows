import type {SavedReadingAnchor} from '../shared/types';
export type ThreadScrollAnchor=SavedReadingAnchor;

export function captureThreadAnchor(reader:HTMLElement):ThreadScrollAnchor|undefined {
  const bounds=reader.getBoundingClientRect();
  if(!bounds.width||!bounds.height)return;
  const point=document.elementFromPoint?.(bounds.left+bounds.width/2,bounds.top+Math.min(40,bounds.height/3));
  let article=point?.closest<HTMLElement>('article.comment[data-floor]');
  if(!article||!reader.contains(article))article=[...reader.querySelectorAll<HTMLElement>('article.comment[data-floor]')].find(node=>node.getBoundingClientRect().bottom>bounds.top+10);
  const floor=article?.dataset.floor,page=Number(article?.dataset.streamPage);
  if(!article||!floor||!/^\d+$/.test(floor)||!Number.isSafeInteger(page)||page<1||page>100000)return;
  return {floor,page,offset:article.getBoundingClientRect().top-bounds.top};
}

export function restoreThreadAnchor(reader:HTMLElement,anchor:ThreadScrollAnchor):void {
  const article=[...reader.querySelectorAll<HTMLElement>('article.comment[data-floor]')].find(node=>node.dataset.floor===anchor.floor);
  if(article)reader.scrollTop+=article.getBoundingClientRect().top-reader.getBoundingClientRect().top-anchor.offset;
}
