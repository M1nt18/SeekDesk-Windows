'use strict';

// Isolated renderer fixtures: forum writes, drafts and desktop preferences are
// mocked. No forum mutation, native close dialog, update or installer is run.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const project = path.resolve(__dirname, '..');
const output = path.join(project, 'verification', 'hot-reply-ui');
const report = { testedAt: new Date().toISOString(), mode: 'isolated Electron; mocked forum writes and preferences', checks: [], errors: [], screenshots: [] };
const check = name => { report.checks.push({ name, status: 'pass' }); console.log('PASS', name); };
let instance, page;
async function capture(name) { await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name); }

(async () => {
  await fs.mkdir(output, { recursive: true });
  const env = { ...process.env, SEEKDESK_TEST: '1', SEEKDESK_USER_DATA: path.join(project, '.test-data', `hot-reply-ui-${Date.now()}`) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SEEKDESK_DEV_URL;
  instance = await electron.launch({ executablePath: require('electron'), args: [project], env, timeout: 45000 });
  page = await instance.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForSelector('.workspace', { timeout: 30000 });
  await instance.evaluate(({ ipcMain, BrowserWindow }) => {
    const now = new Date().toISOString();
    const account = { id: 4242, name: '热评回归账号', avatar: '', level: 6, status: 'signed-in' };
    const settings = { theme: 'light', fontSize: 18, uiFontSize: 16, nodeSeekPro: false, compact: false, restoreTabs: true, defaultSource: 'auto' };
    const appearance = { brand: 'blue', readerGradient: true, sidebarWidth: 250, listWidth: 370, listFontSize: 16, authorFontSize: 100, boardFontSize: 15, rankingFontSize: 14, nqScale: 100, tqScale: 100, sendShortcut: 'ctrl-enter', composerMode: 'split', notificationPolling: false, autoRefresh: false, autoLoadOlder: false };
    const extensions = { hotDefaultPeriod: 'realtime', hotSidebarCount: 10, hotRefreshSeconds: 180, installed: [], enabled: [], blocked: [], hits: [], unread: 0, watchWords: '', watchNote: '' };
    const post = { id: '701234', url: 'https://www.nodeseek.com/post-701234-1', title: '热评置顶与回复草稿回归', author: '楼主样本', authorId: 7000, category: 'tech', published: now, summary: '测试样本', replies: 20 };
    // Original server order deliberately interleaves a normal reply and hot
    // replies; the second hot reply is identified solely by its chicken count.
    const comments = [
      { id: '0', author: '楼主样本', authorId: 7000, date: now, floor: '楼主', html: '<p>主楼应始终保持在第一位。</p>', isAuthor: true, chicken: 5, likes: 0, dislikes: 0 },
      { id: '1', author: '普通回复', authorId: 7001, date: now, floor: '#1', html: '<p>普通回复应显示在热评之后。</p>', chicken: 0, likes: 0, dislikes: 0 },
      { id: '16', author: '跨页热评', authorId: 7016, date: now, floor: '#16', html: '<p>来自第二页的官方热评，引用与点赞都必须指向原楼层。</p>', isHot: true, sourcePage: 2, actionUrl: 'https://www.nodeseek.com/post-701234-2#16', chicken: 0, likes: 0, dislikes: 0 },
      { id: '3', author: '鸡腿热评', authorId: 7003, date: now, floor: '#3', html: '<p>只有鸡腿数量的回复也应显示 HOT。</p>', chicken: 2, sourcePage: 1, actionUrl: 'https://www.nodeseek.com/post-701234-1#3', likes: 0, dislikes: 0 },
    ];
    global.__hotReplyUi = { settings, appearance, post, comments, writes: [], drafts: {}, preferences: { closeBehavior: 'ask' }, delayNextPreferenceRead: 0 };
    const mock = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); };
    mock('app:bootstrap', () => ({ account, settings, workspace: { tabs: [], activeId: null, overviewOpen: true }, official: { visible: false, url: '', loading: false, purpose: 'login' }, blockedUsers: [], version: '0.1.0' }));
    mock('parity:bootstrap', () => ({ extensions, appearance, media: { hasApiKey: false, defaultImageWidth: 0 }, stickers: [], searchHistory: [] }));
    mock('forum:list', () => ({ posts: [post], source: 'web', fetchedAt: now, nextPage: null }));
    mock('forum:thread', () => ({ id: post.id, url: post.url, title: post.title, comments, source: 'web', page: 1, nextPage: 2, rootAuthorId: 7000 }));
    mock('forum:avatar', () => null);
    mock('parity:query', (_event, request) => request.kind === 'account' ? { profile: { id: account.id, name: account.name, rank: 6, coin: 12 }, unread: { mentions: 0, replies: 0, messages: 0 } } : {});
    mock('extensions:get', () => extensions);
    mock('extensions:ranking', () => ({ period: 'realtime', items: [], fetchedAt: now }));
    mock('app:workspace', () => {});
    mock('app:settings', (_event, value) => Object.assign(settings, value));
    mock('parity:appearance', (_event, value) => Object.assign(appearance, value));
    mock('forum:action', (_event, request, owner) => {
      if (owner !== account.id) throw new Error('Missing initiating identity');
      global.__hotReplyUi.writes.push({ request, owner });
      if (request.kind === 'react' && request.reaction === 'like') {
        const comment = comments.find(item => item.id === request.commentId);
        comment.liked = true; comment.likes += 1;
      }
      return { message: '隔离测试已接收' };
    });
    mock('parity:write', () => { throw new Error('Unexpected forum write'); });
    mock('parity:draft-load', (_event, key, owner) => owner === account.id ? global.__hotReplyUi.drafts[key] || null : null);
    mock('parity:draft-save', (_event, key, value, owner) => {
      if (owner !== account.id) throw new Error('Unexpected draft identity');
      if (value) global.__hotReplyUi.drafts[key] = value;
      else delete global.__hotReplyUi.drafts[key];
    });
    mock('media:prepare', (_event, content) => content);
    mock('app:desktop-preferences', () => {
      const value = { ...global.__hotReplyUi.preferences };
      const delay = global.__hotReplyUi.delayNextPreferenceRead;
      global.__hotReplyUi.delayNextPreferenceRead = 0;
      return delay ? new Promise(resolve => setTimeout(() => resolve(value), delay)) : value;
    });
    mock('app:close-behavior', (_event, closeBehavior) => {
      global.__hotReplyUi.preferences.closeBehavior = closeBehavior;
      return global.__hotReplyUi.preferences;
    });
    const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'));
    const send = main.webContents.send.bind(main.webContents);
    main.webContents.send = (channel, ...args) => { if (channel !== 'forum:account-change') send(channel, ...args); };
    main.setSize(1440, 960);
  });
  await page.reload();
  await page.getByTestId('post-row').first().click();
  await page.locator('.comment').nth(3).waitFor();
  assert.deepEqual(await page.locator('.comment').evaluateAll(comments => comments.map(comment => comment.dataset.floor)), ['0', '16', '3', '1']);
  assert.equal(await page.locator('.comment-hot-badge').count(), 2);
  for (const floor of ['16', '3']) assert.equal(await page.locator(`.comment[data-floor="${floor}"] .comment-hot-badge`).innerText(), 'HOT');
  assert.equal(await page.locator('.comment[data-floor="0"] .comment-hot-badge, .comment[data-floor="1"] .comment-hot-badge').count(), 0);
  await capture('hot-order-light-1440.png');
  check('Main post stays first; official and chicken hot replies retain their server order before ordinary replies');

  const hot = page.locator('.comment[data-floor="16"]');
  await hot.locator('.comment-actions > button').first().click();
  await page.getByText('隔离测试已接收', { exact: true }).waitFor();
  assert.deepEqual(await instance.evaluate(() => global.__hotReplyUi.writes), [{ request: { kind: 'react', url: 'https://www.nodeseek.com/post-701234-2#16', commentId: '16', reaction: 'like' }, owner: 4242 }]);
  await hot.getByRole('button', { name: '引用第16楼', exact: true }).click();
  const editor = page.locator('.fixed-reply .md-editor textarea');
  await editor.waitFor();
  assert.match(await editor.inputValue(), /\[#16\]\(https:\/\/www\.nodeseek\.com\/post-701234-2#16\)/);
  check('Cross-page hot reply reactions and quoted links use the actual page and floor');

  const draft = `${await editor.inputValue()}这段回复草稿应在关闭编辑器后保留。`;
  await editor.fill(draft);
  await page.getByRole('button', { name: '关闭回复编辑器', exact: true }).click();
  assert.equal(await page.locator('.fixed-reply .md-editor textarea').count(), 0);
  assert.equal(await page.getByRole('button', { name: '关闭回复编辑器', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: '写回复', exact: true }).getAttribute('aria-expanded'), 'false');
  await page.getByRole('button', { name: '写回复', exact: true }).click();
  assert.equal(await editor.inputValue(), draft);
  assert.equal(await page.getByRole('button', { name: '关闭回复编辑器', exact: true }).count(), 1);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await capture('reply-close-draft-dark-1440.png');
  assert.equal((await instance.evaluate(() => global.__hotReplyUi.writes)).length, 1);
  check('Reply close icon collapses the editor and reopening preserves the entire draft without posting');

  await page.getByTestId('settings-button').click();
  const closeSelect = page.getByRole('combobox', { name: '关闭主窗口', exact: true });
  await closeSelect.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-labelledby="desktop-close-label"]').disabled);
  assert.equal(await closeSelect.inputValue(), 'ask');
  await instance.evaluate(() => { global.__hotReplyUi.preferences.closeBehavior = 'tray'; });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(() => document.querySelector('[aria-labelledby="desktop-close-label"]').value === 'tray');
  await instance.evaluate(() => { global.__hotReplyUi.delayNextPreferenceRead = 300; });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await closeSelect.selectOption('quit');
  await page.waitForFunction(() => document.querySelector('[aria-labelledby="desktop-close-label"]').value === 'quit' && !document.querySelector('[aria-labelledby="desktop-close-label"]').disabled);
  await page.waitForTimeout(400);
  assert.equal(await closeSelect.inputValue(), 'quit');
  assert.equal(await instance.evaluate(() => global.__hotReplyUi.preferences.closeBehavior), 'quit');
  await capture('close-preference-focus-dark-1440.png');
  check('Restoring window focus refreshes external close preferences and a late read cannot overwrite a newer save');
  assert.deepEqual(report.errors, []);
  report.status = 'pass';
})().catch(async error => {
  report.status = 'fail'; report.failure = error.stack; console.error(error);
  if (page) await capture('hot-reply-failure.png').catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  if (instance) await instance.close().catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
});
