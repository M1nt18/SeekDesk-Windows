type Job<T>={promise:Promise<T>;controller:AbortController;users:number;done:boolean};
const cancelled=()=>Object.assign(Error('图片读取已取消'),{name:'AbortError'});
/** Shared work with per-caller cancellation, bounded decodes and a TTL byte budget. */
export class ImageCache<T>{
  private cache=new Map<string,{value:T;bytes:number;expires:number}>();private pending=new Map<string,Job<T>>();
  private waiting:(()=>void)[]=[];private active=0;private bytes=0;
  constructor(private size:(value:T)=>number,private options={maxBytes:32_000_000,ttlMs:120_000,concurrency:2,maxWaiting:64,now:()=>Date.now()}){}
  get(key:string,load:(signal:AbortSignal)=>Promise<T>,refresh=false,signal?:AbortSignal):Promise<T>{
    if(signal?.aborted)return Promise.reject(cancelled());
    const underway=this.pending.get(key);if(underway)return this.subscribe(underway,signal);
    const cached=this.cache.get(key);if(cached){if(!refresh&&cached.expires>this.options.now()){this.cache.delete(key);this.cache.set(key,cached);return Promise.resolve(cached.value);}this.remove(key);}
    if(this.waiting.length>=this.options.maxWaiting)return Promise.reject(Error('图片加载队列已满，请稍后重试'));
    let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;
    const job:Job<T>={promise:new Promise<T>((yes,no)=>{resolve=yes;reject=no;}),controller:new AbortController(),users:0,done:false};this.pending.set(key,job);
    const run=()=>{this.active++;void Promise.resolve().then(()=>{if(job.controller.signal.aborted)throw cancelled();return load(job.controller.signal);}).then(value=>{
      if(job.controller.signal.aborted)throw cancelled();const bytes=this.size(value);
      if(bytes<=this.options.maxBytes){while(this.bytes+bytes>this.options.maxBytes&&this.cache.size)this.remove(this.cache.keys().next().value!);this.cache.set(key,{value,bytes,expires:this.options.now()+this.options.ttlMs});this.bytes+=bytes;}job.done=true;resolve(value);
    }).catch(error=>{job.done=true;reject(error);}).finally(()=>{this.active--;this.waiting.shift()?.();});};
    const cleanup=()=>{if(this.pending.get(key)===job)this.pending.delete(key);};void job.promise.then(cleanup,cleanup);job.controller.signal.addEventListener('abort',cleanup,{once:true});
    const result=this.subscribe(job,signal);if(this.active<this.options.concurrency)run();else this.waiting.push(run);return result;
  }
  private subscribe(job:Job<T>,signal?:AbortSignal):Promise<T>{
    job.users++;return new Promise<T>((resolve,reject)=>{let settled=false;
      const finish=(error?:unknown,value?:T)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);job.users--;if(!job.users&&!job.done)job.controller.abort();if(error)reject(error);else resolve(value!);};
      const abort=()=>finish(cancelled());if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});void job.promise.then(value=>finish(undefined,value),error=>finish(error));
    });
  }
  private remove(key:string){const old=this.cache.get(key);if(old){this.bytes-=old.bytes;this.cache.delete(key);}}
  stats(){return {bytes:this.bytes,cached:this.cache.size,pending:this.pending.size,active:this.active,waiting:this.waiting.length};}
}
