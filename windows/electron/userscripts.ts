import fs from 'node:fs/promises';
import path from 'node:path';
import type {IpcMain,IpcMainInvokeEvent,WebContents} from 'electron';
import {isOfficialUrl} from './forum';
import type {ProCredentials,ProState} from '../shared/pro';

export const USERSCRIPT_WORLD=1004;
export const NODESEEK_PRO_VERSION='1.0.8';
const MAX_STORAGE=512_000;
const MAX_REQUEST=8_000_000;
const allowedHosts=new Set(['api.nodeimage.com','api.openai.com']);
type Stored=Record<string,unknown>;
interface SerializedFormEntry {name:string;value?:string;bytes?:number[];filename?:string;type?:string}
export interface UserscriptRequest {url:string;method?:string;headers?:Record<string,string>;data?:string;form?:SerializedFormEntry[];responseType?:string;timeout?:number}

export function adaptUserscriptSource(source:string):string {
  // Git checkouts may use CRLF. Normalize the runtime copy, never the pinned asset.
  source=source.replace(/\r\n?/g,'\n');
  // The original helper recognizes only HTTP stylesheet URLs, while the GM
  // resource API returns local data URLs. Runtime adapters stay explicit;
  // the vendored original remains untouched and hash-verifiable.
  const original='const isUrl = /^(https?:)?\\/\\//.test(val);';
  if(!source.includes(original))throw new Error('NodeSeek Pro固定版本的资源适配位置未找到');
  let adapted=source.replace(original,'const isUrl = /^(https?:)?\\/\\/|^data:text\\/css/.test(val);');
  const formStart=adapted.indexOf('yes: (idx, ly) => {'),apply=adapted.indexOf('applyRuntimeSettings(ctx, changedKeys);',formStart);
  if(formStart<0||apply<0)throw Error('固定版本的设置确认适配位置未找到');
  let form=adapted.slice(formStart,apply);
  form=form.replace('yes: (idx, ly) => {','yes: async (idx, ly) => {').replace('const changedKeys = [];','if(__seekdeskSaving.has(sc))return;const changedKeys = [],nextSettings=JSON.parse(JSON.stringify(store.init()));').replace('store.set(el.name, v);','__seekdeskSetDraft(nextSettings,el.name,v);');
  form+=`const unlock=__seekdeskLock(sc);const saved=await GM_setValue('settings',nextSettings).then(()=>true,()=>false);unlock();if(!saved)return;cfgCache=nextSettings;\n                        `;
  adapted=adapted.slice(0,formStart)+form+adapted.slice(apply);
  const aiSet=adapted.indexOf('ctx.store.set("ai_comment.api_type", type);'),aiStart=adapted.lastIndexOf('yes: (idx) => {',aiSet),aiClose=adapted.indexOf('ctx.ui.layer.close(idx);',aiSet);
  if(aiSet<0||aiStart<0||aiClose<0)throw Error('固定版本的 AI 设置确认适配位置未找到');
  let ai=adapted.slice(aiStart,aiClose).replace('yes: (idx) => {','yes: async (idx) => {');
  ai=ai.replace('ctx.store.set("ai_comment.api_type", type);',`if(__seekdeskSaving.has(r))return;const nextSettings=JSON.parse(JSON.stringify(store.init())),unlock=__seekdeskLock(r);__seekdeskSetDraft(nextSettings,"ai_comment.api_type", type);`).replaceAll('ctx.store.set(', '__seekdeskSetDraft(nextSettings,');
  ai+=`const saved=await GM_setValue('settings',nextSettings).then(()=>true,()=>false);unlock();if(!saved)return;cfgCache=nextSettings;\n                        `;
  adapted=adapted.slice(0,aiStart)+ai+adapted.slice(aiClose);
  const start=adapted.indexOf('    const downloadBackupFile = payload => {'),end=adapted.indexOf('\n\n    const menus =',start);
  if(start<0||end<0)throw Error('固定版本的备份适配位置未找到');
  return adapted.slice(0,start)+`    const downloadBackupFile = () => {throw Error('官网整站备份暂不支持；请在客户端设置中导出去密的脚本偏好');};`+adapted.slice(end);
}

export function validateUserscriptRequest(input:unknown):UserscriptRequest {
  if(!input || typeof input!=='object')throw new Error('脚本请求无效');
  const value=input as UserscriptRequest;
  if(typeof value.url!=='string' || value.url.length>4096)throw new Error('脚本请求地址无效');
  const url=new URL(value.url);
  if(url.protocol!=='https:' || url.username || url.password || url.port || !allowedHosts.has(url.hostname))throw new Error('此跨域地址不在 NodeSeek Pro 允许列表中');
  const method=(value.method || 'GET').toUpperCase();
  if(!['GET','POST','PUT','PATCH','DELETE','HEAD'].includes(method))throw new Error('脚本请求方法无效');
  const headers:Record<string,string>={};
  for(const [key,content] of Object.entries(value.headers || {})) {
    if(!/^[a-z0-9-]{1,80}$/i.test(key) || typeof content!=='string' || content.length>8192 || /[\r\n]/.test(content))throw new Error('脚本请求头无效');
    if(/^(cookie|host|origin|referer|proxy-|sec-)/i.test(key))throw new Error('脚本不能转发 Cookie 或站点身份请求头');
    headers[key]=content;
  }
  if(value.data!==undefined && (typeof value.data!=='string' || Buffer.byteLength(value.data)>MAX_REQUEST))throw new Error('脚本请求内容过大');
  if(value.form!==undefined) {
    if(!Array.isArray(value.form) || value.form.length>30 || JSON.stringify(value.form).length>MAX_REQUEST*4)throw new Error('脚本上传内容无效');
    let total=0;
    for(const entry of value.form) {
      if(!entry || typeof entry.name!=='string' || entry.name.length>200)throw new Error('脚本上传字段无效');
      if(entry.bytes) {
        if(!Array.isArray(entry.bytes) || entry.bytes.some(byte=>!Number.isInteger(byte)||byte<0||byte>255))throw new Error('脚本上传文件无效');
        total+=entry.bytes.length;
      } else if(typeof entry.value==='string')total+=Buffer.byteLength(entry.value);
      else throw new Error('脚本上传字段无效');
      if(total>MAX_REQUEST)throw new Error('脚本上传超过 8MB');
    }
  }
  return {url:url.href,method,headers,data:value.data,form:value.form,responseType:value.responseType==='json'?'json':'text',timeout:Math.min(30000,Math.max(1000,Number(value.timeout)||20000))};
}

export function initialUserscriptValues(input:unknown):Stored {
  const values=input && typeof input==='object' && !Array.isArray(input)?JSON.parse(JSON.stringify(input)):{};
  if(!values.settings || typeof values.settings!=='object' || Array.isArray(values.settings))values.settings={};
  const settings=values.settings;
  if(!settings.sign_in || typeof settings.sign_in!=='object')settings.sign_in={};
  for(const code of ['ns','df']) {
    if(!settings.sign_in[code] || typeof settings.sign_in[code]!=='object')settings.sign_in[code]={enabled:false,method:0,last_date:'',ignore_date:''};
    else if(settings.sign_in[code].enabled===undefined)settings.sign_in[code].enabled=false;
  }
  return values;
}

export interface UserscriptHostOptions {
  storageDirectory:string;
  getOfficialContents:()=>WebContents|null;
  onOpen:(url:string)=>Promise<void>;
  isEnabled?:()=>boolean;
  vendorDirectory?:string;
  storageProtection?:{isEncryptionAvailable:()=>boolean;encryptString:(value:string)=>Buffer;decryptString:(value:Buffer)=>string};
  fileSystem?:Pick<typeof fs,'readFile'|'writeFile'|'mkdir'|'rename'|'unlink'>;
  onManageCredentials?:()=>void;
  onState?:(state:ProState)=>void;
}

const credentialName=/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth(?:orization|[_-]?token)|password|client[_-]?secret)$/i;
function mapCredentials(value:unknown,convert:(value:unknown)=>unknown,key=''):unknown {
  if(credentialName.test(key))return convert(value);
  if(Array.isArray(value))return value.map(item=>mapCredentials(item,convert));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([name,item])=>[name,mapCredentials(item,convert,name)]));
  return value;
}
export function publicUserscriptValues(values:Stored):Stored{return mapCredentials(values,value=>typeof value==='string'&&value?'已配置（客户端保管）':'') as Stored;}
function preserveCredentials(previous:unknown,next:unknown,key=''):unknown{
  if(credentialName.test(key))return previous;
  if(Array.isArray(next)&&(!previous||Array.isArray(previous)))return next.map((value,index)=>preserveCredentials(Array.isArray(previous)?previous[index]:undefined,value));
  if(previous&&typeof previous==='object'&&!Array.isArray(previous)||next&&typeof next==='object'&&!Array.isArray(next)){
    const old=previous&&typeof previous==='object'&&!Array.isArray(previous)?previous as Stored:{},candidate=next&&typeof next==='object'&&!Array.isArray(next)?next as Stored:{};
    const result:Stored=Object.create(null);for(const name of new Set([...Object.keys(old),...Object.keys(candidate)])){const value=preserveCredentials(old[name],candidate[name],name);if(value!==undefined)result[name]=value;}
    return next&&typeof next==='object'?result:Object.keys(result).length?result:next;
  }return next;
}

export class UserscriptHost {
  private values:Stored=initialUserscriptValues({});
  private queue:Promise<unknown>=Promise.resolve();
  private assets:Record<string,string>|undefined;
  private readonly vendor:string;
  private problem:string|undefined;
  private state:ProState={status:'preparing'};private injection=0;
  getState():ProState{if(this.options.isEnabled?.()===false)return {status:'disabled'};const contents=this.options.getOfficialContents();if(!contents||contents.isDestroyed())return {status:'unsupported',message:'打开支持的官网页面后即可运行'};return {...this.state};}
  reset(){this.injection++;this.setState({status:'preparing'});}
  private setState(state:ProState){this.state=state;this.options.onState?.(this.getState());}
  private readonly io:NonNullable<UserscriptHostOptions['fileSystem']>;
  get storageWarning(){return this.problem;}
  private assertHealthy(){if(this.problem)throw Error(this.problem);}
  constructor(private options:UserscriptHostOptions) {this.vendor=options.vendorDirectory || path.resolve(__dirname,'../../vendor/nodeseek-pro');this.io=options.fileSystem||fs;}
  async load() {
    let read=false;
    try {
      const stored=JSON.parse(await this.io.readFile(path.join(this.options.storageDirectory,'nodeseek-pro.json'),'utf8'));
      read=true;
      if(!stored||typeof stored!=='object'||Array.isArray(stored))throw Error('invalid script storage');
      let migrate=false;
      const decoded=mapCredentials(stored,value=>{
        if(typeof value==='string'){if(value)migrate=true;return value;}
        if(value&&typeof value==='object'&&(value as {protected?:unknown}).protected==='seekdesk-dpapi-v1'){
          const data=(value as {data?:unknown}).data,protection=this.options.storageProtection;
          if(!protection?.isEncryptionAvailable()||typeof data!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))throw Error('credentials unavailable');
          return protection.decryptString(Buffer.from(data,'base64'));
        }
        return value;
      });
      const next=initialUserscriptValues(decoded);
      if(migrate)await this.persist(next);
      this.values=next;this.problem=undefined;
    } catch(error) {
      if(!read&&(error as NodeJS.ErrnoException).code==='ENOENT')return;
      this.problem='NodeSeek Pro 配置或加密凭据无法读取，原文件已保留；请修复后重新启动应用';
    }
  }
  private async persist(next:Stored) {
    this.assertHealthy();
    const encoded=mapCredentials(next,value=>{
      if(typeof value!=='string'||!value)return value;
      const protection=this.options.storageProtection;
      if(!protection?.isEncryptionAvailable())throw Error('系统凭据保护不可用，密钥未保存');
      return {protected:'seekdesk-dpapi-v1',data:protection.encryptString(value).toString('base64')};
    });
    const target=path.join(this.options.storageDirectory,'nodeseek-pro.json');
    try{await this.io.mkdir(this.options.storageDirectory,{recursive:true});await this.io.writeFile(target+'.tmp',JSON.stringify(encoded),'utf8');await this.io.rename(target+'.tmp',target);}
    finally{await this.io.unlink(target+'.tmp').catch(()=>{});}
  }
  private commit(update:(previous:Stored)=>Stored) {
    const task=this.queue.catch(()=>{}).then(async()=>{
      this.assertHealthy();const next=update(this.values);
      if(Buffer.byteLength(JSON.stringify(next))>MAX_STORAGE)throw new Error('脚本配置超过 512KB');
      await this.persist(next);this.values=next;
    });
    this.queue=task;return task;
  }
  private credential(service:'ai'|'nodeimage'):string{const settings=this.values.settings as Record<string,Record<string,unknown>>|undefined,value=settings?.[service==='ai'?'ai_comment':'image_upload']?.api_key;return typeof value==='string'?value:'';}
  credentials():ProCredentials{return {aiConfigured:!!this.credential('ai'),nodeimageConfigured:!!this.credential('nodeimage'),...(this.problem?{warning:this.problem}:{})};}
  async saveCredential(input:unknown):Promise<ProCredentials>{
    if(!input||typeof input!=='object')throw Error('凭据参数无效');const value=input as {service?:unknown;apiKey?:unknown;clear?:unknown};
    if(value.service!=='ai'&&value.service!=='nodeimage'||value.clear!==undefined&&typeof value.clear!=='boolean'||value.apiKey!==undefined&&(typeof value.apiKey!=='string'||!value.apiKey.trim()||value.apiKey.length>1000||/[\r\n\0]/.test(value.apiKey)))throw Error('凭据参数无效');
    if(value.clear!==true&&value.apiKey===undefined)throw Error('请填写新密钥或明确选择清除');
    await this.commit(previous=>{const next=initialUserscriptValues(previous),settings=next.settings as Record<string,Record<string,unknown>>,name=value.service==='ai'?'ai_comment':'image_upload';settings[name]={...(settings[name]||{}),api_key:value.clear===true?'':(value.apiKey as string).trim()};return next;});
    const contents=this.options.getOfficialContents();
    if(contents&&!contents.isDestroyed())void Promise.resolve().then(()=>contents.executeJavaScriptInIsolatedWorld(USERSCRIPT_WORLD,[{code:`window.__seekdeskProRuntime?.updateCredentialState?.(${JSON.stringify(this.credentials())})`}])).catch(()=>{});
    return this.credentials();
  }
  exportPreferences(){this.assertHealthy();return JSON.stringify({format:'seekdesk-pro-preferences',version:1,values:mapCredentials(this.values,()=>undefined)},null,2);}
  private assertSender(event:IpcMainInvokeEvent) {
    const official=this.options.getOfficialContents();
    if(this.options.isEnabled?.()===false || !official || official.isDestroyed() || event.sender!==official || event.senderFrame!==official.mainFrame || !isOfficialUrl(event.senderFrame.url))throw new Error('此页面不能调用脚本宿主');
  }
  registerIPC(ipc:IpcMain) {
    const handle=(name:string,fn:(...args:any[])=>unknown)=>ipc.handle(name,(event,...args)=>{this.assertSender(event);return fn(...args);});
    handle('userscript:set',async(key:unknown,value:unknown)=>{
      if(typeof key!=='string' || !/^[\w.-]{1,120}$/.test(key) || ['__proto__','prototype','constructor'].includes(key))throw new Error('脚本配置键无效');
      const clone=JSON.parse(JSON.stringify(value));
      await this.commit(previous=>preserveCredentials(previous,{...previous,[key]:clone}) as Stored);
      return publicUserscriptValues(this.values)[key];
    });
    handle('userscript:remove',async(key:unknown)=>{if(typeof key!=='string' || !/^[\w.-]{1,120}$/.test(key)||['__proto__','prototype','constructor'].includes(key))throw new Error('脚本配置键无效');await this.commit(previous=>preserveCredentials(previous,Object.fromEntries(Object.entries(previous).filter(([name])=>name!==key))) as Stored);return publicUserscriptValues(this.values)[key];});
    handle('userscript:credentials',()=>this.options.onManageCredentials?.());
    handle('userscript:open',async(url:unknown)=>{
      if(typeof url!=='string' || url.length>4096)throw new Error('链接无效');
      const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password)throw new Error('仅允许网页链接');
      await this.options.onOpen(parsed.href);
    });
    handle('userscript:request',async(input:unknown)=>this.request(validateUserscriptRequest(input)));
  }
  private async request(request:UserscriptRequest) {
    const url=new URL(request.url),ai=url.href==='https://api.openai.com/v1/chat/completions'&&request.method==='POST',image=url.href==='https://api.nodeimage.com/api/upload'&&request.method==='POST';
    if(!ai&&!image)throw Error('仅支持标准 OpenAI 聊天和 NodeImage 上传；请在客户端管理凭据，自定义服务和自动取 Key 暂不支持');
    const key=this.credential(ai?'ai':'nodeimage');if(!key)throw Error('请先在客户端设置中配置 '+(ai?'OpenAI':'NodeImage')+' 密钥');
    const headers=Object.fromEntries(Object.entries(request.headers||{}).filter(([name])=>!/^authorization$|^x-api-key$/i.test(name)));
    headers[ai?'Authorization':'X-API-Key']=ai?'Bearer '+key:key;
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),request.timeout);
    try {
      let body:BodyInit|undefined=request.data;
      if(request.form) {
        const form=new FormData();
        for(const entry of request.form) {
          if(entry.bytes)form.append(entry.name,new Blob([new Uint8Array(entry.bytes)],{type:entry.type || 'application/octet-stream'}),entry.filename || 'upload');
          else form.append(entry.name,entry.value!);
        }
        body=form;
      }
      // This fetch has no Electron forum session, no Cookie header, and rejects
      // redirects so a configured API key cannot be forwarded to another host.
      const response=await fetch(request.url,{method:request.method,headers,body,credentials:'omit',redirect:'error',signal:controller.signal});
      if(!response.body) return {status:response.status,responseText:'',response:null,responseHeaders:'',finalUrl:request.url};
      const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_REQUEST){await reader.cancel();throw new Error('脚本响应超过 8MB');}chunks.push(value);}
      const responseText=Buffer.concat(chunks).toString('utf8').split(key).join('[redacted]');
      let parsed:unknown=responseText;if(request.responseType==='json'){try{parsed=JSON.parse(responseText);}catch{parsed=null;}}
      return {status:response.status,responseText,response:parsed,responseHeaders:[...response.headers].filter(([name])=>!/^set-cookie$|^authorization$|^x-api-key$/i.test(name)).map(([name,value])=>`${name}: ${value.split(key).join('[redacted]')}`).join('\r\n'),finalUrl:request.url};
    } finally {clearTimeout(timer);}
  }
  private async getAssets() {
    if(this.assets)return this.assets;
    const names=['nodeseek-pro.user.js','layui.js','layui.css','layui-dark.css','highlight.js','highlight-light.css','highlight-dark.css'];
    const result:Record<string,string>={};
    await Promise.all(names.map(async name=>{result[name]=await fs.readFile(path.join(this.vendor,name),'utf8');}));
    const font=(await fs.readFile(path.join(this.vendor,'layui-icon.woff2'))).toString('base64');
    result['layui.css']=result['layui.css'].replace(/url\([^)]*iconfont[^)]*\)/g,`url(data:font/woff2;base64,${font})`);
    this.assets=result;return result;
  }
  async inject(contents:WebContents) {
    if(this.options.isEnabled?.()===false || contents.isDestroyed() || contents!==this.options.getOfficialContents() || !isOfficialUrl(contents.getURL()))return {status:'skipped'};
    const version=++this.injection,url=contents.getURL();this.setState({status:'preparing'});
    try{
      this.assertHealthy();
      const state=await contents.executeJavaScript(`(()=>{if(!document.querySelector('#nsk-head'))return {unavailable:/just a moment|验证|checking your browser/i.test(document.title)?'verification':'unsupported'};return JSON.parse(JSON.stringify({user:window.__config__?.user||null,postData:window.__config__?.postData||null}));})()`);
      if(version!==this.injection||contents.isDestroyed()||contents.getURL()!==url)return {status:'skipped'};
      if(state?.unavailable){this.setState({status:state.unavailable==='verification'?'verification':'unsupported',message:'请完成官网验证或打开支持的论坛页面后重试'});return this.getState();}
      const assets=await this.getAssets();if(version!==this.injection||contents.isDestroyed()||contents.getURL()!==url)return {status:'skipped'};
      const result=await contents.executeJavaScriptInIsolatedWorld(USERSCRIPT_WORLD,[{code:buildUserscriptRuntime({values:publicUserscriptValues(this.values),config:state,assets})}]);
      if(version===this.injection&&!contents.isDestroyed()&&contents.getURL()===url)this.setState({status:'running'});
      return result;
    }catch{if(version===this.injection)this.setState({status:'failed',message:'NodeSeek Pro 加载失败，请刷新官网页重试或检查本机脚本配置'});return this.getState();}
  }
  async openMenu(contents:WebContents) {
    if(contents!==this.options.getOfficialContents() || contents.isDestroyed())throw new Error('请先打开内嵌官方页面');
    return contents.executeJavaScriptInIsolatedWorld(USERSCRIPT_WORLD,[{code:`(()=>{if(!window.__seekdeskProRuntime)throw Error('当前页面未加载 NodeSeek Pro，请完成官网验证后刷新');window.__seekdeskProRuntime.showMenu();return {status:'opened'};})()`}]);
  }
}

export function buildUserscriptRuntime(input:{values:Stored;config:unknown;assets:Record<string,string>}):string {
  const resources={highlightStyle:'data:text/css;base64,'+Buffer.from(input.assets['highlight-light.css']).toString('base64'),highlightStyle_dark:'data:text/css;base64,'+Buffer.from(input.assets['highlight-dark.css']).toString('base64')};
  const preparation=String.raw`(() => {
    if(window.__seekdeskProRuntime)return {status:'already-running',version:'1.0.8'};
    const bridge=window.__seekdeskGM;if(!bridge)throw Error('NodeSeek Pro隔离桥未建立');
    const values=__VALUES__,config=__CONFIG__,resources=__RESOURCES__;
    let credentialState={aiConfigured:!!values.settings?.ai_comment?.api_key,nodeimageConfigured:!!values.settings?.image_upload?.api_key};
    // The plugin only receives an opaque capability marker. Main binds the
    // actual current credential at the two fixed HTTPS operation endpoints.
    for(const name of ['ai_comment','image_upload']){values.settings[name]??={};values.settings[name].api_key='seekdesk-key';}
    const clone=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
    const menus=new Map();let nextMenu=1;
    const host=document.createElement('div');host.id='seekdesk-pro-host';host.style.cssText='position:fixed;right:12px;bottom:12px;z-index:2147483646;font:14px system-ui;color:#20304a';
    const toggle=document.createElement('button');toggle.textContent='NodeSeek Pro 设置';toggle.type='button';toggle.style.cssText='font:inherit;border:1px solid #9aadd1;background:#fff;color:#20304a;border-radius:6px;padding:8px 12px;cursor:pointer';
    const menu=document.createElement('div');menu.id='seekdesk-pro-menu';menu.style.cssText='display:none;position:absolute;right:0;bottom:42px;max-height:70vh;overflow:auto;min-width:250px;padding:6px;background:#fff;border:1px solid #9aadd1;border-radius:7px;box-shadow:0 6px 25px #0003';
    const showMenu=()=>{menu.replaceChildren();for(const [id,entry]of menus){const button=document.createElement('button');button.type='button';button.dataset.menuId=String(id);button.textContent=entry.label;button.style.cssText='display:block;width:100%;text-align:left;font:14px system-ui;padding:9px 10px;background:none;color:#20304a;border:0;cursor:pointer';button.onclick=()=>{menu.style.display='none';entry.callback();};menu.append(button);}menu.style.display=menu.style.display==='none'?'block':'none';};
    toggle.onclick=showMenu;host.append(toggle,menu);document.body.append(host);
    const status=document.createElement('div');status.id='seekdesk-pro-status';status.style.cssText='font-size:12px;padding:5px 0';host.append(status);
    const reportError=error=>{status.textContent=error?.message || String(error);status.style.color='#a32b35';};
    const GM_info={script:{name:'Nodeseek Pro',version:'1.0.8',description:'SeekDesk官方页面兼容运行'},scriptHandler:'SeekDesk isolated userscript host'};
    const GM_getValue=(key,fallback)=>key in values?clone(values[key]):fallback;
    const writes=new Set();let writeQueue=Promise.resolve();
    const persist=(key,save)=>{const task=writeQueue.catch(()=>{}).then(save).then(confirmed=>{if(confirmed===undefined)delete values[key];else values[key]=clone(confirmed);if(key==='settings'&&values.settings){credentialState={aiConfigured:!!values.settings.ai_comment?.api_key,nodeimageConfigured:!!values.settings.image_upload?.api_key};for(const name of ['ai_comment','image_upload']){values.settings[name]??={};values.settings[name].api_key='seekdesk-key';}}return confirmed;});writeQueue=task;writes.add(task);void task.then(()=>writes.delete(task),error=>{writes.delete(task);reportError(error);});return task;};
    const GM_setValue=(key,value)=>{const next=clone(value);return persist(key,()=>bridge.set(key,next));};
    const GM_deleteValue=key=>persist(key,()=>bridge.remove(key));
    const __seekdeskSaving=new WeakSet();
    const __seekdeskLock=root=>{__seekdeskSaving.add(root);const controls=[...root.querySelectorAll('input,select,textarea,button')].map(node=>[node,node.disabled]);for(const [node]of controls)node.disabled=true;return()=>{for(const [node,disabled]of controls)node.disabled=disabled;__seekdeskSaving.delete(root);};};
    const __seekdeskSetDraft=(settings,path,value)=>{const parts=String(path).split('.');if(parts.some(part=>!part||['__proto__','prototype','constructor'].includes(part)))throw Error('脚本配置位置无效');let target=settings;for(const part of parts.slice(0,-1)){if(!target[part]||typeof target[part]!=='object')target[part]={};target=target[part];}target[parts.at(-1)]=/api[_-]?key/i.test(parts.at(-1))?'seekdesk-key':value;};
    const GM_registerMenuCommand=(label,callback)=>{const id=nextMenu++;menus.set(id,{label:String(label),callback});return id;};
    const GM_unregisterMenuCommand=id=>menus.delete(id);
    GM_registerMenuCommand('API 凭据（客户端）',()=>{void bridge.credentials?.().catch(reportError);});
    const maskCredentialInputs=()=>{if(typeof document==='undefined'||!document.body)return;for(const input of document.querySelectorAll('input')){if(/api[_-]?key|nsx-ai-key/i.test(input.name||input.id)){input.type='text';input.readOnly=true;input.disabled=true;input.value=(/ai_comment|nsx-ai-key/.test(input.name||input.id)?credentialState.aiConfigured:credentialState.nodeimageConfigured)?'已配置（客户端保管）':'';input.setAttribute('value',input.value);input.placeholder='请在客户端设置中配置';input.title='密钥只在客户端录入；官网页面不会获得实际密钥';}}};
    new MutationObserver(maskCredentialInputs).observe(document.body,{childList:true,subtree:true});
    const GM_getResourceURL=name=>resources[name] || '';
    const GM_addStyle=css=>{const style=document.createElement('style');style.textContent=String(css);document.head.append(style);return style;};
    const GM_addElement=(parent,tag,attributes)=>{if(typeof parent==='string'){attributes=tag;tag=parent;parent=document.head;}const node=document.createElement(tag);for(const [name,value]of Object.entries(attributes||{})){if(name==='textContent')node.textContent=String(value);else node.setAttribute(name,String(value));}(parent||document.head).append(node);return node;};
    const GM_openInTab=url=>{void bridge.open(String(url)).catch(reportError);return {close(){}};};
    const GM_notification=(input,text)=>{const title=typeof input==='object'?input.title:input;status.textContent=String(title||'NodeSeek Pro')+(typeof input==='object'&&input.text?'：'+input.text:text?'：'+text:'');};
    const GM_xmlhttpRequest=details=>{
      let aborted=false;
      void(async()=>{
        const request={url:details.url,method:details.method||'GET',headers:details.headers||{},responseType:details.responseType,timeout:details.timeout};
        if(details.data instanceof FormData){request.form=[];for(const [name,value]of details.data.entries()){if(typeof value==='string')request.form.push({name,value});else request.form.push({name,bytes:Array.from(new Uint8Array(await value.arrayBuffer())),filename:value.name||'upload',type:value.type});}}
        else if(details.data!==undefined&&details.data!==null)request.data=String(details.data);
        try{const result=await bridge.request(request);if(!aborted)details.onload?.(result);}catch(error){if(!aborted){const result={status:0,error:error.message};details.onerror?.(result);reportError(error);}}
      })();return {abort(){aborted=true;details.onabort?.();}};
    };
    const unsafeWindow={__config__:config,indexedDB:window.indexedDB};
    const addLocalStyle=(id,css)=>{if(document.getElementById(id))return;const style=document.createElement('style');style.id=id;style.textContent=css;document.head.append(style);};
    addLocalStyle('seekdesk-pro-viewport','.layui-layer:has(#setting-layer-direction-r){width:min(620px,100vw)!important;max-width:100vw;left:auto!important;right:0!important;box-sizing:border-box}');
    addLocalStyle('nsx-layui-css',__LAYUI_CSS__);addLocalStyle('nsx-layui-dark',__LAYUI_DARK_CSS__);
    for(const id of ['nsx-hljs-script','nsx-hljs-onload']){const marker=document.createElement('meta');marker.id=id;document.head.append(marker);}
    window.__seekdeskProRuntime={version:'1.0.8',showMenu,getMenuLabels:()=>[...menus.values()].map(v=>v.label),getSettings:()=>clone(values.settings),updateCredentialState:state=>{credentialState=state;maskCredentialInputs();}};
    // Layui detects its base path through document.scripts. This inert marker
    // supplies that metadata without executing a page-world or remote script.
    const requireMarker=document.createElement('script');requireMarker.type='application/json';requireMarker.id='seekdesk-pro-require-source';requireMarker.src=location.origin+'/seekdesk-vendor/layui.js';document.head.append(requireMarker);
    __LAYUI_JS__
    // The complete pinned Layui bundle includes every module; avoid lazy loading
    // a second copy from the forum's origin.
    if(window.layui){window.layui['layui.all']=true;window.layui.addcss=(_file,callback)=>callback?.();window.layui.link=(_file,callback)=>callback?.();const layer=window.layui.layer;if(layer?.msg){const msg=layer.msg.bind(layer);layer.msg=(text,...args)=>{if(/已保存|保存成功|配置已保存/.test(String(text))&&writes.size){void Promise.all([...writes]).then(()=>msg(text,...args),()=>msg('保存未完成，请检查客户端提示后重试'));return 0;}return msg(text,...args);};}}
    __HIGHLIGHT_JS__
    if(typeof hljs!=='undefined')window.hljs=hljs;
    __USERSCRIPT__
    window.hljs?.highlightAll?.();
    return {status:'running',version:'1.0.8',menus:menus.size};
  })()`;
  const replacements:Record<string,string>={__VALUES__:JSON.stringify(initialUserscriptValues(publicUserscriptValues(input.values))),__CONFIG__:JSON.stringify(input.config),__RESOURCES__:JSON.stringify(resources),__LAYUI_CSS__:JSON.stringify(input.assets['layui.css']),__LAYUI_DARK_CSS__:JSON.stringify(input.assets['layui-dark.css']),__LAYUI_JS__:input.assets['layui.js'],__HIGHLIGHT_JS__:input.assets['highlight.js'],__USERSCRIPT__:adaptUserscriptSource(input.assets['nodeseek-pro.user.js'])};
  return preparation.replace(/__(?:VALUES|CONFIG|RESOURCES|LAYUI_CSS|LAYUI_DARK_CSS|LAYUI_JS|HIGHLIGHT_JS|USERSCRIPT)__/g,token=>replacements[token]);
}
