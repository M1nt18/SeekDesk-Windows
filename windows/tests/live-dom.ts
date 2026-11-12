import { _electron } from 'playwright-core';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { extractListingScript } from '../electron/forum';

async function main() {
  const profile = path.resolve('.test-data', `live-dom-${Date.now()}`);
  const env = {...process.env, SEEKDESK_TEST:'1', SEEKDESK_USER_DATA:profile};
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.SEEKDESK_DEV_URL;
  const instance = await _electron.launch({executablePath:require('electron'),args:[path.resolve('.')],env});
  try {
    const page = await instance.firstWindow();
    await page.waitForSelector('.workspace');
    await page.evaluate(() => window.seekdesk.listPosts({}));
    const result = await instance.evaluate(async ({BrowserWindow}, script) => {
      const official = BrowserWindow.getAllWindows().find(win => /^https:\/\/(?:www\.)?nodeseek\.com\//.test(win.webContents.getURL()));
      if (!official) throw new Error('No official public page loaded.');
      const structure = await official.webContents.executeJavaScript(`(() => {
        const main = document.querySelector('#nsk-body-left') || document.querySelector('#nsk-frame');
        const lists = [...(main?.querySelectorAll('ul.post-list') || [])].filter(list => !list.parentElement?.closest('ul.post-list'));
        return {path:location.pathname, listCount:lists.length, rowsPerList:lists.map(list=>list.querySelectorAll(':scope > .post-list-item').length)};
      })()`);
      const extracted = await official.webContents.executeJavaScript(script);
      return {structure, extractedCount:extracted?.posts?.length ?? null, nextPage:extracted?.nextPage ?? null,
        sampleIds:(extracted?.posts || []).slice(0,3).map((post:{id:string})=>post.id)};
    }, extractListingScript);
    assert.ok(result.structure.listCount > 0, 'The official listing DOM must be available.');
    if (result.structure.rowsPerList.reduce((n:number,count:number)=>n+count,0) > 1) assert.ok(result.extractedCount! > 1);
    const report = {checkedAt:new Date().toISOString(),status:'pass',...result,
      scope:'Fresh isolated Electron profile; inspected public list structure only. No cookies or account data were read.'};
    await mkdir('verification',{recursive:true});
    await writeFile('verification/public-list-dom-check.json',JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
  } finally { await instance.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
