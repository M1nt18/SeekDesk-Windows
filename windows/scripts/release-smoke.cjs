/* Exercise the shipped executable with a new, workspace-contained profile.
 * No installer, existing profile, remote writes, external browser or clipboard IO.
 * HTTPS fixture handlers preserve production IPC, parsing, storage and Sharp code.
 */
const { _electron } = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const project = path.resolve(__dirname, '..');
const executable = path.resolve(process.argv[2] || path.join(project, 'release-0.1.0-current', 'win-unpacked', 'SeekDesk Windows.exe'));
const output = path.join(project, 'verification');
const profile = path.join(project, '.test-data', 'release-runtime-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
const report = {
  testedAt: new Date().toISOString(),
  scope: 'Actual packaged win-unpacked executable; independent new test profile; fixed HTTPS public fixtures; no installation or forum writes.',
  executable: path.relative(project, executable),
  profile: path.relative(project, profile),
  checks: [], screenshots: [], errors: [],
};
let app, page;
function check(name, detail) {
  report.checks.push({ name, status: 'pass', ...(detail ? { detail } : {}) });
  console.log('PASS', name);
}
async function capture(name) {
  const toastClose = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await toastClose.count()) await toastClose.click();
  await page.screenshot({ path: path.join(output, name) });
  report.screenshots.push(name);
}

async function launch() {
  const env = { ...process.env, SEEKDESK_TEST: '1', SEEKDESK_USER_DATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SEEKDESK_DEV_URL;
  delete env.DEV_URL;
  app = await _electron.launch({
    executablePath: executable,
    args: ['--host-resolver-rules=MAP * ~NOTFOUND'],
    env, timeout: 45000,
  });
  // Install in-memory HTTPS fixtures before awaiting the first renderer window.
  // net.fetch respects Electron protocol handlers, unlike Node's native fetch.
  await app.evaluate(async ({ app, session, net }, { expectedProfile, png }) => {
    await app.whenReady();
    if (app.getPath('userData') !== expectedProfile) throw new Error('Test profile isolation failed');
    const state = { reads: 0, writes: 0, unexpected: 0, imageReads: 0, rssReads: 0 };
    globalThis.__releaseRuntime = state;
    const image = Buffer.from(png, 'base64');
    const rss = '<?xml version="1.0"?><rss version="2.0"><channel><title>Release fixture</title><item><title>发布运行验证 · 公开示例</title><link>https://www.nodeseek.com/post-910001-1</link><description><![CDATA[<p>固定公开摘要，仅用于安装包运行验证。</p>]]></description><author>公开示例作者</author><category>tech</category><pubDate>Thu, 12 Nov 2026 00:00:00 GMT</pubDate></item></channel></rss>';
    const listing = '<ul class="post-list"><li class="post-list-item"><div class="post-title"><a href="/post-910001-1">发布运行验证 · 公开示例</a></div><div class="info-author"><a href="/space/910001">公开示例作者</a></div><a class="post-category" href="/categories/tech">技术</a></li></ul>';
    const thread = '<div class="nsk-post-wrapper"><h1><a class="post-title-link">发布运行验证 · 公开示例</a></h1><div class="content-item" id="0"><div class="nsk-content-meta-info"><div class="author-info"><a class="author-name" href="/space/910001">公开示例作者</a><span class="is-poster">楼主</span></div></div><div class="post-content"><h2>打包运行验证</h2><p>此页面为固定的公开示例，未读取真实账户或论坛私有内容。</p><img src="https://93.184.215.14/release-fixture.png" alt="公开测试图片"><p>默认回复编辑器应保持收起。</p></div></div></div>';
    const html = body => '<!doctype html><meta charset="utf-8"><title>公开运行验证</title><script>window.__config__={user:null,postData:{postId:910001,comments:[]}};</script><div id="nsk-head"></div><div id="nsk-body-left">' + body + '</div>';
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    const route = async request => {
      const url = new URL(request.url);
      if (!['GET', 'HEAD'].includes(request.method)) {
        state.writes++;
        return new Response('All writes prohibited in release QA', { status: 405 });
      }
      state.reads++;
      if (url.hostname === 'rss.nodeseek.com' && url.pathname === '/') {
        state.rssReads++;
        return new Response(rss, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } });
      }
      if (url.hostname === '93.184.215.14' && url.pathname === '/release-fixture.png') {
        state.imageReads++;
        return new Response(image, { headers: { 'content-type': 'image/png' } });
      }
      if (url.hostname === 'api.bimg.eu.org' && /^\/(hot|daily|weekly)\.json$/.test(url.pathname)) {
        return json({ posts: [{ post: { id: 910001, title: '发布运行验证 · 公开示例', author: '公开示例作者', category: 'tech' }, score: 1 }] });
      }
      if (['www.nodeseek.com', 'nodeseek.com'].includes(url.hostname)) {
        if (url.pathname.startsWith('/avatar/')) return new Response(image, { headers: { 'content-type': 'image/png' } });
        if (url.pathname.startsWith('/api/account/getInfo/')) {
          return json({ success: true, detail: { member_id: 910001, member_name: '公开示例作者', rank: 1, roles: [], followed: false } });
        }
        if (url.pathname.startsWith('/api/')) return json({ success: true, data: [], items: [] });
        return new Response(html(url.pathname.startsWith('/post-') ? thread : listing), { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      // All other HTTPS requests are stopped in memory, never sent to a host.
      state.unexpected++;
      return new Response('No external network in release QA', { status: 404 });
    };
    for (const partition of [undefined, 'persist:nodeseek', 'public-rss', 'persist:calculator']) {
      const target = partition ? session.fromPartition(partition) : session.defaultSession;
      target.protocol.handle('https', route);
    }
    globalThis.fetch = (input, options) => net.fetch(input, options);
  }, { expectedProfile: profile, png: (await fs.readFile(path.join(project, 'build', 'icon.png'))).toString('base64') });
  page = await app.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForSelector('.workspace', { timeout: 45000 });
  return app.evaluate(({ app }) => ({
    packaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath(),
    executable: process.execPath, userData: app.getPath('userData'),
    devURL: Boolean(process.env.SEEKDESK_DEV_URL || process.env.DEV_URL),
    runAsNode: Boolean(process.env.ELECTRON_RUN_AS_NODE),
  }));
}

async function establishGuest() {
  // Opens the isolated fixture page and resets any initial startup read timeout.
  await page.evaluate(() => window.seekdesk.openOfficial('https://www.nodeseek.com/'));
  await page.waitForFunction(async () => (await window.seekdesk.checkAccount()).status === 'signed-out');
  await page.evaluate(() => window.seekdesk.closeOfficial());
  await page.getByTestId('official-panel').waitFor({ state: 'hidden' });
}

(async () => {
  await fs.access(executable);
  await fs.mkdir(output, { recursive: true });
  await fs.mkdir(profile, { recursive: false });
  assert.deepEqual(await fs.readdir(profile), []);
  const runtime = await launch();
  assert.equal(runtime.packaged, true);
  assert.equal(runtime.version, '0.1.0');
  assert.equal(path.normalize(runtime.executable).toLowerCase(), path.normalize(executable).toLowerCase());
  assert.equal(runtime.userData, profile);
  assert.match(runtime.appPath, /resources[\\/]app\.asar$/);
  assert.equal(runtime.devURL, false);
  assert.equal(runtime.runAsNode, false);
  check('Launched actual packaged 0.1.0 executable with isolated user data', { packaged: true, version: runtime.version, appAsar: true });

  const clean = await page.evaluate(async () => ({ base: await window.seekdesk.bootstrap(), parity: await window.seekdesk.parityBootstrap(), draft: await window.seekdesk.loadDraft('reply:910001', 910001) }));
  assert.notEqual(clean.base.account.status, 'signed-in');
  assert.equal(clean.base.account.id, undefined);
  assert.deepEqual(clean.base.workspace.tabs, []);
  assert.deepEqual(clean.base.blockedUsers, []);
  assert.deepEqual(clean.base.settings, { theme: 'system', uiFontSize: 16, fontSize: 18, nodeSeekPro: false, compact: false, restoreTabs: true, defaultSource: 'auto' });
  assert.equal(clean.parity.media.hasApiKey, false);
  assert.equal(clean.parity.media.defaultImageWidth, 0);
  assert.deepEqual(clean.parity.searchHistory, []);
  assert.equal(clean.draft, null);
  assert.deepEqual(clean.parity.extensions.installed, ['hot']);
  assert.deepEqual(clean.parity.extensions.enabled, ['hot']);
  for (const key of ['autoAttendance', 'watchSystemNotifications', 'authorOnly']) assert.equal(clean.parity.extensions[key], false);
  for (const key of ['watchWords', 'watchNote']) assert.equal(clean.parity.extensions[key], '');
  for (const key of ['blocked', 'hits']) assert.deepEqual(clean.parity.extensions[key], []);
  assert.equal(clean.parity.stickers.filter(item => !item.official).length, 0);
  const cookies = await app.evaluate(async ({ session }) => (await session.fromPartition('persist:nodeseek').cookies.get({})).length);
  assert.equal(cookies, 0);
  check('Fresh profile has no account, cookies, saved tabs, drafts, API key or custom extension state');

  await establishGuest();
  check('Fixed HTTPS fixture is recognized as signed out by real account extraction');
  await page.getByTestId('settings-button').click();
  await page.getByRole('button', { name: '关于', exact: true }).click();
  assert.match(await page.getByTestId('settings-panel').innerText(), /Windows 0\.1\.0/);
  await capture('release-about-0.1.0.png');
  check('About UI identifies this build as Windows 0.1.0');

  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('button', { name: '图床与表情库设置', exact: true }).click();
  const media = page.getByRole('dialog', { name: '图床与表情设置', exact: true });
  await media.getByRole('button', { name: '保存设置', exact: true }).waitFor();
  assert.equal(await media.locator('input[type=password]').inputValue(), '');
  assert.equal(await media.getByRole('button', { name: '移除密钥', exact: true }).count(), 0);
  await capture('release-media-empty.png');
  await page.keyboard.press('Escape');
  await media.waitFor({ state: 'hidden' });
  check('Image-host settings show an empty password input and no saved secret');

  const contentSource = page.getByTestId('settings-panel').locator('select').last();
  await contentSource.selectOption('rss');
  await page.waitForFunction(async () => (await window.seekdesk.bootstrap()).settings.defaultSource === 'rss');
  await page.getByRole('button', { name: '返回论坛', exact: true }).click();
  await page.getByTestId('post-row').first().waitFor({ timeout: 30000 });
  assert.equal(await page.getByTestId('list-source').innerText(), '公开 RSS');
  assert.match(await page.getByTestId('post-row').first().innerText(), /发布运行验证/);
  const rssResult = await page.evaluate(() => window.seekdesk.listPosts({}));
  assert.equal(rssResult.source, 'rss');
  assert.equal(rssResult.posts[0].id, '910001');
  check('Real RSS parser and preload display the fixed public feed');

  // Change the UI back to its default source to exercise actual web extraction.
  await page.getByTestId('settings-button').click();
  await page.getByTestId('settings-panel').locator('select').last().selectOption('auto');
  await page.waitForFunction(async () => (await window.seekdesk.bootstrap()).settings.defaultSource === 'auto');
  await page.getByRole('button', { name: '返回论坛', exact: true }).click();
  await page.getByTestId('post-row').first().waitFor();
  await page.getByTestId('post-row').first().click();
  await page.getByTestId('reader-content').first().waitFor({ timeout: 30000 });
  await page.getByTestId('reader-content').first().getByText('打包运行验证', { exact: true }).waitFor();
  assert.equal(await page.locator('.fixed-reply textarea').count(), 0);
  assert.equal(await page.getByRole('button', { name: '写回复', exact: true }).getAttribute('aria-expanded'), 'false');
  await capture('release-reader-collapsed.png');
  check('Actual packaged reader extracts the fixture post and keeps replies collapsed');

  const nativeImage = await page.evaluate(async () => {
    const image = await window.seekdesk.loadReaderImage('https://93.184.215.14/release-fixture.png', 96);
    return { width: image.width, height: image.height, originalWidth: image.originalWidth, originalHeight: image.originalHeight, reduced: image.reduced, webp: image.data.startsWith('data:image/webp;base64,'), bytes: image.data.length };
  });
  assert.equal(nativeImage.webp, true);
  assert.equal(nativeImage.width, 96);
  assert.equal(nativeImage.reduced, true);
  assert.ok(nativeImage.originalWidth > nativeImage.width && nativeImage.bytes > 100);
  check('Bundled Sharp native module decodes, resizes and encodes a public HTTPS fixture image', nativeImage);

  // Persist only harmless test-created values, through production UI and IPC.
  await page.getByTestId('settings-button').click();
  await page.getByRole('button', { name: '外观', exact: true }).click();
  await page.getByRole('button', { name: '黑夜', exact: true }).click();
  await page.waitForFunction(async () => (await window.seekdesk.bootstrap()).settings.theme === 'dark');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByRole('button', { name: '图床与表情库设置', exact: true }).click();
  await media.locator('input[type=number]').fill('640');
  await media.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.waitForFunction(async () => (await window.seekdesk.getMediaSettings()).defaultImageWidth === 640);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '返回论坛', exact: true }).click();
  await page.waitForTimeout(500);
  const beforeRestart = await app.evaluate(() => globalThis.__releaseRuntime);
  assert.equal(beforeRestart.writes, 0);
  await app.close(); app = undefined; page = undefined;

  await launch();
  const restored = await page.evaluate(async () => ({ base: await window.seekdesk.bootstrap(), media: await window.seekdesk.getMediaSettings(), draft: await window.seekdesk.loadDraft('reply:910001', 910001) }));
  assert.equal(restored.base.settings.theme, 'dark');
  assert.equal(restored.media.defaultImageWidth, 640);
  assert.equal(restored.media.hasApiKey, false);
  assert.notEqual(restored.base.account.status, 'signed-in');
  assert.equal(restored.draft, null);
  assert.deepEqual(restored.base.workspace.tabs.map(item => item.id), ['910001']);
  await establishGuest();
  await page.getByTestId('reader-content').first().waitFor({ timeout: 30000 });
  assert.equal(await page.getByRole('button', { name: '写回复', exact: true }).getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.fixed-reply textarea').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await capture('release-restarted.png');
  check('Independent profile restores test-created theme, media width and public tab after restart');

  const afterRestart = await app.evaluate(() => globalThis.__releaseRuntime);
  assert.equal(afterRestart.writes, 0);
  assert.ok(beforeRestart.rssReads > 0);
  assert.ok(beforeRestart.imageReads > 0);
  const files = await fs.readdir(profile);
  assert.ok(!files.includes('reader-entry.cjs'));
  const featureFile = await fs.readFile(path.join(profile, 'workspace-features.json'), 'utf8').catch(() => '{}');
  assert.deepEqual(JSON.parse(featureFile).drafts || {}, {});
  const mediaFile = JSON.parse(await fs.readFile(path.join(profile, 'media.json'), 'utf8'));
  assert.equal(mediaFile.key, undefined);
  assert.deepEqual(mediaFile.stickers, []);
  assert.deepEqual(report.errors, []);
  check('No forum writes, renderer exceptions, draft contents or saved API secrets', { forumWrites: 0, rendererExceptions: 0 });
  report.status = 'pass';
})().catch(async error => {
  report.status = 'fail';
  report.failure = error.stack;
  console.error(error.message);
  if (page) await capture('release-runtime-failure.png').catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  if (app) await app.close().catch(() => {});
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, 'release-runtime.json'), JSON.stringify(report, null, 2));
});
