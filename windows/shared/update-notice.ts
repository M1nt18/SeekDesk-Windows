import type {UpdateState} from './desktop';
export function hasUpdateNotice(state:UpdateState|null|undefined):boolean{
  if(!state?.version||state.status==='up-to-date')return false;
  const parse=(version:string)=>/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)?version.split('.').map(Number):null;
  const available=parse(state.version),installed=parse(state.currentVersion);if(!available||!installed)return false;
  for(let i=0;i<3;i++)if(available[i]!==installed[i])return available[i]>installed[i];return false;
}
