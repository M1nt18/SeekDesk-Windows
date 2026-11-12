const {app,BrowserWindow,WebContentsView,session}=require('electron');
const path=require('node:path');
const {UserscriptHost,USERSCRIPT_WORLD}=require('../dist-electron/electron/userscripts');
app.setPath('userData',process.env.SEEKDESK_USER_DATA);
globalThis.userscriptTest={requests:[],errors:[],ready:false};
// No external network is used in this test, including GM_xmlhttpRequest.
globalThis.fetch=async(input,options={})=>{
  globalThis.userscriptTest.requests.push({url:String(input),method:options.method||'GET',bridge:true});
  return new Response(JSON.stringify({success:false,message:'隔离测试响应'}),{status:200,headers:{'content-type':'application/json'}});
};
app.whenReady().then(async()=>{
 const s=session.fromPartition('userscript-isolated-test');
 await s.protocol.handle('https',request=>{
   globalThis.userscriptTest.requests.push({url:request.url,method:request.method});
   if(new URL(request.url).pathname.startsWith('/api/'))return new Response(JSON.stringify({success:true,detail:{rank:4},data:[]}),{headers:{'content-type':'application/json'}});
   return new Response(`<!doctype html><html><head><meta charset="UTF-8"><title>NodeSeek Pro isolated test</title></head><body><header id="nsk-head"><div class="user-menu"></div></header><script>window.__config__={user:{member_id:42,member_name:'隔离测试'},postData:null};</script><main id="nsk-body-left"><h1>NodeSeek Pro · 隔离测试</h1><ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-42-1">真实脚本功能测试</a></div><div class="info-author"><a href="/space/42">隔离测试</a></div></li></ul></main></body></html>`,{headers:{'content-type':'text/html; charset=utf-8'}});
 });
 const main=new BrowserWindow({width:1100,height:800,show:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 await main.loadURL('data:text/html,<html><body style="font:16px system-ui">SeekDesk · NodeSeek Pro 隔离测试</body></html>');
 const view=new WebContentsView({webPreferences:{session:s,preload:path.resolve(__dirname,'../dist-electron/electron/userscript-preload.js'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
 main.contentView.addChildView(view);view.setBounds({x:0,y:40,width:1100,height:720});
 const host=new UserscriptHost({storageDirectory:path.join(process.env.SEEKDESK_USER_DATA,'gm'),getOfficialContents:()=>view.webContents,onOpen:async()=>{},isEnabled:()=>true});
 await host.load();host.registerIPC(require('electron').ipcMain);
 view.webContents.on('console-message',(_event,_level,message)=>{if(message.includes('Error'))globalThis.userscriptTest.errors.push(message);});
 await view.webContents.loadURL('https://www.nodeseek.com/');
 const result=await host.inject(view.webContents);
 globalThis.userscriptTest.host=host;globalThis.userscriptTest.contents=view.webContents;globalThis.userscriptTest.result=result;globalThis.userscriptTest.world=USERSCRIPT_WORLD;globalThis.userscriptTest.ready=true;
 main.on('closed',()=>app.quit());
}).catch(error=>{console.error(error);app.exit(1);});
