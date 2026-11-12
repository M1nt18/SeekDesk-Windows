import {contextBridge,ipcRenderer} from 'electron';

// Only the userscript's isolated world receives these capabilities. The forum's
// main world cannot access this bridge or the application's regular IPC API.
contextBridge.exposeInIsolatedWorld(1004,'__seekdeskGM',{
  set: (key:string,value:unknown) => ipcRenderer.invoke('userscript:set',key,value),
  remove: (key:string) => ipcRenderer.invoke('userscript:remove',key),
  request: (request:unknown) => ipcRenderer.invoke('userscript:request',request),
  open: (url:string) => ipcRenderer.invoke('userscript:open',url),
});
