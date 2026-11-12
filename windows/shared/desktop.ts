export type CloseBehavior='ask'|'tray'|'quit';
export interface DesktopPreferences {closeBehavior:CloseBehavior}
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
  message?:string;
  checkedAt?:string;
  errorCode?:'network'|'manifest-missing'|'verification'|'download'|'install'|'unsupported'|'unknown';
}
export interface DesktopAPI {
  getDesktopPreferences():Promise<DesktopPreferences>;
  setCloseBehavior(behavior:CloseBehavior):Promise<DesktopPreferences>;
  getUpdateState():Promise<UpdateState>;
  checkUpdates():Promise<UpdateState>;
  downloadUpdate():Promise<UpdateState>;
  cancelUpdate():Promise<UpdateState>;
  installUpdate():Promise<UpdateState>;
  onUpdateChange(callback:(state:UpdateState)=>void):()=>void;
}
