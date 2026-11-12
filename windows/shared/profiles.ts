export type UserProfileFailure='timeout'|'network'|'http'|'verification'|'signed-out'|'invalid-response'|'session-changed';
export interface UserProfileMetadata {
  memberId:number;
  level?:number;
  levelSource?:'rank'|'points';
  role?:string;
  following?:boolean;
  joinedAt?:string;
  joinedDays?:number;
  signature?:string;
}
export interface UserProfileOutcome {
  memberId:number;
  status:'ready'|'stale'|'failed';
  profile?:UserProfileMetadata;
  reason?:UserProfileFailure;
  fetchedAt?:string;
}
export interface UserProfilesRequest {memberIds:number[];force?:boolean}
export interface UserProfilesResult {outcomes:UserProfileOutcome[];complete:boolean}
export interface UserProfilesAPI {readUserProfiles(request:UserProfilesRequest):Promise<UserProfilesResult>}
