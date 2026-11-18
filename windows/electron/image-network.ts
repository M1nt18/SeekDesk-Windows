import {net,type Session} from 'electron';

/** Chromium proxy/certificate handling, separate anonymous session, no auto redirects. */
export function anonymousImageFetch(session:Session):typeof fetch{
  return async(input,init={})=>{
    const url=String(input),signal=init.signal||undefined;
    if(signal?.aborted)throw signal.reason||Error('图片读取已取消');
    try{return await session.fetch(url,{...init,method:'GET',credentials:'omit',redirect:'error',cache:'no-cache',referrerPolicy:'no-referrer'});}
    catch(error){if(signal?.aborted)throw error;}
    // Electron fetch cannot expose a manual cross-origin redirect. Probe with
    // net.request, abort it at headers, and let the caller validate the next URL.
    return new Promise<Response>((resolve,reject)=>{
      const request=net.request({url,method:'GET',session,credentials:'omit',useSessionCookies:false,redirect:'manual',referrerPolicy:'no-referrer'});
      let resolved=false,ended=false,controller:ReadableStreamDefaultController<Uint8Array>|undefined;
      const cleanup=()=>signal?.removeEventListener('abort',abort);
      const fail=(error:Error)=>{if(ended)return;ended=true;cleanup();if(resolved)controller?.error(error);else reject(error);};
      const abort=()=>{fail(Error('图片读取已取消'));request.abort();};
      signal?.addEventListener('abort',abort,{once:true});request.setHeader('Cache-Control','no-cache');request.setHeader('Accept','image/*');
      request.on('redirect',(status,_method,target)=>{if(ended)return;resolved=true;ended=true;cleanup();resolve(new Response(null,{status,headers:{Location:target}}));request.abort();});
      request.on('error',fail);
      request.on('response',incoming=>{
        if(ended)return;const headers=new Headers();for(const [name,value]of Object.entries(incoming.headers))if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(', '):value);
        const body=new ReadableStream<Uint8Array>({start(stream){controller=stream;incoming.on('data',chunk=>{if(!ended)stream.enqueue(new Uint8Array(chunk));});incoming.on('end',()=>{if(ended)return;ended=true;cleanup();stream.close();});incoming.on('error',fail);incoming.on('aborted',()=>fail(Error('图片连接中断，请重试')));},cancel(){if(ended)return;ended=true;cleanup();request.abort();}});
        resolved=true;resolve(new Response(body,{status:incoming.statusCode,headers}));
      });
      request.end();
    });
  };
}
