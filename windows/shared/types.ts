import type {ParityAPI} from './parity';
export interface Post {
  id: string;
  url: string;
  title: string;
  author: string;
  category: string;
  published: string;
  summary: string;
  avatar?: string;
  replies?: number;
  readingRank?: number;
  authorId?: number;
  featured?: boolean;
}
export interface ListingRequest {
  category?: string;
  order?: 'postTime' | 'replyTime';
  page?: number;
}
export interface ListingResult {
  posts: Post[];
  source: 'web' | 'rss';
  fetchedAt: string;
  nextPage: number | null;
  notice?: string;
}
export interface Comment {
  id: string;
  author: string;
  avatar?: string;
  date: string;
  floor: string;
  html: string;
  authorId?: number;
  level?: number;
  role?: string;
  signature?: string;
  signatureHtml?: string;
  likes?: number;
  following?: boolean;
  chicken?: number;
  dislikes?: number;
  liked?: boolean;
  gaveChicken?: boolean;
  disliked?: boolean;
  isAuthor?: boolean;
  isOwn?: boolean;
}
export interface ThreadResult {
  id: string;
  url: string;
  title: string;
  comments: Comment[];
  source: 'web' | 'rss';
  notice?: string;
  page: number;
  nextPage: number | null;
  rootAuthorId?: number;
  replyRestriction?: string;
}
export interface AccountState {
  status: 'unknown' | 'signed-out' | 'signed-in' | 'verification';
  name?: string;
  id?: number;
  avatar?: string;
  level?: number;
  coin?: number;
}
export interface OfficialViewState {
  visible: boolean;
  url: string;
  loading: boolean;
  purpose: 'login' | 'browse' | 'calculator';
  error?: string;
}
export interface OfficialViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Settings {
  theme: 'system' | 'light' | 'dark';
  fontSize: number;
  uiFontSize: number;
  nodeSeekPro: boolean;
  compact: boolean;
  restoreTabs: boolean;
  defaultSource: 'auto' | 'rss';
}
export interface SavedWorkspace {
  tabs: Post[];
  activeId: string | null;
  overviewOpen?: boolean;
  scrollPositions?: Record<string,number>;
}
export type ForumActionRequest =
  | {kind:'reply';url:string;content:string;quote?:{floor:string;author:string;text:string}}
  | {kind:'react';url:string;commentId:string;reaction:'like'|'dislike'|'chicken';approval?:'quote'|'free'|'paid'}
  | {kind:'follow';memberId:number;follow:boolean}
  | {kind:'message';memberId:number;content:string};
export interface ForumActionResult {
  message: string;
  confirmation?: 'free' | 'paid';
  count?: number;
  coin?: number;
  destination?: {url:string;page:number;floor?:string};
}
export interface Bootstrap {
  settings: Settings;
  workspace: SavedWorkspace;
  account: AccountState;
  version: string;
  buildNumber?: string;
  official: OfficialViewState;
  blockedUsers: number[];
}
export interface SeekDeskAPI extends ParityAPI {
  bootstrap(): Promise<Bootstrap>;
  listPosts(request: ListingRequest): Promise<ListingResult>;
  readThread(post: Post, page?: number): Promise<ThreadResult>;
  openOfficial(url?: string): Promise<void>;
  closeOfficial(): Promise<void>;
  reloadOfficial(): Promise<void>;
  setOfficialBounds(bounds: OfficialViewBounds): Promise<void>;
  forumAction(action: ForumActionRequest,expectedOwner:number): Promise<ForumActionResult>;
  setBlockedUsers(ids: number[]): Promise<number[]>;
  loadAvatar(memberId: number): Promise<string | null>;
  openScriptSettings(): Promise<void>;
  openExternal(url: string): Promise<void>;
  checkAccount(): Promise<AccountState>;
  clearSession(): Promise<void>;
  saveSettings(settings: Settings): Promise<Settings>;
  saveWorkspace(workspace: SavedWorkspace): Promise<void>;
  windowAction(action: 'minimize' | 'maximize' | 'close'): void;
  onAccountChange(callback: (account: AccountState) => void): () => void;
  onOfficialChange(callback: (state: OfficialViewState) => void): () => void;
}
declare global {
  interface Window { seekdesk: SeekDeskAPI; }
}
