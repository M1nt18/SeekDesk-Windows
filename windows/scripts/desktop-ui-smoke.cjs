'use strict';

// Isolated renderer regression: all desktop actions and external links are IPC
// fixtures. No update is downloaded, no installer runs, and no browser opens.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const project = path.resolve(__dirname, '..');
const output = path.join(project, 'verification', 'desktop-ui');
const report = { testedAt: new Date().toISOString(), mode: 'isolated Electron with desktop IPC fixtures', checks: [], errors: [], screenshots: [] };
let instance, page;
const check = name => { report.checks.push({ name, status: 'pass' }); console.log('PASS', name); };
async function capture(name) { await page.screenshot({ path: path.join(output, name) }); report.screenshots.push(name); }
async function emitUpdate(patch) {
  await instance.evaluate(({ BrowserWindow }, value) => {
    Object.assign(global.__desktopUi.update, value);
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:')).webContents.send('app:update-change', global.__desktopUi.update);
  }, patch);
}
async function assertReadable() {
  const metrics = await page.getByTestId('settings-panel').evaluate(panel => {
    const small = [...panel.querySelectorAll('*')].filter(node => node.getClientRects().length && [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()) && !['SCRIPT', 'STYLE', 'OPTION'].includes(node.tagName) && parseFloat(getComputedStyle(node).fontSize) < 12).map(node => node.textContent.slice(0, 40));
    return { small, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.deepEqual(metrics, { small: [], overflow: false });
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const env = { ...process.env, SEEKDESK_TEST: '1', SEEKDESK_USER_DATA: path.join(project, '.test-data', `desktop-ui-${Date.now()}`) };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SEEKDESK_DEV_URL;
  instance = await electron.launch({ executablePath: require('electron'), args: [project], env, timeout: 45000 });
  page = await instance.firstWindow();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.waitForSelector('.workspace', { timeout: 30000 });
  await instance.evaluate(({ ipcMain, BrowserWindow }) => {
    const settings = { theme: 'light', fontSize: 18, uiFontSize: 16, nodeSeekPro: false, compact: false, restoreTabs: true, defaultSource: 'auto' };
    const appearance = { brand: 'blue', readerGradient: true, sidebarWidth: 250, listWidth: 370, listFontSize: 16, authorFontSize: 100, boardFontSize: 15, rankingFontSize: 14, nqScale: 100, tqScale: 100, sendShortcut: 'ctrl-enter', composerMode: 'split', notificationPolling: false, autoRefresh: false, autoLoadOlder: false };
    const extensions = { hotDefaultPeriod: 'realtime', hotSidebarCount: 10, hotRefreshSeconds: 180, installed: [], enabled: [], blocked: [], hits: [], unread: 0, watchWords: '', watchNote: '' };
    const update = { status: 'idle', currentVersion: '0.1.0', installable: true, releaseUrl: 'https://github.com/M1nt18/SeekDesk-Windows/releases/tag/v0.1.1' };
    global.__desktopUi = { preferences: { closeBehavior: 'ask' }, update, operations: [], links: [], settings };
    const mock = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); };
    const send = () => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:')).webContents.send('app:update-change', update);
    mock('app:bootstrap', () => ({ account: { id: null, name: '', avatar: '', status: 'signed-out' }, settings, workspace: { tabs: [], activeId: null, overviewOpen: true }, official: { visible: false, url: '', loading: false, purpose: 'login' }, blockedUsers: [], version: '0.1.0' }));
    mock('parity:bootstrap', () => ({ extensions, appearance, media: { hasApiKey: false, defaultImageWidth: 0 }, stickers: [], searchHistory: [] }));
    mock('forum:list', () => ({ posts: [], source: 'web', fetchedAt: new Date().toISOString(), nextPage: null }));
    mock('forum:avatar', () => null);
    mock('parity:query', () => ({}));
    mock('extensions:get', () => extensions);
    mock('extensions:ranking', () => ({ period: 'realtime', items: [], fetchedAt: new Date().toISOString() }));
    mock('app:workspace', () => {});
    mock('app:settings', (_event, value) => Object.assign(settings, value));
    mock('parity:appearance', (_event, value) => Object.assign(appearance, value));
    mock('app:external', (_event, url) => { global.__desktopUi.links.push(url); });
    mock('app:desktop-preferences', () => global.__desktopUi.preferences);
    mock('app:close-behavior', (_event, value) => { global.__desktopUi.preferences.closeBehavior = value; return global.__desktopUi.preferences; });
    mock('app:update-state', () => update);
    mock('app:update-check', () => { global.__desktopUi.operations.push('check'); Object.assign(update, { status: 'available', version: '0.1.1', installable: true, manualOnly: false }); send(); return update; });
    mock('app:update-download', () => { global.__desktopUi.operations.push('download'); Object.assign(update, { status: 'downloading', progress: { percent: 0, transferred: 0, total: 100 * 1024 * 1024, bytesPerSecond: 1024 * 1024 } }); send(); return update; });
    mock('app:update-cancel', () => { global.__desktopUi.operations.push('cancel'); Object.assign(update, { status: 'cancelled', progress: undefined }); send(); return update; });
    mock('app:update-install', () => { global.__desktopUi.operations.push('install'); Object.assign(update, { status: 'installing' }); send(); return update; });
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:')).setSize(1440, 960);
  });
  await page.reload();
  await page.getByTestId('settings-button').click();
  const closeSelect = page.getByRole('combobox', { name: '关闭主窗口', exact: true });
  await closeSelect.waitFor();
  await page.waitForFunction(() => !document.querySelector('[aria-labelledby="desktop-close-label"]').disabled);
  assert.equal(await closeSelect.inputValue(), 'ask');
  for (const behavior of ['tray', 'quit', 'ask']) {
    await closeSelect.selectOption(behavior);
    await page.waitForFunction(expected => document.querySelector('[aria-labelledby="desktop-close-label"]').value === expected && !document.querySelector('[aria-labelledby="desktop-close-label"]').disabled, behavior);
    assert.equal(await instance.evaluate(() => global.__desktopUi.preferences.closeBehavior), behavior);
  }
  await assertReadable();
  await capture('desktop-general-light-1440.png');
  check('All three close behaviors save through the desktop API');

  await page.getByRole('button', { name: '关于', exact: true }).click();
  const card = page.getByTestId('desktop-update-card');
  await card.getByRole('button', { name: '检查更新', exact: true }).waitFor();
  assert.deepEqual(await instance.evaluate(() => global.__desktopUi.operations), []);
  await emitUpdate({ status: 'checking' });
  await card.getByRole('heading', { name: '正在检查更新', exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: '正在检查…', exact: true }).isDisabled(), true);
  await emitUpdate({ status: 'up-to-date' });
  await card.getByRole('heading', { name: '已是最新版本', exact: true }).waitFor();
  await card.getByRole('button', { name: '检查更新', exact: true }).click();
  await card.getByRole('button', { name: '下载更新', exact: true }).waitFor();
  assert.deepEqual(await instance.evaluate(() => global.__desktopUi.operations), ['check']);
  await capture('desktop-update-available-light-1440.png');
  await card.getByRole('button', { name: '下载更新', exact: true }).click();
  await card.getByRole('progressbar', { name: '更新下载进度' }).waitFor();
  await emitUpdate({ progress: { percent: 42.5, transferred: 42.5 * 1024 * 1024, total: 100 * 1024 * 1024, bytesPerSecond: 2 * 1024 * 1024 } });
  await page.waitForFunction(() => document.querySelector('progress')?.value === 42.5);
  await card.getByRole('button', { name: '取消下载', exact: true }).click();
  await card.getByText('下载已取消，可以重新下载。', { exact: true }).waitFor();
  await card.getByRole('button', { name: '下载更新', exact: true }).click();
  await card.getByRole('progressbar', { name: '更新下载进度' }).waitFor();
  await emitUpdate({ status: 'downloaded', progress: undefined });
  await card.getByRole('button', { name: '重启并安装', exact: true }).waitFor();
  assert.equal((await instance.evaluate(() => global.__desktopUi.operations)).includes('install'), false);
  await card.getByRole('button', { name: '重启并安装', exact: true }).click();
  await card.getByRole('heading', { name: '正在准备安装', exact: true }).waitFor();
  assert.deepEqual(await instance.evaluate(() => global.__desktopUi.operations), ['check', 'download', 'cancel', 'download', 'install']);
  check('Checking, download progress, cancellation and installation each require their own user action');

  await emitUpdate({ status: 'available', manualOnly: true, installable: false });
  await card.getByText('此版本尚未提供在线更新文件，请前往发布页下载安装。', { exact: true }).waitFor();
  assert.equal(await card.getByRole('button', { name: '下载更新', exact: true }).count(), 0);
  await card.getByRole('button', { name: '前往发布页', exact: true }).click();
  assert.deepEqual(await instance.evaluate(() => global.__desktopUi.links), ['https://github.com/M1nt18/SeekDesk-Windows/releases/tag/v0.1.1']);
  await emitUpdate({ status: 'error', manualOnly: false, errorCode: 'verification', message: 'C:\\private-cache\\do-not-show.exe' });
  await card.getByText('更新文件校验失败，请重新下载。', { exact: true }).waitFor();
  assert.equal((await card.innerText()).includes('private-cache'), false);
  await emitUpdate({ status: 'unsupported', installable: false, manualOnly: true });
  await card.getByText('开发模式和免安装版请从发布页手动更新；安装版支持在线下载和安装。', { exact: true }).waitFor();
  await assertReadable();
  await capture('desktop-update-manual-light-1440.png');
  check('Missing manifests and unsupported builds offer only the user repository release page; errors hide internal paths');

  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await emitUpdate({ status: 'downloading', installable: true, manualOnly: false, progress: { percent: 68, transferred: 68 * 1024 * 1024, total: 100 * 1024 * 1024, bytesPerSecond: 2.4 * 1024 * 1024 } });
  await card.getByRole('progressbar', { name: '更新下载进度' }).waitFor();
  await assertReadable();
  await capture('desktop-update-progress-dark-1440.png');
  await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:')).setSize(980, 720));
  await assertReadable();
  await capture('desktop-update-progress-dark-980.png');
  await page.getByRole('button', { name: '通用', exact: true }).click();
  await page.getByTestId('desktop-close-settings').waitFor();
  await assertReadable();
  await capture('desktop-general-dark-980.png');
  assert.deepEqual(report.errors, []);
  check('Light and dark desktop settings remain at least 12px with no horizontal overflow at 1440 and 980 widths');
  report.status = 'pass';
})().catch(async error => {
  report.status = 'fail'; report.failure = error.stack; console.error(error);
  if (page) await capture('desktop-ui-failure.png').catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  if (instance) await instance.close().catch(() => {});
  await fs.writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
});
