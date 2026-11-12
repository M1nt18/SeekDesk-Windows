import { app, BrowserWindow, WebContentsView, ipcMain, session, shell, clipboard, Notification, globalShortcut, nativeImage, dialog, screen, Tray, Menu, type Session, type IpcMainInvokeEvent, type WebContents } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { AccountState, ListingRequest, ListingResult, Post, ThreadResult, OfficialViewBounds, OfficialViewState, ForumActionRequest, ForumActionResult } from '../shared/types';
import { FORUM_ORIGIN, RSS_URL, isOfficialUrl, normalizePostUrl, listingUrl, parseRss, sanitizeContent, extractListingScript, extractThreadWithProfilesScript, extractIdentityScript, captureTerminalsScript } from './forum';
import {createActionScript,validateActionRequest} from './interactions';
import { Store, validateSettings, validateWorkspace, validateBlockedUsers } from './store';
import {UserscriptHost} from './userscripts';
import {DesktopWindowController} from './desktop-window';
import {UpdaterService} from './updater';
import {ParityStore,validateAppearance,validateHistory} from './parity-store';
import {MediaService} from './media';
import {ExtensionsService} from './extensions';
import {createQueryScript,createWriteScript,requestPage,validateQueryRequest,validateWriteRequest} from './parity-forum';
import type {ForumQueryRequest,ForumQueryResult,ForumWriteRequest,ForumWriteResult,ExtensionsState,RankingPeriod} from '../shared/parity';

// Remote website contents never receive a preload, Node.js, or application IPC.
const testing = process.env.SEEKDESK_TEST === '1';
if (testing && process.env.SEEKDESK_USER_DATA) app.setPath('userData', process.env.SEEKDESK_USER_DATA);
const devURL = process.env.SEEKDESK_DEV_URL;
if (devURL && devURL !== 'http://127.0.0.1:5173') throw new Error('开发地址无效');
const rendererFile = path.join(__dirname, '../../dist/index.html');
const rendererURL = devURL ? new URL(devURL).href : pathToFileURL(rendererFile).href;
let mainWindow: BrowserWindow | null = null;
let officialView: WebContentsView | null = null;
let calculatorView: WebContentsView | null = null;
let calculatorSession: Session;
const CALCULATOR_URL='https://sy.3xme.com/';
let officialState: OfficialViewState = {visible:false,url:'',loading:false,purpose:'login'};
let officialPoll: ReturnType<typeof setInterval> | undefined;
let officialInspectionPending = false;
let readerWindow: BrowserWindow | null = null;
let forumSession: Session;
let publicSession: Session;
let store: Store;
let userscriptHost: UserscriptHost;
let desktopWindow:DesktopWindowController;
let updater:UpdaterService;
let buildNumber='源码调试';
let features:ParityStore;
let media:MediaService;
let extensions:ExtensionsService;
let bossVisible=false;
let bossShortcut:string|undefined;
const readerSetup=new WeakMap<BrowserWindow,Promise<void>>();
let account: AccountState = {status:'unknown'};
let confirmedIdentity: string | undefined;
let generation = 0;
let verificationUntil = 0;
let websiteQueue: Promise<unknown> = Promise.resolve();
let rssCache: {posts: Post[]; time:number} | null = null;
let rssPending: Promise<Post[]> | null = null;
let actionPending = false;
const avatarCache = new Map<number,{data:string;time:number}>();

function assertLocal(event: IpcMainInvokeEvent | Electron.IpcMainEvent) {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== rendererURL) throw new Error('无效的应用调用');
}
function setAccount(value: AccountState) {
  const changed=account.status!==value.status||account.id!==value.id;
  const identity = value.status === 'signed-in' ? `user:${value.id}` : value.status === 'signed-out' ? 'signed-out' : undefined;
  if (identity !== undefined) {
    if (confirmedIdentity !== identity && (confirmedIdentity !== undefined || value.status === 'signed-in')) {
      generation++;
      verificationUntil = 0;
      const previousReader = readerWindow;
      readerWindow = null;
      previousReader?.destroy();
    }
    confirmedIdentity = identity;
  }
  account = value.status==='unknown' || value.status==='verification'?{...account,status:value.status}:value;
  if(changed)extensions?.accountChanged();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('forum:account-change', account);
}
function safeHttp(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('链接无效');
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('仅允许 HTTP / HTTPS 网页链接');
  return url.href;
}
function remoteOptions(official=false) {
  return {session:forumSession, nodeIntegration:false, contextIsolation:true, sandbox:true, webSecurity:true, spellcheck:false,...(official?{preload:path.join(__dirname,'userscript-preload.js')}:{})};
}
function openNativePost(url:string){
  if(!officialState.visible||officialState.purpose!=='browse')return false;
  try{const normalized=normalizePostUrl(url),id=new URL(normalized).pathname.match(/^\/post-(\d+)-/)![1];closeOfficial();mainWindow?.webContents.send('app:open-post',{id,url:normalized,title:'帖子 #'+id,author:'',category:'',published:'',summary:''} satisfies Post);return true;}catch{return false;}
}
function secureRemote(contents: WebContents, isOfficialView = false) {
  if (isOfficialView) contents.on('before-input-event',(event,input)=>{
    if(input.type==='keyDown' && (input.control || input.meta) && input.key.toLowerCase()==='w') {
      event.preventDefault();
      closeOfficial();
    }
  });
  contents.setWindowOpenHandler(({url}) => {
    if (isOfficialUrl(url)) {
      if(isOfficialView&&openNativePost(url))return {action:'deny'};
      // Login redirects and site popups stay in the original view, preserving
      // its login purpose so successful authentication can return to React.
      if (isOfficialView) void contents.loadURL(url).catch(() => {});
      else void openOfficial(url).catch(() => {});
    }
    else { try { void shell.openExternal(safeHttp(url)); } catch { /* Reject executable / custom scheme links. */ } }
    return {action:'deny'};
  });
  contents.on('will-navigate', (event, url) => {
    if(isOfficialView&&isOfficialUrl(url)&&openNativePost(url)){event.preventDefault();return;}
    if (!isOfficialUrl(url)) {
      event.preventDefault();
      try { void shell.openExternal(safeHttp(url)); } catch { /* Disallow non-web schemes. */ }
    }
  });
  contents.on('will-redirect', (event,url,isInPlace,isMainFrame) => {
    if (isMainFrame && !isOfficialUrl(url)) event.preventDefault();
  });
}
async function inspectAccount(contents: WebContents, authoritative=false) {
  const version = generation;
  if (contents.isDestroyed() || !isOfficialUrl(contents.getURL())) return account;
  try {
    const result = await contents.executeJavaScript(extractIdentityScript) as AccountState;
    if (version === generation && result && ['unknown','signed-in','signed-out','verification'].includes(result.status)) {
      if (authoritative || !officialState.visible || officialState.purpose==='calculator') {setAccount(result);return account;}
      return result;
    }
  } catch { /* Navigation may still be in progress. */ }
  return account;
}
function updateOfficial(patch: Partial<OfficialViewState>) {
  officialState = {...officialState,...patch};
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('forum:view-change',officialState);
}
function closeOfficial() {
  clearInterval(officialPoll);
  officialPoll = undefined;
  officialView?.setVisible(false);
  calculatorView?.setVisible(false);
  updateOfficial({visible:false});
  mainWindow?.webContents.focus();
}
function destroyOfficial() {
  closeOfficial();
  if (officialView) {
    mainWindow?.contentView.removeChildView(officialView);
    officialView.webContents.close({waitForBeforeUnload:false});
    officialView=null;
  }
}
function destroyCalculator(){
  if(!calculatorView)return;
  mainWindow?.contentView.removeChildView(calculatorView);
  calculatorView.webContents.close({waitForBeforeUnload:false});calculatorView=null;
}
function isCalculatorUrl(input:string){try{const url=new URL(input);return url.origin===CALCULATOR_URL.slice(0,-1)&&!url.username&&!url.password;}catch{return false;}}
async function openCalculator(){
  if(!mainWindow||mainWindow.isDestroyed())throw new Error('客户端窗口尚未就绪');
  closeOfficial();
  if(!calculatorView||calculatorView.webContents.isDestroyed()){
    const view=new WebContentsView({webPreferences:{session:calculatorSession,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,spellcheck:false}});
    calculatorView=view;view.setVisible(false);mainWindow.contentView.addChildView(view);
    view.webContents.on('before-input-event',(event,input)=>{if(input.type==='keyDown'&&(input.control||input.meta)&&input.key.toLowerCase()==='w'){event.preventDefault();closeOfficial();}});
    view.webContents.setWindowOpenHandler(({url})=>{if(isCalculatorUrl(url))void view.webContents.loadURL(url).catch(()=>{});else{try{void shell.openExternal(safeHttp(url));}catch{}}return {action:'deny'};});
    view.webContents.on('will-navigate',(event,url)=>{if(!isCalculatorUrl(url)){event.preventDefault();try{void shell.openExternal(safeHttp(url));}catch{}}});
    view.webContents.on('will-redirect',(event,url,_inPlace,isMainFrame)=>{if(isMainFrame&&!isCalculatorUrl(url))event.preventDefault();});
    const current=()=>view===calculatorView&&officialState.purpose==='calculator';
    view.webContents.on('did-start-loading',()=>{if(current())updateOfficial({loading:true,error:undefined});});
    view.webContents.on('did-stop-loading',()=>{if(current())updateOfficial({loading:false});});
    view.webContents.on('did-navigate',(_event,url)=>{if(current())updateOfficial({url});});
    view.webContents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{if(current()&&isMainFrame&&code!==-3)updateOfficial({loading:false,error:'计算器暂时无法加载，请检查网络后重试'});});
  }
  updateOfficial({visible:true,purpose:'calculator',url:calculatorView.webContents.getURL()||CALCULATOR_URL,loading:!calculatorView.webContents.getURL(),error:undefined});
  calculatorView.webContents.setZoomFactor(store.settings.uiFontSize/16);
  if(!isCalculatorUrl(calculatorView.webContents.getURL())){
    try{await calculatorView.webContents.loadURL(CALCULATOR_URL);}catch{if(officialState.purpose==='calculator')updateOfficial({loading:false,error:'计算器暂时无法加载，请检查网络后重试'});}
  }
}
async function inspectOfficial() {
  if(officialState.purpose==='calculator')return account;
  const view=officialView;
  if (!view || view.webContents.isDestroyed() || officialInspectionPending) return account;
  officialInspectionPending=true;
  try {
    const result=await inspectAccount(view.webContents,true);
    if (view===officialView && result.status==='signed-in') {
      verificationUntil=0;
      if (officialState.visible && officialState.purpose==='login') closeOfficial();
    }
    return result;
  } finally {officialInspectionPending=false;}
}
function setOfficialBounds(input: OfficialViewBounds) {
  if (!input || !['x','y','width','height'].every(key=>typeof input[key as keyof OfficialViewBounds]==='number' && Number.isFinite(input[key as keyof OfficialViewBounds]))) throw new Error('官方页面区域参数无效');
  const view=officialState.purpose==='calculator'?calculatorView:officialView;
  if (!officialState.visible || !view || !mainWindow) return;
  const container=mainWindow.getContentBounds();
  const zoom=mainWindow.webContents.getZoomFactor();
  const x=Math.max(0,Math.min(container.width,Math.round(input.x*zoom)));
  const y=Math.max(38,Math.min(container.height,Math.round(input.y*zoom)));
  const width=Math.max(0,Math.min(container.width-x,Math.round(input.width*zoom)));
  const height=Math.max(0,Math.min(container.height-y,Math.round(input.height*zoom)));
  view.setBounds({x,y,width,height});
  view.setVisible(width>0 && height>0);
}
async function openOfficial(input?: string) {
  const target = input || FORUM_ORIGIN + '/signIn.html';
  if (!isOfficialUrl(target)) throw new Error('请使用 NodeSeek 官方 HTTPS 页面');
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('客户端窗口尚未就绪');
  calculatorView?.setVisible(false);
  if (!officialView || officialView.webContents.isDestroyed()) {
    officialView = new WebContentsView({webPreferences:remoteOptions(true)});
    const view=officialView;
    view.setVisible(false);
    mainWindow.contentView.addChildView(view);
    secureRemote(view.webContents,true);
    view.webContents.on('did-start-loading',()=>{if(view===officialView&&officialState.purpose!=='calculator')updateOfficial({loading:true,error:undefined});});
    view.webContents.on('did-stop-loading',()=>{if(view===officialView&&officialState.purpose!=='calculator')updateOfficial({loading:false});});
    const loaded=()=>{
      if(view!==officialView||officialState.purpose==='calculator') return;
      updateOfficial({url:view.webContents.getURL(),loading:false});
      verificationUntil=0;
      void inspectOfficial();
      if(store.settings.nodeSeekPro)void userscriptHost.inject(view.webContents).catch(()=>{});
    };
    view.webContents.on('did-finish-load',loaded);
    view.webContents.on('did-navigate-in-page',loaded);
  }
  clearInterval(officialPoll);
  officialPoll=setInterval(()=>{if(officialState.visible)void inspectOfficial();},1000);
  updateOfficial({visible:true,url:target,loading:true,purpose:new URL(target).pathname==='/signIn.html'?'login':'browse',error:undefined});
  // The renderer supplies the reading area's actual bounds before showing the
  // native view. The site's content can never overlap the application toolbar.
  const view=officialView;
  view.webContents.setZoomFactor(store.settings.uiFontSize/16);
  try {
    if (view.webContents.getURL()!==target) await view.webContents.loadURL(target);
    else {updateOfficial({loading:false});await inspectOfficial();}
  } catch {
    if(view===officialView)updateOfficial({loading:false,error:'官方页面加载失败，请检查网络后重试'});
  }
}
function getReader() {
  if (!readerWindow || readerWindow.isDestroyed()) {
    readerWindow = new BrowserWindow({show:false,width:1200,height:900,webPreferences:remoteOptions()});
    secureRemote(readerWindow.webContents);
    const win=readerWindow;
    const setup=(async()=>{await bounded(win.loadURL('about:blank'),6000,'读取页初始化超时');win.webContents.debugger.attach('1.3');await bounded(win.webContents.debugger.sendCommand('Page.enable'),6000,'读取页调试通道初始化超时');await bounded(win.webContents.debugger.sendCommand('Network.enable'),6000,'读取页网络通道初始化超时');await bounded(win.webContents.debugger.sendCommand('Network.setCacheDisabled',{cacheDisabled:true}),6000,'读取页刷新策略初始化超时');await bounded(win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:captureTerminalsScript}),6000,'终端报告初始化超时');})();
    readerSetup.set(win,setup);
    readerWindow.on('closed', () => { if(readerWindow===win)readerWindow = null; });
  }
  return readerWindow;
}
async function bounded<T>(promise: Promise<T>, ms: number, message='官网读取超时'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise,new Promise<never>((_,reject) => {timer=setTimeout(() => reject(new Error(message)),ms);})]); }
  finally { clearTimeout(timer); }
}
function onWebsite<T>(url: string, script: string, options: {timeout?:number;action?:boolean;reuse?:boolean}={}): Promise<T> {
  const version = generation;
  const task = websiteQueue.catch(() => {}).then(async () => {
    if (version !== generation) throw new Error('会话已变更，请重新读取');
    if (Date.now() < verificationUntil) throw new Error('官网需要验证或当前不可用');
    const win = getReader();
    try {
      await bounded(readerSetup.get(win)!,19000,'读取页初始化超时');
      // A floor fragment only identifies a location in React. Navigating Chromium
      // with it can reuse the previous document instead of fetching new replies.
      const documentUrl=new URL(url);documentUrl.hash='';
      if(!options.reuse||win.webContents.getURL().split('#')[0]!==documentUrl.href)await bounded(win.loadURL(documentUrl.href,{extraHeaders:'Cache-Control: no-cache\r\nPragma: no-cache\r\n'}), 16000);
      if (version !== generation) throw new Error('会话已变更，请重新读取');
      const actual = new URL(win.webContents.getURL());
      if (!isOfficialUrl(actual.href) || actual.pathname !== new URL(url).pathname) throw new Error('页面跳转，请在官方窗口登录后重试');
      const observed = await inspectAccount(win.webContents);
      if (observed.status === 'verification') throw new Error('官网需要人工验证');
      const result = await bounded(win.webContents.executeJavaScript(script),options.timeout ?? 6000,options.action?'操作结果尚未确认，请先刷新核实，勿重复提交':'官网读取超时') as T | null;
      if (version !== generation) throw new Error('会话已变更，请重新读取');
      if (!result) throw new Error('当前官网内容不可读取，请在官方窗口查看');
      return result;
    } catch (error) {
      if (!win.isDestroyed()) win.webContents.stop();
      if(version === generation && !options.action && /验证|跳转|超时|不可读取|连接/.test(error instanceof Error?error.message:'')) verificationUntil = Date.now() + 60000;
      throw error;
    }
  });
  websiteQueue = task;
  return task;
}
async function queryForum(input:ForumQueryRequest):Promise<ForumQueryResult>{
  const request=validateQueryRequest(input),owner=account.status==='signed-in'?account.id:undefined,version=generation;
  const result=await onWebsite<ForumQueryResult>(requestPage(request),createQueryScript(request,owner),{timeout:35000,reuse:!['search','edit-source','composer-options'].includes(request.kind)});
  if(version!==generation)throw new Error('会话已变更，请重新读取');
  if(result.posts)result.posts=result.posts.map(post=>({...post,url:normalizePostUrl(post.url),summary:sanitizeContent(post.summary||'')}));
  if(result.activity)result.activity=result.activity.map(item=>({...item,html:item.html?sanitizeContent(item.html):undefined}));
  if(request.kind==='account'&&result.profile&&owner===result.profile.id){const profile=result.profile;setAccount({...account,name:profile.name,avatar:profile.avatar,level:profile.rank,coin:profile.coin});}
  return result;
}
async function writeForum(input:ForumWriteRequest,fromAttendance=false):Promise<ForumWriteResult>{
  const request=validateWriteRequest(input);
  if(request.kind==='attendance'&&!fromAttendance){const attendance=await extensions.attend(request.mode);return {message:attendance.message||'签到状态已更新',attendance};}
  const owner=account.status==='signed-in'?account.id:undefined;if(!owner)throw new Error('请先在客户端的官方页面登录');
  if(actionPending)throw new Error('上一项操作仍在处理中，请稍候');
  const version=generation;actionPending=true;
  try{const result=await onWebsite<ForumWriteResult>(requestPage(request),createWriteScript(request,owner),{timeout:40000,action:true});if(version!==generation||account.status!=='signed-in'||account.id!==owner)throw new Error('账号已变化，操作结果需在官方页面核对');return result;}finally{actionPending=false;}
}
function toggleBoss(){const state=extensions.getState();if(!state.enabled.includes('office')||!state.installed.includes('office'))throw new Error('请先安装并启用办公伪装');bossVisible=!bossVisible;mainWindow?.setTitle(bossVisible?state.officeTitle:'SeekDesk');if(bossVisible)closeOfficial();mainWindow?.webContents.send('extensions:boss',bossVisible);}
function configureBoss(enabled:boolean,state:ExtensionsState){if(bossShortcut)globalShortcut.unregister(bossShortcut);bossShortcut=undefined;if(enabled){const key='Control+Shift+'+state.officeKey;if(globalShortcut.register(key,()=>toggleBoss()))bossShortcut=key;}else if(bossVisible){bossVisible=false;mainWindow?.setTitle('SeekDesk');mainWindow?.webContents.send('extensions:boss',false);}}
function applyBrandIcon(){if(!mainWindow)return;const icon=nativeImage.createFromPath(path.join(__dirname,'../../dist/brands',features.appearance.brand+'.png'));if(!icon.isEmpty())mainWindow.setIcon(icon);}
async function rssPosts(): Promise<Post[]> {
  if (rssCache && Date.now() - rssCache.time < 15000) return rssCache.posts;
  if (rssPending) return rssPending;
  rssPending = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(),16000);
    try {
      const response = await publicSession.fetch(RSS_URL,{headers:{Accept:'application/rss+xml, application/xml, text/xml'},credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
      // Electron's net.fetch currently leaves Response.url empty. The request is
      // fixed, redirects are rejected, and this partition also enforces a URL allowlist.
      if (!response.ok || (response.url && response.url !== RSS_URL)) throw new Error(`RSS 服务返回 ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('RSS 响应为空');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 4_000_000) { await reader.cancel(); throw new Error('RSS 内容超出大小限制'); }
        chunks.push(value);
      }
      const posts = parseRss(Buffer.concat(chunks).toString('utf8'));
      rssCache = {posts,time:Date.now()};
      return posts;
    } catch (error) {
      throw new Error('公开 RSS 读取失败，请检查网络后重试。' + (error instanceof Error && !/abort/i.test(error.message) ? ' ' + error.message : ''));
    } finally { clearTimeout(timer); }
  })();
  try { return await rssPending; } finally { rssPending = null; }
}
async function listPosts(input: ListingRequest): Promise<ListingResult> {
  const url = listingUrl(input); // Validate even when the user prefers RSS.
  const version = generation;
  let notice = '';
  if (store.settings.defaultSource === 'auto') {
    try {
      const result = await onWebsite<{posts:Post[];nextPage:number|null}>(url,extractListingScript);
      return {posts:result.posts.map(post => ({...post,url:normalizePostUrl(post.url),summary:sanitizeContent(post.summary || '')})),nextPage:result.nextPage,source:'web',fetchedAt:new Date().toISOString()};
    } catch {
      if (version !== generation) throw new Error('会话已变更，请重新读取');
      notice = '官网暂不可读取，已切换公开 RSS。可在官方窗口完成登录或验证后刷新。';
    }
  }
  if ((input.page || 1) > 1) throw new Error('公开 RSS 仅提供最近帖子，无法读取下一页。可在官方窗口浏览更多。');
  let posts = await rssPosts();
  if (version !== generation) throw new Error('会话已变更，请重新读取');
  if (input.category) posts = posts.filter(post => post.category === input.category);
  if (input.order === 'replyTime') notice += ' RSS 仅提供发布时间，当前按发布时间展示。';
  return {posts,source:'rss',nextPage:null,fetchedAt:new Date(rssCache!.time).toISOString(),notice:notice.trim() || '公开 RSS 仅包含最近的公开帖子和摘要。'};
}
async function readThread(input: Post, requestedPage?: number): Promise<ThreadResult> {
  const normalized = normalizePostUrl(input?.url);
  const location = new URL(normalized);
  const page = requestedPage ?? Number(location.pathname.match(/-(\d+)$/)![1]);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new Error('页码无效');
  const id = new URL(normalized).pathname.match(/^\/post-(\d+)-/)![1];
  const url = `${FORUM_ORIGIN}/post-${id}-${page}${Number(location.pathname.match(/-(\d+)$/)![1]) === page ? location.hash : ''}`;
  const version = generation;
  if (store.settings.defaultSource === 'auto') {
    try {
      const result = await onWebsite<ThreadResult>(url,extractThreadWithProfilesScript);
      return {...result,id,url,source:'web',comments:result.comments.map(c => ({...c,html:sanitizeContent(c.html),signatureHtml:c.signatureHtml?sanitizeContent(c.signatureHtml):undefined}))};
    } catch {
      if (version !== generation) throw new Error('会话已变更，请重新读取');
      // RSS fallback is explicitly marked as partial content.
    }
  }
  if (page > 1) throw new Error('RSS 不包含回复分页，请在官方窗口继续阅读');
  const posts = await rssPosts();
  if (version !== generation) throw new Error('会话已变更，请重新读取');
  const post = posts.find(p => p.id === id);
  if (!post) throw new Error('此帖不在当前公开 RSS 中，可能需要账号权限或已超出最近帖子范围。请在官方窗口阅读。');
  return {id,url,title:post.title,source:'rss',page:1,nextPage:null,notice:'当前显示公开 RSS 摘要。完整正文、图片与回复以官方页面为准。',comments:post.summary ? [{id:id+'-rss',author:post.author,date:post.published,floor:'摘要',html:sanitizeContent(post.summary)}] : []};
}
async function forumAction(input: ForumActionRequest): Promise<ForumActionResult> {
  const request=validateActionRequest(input);
  const userId=account.status==='signed-in'?account.id:undefined;
  if(!userId)throw new Error('请先在客户端内的官方页面登录，再进行操作');
  if(actionPending)throw new Error('上一项操作仍在处理中，请稍候');
  const version=generation;
  const url=request.kind==='reply' || request.kind==='react'?normalizePostUrl(request.url):`${FORUM_ORIGIN}/space/${request.memberId}`;
  actionPending=true;
  try {
    const result=await onWebsite<ForumActionResult>(url,createActionScript(request,userId),{timeout:35000,action:true});
    if(version!==generation || account.status!=='signed-in' || account.id!==userId)throw new Error('账号已变化，操作状态需在官方页面核对');
    return result;
  } finally {actionPending=false;}
}
async function loadAvatar(input: unknown): Promise<string | null> {
  if(!Number.isSafeInteger(input) || (input as number)<=0 || (input as number)>1_000_000_000)throw new Error('用户编号无效');
  const id=input as number;
  const cached=avatarCache.get(id);
  if(cached && Date.now()-cached.time<300000)return cached.data;
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),8000);
  try {
    const response=await forumSession.fetch(`${FORUM_ORIGIN}/avatar/${id}.png`,{credentials:'include',redirect:'error',signal:controller.signal});
    const mime=response.headers.get('content-type')?.split(';')[0] || '';
    if(!response.ok || !['image/png','image/jpeg','image/webp','image/gif'].includes(mime))return null;
    if(Number(response.headers.get('content-length'))>1_000_000)return null;
    const stream=response.body?.getReader();if(!stream)return null;
    const chunks:Uint8Array[]=[];let size=0;
    while(true) {const {done,value}=await stream.read();if(done)break;size+=value.byteLength;if(size>1_000_000){await stream.cancel();return null;}chunks.push(value);}
    const data=`data:${mime};base64,${Buffer.concat(chunks).toString('base64')}`;
    if(avatarCache.size>=150)avatarCache.delete(avatarCache.keys().next().value!);
    avatarCache.set(id,{data,time:Date.now()});return data;
  } catch {return null;} finally {clearTimeout(timer);}
}
function registerIPC() {
  const handle = (name: string, fn: (...args: any[]) => unknown) => ipcMain.handle(name, async (event,...args) => {assertLocal(event); return fn(...args);});
  const assertOwner=(owner:unknown)=>{if(account.status!=='signed-in'||!Number.isSafeInteger(owner)||owner!==account.id)throw new Error('账号已变化，请确认当前账号后重新操作');};
  handle('app:desktop-preferences',()=>desktopWindow.getPreferences());
  handle('app:close-behavior',(behavior)=>desktopWindow.setCloseBehavior(behavior));
  handle('app:update-state',()=>updater.getState());
  handle('app:update-check',()=>updater.check());
  handle('app:update-download',()=>updater.download());
  handle('app:update-cancel',()=>updater.cancel());
  handle('app:update-install',async()=>{
    if(updater.getState().status!=='downloaded'||!mainWindow)return updater.getState();
    const choice=await dialog.showMessageBox(mainWindow,{type:'question',title:'安装 SeekDesk 更新',message:'现在重启并安装更新？',detail:'请先保存正在编辑的内容。安装完成后会重新打开客户端。',buttons:['立即安装','取消'],defaultId:1,cancelId:1,noLink:true});
    if(choice.response!==0)return updater.getState();
    await Promise.all([store.save(),features.save(),desktopWindow.flush()]);
    return updater.install();
  });
  handle('tool:calculator',openCalculator);
  handle('parity:query',queryForum);
  handle('parity:write',(request,owner)=>{assertOwner(owner);return writeForum(request);});
  handle('parity:bootstrap',async()=>({extensions:extensions.getState(),appearance:features.appearance,media:media.settings(),stickers:await media.getStickers(),searchHistory:features.history}));
  handle('parity:appearance',async(value:unknown)=>{features.appearance=validateAppearance(value);await features.save();applyBrandIcon();return features.appearance;});
  handle('parity:history',async(value:unknown)=>{features.history=validateHistory(value);await features.save();});
  handle('parity:draft-load',(key:string,owner?:number)=>features.loadDraft(account.status==='signed-in'&&account.id===owner?owner:undefined,key));
  handle('parity:draft-save',(key:string,value:unknown,owner?:number)=>{if(account.status!=='signed-in'||!owner||account.id!==owner)throw new Error('草稿所属账号已变化，未保存到其他账号');return features.saveDraft(owner,key,value);});
  handle('media:upload',(input)=>media.upload(input));
  handle('media:prepare',(content,widths)=>media.prepare(content,widths));
  handle('media:image-save',(url)=>media.saveImage(url));
  handle('media:image-copy',(url)=>media.copyImage(url));
  handle('media:reader-image',(url,width)=>media.readerImage(url,width));
  handle('media:settings',()=>media.settings());
  handle('media:save-settings',(input)=>media.setSettings(input));
  handle('media:stickers',()=>media.getStickers());
  handle('media:import',(group)=>media.importStickers(group));
  handle('media:remove',(id)=>media.removeSticker(id));
  handle('media:sticker-upload',(id)=>media.uploadSticker(id));
  handle('extensions:get',()=>extensions.getState());
  handle('extensions:save',async(value)=>{if(!value||typeof value!=='object'||JSON.stringify(value).length>1000000)throw new Error('扩展设置无效');const state=extensions.update(value);await features.save();return state;});
  handle('extensions:ranking',(period:RankingPeriod,force?:boolean)=>extensions.rankings(period,force===true));
  handle('extensions:rulings',async(id:number,username?:string)=>{if(!Number.isSafeInteger(id)||id<(username?0:1))throw new Error('用户编号无效');if(!username){const result=await queryForum({kind:'introduction',memberId:id});username=result.profile?.name;}return extensions.rulings(id,username||'');});
  handle('extensions:rates',(base)=>extensions.exchangeRates(base));
  handle('extensions:calculate',(input)=>extensions.calculate(input));
  handle('extensions:boss-toggle',()=>toggleBoss());
  handle('app:clipboard',(value:unknown)=>{if(typeof value!=='string'||value.length>2000000)throw new Error('复制文本无效');return clipboard.writeText(value);});
  handle('app:updates',()=>updater.check());
  handle('app:bootstrap', () => ({settings:store.settings,workspace:store.settings.restoreTabs ? store.workspace : {tabs:[],activeId:null,overviewOpen:store.workspace.overviewOpen ?? true},account,version:app.getVersion(),buildNumber,official:officialState,blockedUsers:store.blockedUsers}));
  handle('forum:list', (request: ListingRequest) => listPosts(request || {}));
  handle('forum:thread', readThread);
  handle('forum:action',(request,owner)=>{assertOwner(owner);return forumAction(request);});
  handle('forum:avatar',loadAvatar);
  handle('app:blocked-users',async(input:unknown)=>{store.blockedUsers=validateBlockedUsers(input);await store.save();return store.blockedUsers;});
  handle('script:settings',async()=>{
    if(!store.settings.nodeSeekPro)throw new Error('请先启用 NodeSeek Pro');
    if(!officialView || !officialState.visible || officialState.purpose==='calculator')await openOfficial(FORUM_ORIGIN+'/');
    if(!officialView)throw new Error('官方页面尚未就绪');
    await userscriptHost.inject(officialView.webContents);
    await userscriptHost.openMenu(officialView.webContents);
  });
  handle('forum:open', (url?: string) => openOfficial(url));
  handle('forum:close',closeOfficial);
  handle('forum:bounds',setOfficialBounds);
  handle('forum:reload',()=>{const view=officialState.purpose==='calculator'?calculatorView:officialView;if(view&&!view.webContents.isDestroyed())view.webContents.reload();});
  handle('app:external', (url: string) => shell.openExternal(safeHttp(url)));
  handle('forum:account', async () => {
    if (officialState.purpose!=='calculator'&&officialView && !officialView.webContents.isDestroyed()) return inspectOfficial();
    try { await onWebsite(FORUM_ORIGIN+'/',extractIdentityScript); } catch { /* Expose unknown/verification instead of claiming login. */ }
    return account;
  });
  handle('forum:clear', async () => {
    generation++;
    destroyOfficial(); readerWindow?.destroy();
    readerWindow=null;
    await forumSession.clearStorageData();
    await forumSession.clearCache();
    await forumSession.closeAllConnections();
    avatarCache.clear();
    store.workspace={tabs:[],activeId:null};
    await store.save();
    verificationUntil=0;
    setAccount({status:'signed-out'});
  });
  handle('app:settings', async (value: unknown) => {
    const next=validateSettings(value);
    const scriptChanged=store.settings.nodeSeekPro!==next.nodeSeekPro;
    store.settings=next;await store.save();
    if(officialView) {
      officialView.webContents.setZoomFactor(store.settings.uiFontSize/16);
      if(scriptChanged) {
        if(officialState.visible)officialView.webContents.reload();
        else destroyOfficial();
      }
    }
    calculatorView?.webContents.setZoomFactor(store.settings.uiFontSize/16);
    return store.settings;
  });
  handle('app:workspace', async (value: unknown) => {store.workspace=validateWorkspace(value); await store.save();});
  ipcMain.on('app:window',(event,action) => {assertLocal(event); if (action==='close') mainWindow?.close(); else if(action==='minimize') mainWindow?.minimize(); else if(action==='maximize' && mainWindow) {if(mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();}});
}
function createMain() {
  mainWindow = new BrowserWindow({...desktopWindow.createOptions(),show:false,frame:false,backgroundColor:'#f6f7f9',title:'SeekDesk Windows',icon:path.join(__dirname,'../../build/icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
  desktopWindow.attach(mainWindow);
  mainWindow.setMenuBarVisibility(false);
  applyBrandIcon();
  mainWindow.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  mainWindow.webContents.on('will-navigate',(event,url) => {if(url !== rendererURL) event.preventDefault();});
  mainWindow.webContents.on('will-redirect',event => event.preventDefault());
  mainWindow.webContents.on('did-start-loading',closeOfficial);
  mainWindow.on('ready-to-show',() => {desktopWindow.restore();mainWindow?.show();});
  mainWindow.on('close',event=>{if(!event.defaultPrevented){destroyOfficial();destroyCalculator();}});
  mainWindow.on('closed',() => {mainWindow=null;app.quit();});
  void mainWindow.loadURL(rendererURL);
}
if (!app.requestSingleInstanceLock() && !testing) app.quit();
else {
  app.on('second-instance',() => desktopWindow?.show());
  app.whenReady().then(async () => {
    app.setAppUserModelId('cc.seekdesk.windows');
    try{const built=await fs.stat(rendererFile);buildNumber=built.mtime.toISOString().replace(/[-:TZ.]/g,'').slice(0,14);}catch{}
    forumSession = session.fromPartition('persist:nodeseek');
    calculatorSession = session.fromPartition('persist:calculator');
    calculatorSession.setPermissionRequestHandler((contents,permission,callback)=>callback(contents===calculatorView?.webContents&&isCalculatorUrl(contents.getURL())&&permission==='clipboard-sanitized-write'));
    calculatorSession.setPermissionCheckHandler((contents,permission,origin)=>contents===calculatorView?.webContents&&isCalculatorUrl(origin)&&permission==='clipboard-sanitized-write');
    calculatorSession.on('will-download',event=>event.preventDefault());
    publicSession = session.fromPartition('public-rss');
    publicSession.webRequest.onBeforeRequest((details,callback) => callback({cancel:details.url !== RSS_URL}));
    for (const s of [session.defaultSession,forumSession,publicSession]) {
      s.setPermissionRequestHandler((_webContents,_permission,callback) => callback(false));
      s.setPermissionCheckHandler(() => false);
      s.on('will-download',event => event.preventDefault());
    }
    store = new Store(app.getPath('userData'));
    await store.load();
    features=new ParityStore(app.getPath('userData'));
    media=new MediaService(app.getPath('userData'),()=>mainWindow);
    await Promise.all([features.load(),media.load()]);
    desktopWindow=await DesktopWindowController.load({directory:app.getPath('userData'),app,screen,dialog,createTray:icon=>new Tray(icon),createMenu:template=>Menu.buildFromTemplate(template),trayIcon:path.join(__dirname,'../../build/icon.ico'),onFinalQuit:async()=>{await Promise.all([store.save(),features.save()]);}});
    const installed=app.isPackaged&&process.platform==='win32'&&!process.env.PORTABLE_EXECUTABLE_DIR&&await fs.stat(path.join(path.dirname(process.execPath),'Uninstall SeekDesk Windows.exe')).then(value=>value.isFile()).catch(()=>false);
    updater=new UpdaterService({currentVersion:app.getVersion(),isPackaged:app.isPackaged,isInstalled:installed,userDataDirectory:app.getPath('userData'),onChange:state=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('app:update-change',state);}});
    extensions=new ExtensionsService(features.extensions,{
      getAccount:()=>account,
      readAttendance:async()=>{const result=await queryForum({kind:'attendance-status'});return result.attendance||{kind:'failed'};},
      performAttendance:async(mode)=>{const result=await writeForum({kind:'attendance',mode},true);return result.attendance||{kind:'failed',message:result.message};},
      onChange:state=>{features.extensions=state;void features.save().catch(error=>console.error('保存扩展设置失败',error));mainWindow?.webContents.send('extensions:change',state);},
      onBossKey:configureBoss,
      onMatch:hit=>{if(!extensions.getState().watchSystemNotifications||!Notification.isSupported())return;const notification=new Notification({title:'SeekDesk · 关键词提醒',body:hit.post.title,silent:false});notification.on('click',()=>{mainWindow?.show();mainWindow?.focus();mainWindow?.webContents.send('app:open-post',hit.post);});notification.show();}
    });
    userscriptHost=new UserscriptHost({storageDirectory:path.join(app.getPath('userData'),'userscripts'),getOfficialContents:()=>officialState.purpose==='calculator'?null:officialView?.webContents ?? null,isEnabled:()=>store.settings.nodeSeekPro&&officialState.purpose!=='calculator',onOpen:async(url:string)=>{if(isOfficialUrl(url))await openOfficial(url);else await shell.openExternal(safeHttp(url));}});
    await userscriptHost.load();
    userscriptHost.registerIPC(ipcMain);
    registerIPC();
    createMain();
    if(!testing)void updater.initialize().catch(()=>{});
  }).catch(error => {console.error('SeekDesk startup failed:',error);app.quit();});
}
app.on('window-all-closed',() => app.quit());
app.on('will-quit',()=>{extensions?.dispose();updater?.dispose();desktopWindow?.dispose();globalShortcut.unregisterAll();});
