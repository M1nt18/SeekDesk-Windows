import {useLayoutEffect,useRef,type RefObject} from 'react';

export const modalSelector='[aria-modal="true"]:is([role="dialog"],[role="alertdialog"])';
const layers=new Map<HTMLElement,()=>void>();
let inerted=new Map<HTMLElement,boolean>();
const top=()=>[...layers.keys()].filter(node=>node.isConnected&&node.matches(modalSelector)).at(-1);
const focusable=(node:HTMLElement)=>[...node.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex="-1"])')].filter(item=>item.getClientRects().length&&!item.closest('[inert],[hidden]'));
const focusFirst=(node:HTMLElement)=>{const items=focusable(node);(items.find(item=>item.hasAttribute('autofocus'))||items[0]||node).focus();};
function sync(){
  for(const [node,value]of inerted)node.inert=value;inerted=new Map();
  const active=top();if(!active)return;
  let branch:HTMLElement=active;
  while(branch.parentElement){for(const sibling of branch.parentElement.children)if(sibling!==branch&&sibling instanceof HTMLElement&&!sibling.inert){inerted.set(sibling,false);sibling.inert=true;}branch=branch.parentElement;if(branch===document.body)break;}
}
function keydown(event:KeyboardEvent){
  const active=top();if(!active||event.defaultPrevented)return;
  if(event.key==='Escape'||(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='w'){event.preventDefault();event.stopImmediatePropagation();layers.get(active)?.();}
  if(event.key==='Tab'){const nodes=focusable(active),first=nodes[0],last=nodes.at(-1);if(!first){event.preventDefault();active.focus();}else if(!active.contains(document.activeElement)||event.shiftKey&&document.activeElement===first||!event.shiftKey&&document.activeElement===last){event.preventDefault();(event.shiftKey?last:first)?.focus();}}
}
function focusin(event:FocusEvent){const active=top();if(active&&event.target instanceof Node&&!active.contains(event.target))focusFirst(active);}
export function isTopModal(node:HTMLElement|null){return top()===node;}
export function useModalLayer(ref:RefObject<HTMLElement|null>,onClose?:()=>void,enabled=true){
  const close=useRef(onClose);close.current=onClose;
  useLayoutEffect(()=>{
    const node=ref.current;if(!node||!enabled)return;const before=document.activeElement as HTMLElement|null;
    if(!layers.size){window.addEventListener('keydown',keydown,true);document.addEventListener('focusin',focusin,true);}
    layers.set(node,()=>close.current?.());if(!node.hasAttribute('tabindex'))node.tabIndex=-1;sync();if(top()===node&&!node.contains(document.activeElement))focusFirst(node);
    return()=>{layers.delete(node);sync();if(!layers.size){window.removeEventListener('keydown',keydown,true);document.removeEventListener('focusin',focusin,true);}queueMicrotask(()=>{const active=top();if(before?.isConnected&&(!active||active.contains(before)))before.focus();else if(active)focusFirst(active);});};
  },[ref,enabled]);
}
