export type ProService='ai'|'nodeimage';
export interface ProCredentials {aiConfigured:boolean;nodeimageConfigured:boolean;warning?:string}
export interface ProState {status:'disabled'|'preparing'|'running'|'verification'|'unsupported'|'failed';message?:string}
export interface ProAPI {
  getProCredentials():Promise<ProCredentials>;
  saveProCredential(input:{service:ProService;apiKey?:string;clear?:boolean}):Promise<ProCredentials>;
  exportProPreferences():Promise<{canceled:boolean}>;
  getProState():Promise<ProState>;
  onProState(callback:(state:ProState)=>void):()=>void;
  onProCredentialsOpen(callback:()=>void):()=>void;
}
