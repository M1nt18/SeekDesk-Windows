import test from 'node:test';import assert from 'node:assert/strict';import {JSDOM} from 'jsdom';
import {captureThreadAnchor,restoreThreadAnchor} from '../src/thread-scroll';
import {validateWorkspace} from '../electron/store';
test('logical block anchors preserve the visible paragraph when images above it change height',()=>{
  const dom=new JSDOM('<div id=reader><article class=comment data-floor=0 data-stream-page=1><div class=reader-rich-content><div>image placeholder</div><p>Visible paragraph</p></div></article></div>');
  const reader=dom.window.document.querySelector<HTMLElement>('#reader')!,article=reader.querySelector<HTMLElement>('article')!,paragraph=reader.querySelector<HTMLElement>('p')!;
  let imageHeight=1000;reader.scrollTop=1180;
  reader.getBoundingClientRect=()=>({top:0,width:600,height:500} as DOMRect);article.getBoundingClientRect=()=>({top:-reader.scrollTop,bottom:5000-reader.scrollTop} as DOMRect);paragraph.getBoundingClientRect=()=>({top:200+imageHeight-reader.scrollTop} as DOMRect);
  dom.window.document.elementFromPoint=()=>paragraph;
  const anchor=captureThreadAnchor(reader)!;assert.equal(anchor.blockOffset,20);imageHeight=2200;reader.scrollTop=0;restoreThreadAnchor(reader,anchor);assert.equal(paragraph.getBoundingClientRect().top,20);
  const workspace=validateWorkspace({tabs:[{url:'https://www.nodeseek.com/post-123-1#0',title:'fixture'}],activeId:'123',readingAnchors:{123:anchor}});assert.deepEqual(workspace.readingAnchors?.['123'],anchor);
  assert.doesNotMatch(JSON.stringify(anchor),/Visible paragraph/);dom.window.close();
});
