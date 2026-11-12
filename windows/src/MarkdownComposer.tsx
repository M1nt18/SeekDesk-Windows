import {useEffect,useRef,useState} from 'react';
import type {ClipboardEvent,DragEvent,KeyboardEvent} from 'react';
import {Bold,Italic,Strikethrough,Code,Quote,List,ListOrdered,Table,Heading2,Link,Image,Minus,FileCode,Undo2,Redo2,Trash2,Smile,Upload,Settings,Maximize2,Minimize2} from 'lucide-react';
import type {StickerItem} from '../shared/parity';
import {applyMarkdownCommand,renderMarkdown} from './markdown';
import type {MarkdownCommand} from './markdown';
import './composer.css';

export interface MarkdownComposerProps{
  value:string;onChange:(value:string)=>void;onSubmit?:()=>void;disabled?:boolean;busy?:boolean;initialMode?:'edit'|'split'|'preview';label?:string;placeholder?:string;sendShortcut?:'ctrl-enter'|'enter'|'button-only';
  onUpload?:(file:File,width?:number)=>Promise<string>;stickers?:StickerItem[];onImportStickers?:()=>void;onMediaSettings?:()=>void;imageWidths?:Record<string,number>;onImageWidthsChange?:(values:Record<string,number>)=>void;
  focusRequest?:number;
}
const tools:{command:MarkdownCommand;label:string;icon:typeof Bold}[]=[{command:'heading',label:'标题',icon:Heading2},{command:'bold',label:'加粗',icon:Bold},{command:'italic',label:'斜体',icon:Italic},{command:'strike',label:'删除线',icon:Strikethrough},{command:'code',label:'行内代码',icon:Code},{command:'quote',label:'引用',icon:Quote},{command:'bullets',label:'无序列表',icon:List},{command:'numbers',label:'有序列表',icon:ListOrdered},{command:'codeBlock',label:'代码块',icon:FileCode},{command:'table',label:'表格',icon:Table},{command:'divider',label:'分割线',icon:Minus},{command:'link',label:'链接',icon:Link},{command:'image',label:'图片链接',icon:Image}];

export function MarkdownComposer({value,onChange,onSubmit,disabled=false,busy=false,initialMode='edit',label='正文',placeholder='写下你的回复…',sendShortcut='ctrl-enter',onUpload,stickers:providedStickers,onImportStickers,onMediaSettings,imageWidths:providedWidths,onImageWidthsChange,focusRequest}:MarkdownComposerProps){
  const [mode,setMode]=useState(initialMode),[expanded,setExpanded]=useState(false),[uploading,setUploading]=useState(false),[message,setMessage]=useState(''),[picker,setPicker]=useState(false),[group,setGroup]=useState('ac'),[stickers,setStickers]=useState<StickerItem[]>(providedStickers||[]),[localWidths,setLocalWidths]=useState<Record<string,number>>({}),[selectedImage,setSelectedImage]=useState<string>(),[uploadWidth,setUploadWidth]=useState<number|undefined>();
  const textarea=useRef<HTMLTextAreaElement>(null),files=useRef<HTMLInputElement>(null),valueRef=useRef(value),selection=useRef({start:value.length,end:value.length}),history=useRef([value]),historyIndex=useRef(0),historyChange=useRef(false);valueRef.current=value;
  const widths=providedWidths||localWidths,locked=disabled||busy||uploading;
  const focusPending=useRef(false);
  useEffect(()=>{setMode(initialMode);},[initialMode]);
  useEffect(()=>{if(focusRequest){focusPending.current=true;if(mode==='preview')setMode('edit');}},[focusRequest]);
  useEffect(()=>{if(!focusPending.current||mode==='preview')return;const frame=requestAnimationFrame(()=>{const node=textarea.current;if(!node)return;focusPending.current=false;const end=valueRef.current.length;selection.current={start:end,end};node.focus();node.setSelectionRange(end,end);node.scrollTop=node.scrollHeight;});return()=>cancelAnimationFrame(frame);},[focusRequest,mode,value]);
  useEffect(()=>{if(providedStickers)setStickers(providedStickers);},[providedStickers]);
  useEffect(()=>{if(!picker||providedStickers)return;let disposed=false;window.seekdesk.getStickers().then(rows=>{if(!disposed)setStickers(rows);}).catch(error=>setMessage(String(error.message||error)));return()=>{disposed=true;};},[picker,providedStickers]);
  useEffect(()=>{if(historyChange.current){historyChange.current=false;return;}if(history.current[historyIndex.current]!==value){history.current=history.current.slice(0,historyIndex.current+1);history.current.push(value);if(history.current.length>100)history.current.shift();historyIndex.current=history.current.length-1;}},[value]);
  const commit=(next:string,start?:number,end?:number)=>{if(!historyChange.current&&history.current[historyIndex.current]!==next){history.current=history.current.slice(0,historyIndex.current+1);history.current.push(next);if(history.current.length>100)history.current.shift();historyIndex.current=history.current.length-1;}onChange(next);valueRef.current=next;if(start!==undefined){selection.current={start,end:end??start};requestAnimationFrame(()=>{textarea.current?.focus();textarea.current?.setSelectionRange(start,end??start);});}};
  const remember=()=>{if(textarea.current)selection.current={start:textarea.current.selectionStart,end:textarea.current.selectionEnd};};
  const insert=(text:string,atEnd=false)=>{const current=valueRef.current,range=atEnd?{start:current.length,end:current.length}:selection.current,start=Math.min(current.length,range.start),end=Math.min(current.length,range.end);commit(current.slice(0,start)+text+current.slice(end),start+text.length);};
  const command=(command:MarkdownCommand)=>{if(locked||mode==='preview')return;const edit=applyMarkdownCommand(valueRef.current,selection.current.start,selection.current.end,command);commit(edit.text,edit.start,edit.end);};
  const undo=(redo=false)=>{const index=historyIndex.current+(redo?1:-1);if(index<0||index>=history.current.length)return;historyIndex.current=index;historyChange.current=true;commit(history.current[index]);};
  const setWidths=(next:Record<string,number>)=>{setLocalWidths(next);onImageWidthsChange?.(next);};
  const upload=async(file:File)=>{
    if(locked)return;if(!file.type.startsWith('image/')){setMessage('请选择图片文件');return;}setUploading(true);setMessage('正在上传到 NodeImage…');
    const before=valueRef.current,at={...selection.current};
    try{
      const url=onUpload?await onUpload(file,uploadWidth): (await window.seekdesk.uploadImage({name:file.name||'clipboard.png',mime:file.type,bytes:new Uint8Array(await file.arrayBuffer()),width:uploadWidth})).url;
      if(valueRef.current===before)selection.current=at;else remember();
      insert('!['+(file.name||'图片').replace(/[\[\]\\]/g,'')+'](<'+url+'>)');if(uploadWidth)setWidths({...widths,[url]:uploadWidth});setMessage('图片已插入');
    }catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setUploading(false);}
  };
  const chooseSticker=async(sticker:StickerItem)=>{
    if(locked)return;setPicker(false);
    if(sticker.official){insert(' '+sticker.name+' ');return;}
    setUploading(true);setMessage('正在上传表情…');try{const result=await window.seekdesk.uploadSticker(sticker.id);insert('!['+sticker.name.replace(/[\[\]\\]/g,'')+'](<'+result.url+'>)');setMessage('表情已插入');}catch(error){setMessage(error instanceof Error?error.message:String(error));}finally{setUploading(false);}
  };
  const paste=(event:ClipboardEvent<HTMLTextAreaElement>)=>{const file=[...event.clipboardData.files].find(file=>file.type.startsWith('image/'));if(file&&!event.clipboardData.getData('text/plain')){event.preventDefault();remember();void upload(file);}};
  const drop=(event:DragEvent<HTMLTextAreaElement>)=>{if(event.dataTransfer.files.length)event.preventDefault();const file=[...event.dataTransfer.files].find(file=>file.type.startsWith('image/'));if(file){remember();void upload(file);}else if(event.dataTransfer.files.length)setMessage('请选择图片文件');};
  const keydown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{
    if(event.nativeEvent.isComposing||event.keyCode===229)return;
    if((event.ctrlKey||event.metaKey)&&!event.altKey){const key=event.key.toLowerCase();if(['b','i','k','z','y'].includes(key)){event.preventDefault();remember();if(key==='b')command('bold');else if(key==='i')command('italic');else if(key==='k')command('link');else undo(key==='y'||event.shiftKey);return;}}
    if(event.key==='Enter'&&!event.shiftKey&&!event.altKey&&onSubmit&&!locked&&value.trim()&&(sendShortcut==='enter'&&!event.ctrlKey&&!event.metaKey||sendShortcut==='ctrl-enter'&&(event.ctrlKey||event.metaKey))){event.preventDefault();onSubmit();}
    if(event.key==='Tab'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();remember();insert('    ');}
  };
  return <div className={'md-composer'+(expanded?' md-expanded':'')}>
    <div className="md-toolbar"><div className="md-toolbar-main">
      <button type="button" disabled={locked||mode==='preview'} onClick={()=>{remember();files.current?.click();}} title="上传图片，也可粘贴或拖入图片"><Upload size={16}/><span>上传图片</span></button>
      <button type="button" disabled={locked||mode==='preview'} onClick={()=>setPicker(!picker)} aria-expanded={picker}><Smile size={16}/><span>表情包</span></button>
      <button type="button" disabled={locked} onClick={onMediaSettings} title="图床密钥与表情设置" aria-label="图床与表情设置"><Settings size={15}/></button>
      <i/><button type="button" disabled={locked||mode==='preview'||historyIndex.current<1} onClick={()=>undo()} title="撤销 Ctrl+Z" aria-label="撤销"><Undo2 size={16}/></button>
      <button type="button" disabled={locked||mode==='preview'||historyIndex.current>=history.current.length-1} onClick={()=>undo(true)} title="重做 Ctrl+Shift+Z" aria-label="重做"><Redo2 size={16}/></button>
      <button type="button" disabled={locked||mode==='preview'||!value} onClick={()=>{if(window.confirm('清空当前编辑内容？草稿也会随之清空。'))commit('');}} title="清空内容" aria-label="清空内容"><Trash2 size={15}/></button>
      <div className="md-mode" role="group" aria-label="编辑器视图">{([['edit','仅编辑'],['split','对照'],['preview','仅预览']] as const).map(([id,text])=><button type="button" key={id} aria-pressed={mode===id} disabled={disabled||busy} onClick={()=>setMode(id)}>{text}</button>)}</div>
      <button type="button" onClick={()=>setExpanded(!expanded)} title={expanded?'恢复编辑区高度':'展开编辑区'} aria-label={expanded?'恢复编辑区高度':'展开编辑区'}>{expanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}</button>
    </div><div className="md-format-tools">{tools.map(({command:id,label,icon:Icon})=><button type="button" disabled={locked||mode==='preview'} key={id} onMouseDown={event=>event.preventDefault()} onClick={()=>command(id)} title={label} aria-label={label}><Icon size={15}/><span>{label}</span></button>)}</div></div>
    {picker&&<div className="md-stickers"><div className="md-sticker-tabs">{[...new Set(stickers.map(row=>row.group))].map(id=><button type="button" key={id} aria-pressed={group===id} onClick={()=>setGroup(id)}>{({ac:'AC娘',yct:'洋葱头',xhj:'小黄鸡',emoji:'Emoji'} as Record<string,string>)[id]||id}</button>)}<button type="button" onClick={()=>{if(onImportStickers)onImportStickers();else{const name=window.prompt('表情分组名称','自定义');if(name)window.seekdesk.importStickers(name).then(setStickers).catch(error=>setMessage(String(error)));}}}>导入表情…</button><button type="button" onClick={()=>setPicker(false)}>收起</button></div><div className="md-sticker-grid">{stickers.filter(row=>row.group===group).map(row=><button type="button" key={row.id} title={row.name} onClick={()=>void chooseSticker(row)}><img src={row.url} alt={row.name} loading="lazy"/></button>)}</div></div>}
    <div className={'md-body md-'+mode}>
      {mode!=='preview'&&<label className="md-editor"><span>{label}<small>Markdown</small></span><textarea ref={textarea} value={value} aria-label={label} disabled={locked} placeholder={placeholder} spellCheck={false} onSelect={remember} onBlur={remember} onChange={event=>{commit(event.target.value);remember();}} onKeyDown={keydown} onPaste={paste} onDrop={drop} onDragOver={event=>{if(event.dataTransfer.types.includes('Files'))event.preventDefault();}}/></label>}
      {mode!=='edit'&&<div className="md-preview"><div className="md-preview-title">实时预览</div><article className="prose" onClick={event=>{const image=(event.target as HTMLElement).closest('img');if(image&&!image.classList.contains('sticker'))setSelectedImage(image.getAttribute('src')||undefined);}} dangerouslySetInnerHTML={{__html:renderMarkdown(value,widths)}}/>{!value&&<p className="md-empty">在左侧输入内容，预览将在这里显示。</p>}</div>}
    </div>
    {selectedImage&&mode!=='edit'&&<div className="md-image-size"><label>预览图片宽度 <input type="number" min={32} max={8192} value={widths[selectedImage]||''} placeholder="原始尺寸" onChange={event=>{const next={...widths},number=Number(event.target.value);if(Number.isFinite(number)&&number>=32&&number<=8192)next[selectedImage]=Math.round(number);else delete next[selectedImage];setWidths(next);}}/> px</label><button type="button" onClick={()=>{const next={...widths};delete next[selectedImage];setWidths(next);}}>恢复原图</button><button type="button" onClick={()=>setSelectedImage(undefined)}>完成</button></div>}
    <div className="md-status"><span aria-live="polite">{message||value.length+' 字符'}</span><label title="上传前处理图片宽度">上传宽度 <input type="number" min={32} max={8192} placeholder="原图" value={uploadWidth||''} onChange={event=>{const value=Number(event.target.value);setUploadWidth(value>=32&&value<=8192?Math.round(value):undefined);}}/> px</label><span>{sendShortcut==='ctrl-enter'?'Ctrl + Enter 发送':sendShortcut==='enter'?'Enter 发送 · Shift + Enter 换行':'点击发送按钮'}</span></div>
    <input ref={files} type="file" accept="image/*" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void upload(file);event.target.value='';}}/>
  </div>;
}
export default MarkdownComposer;
