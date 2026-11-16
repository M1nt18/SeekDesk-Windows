import type {Post} from './types';

/** Local metadata only. These entries are separate from forum-side favorites. */
export interface LibraryEntry {
  post:Post;
  visitedAt:string;
}
export type ReadingLibraryEntry=LibraryEntry;
export interface ReadingLibraryState {
  bookmarks:LibraryEntry[];
  history:LibraryEntry[];
}
export type ReadingLibraryMutation=
  | {kind:'visit'|'bookmark-add'|'bookmark-toggle';post:Post}
  | {kind:'bookmark-remove'|'history-remove';postId:string}
  | {kind:'clear-bookmarks'|'clear-history'};
export interface ReadingLibraryAPI {
  readReadingLibrary(expectedOwner?:number):Promise<ReadingLibraryState>;
  mutateReadingLibrary(request:ReadingLibraryMutation,expectedOwner?:number):Promise<ReadingLibraryState>;
}

export const READING_HISTORY_LIMIT=200;
export const READING_BOOKMARK_LIMIT=500;
