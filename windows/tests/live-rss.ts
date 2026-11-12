import { writeFile, mkdir } from 'node:fs/promises';
import { RSS_URL, parseRss } from '../electron/forum';

async function main() {
  const response = await fetch(RSS_URL, {headers:{Accept:'application/rss+xml, application/xml, text/xml'}, signal:AbortSignal.timeout(20000)});
  if (!response.ok || new URL(response.url).hostname !== 'rss.nodeseek.com') throw new Error(`RSS HTTP ${response.status}`);
  const xml = await response.text();
  const posts = parseRss(xml);
  if (!posts.length || !posts.some(post => post.summary.length > 0)) throw new Error('No readable public RSS posts.');
  const report = {checkedAt:new Date().toISOString(), source:response.url, httpStatus:response.status,
    bytes:Buffer.byteLength(xml), count:posts.length, categories:[...new Set(posts.map(post => post.category))],
    readableSummaries:posts.filter(post=>post.summary.length>0).length,
    sample:posts.slice(0,3).map(({id,title,url,author,category,summary})=>({id,title,url,author,category,summaryLength:summary.length})),
    scope:'Live public RSS only; no authenticated content was requested.'};
  await mkdir('verification',{recursive:true});
  await writeFile('verification/public-rss-check.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
