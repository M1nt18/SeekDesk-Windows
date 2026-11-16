'use strict';

// Renderer-only fixtures: no update package, real installer, forum writes,
// existing user profile, registry changes, or external browser are used.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {_electron: electron} = require('playwright-core');
const project = path.resolve(__dirname, '..');
const output = path.join(project, 'verification', 'update-oneclick-ui');
const report = {checks: [], errors: [], mode: 'isolated Electron renderer with updater IPC fixtures'};
let app, page;
const check = name => {report.checks.push(name); console.log('PASS', name);};
const currentVersion = require('../package.json').version;
const nextVersion = currentVersion.split('.').map((number, index) => index === 2 ? Number(number) + 1 : Number(number)).join('.');

async function emit(patch) {
  await app.evaluate(({BrowserWindow}, value) => {
    Object.assign(global.__oneclick.update, value);
    BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:')).webContents.send('app:update-change', global.__oneclick.update);
  }, patch);
}
async function finish(patch, responsePatch = patch) {
  await app.evaluate(({BrowserWindow}, {patch, responsePatch}) => {
    Object.assign(global.__oneclick.update, patch);
    const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:'));
    win.webContents.send('app:update-change', global.__oneclick.update);
    global.__oneclick.resolveApply?.({...global.__oneclick.update, ...responsePatch});
    global.__oneclick.resolveApply = undefined;
  }, {patch, responsePatch});
}
const operations = () => app.evaluate(() => global.__oneclick.operations);
const card = () => page.getByTestId('desktop-update-card');

(async () => {
  await fs.mkdir(output, {recursive: true});
  const env = {...process.env, SEEKDESK_TEST: '1', SEEKDESK_USER_DATA: path.join(project, '.test-data', `update-oneclick-ui-${Date.now()}`)};
  delete env.ELECTRON_RUN_AS_NODE; delete env.SEEKDESK_DEV_URL;
  app = await electron.launch({executablePath: require('electron'), args: [project, '--host-resolver-rules=MAP * ~NOTFOUND'], env});
  page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
  await page.locator('.workspace').waitFor();
  await app.evaluate(({ipcMain, BrowserWindow}, {version, nextVersion}) => {
    const settings = {theme:'light', fontSize:18, uiFontSize:16, nodeSeekPro:false, compact:false, restoreTabs:true, defaultSource:'auto'};
    const appearance = {brand:'blue', readerGradient:true, sidebarWidth:250, listWidth:370, listFontSize:16, authorFontSize:100, boardFontSize:15, rankingFontSize:14, nqScale:100, tqScale:100, sendShortcut:'ctrl-enter', composerMode:'split', notificationPolling:false, autoRefresh:false, autoLoadOlder:false};
    const extensions = {installed:[], enabled:[], blocked:[], hits:[], unread:0, hotDefaultPeriod:'realtime', hotSidebarCount:10, hotRefreshSeconds:180, watchWords:'', watchNote:''};
    const update = {status:'idle', currentVersion:version, installable:true, releaseUrl:'https://github.com/M1nt18/SeekDesk-Windows/releases/tag/v'+nextVersion};
    const fixture = global.__oneclick = {update, operations:[], links:[], nextVersion};
    const mock = (channel, handler) => {ipcMain.removeHandler(channel); ipcMain.handle(channel, handler);};
    const send = () => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:')).webContents.send('app:update-change', update);
    mock('app:bootstrap', () => ({settings, workspace:{tabs:[], activeId:null, overviewOpen:true}, account:{status:'signed-out'}, official:{visible:false, url:'', loading:false, purpose:'login'}, blockedUsers:[], version}));
    mock('parity:bootstrap', () => ({appearance, extensions, stickers:[], searchHistory:[], media:{hasApiKey:false, defaultImageWidth:0}}));
    mock('forum:list', () => ({posts:[], nextPage:null, source:'web', fetchedAt:new Date().toISOString()}));
    mock('parity:query', () => ({})); mock('forum:avatar', () => null); mock('app:workspace', () => {});
    mock('extensions:get', () => extensions); mock('extensions:ranking', () => ({period:'realtime', items:[], fetchedAt:new Date().toISOString()}));
    mock('app:desktop-preferences', () => ({closeBehavior:'ask'}));
    mock('app:update-state', () => update);
    mock('app:update-check', () => {fixture.operations.push('check'); Object.assign(update, {status:'available', version:nextVersion, installable:true, canDownload:true, manualOnly:false, errorCode:undefined}); send(); return update;});
    mock('app:update-download', () => {throw new Error('Renderer must use the one-click operation');});
    mock('app:update-install', () => {throw new Error('Renderer must not orchestrate installation');});
    mock('app:update-apply', () => {
      fixture.operations.push('apply');
      if (update.status === 'downloaded') {Object.assign(update, {status:'installing', applying:true, canDownload:false, errorCode:undefined}); send(); return update;}
      Object.assign(update, {status:'downloading', applying:true, canDownload:false, errorCode:undefined, progress:{percent:0, transferred:0, total:104857600, bytesPerSecond:1048576}}); send();
      return new Promise(resolve => {fixture.resolveApply = resolve;});
    });
    mock('app:update-cancel', () => {
      fixture.operations.push('cancel'); Object.assign(update, {status:'cancelled', applying:false, canDownload:true, progress:undefined}); send();
      fixture.resolveApply?.({...update}); fixture.resolveApply = undefined; return update;
    });
    mock('app:external', (_event, url) => {fixture.links.push(url);});
  }, {version:currentVersion, nextVersion});
  await page.reload(); await page.getByTestId('settings-button').click();
  await page.getByRole('button', {name:'关于', exact:true}).click();
  await card().getByRole('button', {name:'检查更新', exact:true}).click();
  await card().getByRole('button', {name:'立即更新', exact:true}).waitFor();
  await card().getByText('后台下载并校验，完成后自动更新和重启，请先保存正在编辑的内容。', {exact:true}).waitFor();
  assert.deepEqual(await operations(), ['check']);
  await card().getByRole('button', {name:'立即更新', exact:true}).evaluate(button => {button.click(); button.click();});
  await card().getByRole('progressbar', {name:'更新下载进度'}).waitFor();
  assert.deepEqual(await operations(), ['check','apply']);
  assert.equal(await card().getByRole('button', {name:'下载更新', exact:true}).count(), 0);
  check('One click starts the dedicated update operation exactly once and discloses the automatic restart');

  await emit({progress:{percent:42.5, transferred:44564480, total:104857600, bytesPerSecond:2097152}});
  await page.waitForFunction(() => document.querySelector('progress')?.value === 42.5);
  await page.getByRole('button', {name:'通用', exact:true}).click();
  await finish({status:'downloaded', applying:true, canDownload:false, progress:undefined}, {status:'available', applying:false, canDownload:true});
  await page.getByRole('button', {name:'关于', exact:true}).click();
  await card().getByRole('button', {name:'正在准备更新…', exact:true}).waitFor();
  assert.equal(await card().getByRole('button', {name:'正在准备更新…', exact:true}).isDisabled(), true);
  await emit({status:'installing', applying:true});
  await card().getByRole('heading', {name:'正在重启更新', exact:true}).waitFor();
  assert.equal(await card().getByRole('progressbar').count(), 0);
  assert.deepEqual(await operations(), ['check','apply']);
  assert.deepEqual(await app.evaluate(() => global.__oneclick.links), []);
  check('Leaving settings does not require a renderer install callback; a stale action result cannot replace installation state');

  await emit({status:'available', applying:false, canDownload:true, installable:true, manualOnly:false});
  await card().getByRole('button', {name:'立即更新', exact:true}).click();
  await card().getByRole('button', {name:'取消下载', exact:true}).click();
  await card().getByText('更新已取消，可以重新点击“立即更新”。', {exact:true}).waitFor();
  await emit({status:'downloaded', canDownload:false});
  await card().getByRole('button', {name:'重启更新', exact:true}).waitFor();
  assert.deepEqual(await operations(), ['check','apply','apply','cancel']);
  await card().getByRole('button', {name:'重启更新', exact:true}).click();
  await card().getByRole('heading', {name:'正在重启更新', exact:true}).waitFor();
  assert.deepEqual(await operations(), ['check','apply','apply','cancel','apply']);
  check('Cancellation does not install; a recovered verified package waits for an explicit install-and-restart click');

  await emit({status:'error', applying:false, errorCode:'verification', canDownload:true, installable:true, manualOnly:false, message:'C:\\private\\not-for-renderer.exe'});
  await card().getByText('更新文件校验失败，请重新下载。', {exact:true}).waitFor();
  assert.equal(await card().getByRole('button', {name:'前往发布页', exact:true}).count(), 0);
  assert.equal((await card().innerText()).includes('not-for-renderer'), false);
  await emit({status:'downloaded', applying:false, errorCode:'prepare', canDownload:false, installable:true, manualOnly:false});
  await card().getByText('当前编辑内容未能保存，更新尚未安装，请稍后重试。', {exact:true}).waitFor();
  assert.equal(await card().getByRole('button', {name:'重启更新', exact:true}).isEnabled(), true);
  assert.equal(await card().getByRole('button', {name:'前往发布页', exact:true}).count(), 0);
  await emit({status:'available', applying:false, errorCode:'manifest-missing', manualOnly:true, installable:false, canDownload:false});
  await card().getByRole('button', {name:'前往发布页', exact:true}).click();
  assert.deepEqual(await app.evaluate(() => global.__oneclick.links), ['https://github.com/M1nt18/SeekDesk-Windows/releases/tag/v'+nextVersion]);
  assert.equal(await card().getByRole('button', {name:'立即更新', exact:true}).count(), 0);
  check('Only explicit manual-only cases open the user release page; ordinary failures retain an in-app retry and hide native paths');

  await emit({status:'downloading', errorCode:undefined, canDownload:false, manualOnly:false, installable:true, progress:{percent:68, transferred:71303168, total:104857600, bytesPerSecond:2097152}});
  await page.evaluate(() => {document.documentElement.dataset.theme='dark';});
  await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().startsWith('file:')).setSize(980,720));
  const layout = await card().evaluate(node => ({overflow:document.documentElement.scrollWidth>innerWidth, tooSmall:[...node.querySelectorAll('*')].some(item => item.getClientRects().length && [...item.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim()) && parseFloat(getComputedStyle(item).fontSize)<12)}));
  assert.deepEqual(layout, {overflow:false, tooSmall:false});
  await page.screenshot({path:path.join(output,'progress-dark-980.png')});
  await emit({status:'installing', canDownload:false, progress:undefined});
  await card().getByRole('heading', {name:'正在重启更新', exact:true}).waitFor();
  await page.screenshot({path:path.join(output,'installing-dark-980.png')});
  assert.deepEqual(report.errors, []);
  check('Progress remains readable in a narrow dark window without claiming a fake installation percentage or renderer exceptions');
  report.status='pass';
})().catch(error => {report.status='fail'; report.failure=error.stack; console.error(error); process.exitCode=1;}).finally(async()=>{
  if(app)await app.close().catch(()=>{});
  await fs.mkdir(output,{recursive:true}); await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
});
