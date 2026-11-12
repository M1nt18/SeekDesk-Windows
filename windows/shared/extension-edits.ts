import type {ExtensionsState} from './parity';

const editable=['hotDefaultPeriod','hotSidebarCount','hotRefreshSeconds','hotShowScore','attendanceMode','autoAttendance','officeTitle','officeButton','officeKey','watchWords','watchNote','watchSystemNotifications','authorOnly','blocked'] as const;
/** Background runtime snapshots must never replace an open settings draft. */
export function mergeExtensionEdits(latest:ExtensionsState,original:ExtensionsState,edited:ExtensionsState):ExtensionsState {
  const result={...latest};
  for(const key of editable)if(JSON.stringify(original[key])!==JSON.stringify(edited[key]))Object.assign(result,{[key]:edited[key]});
  return result;
}
