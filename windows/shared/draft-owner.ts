import type {AccountState} from './types';

/** Temporary site verification must not prevent saving this device's own draft. */
export function canAccessLocalDraft(account:AccountState,confirmedIdentity:string|undefined,owner:unknown):owner is number {
  return typeof owner==='number'&&Number.isSafeInteger(owner)&&owner>0&&account.status!=='signed-out'&&account.id===owner&&confirmedIdentity===`user:${owner}`;
}
