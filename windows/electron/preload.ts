import { contextBridge, ipcRenderer } from 'electron';
import type { SeekDeskAPI, AccountState, OfficialViewState } from '../shared/types';

const api: SeekDeskAPI = {
  getDesktopPreferences: () => ipcRenderer.invoke('app:desktop-preferences'),
  setCloseBehavior: behavior => ipcRenderer.invoke('app:close-behavior',behavior),
  getUpdateState: () => ipcRenderer.invoke('app:update-state'),
  downloadUpdate: () => ipcRenderer.invoke('app:update-download'),
  cancelUpdate: () => ipcRenderer.invoke('app:update-cancel'),
  installUpdate: () => ipcRenderer.invoke('app:update-install'),
  onUpdateChange: callback => {const handler=(_event:Electron.IpcRendererEvent,state:Parameters<typeof callback>[0])=>callback(state);ipcRenderer.on('app:update-change',handler);return()=>ipcRenderer.removeListener('app:update-change',handler);},
  openCalculator: () => ipcRenderer.invoke('tool:calculator'),
  queryForum: request => ipcRenderer.invoke('parity:query',request),
  writeForum: (request,owner) => ipcRenderer.invoke('parity:write',request,owner),
  loadDraft: (key,owner) => ipcRenderer.invoke('parity:draft-load',key,owner),
  saveDraft: (key,value,owner) => ipcRenderer.invoke('parity:draft-save',key,value,owner),
  uploadImage: input => ipcRenderer.invoke('media:upload',input),
  prepareImages: (content,widths) => ipcRenderer.invoke('media:prepare',content,widths),
  saveImage: url => ipcRenderer.invoke('media:image-save',url),
  copyImage: url => ipcRenderer.invoke('media:image-copy',url),
  loadReaderImage: (url,width) => ipcRenderer.invoke('media:reader-image',url,width),
  getMediaSettings: () => ipcRenderer.invoke('media:settings'),
  setMediaSettings: input => ipcRenderer.invoke('media:save-settings',input),
  getStickers: () => ipcRenderer.invoke('media:stickers'),
  importStickers: group => ipcRenderer.invoke('media:import',group),
  removeSticker: id => ipcRenderer.invoke('media:remove',id),
  uploadSticker: id => ipcRenderer.invoke('media:sticker-upload',id),
  parityBootstrap: () => ipcRenderer.invoke('parity:bootstrap'),
  saveAppearance: value => ipcRenderer.invoke('parity:appearance',value),
  getExtensions: () => ipcRenderer.invoke('extensions:get'),
  saveExtensions: value => ipcRenderer.invoke('extensions:save',value),
  getHotRanking: (period,force) => ipcRenderer.invoke('extensions:ranking',period,force),
  queryRulings: (id,username) => ipcRenderer.invoke('extensions:rulings',id,username),
  getExchangeRates: base => ipcRenderer.invoke('extensions:rates',base),
  calculateRemaining: input => ipcRenderer.invoke('extensions:calculate',input),
  toggleBossKey: () => ipcRenderer.invoke('extensions:boss-toggle'),
  saveSearchHistory: value => ipcRenderer.invoke('parity:history',value),
  copyText: text => ipcRenderer.invoke('app:clipboard',text),
  checkUpdates: () => ipcRenderer.invoke('app:update-check'),
  onBossKey: callback => {const handler=(_event:Electron.IpcRendererEvent,visible:boolean)=>callback(visible);ipcRenderer.on('extensions:boss',handler);return ()=>ipcRenderer.removeListener('extensions:boss',handler);},
  onExtensionsChange: callback => {const handler=(_event:Electron.IpcRendererEvent,state:Parameters<typeof callback>[0])=>callback(state);ipcRenderer.on('extensions:change',handler);return ()=>ipcRenderer.removeListener('extensions:change',handler);},
  onOpenPost: callback => {const handler=(_event:Electron.IpcRendererEvent,post:Parameters<typeof callback>[0])=>callback(post);ipcRenderer.on('app:open-post',handler);return ()=>ipcRenderer.removeListener('app:open-post',handler);},
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  listPosts: request => ipcRenderer.invoke('forum:list', request),
  readThread: (post, page) => ipcRenderer.invoke('forum:thread', post, page),
  openOfficial: url => ipcRenderer.invoke('forum:open', url),
  closeOfficial: () => ipcRenderer.invoke('forum:close'),
  reloadOfficial: () => ipcRenderer.invoke('forum:reload'),
  setOfficialBounds: bounds => ipcRenderer.invoke('forum:bounds', bounds),
  forumAction: (action,owner) => ipcRenderer.invoke('forum:action', action,owner),
  setBlockedUsers: ids => ipcRenderer.invoke('app:blocked-users', ids),
  loadAvatar: id => ipcRenderer.invoke('forum:avatar', id),
  openScriptSettings: () => ipcRenderer.invoke('script:settings'),
  openExternal: url => ipcRenderer.invoke('app:external', url),
  checkAccount: () => ipcRenderer.invoke('forum:account'),
  clearSession: () => ipcRenderer.invoke('forum:clear'),
  saveSettings: settings => ipcRenderer.invoke('app:settings', settings),
  saveWorkspace: workspace => ipcRenderer.invoke('app:workspace', workspace),
  windowAction: action => ipcRenderer.send('app:window', action),
  onAccountChange: callback => {
    const handler = (_event: Electron.IpcRendererEvent, state: AccountState) => callback(state);
    ipcRenderer.on('forum:account-change', handler);
    return () => ipcRenderer.removeListener('forum:account-change', handler);
  },
  onOfficialChange: callback => {
    const handler = (_event: Electron.IpcRendererEvent, state: OfficialViewState) => callback(state);
    ipcRenderer.on('forum:view-change', handler);
    return () => ipcRenderer.removeListener('forum:view-change', handler);
  }
};
contextBridge.exposeInMainWorld('seekdesk', api);
