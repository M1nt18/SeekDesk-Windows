import fs from 'node:fs/promises';
import path from 'node:path';
import type {IpcMain,IpcMainInvokeEvent,WebContents} from 'electron';
import {isOfficialUrl} from './forum';

export const USERSCRIPT_WORLD=1004;
export const NODESEEK_PRO_VERSION='1.0.8';
const MAX_STORAGE=512_000;
const MAX_REQUEST=8_000_000;
const allowedHosts=new Set(['api.nodeimage.com','api.openai.com']);
type Stored=Record<string,unknown>;
interface SerializedFormEntry {name:string;value?:string;bytes?:number[];filename?:string;type?:string}
export interface UserscriptRequest {url:string;method?:string;headers?:Record<string,string>;data?:string;form?:SerializedFormEntry[];responseType?:string;timeout?:number}

export function adaptUserscriptSource(source:string):string {
  // The original helper recognizes only HTTP stylesheet URLs, while the GM
  // resource API returns local data URLs. Keep this one compatibility change
  // explicit; the vendored original remains untouched and hash-verifiable.
  const original='const isUrl = /^(https?:)?\\/\\//.test(val);';
  if(!source.includes(original))throw new Error('NodeSeek Pro固定版本的资源适配位置未找到');
  return source.replace(original,'const isUrl = /^(https?:)?\\/\\/|^data:text\\/css/.test(val);');
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
}

export class UserscriptHost {
  private values:Stored=initialUserscriptValues({});
  private queue:Promise<unknown>=Promise.resolve();
  private assets:Record<string,string>|undefined;
  private readonly vendor:string;
  constructor(private options:UserscriptHostOptions) {this.vendor=options.vendorDirectory || path.resolve(__dirname,'../../vendor/nodeseek-pro');}
  async load() {
    try {this.values=initialUserscriptValues(JSON.parse(await fs.readFile(path.join(this.options.storageDirectory,'nodeseek-pro.json'),'utf8')));} catch {this.values=initialUserscriptValues({});}
  }
  private save() {
    const data=JSON.stringify(this.values);
    this.queue=this.queue.catch(()=>{}).then(async()=>{
      await fs.mkdir(this.options.storageDirectory,{recursive:true});
      const target=path.join(this.options.storageDirectory,'nodeseek-pro.json');
      await fs.writeFile(target+'.tmp',data,'utf8');await fs.rename(target+'.tmp',target);
    });
    return this.queue;
  }
  private assertSender(event:IpcMainInvokeEvent) {
    const official=this.options.getOfficialContents();
    if(this.options.isEnabled?.()===false || !official || official.isDestroyed() || event.sender!==official || event.senderFrame!==official.mainFrame || !isOfficialUrl(event.senderFrame.url))throw new Error('此页面不能调用脚本宿主');
  }
  registerIPC(ipc:IpcMain) {
    const handle=(name:string,fn:(...args:any[])=>unknown)=>ipc.handle(name,(event,...args)=>{this.assertSender(event);return fn(...args);});
    handle('userscript:set',async(key:unknown,value:unknown)=>{
      if(typeof key!=='string' || !/^[\w.-]{1,120}$/.test(key) || ['__proto__','prototype','constructor'].includes(key))throw new Error('脚本配置键无效');
      const clone=JSON.parse(JSON.stringify(value));
      const next={...this.values,[key]:clone};
      if(Buffer.byteLength(JSON.stringify(next))>MAX_STORAGE)throw new Error('脚本配置超过 512KB');
      this.values=next;await this.save();
    });
    handle('userscript:remove',async(key:unknown)=>{if(typeof key!=='string' || !/^[\w.-]{1,120}$/.test(key))throw new Error('脚本配置键无效');delete this.values[key];await this.save();});
    handle('userscript:open',async(url:unknown)=>{
      if(typeof url!=='string' || url.length>4096)throw new Error('链接无效');
      const parsed=new URL(url);if(!['https:','http:'].includes(parsed.protocol) || parsed.username || parsed.password)throw new Error('仅允许网页链接');
      await this.options.onOpen(parsed.href);
    });
    handle('userscript:request',async(input:unknown)=>this.request(validateUserscriptRequest(input)));
  }
  private async request(request:UserscriptRequest) {
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
      const response=await fetch(request.url,{method:request.method,headers:request.headers,body,credentials:'omit',redirect:'error',signal:controller.signal});
      if(!response.body) return {status:response.status,responseText:'',response:null,responseHeaders:'',finalUrl:request.url};
      const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
      while(true) {const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX_REQUEST){await reader.cancel();throw new Error('脚本响应超过 8MB');}chunks.push(value);}
      const responseText=Buffer.concat(chunks).toString('utf8');
      let parsed:unknown=responseText;if(request.responseType==='json'){try{parsed=JSON.parse(responseText);}catch{parsed=null;}}
      return {status:response.status,responseText,response:parsed,responseHeaders:[...response.headers].filter(([name])=>name!=='set-cookie').map(([name,value])=>`${name}: ${value}`).join('\r\n'),finalUrl:request.url};
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
    const state=await contents.executeJavaScript(`(()=>{if(!document.querySelector('#nsk-head'))return null;try{return JSON.parse(JSON.stringify({user:window.__config__?.user||null,postData:window.__config__?.postData||null}));}catch{return null;}})()`);
    if(!state)return {status:'skipped'};
    const assets=await this.getAssets();
    const code=buildUserscriptRuntime({values:this.values,config:state,assets});
    return contents.executeJavaScriptInIsolatedWorld(USERSCRIPT_WORLD,[{code}]);
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
    const GM_setValue=(key,value)=>{values[key]=clone(value);void bridge.set(key,value).catch(reportError);};
    const GM_deleteValue=key=>{delete values[key];void bridge.remove(key).catch(reportError);};
    const GM_registerMenuCommand=(label,callback)=>{const id=nextMenu++;menus.set(id,{label:String(label),callback});return id;};
    const GM_unregisterMenuCommand=id=>menus.delete(id);
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
    window.__seekdeskProRuntime={version:'1.0.8',showMenu,getMenuLabels:()=>[...menus.values()].map(v=>v.label),getSettings:()=>clone(values.settings)};
    // Layui detects its base path through document.scripts. This inert marker
    // supplies that metadata without executing a page-world or remote script.
    const requireMarker=document.createElement('script');requireMarker.type='application/json';requireMarker.id='seekdesk-pro-require-source';requireMarker.src=location.origin+'/seekdesk-vendor/layui.js';document.head.append(requireMarker);
    __LAYUI_JS__
    // The complete pinned Layui bundle includes every module; avoid lazy loading
    // a second copy from the forum's origin.
    if(window.layui){window.layui['layui.all']=true;window.layui.addcss=(_file,callback)=>callback?.();window.layui.link=(_file,callback)=>callback?.();}
    __HIGHLIGHT_JS__
    if(typeof hljs!=='undefined')window.hljs=hljs;
    __USERSCRIPT__
    window.hljs?.highlightAll?.();
    return {status:'running',version:'1.0.8',menus:menus.size};
  })()`;
  const replacements:Record<string,string>={__VALUES__:JSON.stringify(initialUserscriptValues(input.values)),__CONFIG__:JSON.stringify(input.config),__RESOURCES__:JSON.stringify(resources),__LAYUI_CSS__:JSON.stringify(input.assets['layui.css']),__LAYUI_DARK_CSS__:JSON.stringify(input.assets['layui-dark.css']),__LAYUI_JS__:input.assets['layui.js'],__HIGHLIGHT_JS__:input.assets['highlight.js'],__USERSCRIPT__:adaptUserscriptSource(input.assets['nodeseek-pro.user.js'])};
  return preparation.replace(/__(?:VALUES|CONFIG|RESOURCES|LAYUI_CSS|LAYUI_DARK_CSS|LAYUI_JS|HIGHLIGHT_JS|USERSCRIPT)__/g,token=>replacements[token]);
}
