export type CloseBehavior='ask'|'tray'|'quit';
export interface DesktopPreferences {closeBehavior:CloseBehavior;automaticUpdates?:boolean}
export type UpdateStatus='idle'|'checking'|'available'|'up-to-date'|'downloading'|'downloaded'|'installing'|'cancelled'|'error'|'unsupported';
export interface UpdateState {
  status:UpdateStatus;
  currentVersion:string;
  version?:string;
  releaseUrl?:string;
  publishedAt?:string;
  progress?:{percent:number;bytesPerSecond:number;transferred:number;total:number};
  installable:boolean;
  manualOnly?:boolean;
  canDownload?:boolean;
  applying?:boolean;
  automaticChecks?:boolean;
  message?:string;
  checkedAt?:string;
  errorCode?:'network'|'manifest-missing'|'verification'|'download'|'prepare'|'install'|'unsupported'|'unknown';
}
export interface DesktopAPI {
  getDesktopPreferences():Promise<DesktopPreferences>;
  setCloseBehavior(behavior:CloseBehavior):Promise<DesktopPreferences>;
  setAutomaticUpdates(enabled:boolean):Promise<DesktopPreferences>;
  getUpdateState():Promise<UpdateState>;
  checkUpdates():Promise<UpdateState>;
  downloadUpdate():Promise<UpdateState>;
  cancelUpdate():Promise<UpdateState>;
  installUpdate():Promise<UpdateState>;
  applyUpdate():Promise<UpdateState>;
  onBeforeUpdateInstall(callback:(reason?:'quit'|'update')=>Promise<void>):()=>void;
  onSaveCancelled?(callback:(reason:'quit'|'update')=>void):()=>void;
  onUpdateChange(callback:(state:UpdateState)=>void):()=>void;
}
