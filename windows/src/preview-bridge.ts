import type { SeekDeskAPI, Post, Settings, ThreadResult } from '../shared/types';
import type { ExtensionsState, ParitySettings, RankingPeriod } from '../shared/parity';
import { appearanceDefaults } from './components/PreferencesPanel';

const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3600000).toISOString();
const post = (id: number, title: string, author: string, category: string, replies: number, hours: number, featured = false): Post => ({
  id: String(id), url: `https://www.nodeseek.com/post-${id}-1`, title, author, category,
  authorId: 1000 + id % 7, published: ago(hours), summary: '', replies, featured,
});
const posts = [
  post(620101, '如何把个人知识库打造成真正好用的第二大脑？', '林默', 'tech', 128, 1, true),
  post(620102, '2026 年值得关注的自建服务清单', '北岛', 'review', 86, 2),
  post(620103, '分享一下我的桌面工作流与效率工具', '橙子', 'daily', 42, 4),
  post(620104, '从零开始搭建家庭服务器：硬件与网络篇', '阿茶', 'dev', 67, 6),
  post(620105, '那些让阅读体验更舒服的设计细节', '青禾', 'info', 31, 9),
  post(620106, '本周数码与云服务好价汇总', '好价观察员', 'trade', 55, 12),
  post(620107, '一个轻量书签管理工具的使用心得', '苏木', 'review', 24, 18),
  post(620108, '关于信息碎片整理，我的一些实践', '拾光', 'life', 19, 26),
];
const account = { id: 4242, name: 'SeekDesk 预览', avatar: '', level: 6, status: 'signed-in' as const };
let settings: Settings = { theme: 'dark', fontSize: 18, uiFontSize: 16, nodeSeekPro: false, compact: false, restoreTabs: true, defaultSource: 'auto' };
let appearance: ParitySettings = { ...appearanceDefaults, sidebarWidth: 238, listWidth: 390, notificationPolling: false, autoRefresh: false };
const extensionIds = ['hot', 'attendance', 'office', 'value', 'block', 'authorOnly', 'keywords', 'rulings'] as const;
let extensions: ExtensionsState = {
  installed: [...extensionIds], enabled: [...extensionIds], hotDefaultPeriod: 'realtime', hotSidebarCount: 6,
  hotRefreshSeconds: 180, hotShowScore: false, attendanceMode: 'fixed', autoAttendance: false,
  officeTitle: '工作台', officeButton: '返回', officeKey: '9', watchWords: '', watchNote: '',
  watchSystemNotifications: false, authorOnly: false, blocked: [], hits: [], unread: 0,
};
const library = { bookmarks: [{ post: posts[1], visitedAt: ago(4) }], history: [{ post: posts[0], visitedAt: ago(1) }] };
const noop = () => () => {};
const html = `
  <p>真正好用的知识库，不在于收藏了多少内容，而在于需要时能否快速找到，并且重新连接已经沉淀的想法。</p>
  <p>过去我习惯把文章、摘录和灵感分散在不同工具里。工具越来越多，回顾却越来越少。后来我把流程收敛成三个动作：<strong>捕获、消化、连接</strong>。</p>
  <h2>先减少输入，再提高质量</h2>
  <p>只保存那些值得再次阅读的内容。收藏时写下一句话，说明它为什么重要；这个小小的停顿，会显著提升后续检索的效率。</p>
  <blockquote><p>知识管理的目标不是记住所有事情，而是让重要的想法在恰当时刻再次出现。</p></blockquote>
  <h2>用轻量结构代替复杂分类</h2>
  <p>相比深层文件夹，我更倾向于少量主题与双向链接。每条笔记都应该有清晰的标题，并尽量关联一个已有主题。</p>
  <pre><code>capture → distill → connect → revisit</code></pre>
  <p>最后，每周留出二十分钟回顾。删除不再重要的内容，补充新的理解，让知识库保持流动，而不是成为信息的仓库。</p>`;

function threadFor(item: Post, page = 1): ThreadResult {
  const comments = [
    { id: '0', author: item.author, authorId: item.authorId, date: item.published, floor: '楼主', html, level: 6, likes: 36, chicken: 3, dislikes: 0, isAuthor: true },
    { id: '1', author: '山间明月', authorId: 4311, date: ago(0.8), floor: '#1', html: '<p>“收藏时写下一句话”这个方法很有用。之前总是囤很多文章，现在会先判断它和未来哪件事有关，列表清爽了不少。</p><p>每周回顾也确实比复杂分类更重要。</p>', level: 4, likes: 12, isHot: true, signatureHtml: '<p>保持好奇，持续记录。</p>' },
    { id: '2', author: 'Kite', authorId: 4312, date: ago(0.6), floor: '#2', html: '<p>补充一个实践：我会给每条笔记设置下次回顾日期，而不是只依赖标签。这样旧内容也有机会重新进入视野。</p>', level: 3, likes: 7 },
    { id: '3', author: item.author, authorId: item.authorId, date: ago(0.4), floor: '#3', html: '<p>回顾日期是个好思路，相当于把知识库从静态目录变成了有节奏的系统。</p>', level: 6, likes: 4, isAuthor: true },
    { id: '4', author: '七月', authorId: 4314, date: ago(0.2), floor: '#4', html: '<p>很喜欢“减少输入”这一点。工具只是载体，真正需要优化的是自己的注意力。</p>', level: 2, likes: 3 },
  ];
  return { id: item.id, url: item.url, title: item.title, comments, source: 'web', page, nextPage: null, rootAuthorId: item.authorId, category: item.category };
}

export function installPreviewBridge() {
  const updateState = { status: 'unsupported' as const, currentVersion: '0.1.2-preview', installable: false, manualOnly: true };
  const api: SeekDeskAPI = {
    bootstrap: async () => ({ account, settings, workspace: { tabs: [posts[0]], activeId: posts[0].id, overviewOpen: true, listHidden: false, scrollPositions: {} }, official: { visible: false, url: '', loading: false, purpose: 'login' }, blockedUsers: [], version: '0.1.2', buildNumber: '预览版' }),
    parityBootstrap: async () => ({ extensions, appearance, media: { hasApiKey: false, defaultImageWidth: 0 }, stickers: [], searchHistory: [] }),
    listPosts: async request => ({ posts: posts.filter(item => !request.category || item.category === request.category), source: 'web', fetchedAt: new Date().toISOString(), nextPage: null, notice: '本地预览数据 · 操作不会影响真实账号' }),
    readThread: async (item, page) => threadFor(item, page),
    readUserProfiles: async request => ({ outcomes: request.memberIds.map(memberId => ({ memberId, status: 'ready' as const, profile: { memberId, level: memberId === itemAuthorId(memberId) ? 6 : 3 }, fetchedAt: new Date().toISOString() })), complete: true }),
    queryForum: async request => {
      if (request.kind === 'account') return { profile: { id: 4242, name: account.name, rank: 6, coin: 128, topics: 18, replies: 236, following: 32, followers: 64 }, unread: { mentions: 1, replies: 2, messages: 0 } };
      if (request.kind === 'search') return { posts: posts.filter(item => item.title.includes(request.term)).slice(0, 8), nextPage: null };
      if (request.kind === 'publication-dates') return { publicationDates: Object.fromEntries(request.postIds.map(id => [id, ago(2)])) };
      if (request.kind === 'composer-options') return { options: { canPost: true, categories: [{ id: 'daily', title: '日常' }, { id: 'tech', title: '技术' }], ranks: [{ value: 0, title: '所有人可见' }] } };
      if (request.kind === 'introduction') return { introduction: { bio: '这是用于界面预览的本地账号。', signature: '保持好奇，持续记录。', readme: '# 预览简介\n\n无需登录即可检查界面。' } };
      if (request.kind === 'notifications') return request.category === 'messages' ? { conversations: [] } : { notices: [] };
      if (request.kind === 'space') return { profile: { id: request.memberId, name: '预览用户', rank: 5 }, activity: [], nextPage: null };
      return {};
    },
    getHotRanking: async (period: RankingPeriod) => ({ period, items: posts.slice(0, 6).map((item, index) => ({ ...item, position: index + 1, score: 98 - index * 7 })), fetchedAt: new Date().toISOString() }),
    saveSettings: async value => (settings = value),
    saveAppearance: async value => (appearance = value),
    getExtensions: async () => extensions,
    saveExtensions: async value => (extensions = value),
    readReadingLibrary: async () => library,
    mutateReadingLibrary: async () => library,
    forumAction: async () => ({ message: '预览模式：操作已模拟完成' }),
    writeForum: async () => ({ message: '预览模式：内容未发布到论坛' }),
    loadDraft: async () => null, saveDraft: async () => {},
    saveWorkspace: async () => {}, saveSearchHistory: async () => {},
    checkAccount: async () => account, clearSession: async () => {}, setBlockedUsers: async ids => ids,
    getDesktopPreferences: async () => ({ closeBehavior: 'ask', automaticUpdates: false }),
    setCloseBehavior: async closeBehavior => ({ closeBehavior, automaticUpdates: false }),
    setAutomaticUpdates: async automaticUpdates => ({ closeBehavior: 'ask', automaticUpdates }),
    getUpdateState: async () => updateState, checkUpdates: async () => updateState,
    downloadUpdate: async () => updateState, cancelUpdate: async () => updateState,
    installUpdate: async () => updateState, applyUpdate: async () => updateState,
    copyText: async text => { await navigator.clipboard?.writeText(text); },
    prepareImages: async content => content,
    getMediaSettings: async () => ({ hasApiKey: false, defaultImageWidth: 0 }),
    setMediaSettings: async () => ({ hasApiKey: false, defaultImageWidth: 0 }),
    getStickers: async () => [], readConversationContacts: async () => [],
    rememberConversationContact: async contact => [contact],
    loadAvatar: async () => null, loadReaderImage: async () => { throw new Error('预览模式不加载远程图片'); },
    uploadImage: async () => { throw new Error('预览模式不支持上传'); },
    uploadSticker: async () => { throw new Error('预览模式不支持上传'); },
    importStickers: async () => [], removeSticker: async () => {}, saveImage: async () => {}, copyImage: async () => {},
    queryRulings: async memberId => ({ memberId, records: [], source: '本地预览', fetchedAt: new Date().toISOString() }),
    getExchangeRates: async base => ({ base, rates: { CNY: 7.2 }, fetchedAt: new Date().toISOString(), source: '本地预览' }),
    calculateRemaining: async () => ({ value: '0', currency: 'CNY', remainingDays: 0, fullPeriods: 0, partialDays: 0, periodDays: 0, premium: '0', explanation: '预览数据' }),
    openOfficial: async () => {}, closeOfficial: async () => {}, reloadOfficial: async () => {}, setOfficialBounds: async () => {},
    openCalculator: async () => {}, openScriptSettings: async () => {}, openExternal: async () => {}, toggleBossKey: async () => {},
    windowAction: () => {},
    onAccountChange: noop, onOfficialChange: noop, onExtensionsChange: noop, onBossKey: noop, onOpenPost: noop, onUpdateChange: noop, onBeforeUpdateInstall: noop,
  };
  window.seekdesk = api;
}

function itemAuthorId(memberId: number) {
  return posts.find(item => item.authorId === memberId)?.authorId;
}
