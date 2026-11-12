'use strict';

// Runs the real main/preload/renderer in disposable userData. Every HTTPS
// request is handled by local fixtures; every forum write is rejected.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const project = path.resolve(__dirname, '..');
const directory = path.join(project, '.test-data', `profile-pagination-${Date.now()}`);
const output = path.join(project, 'verification', 'profile-pagination');
const report = { testedAt: new Date().toISOString(), mode: 'isolated Electron with local HTTPS protocol fixtures; no live forum requests or writes', checks: [], errors: [], screenshots: [] };
let app, page;
const check = (name, detail) => { report.checks.push({ name, status: 'pass', ...(detail ? { detail } : {}) }); console.log('PASS', name); };
async function capture(name) { await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name); }

function installFixture(input) {
  const { app, session } = require('electron');
  const state = globalThis.__profilePagination = {
    owner: 42, hold: true, holdOwner: undefined, pending: [], active: 0, peak: 0,
    profileCalls: [], documents: [], writes: [], failedAttempts: 0, slowPageTwo: false,
    release(owner) {
      const matching = this.pending.filter(item => owner === undefined || item.owner === owner);
      this.pending = this.pending.filter(item => !matching.includes(item));
      for (const item of matching) item.resolve();
    }
  };
  const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  const idsFor = number => number === 1 ? Array.from({ length: 14 }, (_, index) => 1000 + index) : Array.from({ length: 4 }, (_, index) => number * 1000 + index);
  const floor = (index, id, number) => '<div class="content-item" id="' + index + '"><div class="nsk-content-meta-info"><div class="author-info"><a class="author-name" href="/space/' + id + '">作者' + id + '</a>' + (index === 0 ? '<span class="is-poster">楼主</span>' : '') + '<time datetime="2026-11-12T01:00:00Z"></time></div></div><div class="post-content"><p>第' + number + '页：作者' + id + '的正文。</p>' + Array.from({ length: 5 }, (_, paragraph) => '<p>可滚动的正文段落' + paragraph + '。元数据逐项到达时不能把阅读位置重置到顶部。</p>').join('') + (index === 0 ? '<p><a href="/post-123-3#23">直接定位第三页楼层</a></p>' : '') + '</div></div>';
  function html(address) {
    const url = new URL(address), match = /^\/post-123-(\d+)$/.exec(url.pathname), number = Number(match?.[1] || 1), ids = idsFor(number);
    const rows = ids.map((id, index) => ({ floorIndex: index ? (number - 1) * 10 + index : 0, commentId: 900000 + id, poster: { uid: id, name: '作者' + id, isOp: index === 0, isMe: false, profile: '/space/' + id } }));
    const configuration = { user: { member_id: state.owner, member_name: '隔离账号' + state.owner }, commmentPerPage: 10, postData: { postId: 123, comments: rows } };
    const content = match
      ? '<div class="nsk-post-wrapper"><h1><a class="post-title-link">全员资料与分页回归</a></h1>' + floor(0, ids[0], number) + '</div><div class="comments">' + ids.slice(1).map((id, index) => floor((number - 1) * 10 + index + 1, id, number)).join('') + '</div><nav class="pagination" aria-label="pagination">' + [1, 2, 3, 4].map(value => '<a ' + (value === 4 ? 'rel="last" ' : value === number + 1 ? 'rel="next" ' : '') + 'href="/post-123-' + value + '">' + value + '</a>').join('') + '</nav>'
      : '<ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-123-1">全员资料与分页回归</a></div><div class="info-author"><a href="/space/1000">作者1000</a></div><a class="post-category" href="/categories/tech">技术</a><time datetime="2026-11-12T01:00:00Z"></time></li></ul>';
    return '<!doctype html><meta charset="utf-8"><title>隔离分页测试</title><script>window.__config__=' + JSON.stringify(configuration) + '</script><div id="nsk-head"></div><div id="nsk-body-left">' + content + '</div>';
  }
  async function route(request) {
    const url = new URL(request.url);
    if (!['www.nodeseek.com', 'nodeseek.com', 'rss.nodeseek.com'].includes(url.hostname)) return new Response('Fixture denies external hosts', { status: 403 });
    if (request.method !== 'GET') { state.writes.push({ method: request.method, path: url.pathname }); return json({ success: false, message: 'Fixture forbids forum writes' }, 405); }
    if (url.pathname.startsWith('/avatar/')) return new Response(Buffer.from(input.png, 'base64'), { headers: { 'content-type': 'image/png' } });
    if (url.pathname.startsWith('/api/account/getInfo/')) {
      const id = Number(url.pathname.split('/').pop()), owner = state.owner;
      if (id < 1000) return json({ success: true, detail: { member_id: id, member_name: '隔离账号' + id, rank: 6, coin: 1200 } });
      const call = { id, owner, started: Date.now() }; state.profileCalls.push(call); state.active++; state.peak = Math.max(state.peak, state.active);
      try {
        if (state.hold || state.holdOwner === owner) await new Promise(resolve => state.pending.push({ owner, id, resolve }));
        await wait(id === 1000 && owner === 42 ? 1800 : state.slowPageTwo && id >= 2000 && id < 3000 ? 1700 : 90);
        if (id === 1012 && owner === 42 && state.failedAttempts++ < 2) return json({ success: false, message: 'Synthetic transient endpoint failure' }, 503);
        return json({ success: true, detail: { member_id: id, member_name: '作者' + id, rank: owner === 43 ? 6 : id % 6, coin: 900, created_at: '2024-01-01T00:00:00Z', followed: id === 1009, bio: '账号' + owner + '的公开签名', signature_markdown: '[公开签名](https://example.com/)' } });
      } finally { call.finished = Date.now(); state.active--; }
    }
    if (url.pathname === '/api/notification/unread-count') return json({ success: true, unreadCount: { atMe: 0, reply: 0, message: 0 } });
    if (url.pathname.startsWith('/api/')) return json({ success: true, data: [], memberList: [], msgArray: [] });
    if (url.hostname === 'rss.nodeseek.com') return new Response('<rss><channel><item><title>全员资料与分页回归</title><link>https://www.nodeseek.com/post-123-1</link><description>Fixture RSS summary</description></item></channel></rss>', { headers: { 'content-type': 'application/rss+xml' } });
    state.documents.push({ url: request.url, at: Date.now() });
    return new Response(html(request.url), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  app.whenReady().then(() => { for (const partition of [undefined, 'persist:nodeseek', 'public-rss']) (partition ? session.fromPartition(partition) : session.defaultSession).protocol.handle('https', route); });
  globalThis.fetch = async () => { throw new Error('Fixture forbids external fetch'); };
}

const nav = position => page.getByRole('navigation', { name: position === 'top' ? '帖子顶部分页' : '帖子底部分页', exact: true });
async function go(number, position = 'top') {
  await nav(position).locator(`[data-page="${number}"]`).click();
  await nav('top').locator(`[data-page="${number}"][aria-current="page"]`).waitFor();
}

(async () => {
  await fs.mkdir(directory, { recursive: true }); await fs.mkdir(output, { recursive: true });
  const settings = { theme: 'light', fontSize: 18, uiFontSize: 16, nodeSeekPro: false, compact: false, restoreTabs: true, defaultSource: 'auto' };
  const appearance = { brand: 'blue', readerGradient: true, sidebarWidth: 250, listWidth: 370, listFontSize: 16, authorFontSize: 100, boardFontSize: 15, rankingFontSize: 14, nqScale: 100, tqScale: 100, sendShortcut: 'ctrl-enter', composerMode: 'split', notificationPolling: false, autoRefresh: false, autoLoadOlder: false };
  const extensions = { installed: [], enabled: [], hotDefaultPeriod: 'realtime', hotSidebarCount: 10, hotRefreshSeconds: 180, hotShowScore: false, attendanceMode: 'fixed', autoAttendance: false, officeTitle: '工作计划', officeButton: '返回', officeKey: '9', watchWords: '', watchNote: '', watchSystemNotifications: false, blocked: [], hits: [], unread: 0 };
  await fs.writeFile(path.join(directory, 'preferences.json'), JSON.stringify({ settings, workspace: { tabs: [], activeId: null, overviewOpen: true } }));
  await fs.writeFile(path.join(directory, 'workspace-features.json'), JSON.stringify({ appearance, extensions, history: [], drafts: {} }));
  const fixture = { main: path.join(project, 'dist-electron/electron/main.js'), png: (await fs.readFile(path.join(project, 'build/icon.png'))).toString('base64') }, entry = path.join(directory, 'entry.cjs');
  await fs.writeFile(entry, '(' + installFixture.toString() + ')(' + JSON.stringify(fixture) + ');require(' + JSON.stringify(fixture.main) + ');');
  const env = { ...process.env, SEEKDESK_TEST: '1', SEEKDESK_USER_DATA: directory }; delete env.ELECTRON_RUN_AS_NODE; delete env.SEEKDESK_DEV_URL;
  app = await electron.launch({ executablePath: require('electron'), args: [entry], env, timeout: 45000 });
  page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await page.evaluate(async () => { await window.seekdesk.openOfficial('https://www.nodeseek.com/?fixtureOwner=42'); await window.seekdesk.checkAccount(); await window.seekdesk.closeOfficial(); });
  await page.getByTestId('post-row').first().waitFor({ timeout: 30000 });
  await page.getByTestId('post-row').first().click();
  await page.locator('.comment').nth(13).waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('.profile-load-status')?.textContent.includes('读取用户等级'));
  assert.equal(await page.locator('.comment .level-badge').count(), 0);
  assert.equal(await page.getByTestId('thread-pagination').count(), 2);
  await app.evaluate(async () => {
    const deadline = Date.now() + 5000;
    while (!globalThis.__profilePagination.pending.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    if (!globalThis.__profilePagination.pending.length) throw new Error('Profiles did not start');
  });
  check('All 14 author bodies appear while profile GETs are held; no metadata blocks the document');

  await page.locator('.reader-scroll').evaluate(node => { node.scrollTop = 420; });
  const scrollBefore = await page.locator('.reader-scroll').evaluate(node => node.scrollTop);
  await app.evaluate(() => { const state = globalThis.__profilePagination; state.hold = false; state.release(); });
  await page.locator('.comment[data-floor="9"] .level-badge').waitFor({ timeout: 15000 });
  await page.locator('.comment[data-floor="12"]').getByRole('button', { name: '重试等级', exact: true }).waitFor({ timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('.profile-load-status')?.textContent.includes('读取用户等级'));
  const first = await app.evaluate(() => ({ calls: globalThis.__profilePagination.profileCalls, peak: globalThis.__profilePagination.peak }));
  assert.equal(new Set(first.calls.map(item => item.id)).size, 14); assert.ok(first.peak <= 3, `Peak profile concurrency ${first.peak}`);
  assert.equal(await page.locator('.comment .level-badge').count(), 13);
  assert.equal(await page.locator('.comment[data-floor="9"] .level-badge').getAttribute('data-level'), '1');
  assert.equal(await page.locator('.comment[data-floor="2"] .level-badge').getAttribute('data-level'), '0');
  assert.ok(first.calls.find(item => item.id === 1000).finished - first.calls.find(item => item.id === 1000).started >= 1750);
  const scrollAfter = await page.locator('.reader-scroll').evaluate(node => node.scrollTop);
  assert.ok(scrollAfter > 250 && Math.abs(scrollAfter - scrollBefore) < 90, `Unexpected scroll reset ${scrollBefore} -> ${scrollAfter}`);
  await capture('all-authors-progressive-light.png');
  check('Every author beyond the old eight-user limit is requested at max three concurrency; rank zero and a 1.8-second response work', { uniqueAuthors: 14, peak: first.peak, scrollBefore, scrollAfter });

  const documentsBeforeRetry = await app.evaluate(() => globalThis.__profilePagination.documents.length);
  await page.locator('.comment[data-floor="12"]').getByRole('button', { name: '重试等级', exact: true }).click();
  await page.locator('.comment[data-floor="12"] .level-badge').waitFor();
  assert.equal(await page.locator('.comment .level-badge').count(), 14);
  assert.equal(await app.evaluate(() => globalThis.__profilePagination.documents.length), documentsBeforeRetry);
  check('One transient retry and a persistent failure expose a working force-retry without reloading the post');

  for (const position of ['top', 'bottom']) assert.deepEqual(await nav(position).locator('[data-page]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.page))), [1, 2, 3, 4]);
  await page.getByRole('link', { name: '直接定位第三页楼层', exact: true }).first().click();
  await nav('top').locator('[data-page="3"][aria-current="page"]').waitFor();
  await page.locator('.comment[data-floor="23"]').waitFor();
  await go(1, 'top');
  await page.waitForFunction(() => document.querySelector('.reader-scroll').scrollTop < 12);
  await page.waitForFunction(async () => (await window.seekdesk.bootstrap()).workspace.tabs.find(tab => tab.id === '123')?.url === 'https://www.nodeseek.com/post-123-1');
  await go(3, 'bottom'); await go(1, 'bottom');
  await page.waitForFunction(() => document.querySelector('.reader-scroll').scrollTop < 12);
  await capture('top-bottom-four-page-controls.png');
  check('Top and bottom show all four real pages; both return page three to page one and discard its old floor hash');

  await app.evaluate(() => { globalThis.__profilePagination.slowPageTwo = true; });
  await go(2);
  await page.locator('.comment .author-name').filter({ hasText: '作者2000' }).waitFor();
  await page.waitForFunction(() => document.querySelector('.profile-load-status')?.textContent.includes('读取用户等级'));
  await go(4);
  await page.locator('.comment .author-name').filter({ hasText: '作者4000' }).waitFor();
  await page.locator('.comment[data-floor="33"] .level-badge').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1900);
  assert.equal(await page.locator('.comment').count(), 4);
  assert.ok((await page.locator('.comment .author-name').allTextContents()).every(name => /^作者400[0-3]$/.test(name)));
  assert.equal(await nav('top').locator('[aria-current="page"]').innerText(), '4');
  check('Late page-two metadata cannot bring old authors or page state back after switching to page four');

  await app.evaluate(() => { const state = globalThis.__profilePagination; state.owner = 43; state.holdOwner = 43; });
  await page.evaluate(async () => { await window.seekdesk.openOfficial('https://www.nodeseek.com/?fixtureOwner=43'); await window.seekdesk.checkAccount(); await window.seekdesk.closeOfficial(); });
  await page.waitForFunction(async () => (await window.seekdesk.bootstrap()).account.id === 43);
  await page.getByTestId('post-row').first().click();
  await page.locator('.comment').nth(13).waitFor();
  await page.waitForFunction(() => document.querySelector('.profile-load-status')?.textContent.includes('读取用户等级'));
  assert.equal(await page.locator('.comment .level-badge').count(), 0);
  await app.evaluate(() => { const state = globalThis.__profilePagination; state.holdOwner = undefined; state.release(43); });
  await page.waitForFunction(() => document.querySelectorAll('.comment .level-badge').length === 14, { timeout: 15000 });
  assert.ok((await page.locator('.comment .level-badge').evaluateAll(nodes => nodes.map(node => node.dataset.level))).every(level => level === '6'));
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; }); await capture('new-account-level-scope-dark.png');
  check('Switching accounts clears the old same-UID badges and only the new account scope can refill all 14 levels');

  const summary = await app.evaluate(() => ({ writes: globalThis.__profilePagination.writes, profileRequests: globalThis.__profilePagination.profileCalls.length, documents: globalThis.__profilePagination.documents }));
  assert.deepEqual(summary.writes, []); assert.deepEqual(report.errors, []);
  report.fixture = summary; report.status = 'pass';
  check('No real forum requests, forum writes, account data, or renderer exceptions were used');
})().catch(async error => {
  report.status = 'fail'; report.failure = error.stack; console.error(error); process.exitCode = 1;
  if (app) report.fixtureFailure = await app.evaluate(() => ({ owner: globalThis.__profilePagination.owner, profiles: globalThis.__profilePagination.profileCalls, documents: globalThis.__profilePagination.documents })).catch(() => undefined);
  if (page) report.accountFailure = await page.evaluate(async () => (await window.seekdesk.bootstrap()).account).catch(() => undefined);
  if (page) { await capture('failure.png').catch(() => {}); await fs.writeFile(path.join(output, 'failure.html'), await page.content()).catch(() => {}); }
}).finally(async () => {
  if (app) await app.close().catch(() => {});
  await fs.mkdir(output, { recursive: true }); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
});
