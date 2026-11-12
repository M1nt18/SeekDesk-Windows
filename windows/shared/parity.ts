import type {Post,AccountState,Settings} from './types';
export interface UnreadCounts {mentions:number;replies:number;messages:number}
export interface MemberProfile {id:number;name:string;rank?:number;avatar?:string;joined?:string;bio?:string;topics?:number;replies?:number;following?:number;followers?:number;coin?:number;followed?:boolean}
export interface Introduction {bio:string;signature:string;readme:string}
export interface ForumNotice {id:string;author:string;authorId?:number;title:string;date:string;unread:boolean;postId:number;floor:number;url:string}
export interface Conversation {id:number;name:string;preview:string;date:string;unread:boolean}
export interface PrivateMessage {id:string;text:string;date:string;mine:boolean;markdown:boolean;peerName?:string}
export interface Activity {id:string;title:string;url:string;date:string;html?:string;floor?:number}
export interface ComposerOptions {categories:{id:string;title:string}[];ranks:{value:number;title:string}[];defaultCategory?:string;canPost:boolean}
export interface EditableSource {url:string;floor:string;content:string;title?:string;category?:string;rank?:number;mode:'edit-post'|'edit-comment';editable:boolean}
export type ForumQueryRequest=
 |{kind:'account'}|{kind:'notifications';category:'mentions'|'replies'|'messages'}
 |{kind:'conversation';memberId:number}|{kind:'introduction';memberId?:number}
 |{kind:'space';memberId:number;section:'topics'|'comments'|'followers'|'following';page?:number}
 |{kind:'directory';memberId:number;section:'followers'|'following';page?:number}
 |{kind:'search-users';term:string}|{kind:'search';term:string;categories?:string[];page?:number}
 |{kind:'composer-options'}|{kind:'edit-source';url:string;floor:string}
 |{kind:'attendance-status'}|{kind:'stickers'};
export interface AttendanceResult {kind:'completed'|'alreadyCompleted'|'signedOut'|'verification'|'failed'|'ready';gain?:number;current?:number;date?:string;message?:string}
export interface ForumQueryResult {profile?:MemberProfile;unread?:UnreadCounts;notices?:ForumNotice[];conversations?:Conversation[];messages?:PrivateMessage[];posts?:Post[];activity?:Activity[];users?:MemberProfile[];introduction?:Introduction;options?:ComposerOptions;edit?:EditableSource;attendance?:AttendanceResult;stickers?:StickerItem[];page?:number;nextPage?:number|null}
export type ForumWriteRequest=
 |{kind:'new-topic';title:string;content:string;category:string;rank:number;confirmed?:boolean}
 |{kind:'edit';url:string;floor:string;content:string;title?:string;category?:string;rank?:number}
 |{kind:'profile';original:Introduction;draft:Introduction}
 |{kind:'mark-read';category:'mentions'|'replies'|'messages';id:number}
 |{kind:'attendance';mode:'fixed'|'random'};
export interface ForumWriteResult {message:string;url?:string;postId?:number;floor?:number;confirmation?:string;introduction?:Introduction;attendance?:AttendanceResult}
export interface DraftValue {content:string;title?:string;category?:string;rank?:number;imageWidths?:Record<string,number>;updatedAt?:string}
export interface ImageUploadInput {name:string;mime:string;bytes:number[]|Uint8Array;width?:number}
export interface UploadedImage {url:string;width?:number;height?:number}
export interface ReaderImage {data:string;width:number;height:number;originalWidth:number;originalHeight:number;reduced:boolean}
export interface MediaSettings {hasApiKey:boolean;defaultImageWidth:number}
export interface StickerItem {id:string;name:string;url:string;group:string;official:boolean}
export type ExtensionId='hot'|'attendance'|'office'|'value'|'block'|'authorOnly'|'keywords'|'rulings';
export type RankingPeriod='realtime'|'daily'|'weekly';
export interface RankingItem {id:string;url:string;title:string;author:string;category:string;score?:number;views?:number;comments?:number;position:number}
export interface RankingResult {period:RankingPeriod;items:RankingItem[];fetchedAt:string;nextRefresh?:string;error?:string}
export interface KeywordHit {post:Post;words:string[];date:string}
export interface ExtensionsState {
 installed:ExtensionId[];enabled:ExtensionId[];
 hotDefaultPeriod:RankingPeriod;hotSidebarCount:number;hotRefreshSeconds:number;hotShowScore:boolean;
 attendanceMode:'fixed'|'random';autoAttendance:boolean;
 officeTitle:string;officeButton:string;officeKey:string;
 watchWords:string;watchNote:string;watchSystemNotifications:boolean;
 authorOnly:boolean;blocked:{memberId?:number;name:string}[];
 hits:KeywordHit[];unread:number;lastCheck?:string;watchError?:string;
 attendance?:AttendanceResult;
 watchHistory?:{terms:string[];ids:string[]};attendanceOwner?:number;
}
export interface RulingRecord {id:string;date:string;action:string;reason:string;url?:string;operator?:string}
export interface RulingsResult {memberId:number;records:RulingRecord[];source:string;fetchedAt:string}
export interface ExchangeRates {base:string;rates:Record<string,number>;fetchedAt:string;source:string}
export interface RemainingValueInput {amount:string;currency:string;periodMonths:number;expiresAt:string;now?:string;askingPrice?:string;targetCurrency?:string;exchangeRate?:string}
export interface RemainingValueResult {value:string;currency:string;remainingDays:number;fullPeriods:number;partialDays:number;periodDays:number;convertedValue?:string;targetCurrency?:string;premium?:string;explanation:string}
export interface SearchHistory {term:string;mode:'posts'|'users';categories:string[];date:string}
export interface ParitySettings {
 brand:'blue'|'teal'|'green'|'purple'|'orange'|'red';readerGradient:boolean;sidebarWidth:number;listWidth:number;
 listFontSize:number;authorFontSize:number;boardFontSize:number;rankingFontSize:number;nqScale:number;tqScale:number;
 sendShortcut:'ctrl-enter'|'enter'|'button-only';composerMode:'edit'|'split'|'preview';notificationPolling:boolean;
 autoRefresh:boolean;autoLoadOlder:boolean;
}
export interface ParityBootstrap {extensions:ExtensionsState;appearance:ParitySettings;media:MediaSettings;stickers:StickerItem[];searchHistory:SearchHistory[]}
export interface ParityAPI {
 openCalculator():Promise<void>;
 queryForum(request:ForumQueryRequest):Promise<ForumQueryResult>;
 writeForum(request:ForumWriteRequest,expectedOwner:number):Promise<ForumWriteResult>;
 loadDraft(key:string,owner?:number):Promise<DraftValue|null>;saveDraft(key:string,value:DraftValue|null,owner?:number):Promise<void>;
 uploadImage(input:ImageUploadInput):Promise<UploadedImage>;
 prepareImages(content:string,widths:Record<string,number>):Promise<string>;
 saveImage(url:string):Promise<void>;copyImage(url:string):Promise<void>;
 loadReaderImage(url:string,width:number):Promise<ReaderImage>;
 getMediaSettings():Promise<MediaSettings>;setMediaSettings(input:{apiKey?:string;clearKey?:boolean;defaultImageWidth?:number}):Promise<MediaSettings>;
 getStickers():Promise<StickerItem[]>;importStickers(group:string):Promise<StickerItem[]>;removeSticker(id:string):Promise<void>;uploadSticker(id:string):Promise<UploadedImage>;
 parityBootstrap():Promise<ParityBootstrap>;saveAppearance(value:ParitySettings):Promise<ParitySettings>;
 getExtensions():Promise<ExtensionsState>;saveExtensions(value:ExtensionsState):Promise<ExtensionsState>;
 getHotRanking(period:RankingPeriod,force?:boolean):Promise<RankingResult>;queryRulings(memberId:number,username?:string):Promise<RulingsResult>;
 getExchangeRates(base:string):Promise<ExchangeRates>;calculateRemaining(input:RemainingValueInput):Promise<RemainingValueResult>;
 toggleBossKey():Promise<void>;onBossKey(callback:(visible:boolean)=>void):()=>void;
 onExtensionsChange(callback:(state:ExtensionsState)=>void):()=>void;
 onOpenPost(callback:(post:Post)=>void):()=>void;
 saveSearchHistory(history:SearchHistory[]):Promise<void>;
 copyText(text:string):Promise<void>;
}
