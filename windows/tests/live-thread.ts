import { _electron } from 'playwright-core';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { RSS_URL, parseRss, extractThreadScript } from '../electron/forum';

async function main() {
  const rss = await fetch(RSS_URL, {signal:AbortSignal.timeout(20000)});
  if (!rss.ok) throw new Error(`RSS HTTP ${rss.status}`);
  const post = parseRss(await rss.text()).find(post => post.summary.length > 0);
  if (!post) throw new Error('No public RSS post found.');
  const env = {...process.env, SEEKDESK_TEST:'1', SEEKDESK_USER_DATA:path.resolve('.test-data', `live-thread-${Date.now()}`)};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SEEKDESK_DEV_URL;
  const instance = await _electron.launch({executablePath:require('electron'),args:[path.resolve('.')],env});
  try {
    const page = await instance.firstWindow();
    await page.waitForSelector('.workspace');
    await page.waitForSelector('.post-row, .list-error', {timeout:45000});
    const throughApp = await page.evaluate(async post => {
      try {
        const result = await window.seekdesk.readThread(post);
        return {source:result.source, comments:result.comments.length, htmlCharacters:result.comments.reduce((n,comment)=>n+comment.html.length,0), notice:result.notice};
      } catch (error) { return {error:error instanceof Error ? error.message : String(error)}; }
    }, post);
    const inspected = await instance.evaluate(async ({BrowserWindow}, script) => {
      const official = BrowserWindow.getAllWindows().find(win => /^https:\/\/(?:www\.)?nodeseek\.com\//.test(win.webContents.getURL()));
      if (!official) return {error:'No official public page loaded.'};
      const structure = await official.webContents.executeJavaScript(`(() => ({
        path:location.pathname, title:document.title,
        challenge:Boolean(document.querySelector('#challenge-running, #challenge-stage, .cf-challenge-running')) || /^(Just a moment|Attention Required)/i.test(document.title),
        mainCount:document.querySelectorAll('#nsk-body-left').length,
        h1Count:document.querySelectorAll('h1').length,
        titleLinkCount:document.querySelectorAll('h1 .post-title-link, .nsk-post-wrapper .post-title-link').length,
        rootFloorCount:document.querySelectorAll('.nsk-post-wrapper .content-item[id="0"]').length,
        commentCount:document.querySelectorAll('.comments > .content-item[id]').length,
        bodyCount:document.querySelectorAll('.post-content').length
      }))()`);
      const extracted = await official.webContents.executeJavaScript(script);
      return {structure, extracted:extracted ? {id:extracted.id, title:extracted.title, page:extracted.page,
        comments:extracted.comments.length, htmlCharacters:extracted.comments.reduce((n:number,comment:{html:string})=>n+comment.html.length,0), nextPage:extracted.nextPage} : null};
    }, extractThreadScript);
    const status = 'structure' in inspected && inspected.structure?.challenge ? 'site-verification' :
      'extracted' in inspected && inspected.extracted?.htmlCharacters ? 'pass' : 'unavailable';
    const report = {checkedAt:new Date().toISOString(), status, publicPost:{id:post.id,url:post.url}, throughApp, ...inspected,
      scope:'One public thread navigation in a fresh isolated Electron profile. No sign-in, bypass, cookies, credentials, or private content inspected.'};
    await mkdir('verification',{recursive:true});
    await writeFile('verification/public-thread-dom-check.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { await instance.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
