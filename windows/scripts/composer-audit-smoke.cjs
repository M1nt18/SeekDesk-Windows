/* Actual renderer components with a synthetic IPC bridge. No Electron profile,
   login, network, or real publication is used by this regression suite. */
require('tsx/cjs');
require.extensions['.css']=()=>{};
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'https://fixture.invalid/',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','Element','Node','DOMParser','MutationObserver','Event','MouseEvent','KeyboardEvent','File'])globalThis[key]=dom.window[key];
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.requestAnimationFrame=dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame=dom.window.cancelAnimationFrame.bind(dom.window);
dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
dom.window.HTMLElement.prototype.scrollIntoView=function(){};
dom.window.HTMLElement.prototype.scrollTo=function(){};
dom.window.confirm=()=>true;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
globalThis.IntersectionObserver=class{observe(){}disconnect(){}};
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {MarkdownComposer}=require('../src/MarkdownComposer.tsx');
const {NotificationsPanel,TopicComposerPanel}=require('../src/parity-panels.tsx');
let App;
const {appearanceDefaults}=require('../src/components/PreferencesPanel.tsx');
const {getComposerUploadCount}=require('../src/composer-uploads.ts');
const appearance={...appearanceDefaults,composerMode:'split',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
const account={id:919191,name:'Fixture',status:'signed-in',level:6};
const posts=['100001','100002'].map(id=>({id,url:`https://www.nodeseek.com/post-${id}-1`,title:`Topic ${id}`,author:'Fixture',category:'daily',published:'',summary:''}));
const noop=()=>{},checks=[];
const ownerOnly=process.argv.includes('--owner-only'),baseline=process.argv.find(value=>value.startsWith('--baseline='))?.slice('--baseline='.length);
let fixture,root=createRoot(document.querySelector('#root'));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>act(async()=>{await Promise.resolve();});
const wait=ms=>act(async()=>{await new Promise(resolve=>setTimeout(resolve,ms));});
async function render(component){await act(async()=>root.render(component));await flush();}
async function click(selector){const node=typeof selector==='string'?document.querySelector(selector):selector;assert.ok(node,'Missing click target '+selector);await act(async()=>node.click());await flush();}
async function input(node,value){assert.ok(node,'Missing input');await act(async()=>{Object.getOwnPropertyDescriptor(node instanceof dom.window.HTMLTextAreaElement?dom.window.HTMLTextAreaElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});await flush();}
async function key(node,key,options={}){await act(async()=>node.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...options})));await flush();}
const button=text=>[...document.querySelectorAll('button')].find(node=>node.textContent.trim()===text);
async function reset(){await act(async()=>root.unmount());await flush();root=createRoot(document.querySelector('#root'));}
function installBridge(overrides={}){
 fixture={drafts:{},writes:[],loads:[],notices:[],actions:[],published:[],back:0};
 const base={
  bootstrap:async()=>({account,settings:{theme:'light',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'},workspace:{tabs:posts,activeId:posts[0].id,overviewOpen:true},official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[],version:'fixture'}),
  parityBootstrap:async()=>({appearance,extensions:{installed:[],enabled:[],hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,attendanceMode:'fixed',autoAttendance:false,officeTitle:'Fixture',officeButton:'Back',officeKey:'9',watchWords:'',watchNote:'',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0},stickers:[],searchHistory:[]}),
  listPosts:async()=>({posts,source:'web',fetchedAt:'',nextPage:null}),
  readThread:async post=>({id:post.id,url:post.url,title:post.title,source:'web',page:1,nextPage:null,comments:[{id:'0',author:'Fixture',date:'',floor:'楼主',html:'<p>body</p>'}]}),
  loadDraft:async key=>{fixture.loads.push(key);return fixture.drafts[key]||null;},
  saveDraft:async(key,value)=>{fixture.writes.push({key,value:structuredClone(value)});if(value)fixture.drafts[key]=structuredClone(value);else delete fixture.drafts[key];},
  queryForum:async request=>request.kind==='notifications'?{conversations:[{id:33,name:'Peer 33'}]}:request.kind==='conversation'?{messages:[]}:request.kind==='composer-options'?{options:{canPost:true}}:{unread:{mentions:0,replies:0,messages:0}},
  forumAction:async request=>{fixture.actions.push(request);return {message:'Synthetic acceptance'};},
  writeForum:async request=>{fixture.actions.push(request);return {message:'Synthetic acceptance',url:posts[0].url,postId:Number(posts[0].id)};},
  readConversationContacts:async()=>[],rememberConversationContact:async()=>[],
  readReadingLibrary:async()=>({bookmarks:[],history:[]}),mutateReadingLibrary:async()=>({bookmarks:[],history:[]}),
  readUserProfiles:async()=>({outcomes:[],complete:true}),prepareImages:async value=>value,
 };
 dom.window.seekdesk=new Proxy({...base,...overrides},{get(target,key){if(key in target)return target[key];if(String(key).startsWith('on'))return ()=>noop;return async()=>{};}});
 return fixture;
}
const props=()=>({account,onBack:()=>fixture.back++,onOpenPost:noop,onMember:noop,onLogin:noop,onNotify:message=>fixture.notices.push(message),appearance,stickers:[],onUpload:async()=>'',onStickers:noop,onMedia:noop,onRead:noop});
const messageEditor=()=>document.querySelector('textarea[aria-label="私信内容"]');
async function check(name,run){if(ownerOnly&&!name.startsWith('A same-tick account change'))return;await reset();installBridge();await run();checks.push(name);console.log('PASS',name);}

async function loadApp(){
 const appFile=require.resolve('../src/App.tsx');
 if(!baseline)return require(appFile).default;
 if(!ownerOnly||!/^\w{7,40}$/.test(baseline)||!/^[0-9a-f]+$/i.test(baseline))throw Error('--baseline requires --owner-only and a hexadecimal Git commit');
 const path=require('node:path'),{execFileSync}=require('node:child_process'),Module=require('node:module');
 const source=execFileSync('git',['show',baseline+':windows/src/App.tsx'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'});
 const result=await require('esbuild').build({entryPoints:[appFile],bundle:false,write:false,platform:'node',format:'cjs',jsx:'automatic',plugins:[{name:'audit-app-baseline',setup(build){build.onLoad({filter:/[\\/]App\.tsx$/},()=>({contents:source,loader:'tsx',resolveDir:path.dirname(appFile)}));}}]});
 const compiled=new Module(appFile,module);compiled.filename=appFile;compiled.paths=Module._nodeModulePaths(path.dirname(appFile));compiled._compile(result.outputFiles[0].text,appFile);
 console.log('AUDIT_SOURCE',baseline+':windows/src/App.tsx','(Git source compiled in memory; only the owner-race case runs)');
 return compiled.exports.default;
}

(async()=>{
 App=await loadApp();
 if(!process.argv.includes('--panels-only')){
  await check('Reply drafts survive leaving and returning before the autosave timer',async()=>{
   fixture.drafts['reply:100001']={content:'disk A',imageWidths:{}};
   await render(React.createElement(App));await click('[aria-label="写回复"]');
   const editor=document.querySelector('.fixed-reply textarea');assert.equal(editor.value,'disk A');
   await input(editor,'new unsaved A');await click('[data-tab-id="100002"] button[role="tab"]');
   await click('[data-tab-id="100001"] button[role="tab"]');await click('[aria-label="写回复"]');
   assert.equal(document.querySelector('.fixed-reply textarea').value,'new unsaved A');
  });
  await check('Reply image width changes immediately update the controlled preview',async()=>{
   await render(React.createElement(App));await click('[aria-label="写回复"]');
   await input(document.querySelector('.fixed-reply textarea'),'![fixture](https://fixture.invalid/a.png)');
   await click([...document.querySelectorAll('.fixed-reply .md-mode button')].find(node=>node.textContent==='对照'));
   await click('.fixed-reply .md-preview img');const width=document.querySelector('.fixed-reply .md-image-size input');
   await input(width,'320');assert.equal(width.value,'320');assert.match(document.querySelector('.fixed-reply .md-preview img').getAttribute('style'),/width:\s*320px/);
  });
  await check('Reply draft read failures block sends and updates while retry retains current text and widths',async()=>{
   const url='https://fixture.invalid/retry.png',text='Keep this newly typed reply ![fixture]('+url+')';let reads=0,prepare;
   dom.window.seekdesk.loadDraft=async key=>{fixture.loads.push(key);if(key==='reply:100001'&&++reads===1)throw Error('Synthetic reply draft failure');return {content:'older disk reply',imageWidths:{[url]:640}};};
   dom.window.seekdesk.onBeforeUpdateInstall=handler=>{prepare=handler;return noop;};
   await render(React.createElement(App));await click('[aria-label="写回复"]');assert.match(document.querySelector('.fixed-reply [role="alert"]').textContent,/Synthetic reply draft failure/);
   const editor=document.querySelector('.fixed-reply textarea');await input(editor,text);
   assert.equal(document.querySelector('[data-testid="submit-reply"]').disabled,true);assert.doesNotMatch(document.querySelector('.reply-heading-actions').textContent,/草稿已自动保存/);
   await key(editor,'Enter',{ctrlKey:true});assert.equal(fixture.actions.length,0);
   await click([...document.querySelectorAll('.fixed-reply .md-mode button')].find(node=>node.textContent==='对照'));await click('.fixed-reply .md-preview img');
   const width=document.querySelector('.fixed-reply .md-image-size input');await input(width,'320');
   await wait(550);assert.equal(fixture.writes.filter(write=>write.key==='reply:100001').length,0,'An unread draft must not be treated as ready by autosave');
   assert.equal(typeof prepare,'function');await act(async()=>assert.rejects(prepare('update'),/部分草稿未能保存|回复草稿尚未读取完成/));
   assert.equal(fixture.writes.filter(write=>write.key==='reply:100001').length,0,'Update must reject before persisting an unread reply');
   await click(button('重试草稿读取'));assert.equal(editor.value,text);assert.equal(document.querySelector('.fixed-reply [role="alert"]'),null);assert.equal(document.querySelector('[data-testid="submit-reply"]').disabled,false);
   assert.equal(width.value,'320');assert.match(document.querySelector('.fixed-reply .md-preview img').getAttribute('style'),/width:\s*320px/);
   await wait(550);assert.equal(fixture.drafts['reply:100001'].content,text);assert.equal(fixture.drafts['reply:100001'].imageWidths[url],320);
   await act(async()=>prepare('update'));assert.equal(fixture.drafts['reply:100001'].content,text);assert.equal(fixture.drafts['reply:100001'].imageWidths[url],320);
  });
  await check('A same-tick account change rejects the previous owner draft before React commits the new account',async()=>{
   const previous={...account,id:42,name:'Owner 42'},next={...account,id:43,name:'Owner 43'},privateText='OWNER42_PRIVATE_REPLY_MUST_NEVER_ENTER_OWNER43';
   const load=deferred(),reads=[],writes=[],bootstrap=dom.window.seekdesk.bootstrap,save=dom.window.seekdesk.saveDraft;let accountChange;
   dom.window.seekdesk.bootstrap=async()=>({...await bootstrap(),account:previous});
   dom.window.seekdesk.onAccountChange=handler=>{accountChange=handler;return noop;};
   dom.window.seekdesk.loadDraft=(key,owner)=>{reads.push({key,owner});return owner===42?load.promise:Promise.resolve(null);};
   dom.window.seekdesk.saveDraft=async(key,value,owner)=>{writes.push({key,value:structuredClone(value),owner});return save(key,value,owner);};
   await render(React.createElement(App));await click('[aria-label="写回复"]');assert.deepEqual(reads,[{key:'reply:100001',owner:42}]);assert.equal(typeof accountChange,'function');
   // The old promise is queued first; the identity event fires synchronously
   // before React can commit owner 43 or run the old effect's cleanup.
   await act(async()=>{load.resolve({content:privateText,imageWidths:{'https://fixture.invalid/private-owner42.png':640}});accountChange(next);});await flush();
   assert.equal([...document.querySelectorAll('textarea')].some(node=>node.value.includes(privateText)),false);
   await click('[data-testid="post-row"]');await click('[aria-label="写回复"]');
   const editor=document.querySelector('.fixed-reply textarea');assert.equal(editor.value,'');assert.ok(reads.some(row=>row.owner===43&&row.key==='reply:100001'));
   assert.equal(writes.some(row=>row.owner===43&&row.value?.content.includes(privateText)),false);
   await input(editor,'Owner 43 new public-safe draft');await wait(550);
   const saved=writes.filter(row=>row.owner===43&&row.key==='reply:100001').at(-1);assert.ok(saved);assert.equal(saved.value.content,'Owner 43 new public-safe draft');assert.deepEqual(saved.value.imageWidths,{});
  });
 }
 await check('Markdown shortcuts, clear, undo and send preferences reach their final states',async()=>{
  let sent=0;
  function Composer(){const [value,setValue]=React.useState('text');return React.createElement(MarkdownComposer,{value,onChange:setValue,onSubmit:()=>sent++,sendShortcut:'button-only'});}
  await render(React.createElement(Composer));let editor=document.querySelector('textarea');editor.setSelectionRange(0,4);await key(editor,'b',{ctrlKey:true});assert.equal(editor.value,'**text**');
  await key(editor,'Enter',{ctrlKey:true});assert.equal(sent,0);await click('[aria-label="清空内容"]');assert.equal(editor.value,'');await click('[aria-label="撤销"]');assert.equal(editor.value,'**text**');
 });
 await check('Image uploads block sends and retain the inserted image and chosen width',async()=>{
  const transfer=deferred();let submitted=0;
  function Composer(){const [value,setValue]=React.useState('body');return React.createElement(MarkdownComposer,{value,onChange:setValue,onSubmit:()=>submitted++,onUpload:()=>transfer.promise,initialMode:'split'});}
  await render(React.createElement(Composer));await input(document.querySelector('.md-status input'),'320');
  const files=document.querySelector('input[type="file"]');Object.defineProperty(files,'files',{configurable:true,value:[new dom.window.File(['fixture'],'fixture.png',{type:'image/png'})]});
  await act(async()=>files.dispatchEvent(new dom.window.Event('change',{bubbles:true})));assert.equal(getComposerUploadCount(),1);assert.equal(document.querySelector('textarea').disabled,true);
  await key(document.querySelector('textarea'),'Enter',{ctrlKey:true});assert.equal(submitted,0);
  await act(async()=>transfer.resolve('https://fixture.invalid/upload.png'));await flush();assert.equal(getComposerUploadCount(),0);assert.match(document.querySelector('textarea').value,/fixture\.png.*upload\.png/);assert.match(document.querySelector('.md-preview img').getAttribute('style'),/width:\s*320px/);
 });
 await check('Private-message draft failures are visible and retry preserves input before saving',async()=>{
  let failed=true;dom.window.seekdesk.loadDraft=async key=>{fixture.loads.push(key);if(failed)throw Error('Synthetic disk failure');return {content:'older disk draft'};};
  await render(React.createElement(NotificationsPanel,{...props(),initialPeer:{id:22,name:'Peer 22'}}));
  assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic disk failure/);await input(messageEditor(),'keep my new input');assert.equal(button('发送私信').disabled,true);
  failed=false;await click(button('重试草稿读取'));assert.equal(messageEditor().value,'keep my new input');assert.equal(document.querySelector('[role="alert"]'),null);assert.equal(button('发送私信').disabled,false);
  await wait(550);assert.equal(fixture.drafts['message:22'].content,'keep my new input');
  await click('.conversation-select');assert.equal(document.querySelector('.conversation-heading strong').textContent,'Peer 33');
 });
 await check('Input typed during a slow draft read saves when loading finishes without another edit',async()=>{
  const load=deferred();dom.window.seekdesk.loadDraft=key=>{fixture.loads.push(key);return key==='message:24'?load.promise:Promise.resolve(null);};
  await render(React.createElement(NotificationsPanel,{...props(),initialPeer:{id:24,name:'Peer 24'}}));await input(messageEditor(),'typed before disk arrived');
  await act(async()=>load.resolve({content:'older disk value'}));await flush();assert.equal(messageEditor().value,'typed before disk arrived');
  await wait(550);assert.equal(fixture.drafts['message:24'].content,'typed before disk arrived');
 });
 await check('An accepted old private-message request preserves newer input in a reopened composer',async()=>{
  const accepted=deferred();dom.window.seekdesk.forumAction=async request=>{fixture.actions.push(request);return accepted.promise;};
  const panel=()=>React.createElement(NotificationsPanel,{...props(),initialPeer:{id:26,name:'Peer 26'}});
  await render(panel());await input(messageEditor(),'old message');await click(button('发送私信'));assert.equal(fixture.actions.length,1);
  await reset();await render(panel());await input(messageEditor(),'new unsent message');await act(async()=>accepted.resolve({message:'Synthetic acceptance'}));await flush();
  assert.equal(messageEditor().value,'new unsent message');await wait(550);assert.equal(fixture.drafts['message:26'].content,'new unsent message');assert.equal(fixture.actions.length,1);
 });
 await check('Plain-message mode preserves punctuation and rejected sends retain the editable draft',async()=>{
  let reject=true;dom.window.seekdesk.forumAction=async request=>{fixture.actions.push(request);if(reject)throw Error('Synthetic send rejection');return {message:'Synthetic acceptance'};};
  await render(React.createElement(NotificationsPanel,{...props(),initialPeer:{id:28,name:'Peer 28'}}));await input(messageEditor(),'**literal** <b>text</b>');await click('.message-markdown-toggle input');
  assert.equal(messageEditor().value,'**literal** <b>text</b>');await click(button('发送私信'));assert.equal(messageEditor().value,'**literal** <b>text</b>');assert.equal(button('发送私信').disabled,false);assert.equal(fixture.actions[0].markdown,false);assert.equal(fixture.actions[0].content,'**literal** <b>text</b>');assert.ok(fixture.notices.includes('Synthetic send rejection'));
  reject=false;await click(button('发送私信'));assert.equal(messageEditor().value,'');assert.equal(fixture.actions.length,2);
 });
 await check('Opening a notice marks it read and a rejected update remains retryable',async()=>{
  let rejected=true,read=0;
  dom.window.seekdesk.queryForum=async()=>({notices:[{id:'71',author:'Peer',authorId:32,title:'Synthetic notice',date:'',unread:true,postId:100001,floor:1,url:posts[0].url+'#1'}]});
  dom.window.seekdesk.readThread=async()=>({id:'100001',url:posts[0].url,title:'Synthetic notice',source:'web',page:1,nextPage:null,comments:[{id:'1',author:'Peer',date:'',floor:'#1',html:'<p>Exact notice floor</p>'}]});
  dom.window.seekdesk.writeForum=async request=>{fixture.actions.push(request);if(rejected)throw Error('Synthetic mark rejection');return {message:'Synthetic acceptance'};};
  await render(React.createElement(NotificationsPanel,{...props(),onRead:()=>read++,unread:{mentions:1,replies:0,messages:0}}));await click('.notice-content');assert.equal(document.querySelector('.notification-row').classList.contains('unread'),true);assert.equal(fixture.actions.length,1);assert.match(document.querySelector('.notice-reply-preview').textContent,/Exact notice floor/);
  assert.equal(document.querySelector('.notification-row').classList.contains('unread'),true);assert.match(document.querySelector('[role="alert"]').textContent,/Synthetic mark rejection/);assert.equal(read,0);
  rejected=false;await click('.inbox-read-button');assert.equal(document.querySelector('.notification-row').classList.contains('unread'),false);assert.equal(document.querySelector('.inbox-read-button'),null);assert.equal(read,1);assert.equal(fixture.actions.length,2);
  await click(button('全部已读'));assert.deepEqual(fixture.actions.slice(2).map(row=>[row.kind,row.category]),[['mark-category-read','mentions'],['mark-category-read','replies'],['mark-category-read','messages']]);
 });
 await check('Topic confirmation retains the draft and only confirmed publication clears it',async()=>{
  dom.window.seekdesk.writeForum=async request=>{fixture.actions.push(request);return request.confirmed?{message:'Synthetic acceptance',url:posts[0].url,postId:Number(posts[0].id)}:{message:'Confirm',confirmation:'Synthetic publication confirmation'};};
  await render(React.createElement(TopicComposerPanel,{...props(),onPublished:post=>fixture.published.push(post)}));await input(document.querySelector('[aria-label="帖子标题"]'),'Confirmation title');await input(document.querySelector('textarea'),'Confirmation body');await click('[data-testid="publish-topic"]');
  assert.equal(document.querySelector('textarea').value,'Confirmation body');assert.equal(fixture.published.length,0);assert.match(document.querySelector('[role="dialog"]').textContent,/Synthetic publication confirmation/);
  await click(button('确认发布'));assert.equal(fixture.actions.length,2);assert.equal(fixture.actions[1].confirmed,true);assert.equal(fixture.published.length,1);assert.equal(document.querySelector('textarea').value,'');
 });
 await check('An accepted old publication clears an unchanged reopened topic and blocks duplicate writes',async()=>{
  const accepted=deferred();dom.window.seekdesk.writeForum=async request=>{fixture.actions.push(request);return accepted.promise;};
  const panel=()=>React.createElement(TopicComposerPanel,{...props(),onPublished:post=>fixture.published.push(post)});
  await render(panel());await input(document.querySelector('[aria-label="帖子标题"]'),'Synthetic title');await input(document.querySelector('textarea'),'Synthetic body');await click('[data-testid="publish-topic"]');assert.equal(fixture.actions.length,1);
  await reset();await render(panel());assert.equal(document.querySelector('textarea').value,'Synthetic body');assert.equal(document.querySelector('[data-testid="publish-topic"]').disabled,true);
  await act(async()=>accepted.resolve({message:'Synthetic acceptance',url:posts[0].url,postId:Number(posts[0].id)}));await flush();assert.equal(document.querySelector('textarea').value,'');assert.equal(document.querySelector('[aria-label="帖子标题"]').value,'');assert.equal(fixture.actions.length,1);
 });
 await reset();console.log(JSON.stringify({status:'passed',checks:checks.length,scope:'Synthetic renderer only',source:baseline||'working-tree',names:checks}));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{try{await act(async()=>root.unmount());}finally{dom.window.close();}});
