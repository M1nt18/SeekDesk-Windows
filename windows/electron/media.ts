import {ImageCache} from './image-cache';
import {dialog,safeStorage,clipboard,ClipboardItem,type BrowserWindow} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import sharp from 'sharp';
import type {ImageUploadInput,MediaSettings,StickerItem,UploadedImage,ReaderImage} from '../shared/parity';
import {officialStickers} from './parity-forum';
import {scanImageLinks,replaceImageLinks} from './image-links';

const maxBytes=100*1024*1024;
interface LocalSticker {id:string;name:string;group:string;file:string;mime:string}
interface MediaSnapshot {key?:string;keyCipher?:string;width:number;stickers:LocalSticker[]}
interface MediaDependencies {persistence?:Pick<typeof fs,'mkdir'|'writeFile'|'rename'>;readFile?:typeof fs.readFile;fetchImage?:typeof fetch;encryption?:Pick<typeof safeStorage,'isEncryptionAvailable'|'encryptString'|'decryptString'>;dialogs?:Pick<typeof dialog,'showOpenDialog'>}
const mimes:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp'};
function validWidth(input:unknown,allowZero=true):number{if(typeof input!=='number'||!Number.isInteger(input)||input<(allowZero?0:32)||input>8192)throw new Error('图片宽度须为 32–8192 像素（0 为原图）');return input;}
async function assertImage(buffer:Buffer){if(buffer.length<8||buffer.length>maxBytes)throw new Error('图片为空或超过 100 MB');const metadata=await sharp(buffer,{limitInputPixels:100000000}).metadata();const width=metadata.width,height=metadata.height;if(!width||!height||width>100000||height>100000||width*height>100000000)throw new Error('图片像素过大');return {width,height,pages:metadata.pages||1};}
async function resize(buffer:Buffer,mime:string,width:number){const size=await assertImage(buffer);if(!width||size.width<=width)return {buffer,mime,...size};if(size.pages>1||mime==='image/gif')throw new Error('GIF 动图请保留原始尺寸，调整会丢失动画');const next=await sharp(buffer,{limitInputPixels:100000000}).resize({width,withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});return {buffer:next.data,mime:'image/png',width:next.info.width,height:next.info.height};}
function isPrivateIpv4(address:string):boolean{
  const parts=address.split('.').map(Number);if(parts.length!==4||parts.some(n=>!Number.isInteger(n)||n<0||n>255))return true;
  const [a,b]=parts;
  return a===0||a===10||a===127||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===0&&parts[2]===0)||(a===192&&b===168)||(a===198&&(b===18||b===19))||a>=224;
}
function isPrivateAddress(raw:string):boolean{
  const address=raw.toLowerCase().split('%')[0];
  if(!address.includes(':'))return isPrivateIpv4(address);
  if(address==='::'||address==='::1'||/^0+:0+:0+:0+:0+:0+:0+:[01]$/.test(address))return true;
  const mapped=address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);if(mapped)return isPrivateIpv4(mapped[1]);
  const mappedHex=address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if(mappedHex){const hi=parseInt(mappedHex[1],16),lo=parseInt(mappedHex[2],16);return isPrivateIpv4(`${hi>>8}.${hi&255}.${lo>>8}.${lo&255}`);}
  return /^(?:fc|fd|fe[89ab]|fe[cdef]|ff|64:ff9b:)/i.test(address);
}
async function publicImageUrl(input:string){const url=new URL(input);if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443'||url.href.length>4096)throw new Error('图片链接无效');const host=url.hostname.toLowerCase();if(host==='localhost'||host.endsWith('.local')||host.startsWith('['))throw new Error('图片链接必须为公开 HTTPS 地址');const records=await lookup(host,{all:true});if(!records.length||records.some(({address})=>isPrivateAddress(address)))throw new Error('禁止读取本机或内网图片');return url.href;}
async function limitedBody(response:Response){const length=Number(response.headers.get('content-length'));if(length>maxBytes)throw new Error('图片超过 100 MB');const reader=response.body?.getReader();if(!reader)throw new Error('图片内容为空');const chunks:Uint8Array[]=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('图片超过 100 MB');}chunks.push(value);}return Buffer.concat(chunks);}
export class MediaService{
  private imageCache=new ImageCache<ReaderImage>(image=>Buffer.byteLength(image.data));
  private key?:string;private keyCipher?:string;private width=0;private stickers:LocalSticker[]=[];private queue:Promise<unknown>=Promise.resolve();
  private problem?:string;
  get storageWarning(){return this.problem;}
  private persistence:NonNullable<MediaDependencies['persistence']>;private encryption:NonNullable<MediaDependencies['encryption']>;private dialogs:NonNullable<MediaDependencies['dialogs']>;
  constructor(private directory:string,private getWindow:()=>BrowserWindow|null,private dependencies:MediaDependencies={}){this.persistence=dependencies.persistence||fs;this.encryption=dependencies.encryption||safeStorage;this.dialogs=dependencies.dialogs||dialog;}
  async load(){try{const row=JSON.parse(await (this.dependencies.readFile||fs.readFile)(path.join(this.directory,'media.json'),'utf8'));if(!row||typeof row!=='object'||Array.isArray(row))throw Error('invalid media config');if(row.key!==undefined&&typeof row.key!=='string')throw Error('invalid media credential');if(typeof row.key==='string'){this.keyCipher=row.key;if(this.encryption.isEncryptionAvailable())try{this.key=this.encryption.decryptString(Buffer.from(row.key,'base64'));}catch{/* Retain the opaque ciphertext until explicit replacement/removal. */}}this.width=validWidth(row.width??0);if(Array.isArray(row.stickers))this.stickers=row.stickers.slice(0,1000).filter((s:LocalSticker)=>s&&/^[a-f0-9-]{36}$/.test(s.id)&&typeof s.name==='string'&&typeof s.group==='string'&&/^[a-f0-9-]{36}\.(png|jpg|jpeg|gif|webp|bmp)$/.test(s.file)&&Object.values(mimes).includes(s.mime));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.problem='图床配置无法读取，原文件已保留；请修复后重新启动应用';}}
  settings():MediaSettings{return {hasApiKey:!!this.key,defaultImageWidth:this.width,...(this.keyCipher&&!this.key?{credentialError:'已保存的图床密钥暂时无法解密，密文已保留；请重新配置或明确清除'}:{}),...(this.problem?{storageWarning:this.problem}:{})};}
  private async publicImage(input:string,signal=AbortSignal.timeout(30000)){
    const source=new URL(await publicImageUrl(input));
    // Speedtest permanently redirects its old mobile result PNG links on the same host.
    if(source.origin==='https://www.speedtest.net'&&!source.search&&/^\/my-result\/a\/\d+\.png$/.test(source.pathname)){
      source.pathname=source.pathname.replace('/my-result/','/result/');
    }
    let url=source.href;
    for(let hop=0;hop<=3;hop++){
      let response:Response;try{response=await (this.dependencies.fetchImage||fetch)(url,{method:'GET',credentials:'omit',redirect:'manual',cache:'no-cache',signal});}catch{if(signal.aborted)throw Error('图片读取已取消或超时');throw Error('图片连接失败，请重试或查看原图；客户端将沿用系统代理与证书设置');}
      if([301,302,303,307,308].includes(response.status)){
        const location=response.headers.get('location');await response.body?.cancel().catch(()=>{});if(!location||hop===3)throw Error('图片跳转次数过多或地址无效，请查看原图');
        url=await publicImageUrl(new URL(location,url).href);continue;
      }
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('图片服务器返回 HTTP '+response.status+'，请重试或查看原图');}return {response,url};
    }throw Error('图片地址不可读取');
  }
  async readerImage(input:string,width:number,refresh=false,signal?:AbortSignal):Promise<ReaderImage>{validWidth(width,false);if(typeof refresh!=='boolean')throw Error('图片刷新参数无效');return this.imageCache.get(input+'@'+width,signal=>this.decodeReaderImage(input,width,signal),refresh,signal);}
  private async decodeReaderImage(input:string,width:number,signal:AbortSignal):Promise<ReaderImage>{const {response}=await this.publicImage(input,AbortSignal.any([signal,AbortSignal.timeout(30000)]));const buffer=await limitedBody(response),options={limitInputPixels:100000000},metadata=await sharp(buffer,options).metadata(),w=metadata.width,h=metadata.height;if(!w||!h)throw new Error('图片尺寸无效');if(metadata.pages&&metadata.pages>1){if(buffer.length>10000000)throw new Error('动图过大，请查看原图');const animatedMime=metadata.format==='webp'?'image/webp':metadata.format==='png'?'image/png':'image/gif';return {data:'data:'+animatedMime+';base64,'+buffer.toString('base64'),width:w,height:h,originalWidth:w,originalHeight:h,reduced:false};}const scale=Math.min(1,width/w,Math.sqrt(16000000/(w*h))),nextW=Math.max(1,Math.floor(w*scale)),nextH=Math.max(1,Math.floor(h*scale));const output=await sharp(buffer,options).rotate().resize({width:nextW,height:nextH,fit:'inside',withoutEnlargement:true}).webp({quality:90}).toBuffer({resolveWithObject:true});const result={data:'data:image/webp;base64,'+output.data.toString('base64'),width:output.info.width,height:output.info.height,originalWidth:w,originalHeight:h,reduced:scale<1};return result;}
  private async download(input:string){const {url,response}=await this.publicImage(input);const mime=response.headers.get('content-type')?.split(';')[0]||'';if(!Object.values(mimes).includes(mime)){await response.body?.cancel().catch(()=>{});throw new Error('图片类型不支持');}const buffer=await limitedBody(response);await assertImage(buffer);return {buffer,mime,url};}
  async saveImage(url:string){const image=await this.download(url),extension=Object.entries(mimes).find(([,mime])=>mime===image.mime)?.[0]||'.png';const win=this.getWindow(),options:Electron.SaveDialogOptions={title:'保存图片',defaultPath:'SeekDesk-image'+extension,filters:[{name:'图片',extensions:[extension.slice(1)]}]};const selected=win?await dialog.showSaveDialog(win,options):await dialog.showSaveDialog(options);if(!selected.canceled&&selected.filePath)await fs.writeFile(selected.filePath,image.buffer);}
  async copyImage(url:string){const image=await this.download(url),metadata=await assertImage(image.buffer);if(metadata.width*metadata.height>30000000)throw new Error('图片过大，请使用保存原图');const png=await sharp(image.buffer,{limitInputPixels:30000000}).png().toBuffer();await clipboard.write([new ClipboardItem({'image/png':new Blob([new Uint8Array(png)],{type:'image/png'})})]);}
  async setSettings(input:{apiKey?:string;clearKey?:boolean;defaultImageWidth?:number}){
    if(!input||typeof input!=='object')throw new Error('图床设置无效');const patch={...input};
    if(patch.defaultImageWidth!==undefined)validWidth(patch.defaultImageWidth);
    if(patch.apiKey!==undefined&&(typeof patch.apiKey!=='string'||patch.apiKey.length>1000||/[\r\n\0]/.test(patch.apiKey)))throw new Error('API Key 无效');
    return this.serialize(async()=>{
      const next=this.snapshot();if(patch.defaultImageWidth!==undefined)next.width=patch.defaultImageWidth;
      if(patch.clearKey===true){next.key=undefined;next.keyCipher=undefined;}
      if(patch.apiKey!==undefined){next.key=patch.apiKey.trim()||undefined;if(next.key){if(!this.encryption.isEncryptionAvailable())throw new Error('Windows 凭据加密不可用，无法安全保存 API Key');next.keyCipher=this.encryption.encryptString(next.key).toString('base64');}else next.keyCipher=undefined;}
      await this.save(next);return this.settings();
    });
  }
  private snapshot():MediaSnapshot{return {key:this.key,keyCipher:this.keyCipher,width:this.width,stickers:[...this.stickers]};}
  private serialize<T>(operation:()=>Promise<T>):Promise<T>{const task=this.queue.catch(()=>{}).then(operation);this.queue=task;return task;}
  private async save(next:MediaSnapshot){if(this.problem)throw Error(this.problem);const snapshot=JSON.stringify({key:next.keyCipher,width:next.width,stickers:next.stickers});await this.persistence.mkdir(this.directory,{recursive:true});const target=path.join(this.directory,'media.json');await this.persistence.writeFile(target+'.tmp',snapshot);await this.persistence.rename(target+'.tmp',target);this.key=next.key;this.keyCipher=next.keyCipher;this.width=next.width;this.stickers=next.stickers;}
  async upload(input:ImageUploadInput):Promise<UploadedImage>{if(!input||typeof input.name!=='string'||input.name.length>255||typeof input.mime!=='string'||!Object.values(mimes).includes(input.mime)||!(Array.isArray(input.bytes)||input.bytes instanceof Uint8Array)||input.bytes.length>maxBytes||input.bytes.some(byte=>!Number.isInteger(byte)||byte<0||byte>255))throw new Error('上传图片参数无效');return this.uploadBuffer(Buffer.from(input.bytes),input.mime,input.name,input.width===undefined?this.width:validWidth(input.width));}
  private async uploadBuffer(buffer:Buffer,mime:string,name:string,width:number):Promise<UploadedImage>{if(!this.key)throw new Error('请先在图片设置中配置 NodeImage API Key');const prepared=await resize(buffer,mime,width),form=new FormData();form.set('image',new Blob([new Uint8Array(prepared.buffer)],{type:prepared.mime}),name.replace(/[^\p{L}\p{N}._-]/gu,'_')||'image.png');let response:Response;try{response=await fetch('https://api.nodeimage.com/api/upload',{method:'POST',headers:{'X-API-Key':this.key},body:form,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(90000)});}catch{throw new Error('图片上传未完成，请检查网络和 API Key 后重试');}const json=await response.json().catch(()=>null) as {success?:boolean;links?:{direct?:string};message?:string}|null;if(!response.ok||json?.success!==true||!json.links?.direct)throw new Error('图床未确认上传成功'+(json?.message?'：'+String(json.message).slice(0,200):''));const url=new URL(json.links.direct);if(url.protocol!=='https:'||url.username||url.password)throw new Error('图床返回无效链接');return {url:url.href,width:prepared.width,height:prepared.height};}
  async prepare(content:string,widths:Record<string,number>){
    if(typeof content!=='string'||content.length>200000||!widths||typeof widths!=='object'||Object.keys(widths).length>100)throw new Error('待发送图片参数无效');
    const destinations=new Set(scanImageLinks(content).map(link=>link.url)),replacements:Record<string,string>=Object.create(null);
    for(const [input,width] of Object.entries(widths)){
      validWidth(width,false);if(!destinations.has(input))continue;
      const {response}=await this.publicImage(input);
      const mime=response.headers.get('content-type')?.split(';')[0]||'';if(!Object.values(mimes).includes(mime)){await response.body?.cancel().catch(()=>{});throw new Error('图片类型不支持调整');}
      const buffer=await limitedBody(response),size=await assertImage(buffer);if(size.width<=width)continue;
      replacements[input]=(await this.uploadBuffer(buffer,mime,'resized-image.png',width)).url;
    }
    return replaceImageLinks(content,replacements);
  }
  async getStickers():Promise<StickerItem[]>{const local:StickerItem[]=[];for(const row of this.stickers){try{const file=path.join(this.directory,'stickers',row.file),stat=await fs.stat(file);if(stat.size>10000000)continue;const buffer=await fs.readFile(file);await assertImage(buffer);const thumb=await sharp(buffer,{limitInputPixels:100000000}).resize({width:96,height:96,fit:'inside',withoutEnlargement:true}).webp({quality:75}).toBuffer();local.push({id:row.id,name:row.name,group:row.group,official:false,url:`data:image/webp;base64,${thumb.toString('base64')}`});}catch{}}return [...officialStickers(),...local];}
  async importStickers(group:string){
    if(typeof group!=='string'||!group.trim()||group.length>80)throw new Error('表情组名称无效');
    const options:Electron.OpenDialogOptions={title:'导入自定义表情',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','gif','webp','bmp']}]};
    const win=this.getWindow(),selected=win?await this.dialogs.showOpenDialog(win,options):await this.dialogs.showOpenDialog(options);
    if(selected.canceled)return this.getStickers();
    return this.serialize(async()=>{
    if(this.stickers.length+selected.filePaths.length>1000)throw new Error('最多保存 1000 个自定义表情');
    let total=0;for(const row of this.stickers)total+=(await fs.stat(path.join(this.directory,'stickers',row.file)).catch(()=>({size:0}))).size;
    for(const file of selected.filePaths){const stat=await fs.stat(file);if(stat.size>10*1024*1024)throw new Error('单个表情不可超过 10 MB');total+=stat.size;}
    if(total>64*1024*1024)throw new Error('本机表情总大小已达到 64 MB，请移除部分表情后导入');
    await fs.mkdir(path.join(this.directory,'stickers'),{recursive:true});
    const added:LocalSticker[]=[];
    try{for(const file of selected.filePaths){const extension=path.extname(file).toLowerCase(),mime=mimes[extension];if(!mime)continue;const buffer=await fs.readFile(file);await assertImage(buffer);const id=randomUUID(),stored=id+extension;await fs.writeFile(path.join(this.directory,'stickers',stored),buffer);added.push({id,name:path.basename(file,extension),group:group.trim(),file:stored,mime});}await this.save({...this.snapshot(),stickers:[...this.stickers,...added]});}
    catch(error){for(const row of added)await fs.unlink(path.join(this.directory,'stickers',row.file)).catch(()=>{});throw error;}
    return this.getStickers();
    });
  }
  async removeSticker(id:string){return this.serialize(async()=>{const row=this.stickers.find(item=>item.id===id);if(!row)throw new Error('自定义表情不存在');await this.save({...this.snapshot(),stickers:this.stickers.filter(item=>item.id!==id)});await fs.unlink(path.join(this.directory,'stickers',row.file)).catch(()=>{});});}
  async uploadSticker(id:string){const row=this.stickers.find(item=>item.id===id);if(!row)throw new Error('自定义表情不存在');const buffer=await fs.readFile(path.join(this.directory,'stickers',row.file));return this.uploadBuffer(buffer,row.mime,row.file,0);}
}
