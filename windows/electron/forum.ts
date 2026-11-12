import { XMLParser, XMLValidator } from 'fast-xml-parser';
import sanitizeHtml from 'sanitize-html';
import type { ListingRequest, Post } from '../shared/types';

export const FORUM_ORIGIN = 'https://www.nodeseek.com';
export const RSS_URL = 'https://rss.nodeseek.com/';
const officialHosts = new Set(['www.nodeseek.com', 'nodeseek.com']);
const categories = new Set(['', 'daily', 'tech', 'info', 'review', 'trade', 'carpool', 'dev',
  'photo-share', 'expose', 'promotion', 'life', 'inside', 'sandbox', 'award']);

export function isOfficialUrl(input: unknown): input is string {
  if (typeof input !== 'string' || input.length > 4096) return false;
  try {
    const url = new URL(input);
    return url.protocol === 'https:' && officialHosts.has(url.hostname) && !url.username && !url.password && !url.port;
  } catch { return false; }
}

/** A canonical post location. Query strings are deliberately discarded. */
export function normalizePostUrl(input: unknown): string {
  if (!isOfficialUrl(input)) throw new Error('请使用 NodeSeek 官方 HTTPS 帖子链接。');
  const url = new URL(input);
  const match = /^\/post-([1-9]\d{0,14})(?:-([1-9]\d{0,6}))?\/?$/.exec(url.pathname);
  if (!match) throw new Error('帖子链接格式无效。');
  const hash = /^#(?:comment-)?\d{1,9}$/.test(url.hash) ? url.hash : '';
  return `${FORUM_ORIGIN}/post-${match[1]}-${match[2] || '1'}${hash}`;
}

export function listingUrl(request: ListingRequest = {}): string {
  const category = request.category ?? '';
  const order = request.order ?? 'postTime';
  const page = request.page ?? 1;
  if (!categories.has(category) || !['postTime', 'replyTime'].includes(order) ||
      !Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('无效的帖子列表参数。');
  const route = category === 'award' ? '/award' : category ? `/categories/${category}` : '';
  const url = new URL(`${route}${page > 1 ? `/page-${page}` : '/'}`, FORUM_ORIGIN);
  // The forum uses /categories/tech, without a trailing slash.
  if (page === 1 && route) url.pathname = route;
  if (category !== 'award') url.searchParams.set('sortBy', order);
  return url.href;
}

function contentUrl(input: string | undefined,link=false): string | undefined {
  if (!input || input.length > 8192) return undefined;
  try {
    const url = new URL(input, FORUM_ORIGIN);
    return (url.protocol === 'https:' || link&&url.protocol==='http:') && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

/** Untrusted forum HTML is rendered locally only after applying this allowlist. */
export function sanitizeContent(html: string): string {
  return sanitizeHtml(typeof html === 'string' ? html.slice(0, 2_000_000) : '', {
    allowedTags: ['p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'a', 'img',
      'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'details', 'summary', 'kbd', 'sup', 'sub'],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'title', 'loading', 'referrerpolicy','class'],
      th: ['colspan', 'rowspan'], td: ['colspan', 'rowspan'], ol: ['start'], code: ['class'],
      div: ['class'], span: ['class','style'], pre: ['class'],
    },
    allowedClasses: { code: [/^language-[a-z0-9-]{1,30}$/],div:['nsk-magic-tabs','nsk-magic-tab-title','nsk-magic-tab-body'],span:['nsk-magic-tab-title','seekdesk-terminal-span'],pre:['seekdesk-terminal','seekdesk-terminal-unavailable'],img:['sticker'] },
    allowedStyles:{span:{color:[/^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.%]+\))$/], 'background-color':[/^(?:#[0-9a-fA-F]{3,8}|rgba?\([\d\s,.%]+\))$/],'font-weight':[/^(?:bold|[1-9]00)$/]}},
    allowedSchemes: ['https','http'], allowedSchemesByTag:{img:['https']},allowProtocolRelative: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'iframe', 'object', 'embed', 'template', 'svg', 'math'],
    transformTags: {
      a: (_tag, attribs) => ({tagName: 'a', attribs: {
        ...(contentUrl(attribs.href,true) ? {href: contentUrl(attribs.href,true)!} : {}),
        ...(attribs.title ? {title: attribs.title} : {}), target: '_blank', rel: 'noopener noreferrer',
      }}),
      img: (_tag, attribs) => ({tagName: 'img', attribs: {
        ...(contentUrl(attribs.src) ? {src: contentUrl(attribs.src)!} : {}),
        ...(attribs.class?.split(/\s+/).includes('sticker')?{class:'sticker'}:{}),
        alt: attribs.alt || '帖子图片', loading: 'lazy', referrerpolicy: 'no-referrer',
      }}),
    },
    exclusiveFilter: frame => frame.tag === 'img' && !frame.attribs.src,
  });
}

const text = (value: unknown): string => typeof value === 'string' ? value :
  typeof value === 'number' ? String(value) : value && typeof value === 'object' && '#text' in value ?
    text((value as Record<string, unknown>)['#text']) : '';

export function parseRss(xml: string): Post[] {
  if (typeof xml !== 'string' || xml.length > 10_000_000 || /<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) {
    throw new Error('公开 RSS 文档无效。');
  }
  if (XMLValidator.validate(xml) !== true) throw new Error('公开 RSS 文档解析失败。');
  const parser = new XMLParser({ignoreAttributes: true, parseTagValue: false, trimValues: true,
    processEntities: true, isArray: name => name === 'item'});
  const data = parser.parse(xml);
  if (!data?.rss?.channel || typeof data.rss.channel !== 'object') throw new Error('服务器未返回有效 RSS。');
  const channel = data.rss.channel;
  const items: unknown[] = Array.isArray(channel.item) ? channel.item : [];
  const seen = new Set<string>();
  const posts: Post[] = [];
  for (const value of items.slice(0, 500)) {
    if (!value || typeof value !== 'object') continue;
    const item = value as Record<string, unknown>;
    let url: string;
    try { url = normalizePostUrl(text(item.link)); } catch { continue; }
    const id = url.match(/\/post-(\d+)-/)?.[1];
    const title = text(item.title).replace(/<[^>]*>/g, '').trim().slice(0, 1000);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const date = text(item.pubDate);
    const parsedDate = new Date(date);
    posts.push({id, url, title, author: text(item['dc:creator'] || item.author).slice(0, 200),
      category: text(item.category).slice(0, 100), published: Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString(),
      summary: sanitizeContent(text(item.description || item['content:encoded']))});
  }
  if (items.length && !posts.length) throw new Error('RSS 中未找到可读取的 NodeSeek 帖子。');
  return posts;
}

// Kept as self-contained IIFEs so Electron executes them in the official page's
// main world. No Node.js objects, IPC bridge, cookies, or credentials are exposed.
export const extractListingScript = String.raw`(() => {
  if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.hostname)) return null;
  const main = document.querySelector('#nsk-body-left') || document.querySelector('#nsk-frame');
  if (!main) return null;
  // Home can contain a pinned list followed by the regular feed. Keep every
  // top-level list, rather than treating its first (pinned) row as the feed.
  const lists = [...main.querySelectorAll('ul.post-list')]
    .filter(list => !list.parentElement?.closest('ul.post-list'));
  if (!lists.length) return null;
  const plain = node => (node?.textContent || '').trim();
  const safe = value => {
    if (!value) return undefined;
    try { const u = new URL(value, location.href); return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
  };
  const seen = new Set();
  const posts = lists.flatMap(list => [...list.querySelectorAll(':scope > .post-list-item')]).flatMap(row => {
    const link = row.querySelector('.post-title a[href^="/post-"], a[href^="/post-"]');
    if (!link) return [];
    const u = new URL(link.href);
    const route = /^\/post-([1-9]\d*)-([1-9]\d*)\/?$/.exec(u.pathname);
    if (!route || u.origin !== location.origin || seen.has(route[1])) return [];
    seen.add(route[1]);
    const author = row.querySelector('.info-author a') || row.querySelector('a[href^="/space/"]');
    const photo = row.querySelector('img.avatar-normal') || author?.querySelector('img');
    const cat = row.querySelector('.post-category, a[href^="/categories/"]');
    const titleNode = link.closest('.post-title');
    const restriction = plain(titleNode?.querySelector('use[href="#lock"]')?.closest('span'));
    const repliesText = plain(row.querySelector('.post-comment-count, .info-comments, .comment-count'));
    const authorId = Number(author?.getAttribute('href')?.match(/^\/space\/([1-9]\d*)\/?$/)?.[1]) || undefined;
    return [{id:route[1], url:link.href, title:plain(link), author:plain(author) || photo?.alt || '', authorId,
      category:cat?.getAttribute('href')?.split('/').filter(Boolean).pop() || '',
      published:row.querySelector('time[datetime]')?.getAttribute('datetime') || '', summary:'',
      avatar:safe(photo?.getAttribute('data-src') || photo?.getAttribute('src')),
      replies:/^\d+$/.test(repliesText) ? Number(repliesText) : undefined,
      featured:Boolean(titleNode?.querySelector('a[href="/award"] use[href="#diamonds"]')),
      readingRank:/^\d+$/.test(restriction) ? Number(restriction) : restriction === '私有' ? 255 : undefined}];
  });
  const currentPage = Number(location.pathname.match(/\/page-(\d+)\/?$/)?.[1] || 1);
  const candidate = [...main.querySelectorAll('a.pager-next[href], [aria-label="pagination"] a[href], .pagination a[href]')]
    .map(a => {try {return new URL(a.href);} catch {return null;}})
    .find(u => u?.origin === location.origin && Number(u.pathname.match(/\/page-(\d+)\/?$/)?.[1]) === currentPage + 1);
  return {posts, nextPage:candidate ? currentPage + 1 : null};
})()`;

/** Installed in the page main world at document start, before xterm replaces PRE. */
export const captureTerminalsScript = String.raw`(() => {
  if(location.protocol!=='https:'||!['www.nodeseek.com','nodeseek.com'].includes(location.host)||!/^\/post-\d+-\d+\/?$/.test(location.pathname)||globalThis.__seekDeskTerminalSources)return;
  const panes=new WeakMap(),captured=new WeakSet();
  const collect=(pre,parent)=>{
    if(!parent||captured.has(pre))return;const pane=parent.closest('.nsk-magic-tab-body,.post-content');if(!pane)return;
    const code=pre.querySelector('code')||pre,text=code.textContent||'',hint=/ansi|terminal|xterm/i.test(pre.className+' '+code.className)||/基本信息|IP质量/i.test(pane.previousElementSibling?.textContent||'');
    if(!/[\x1b]\[[0-9;:]*m|\u009b[0-9;:]*m/.test(text)&&!((hint||/硬件质量|IP质量|NodeQuality|融合怪|ecs\.sh/i.test(text))&&(text.match(/\[[0-9;:]{1,24}m/g)||[]).length>=3))return;
    captured.add(pre);const records=panes.get(pane)||[];records.push({pre,parent,text});panes.set(pane,records);
  };
  const scan=node=>{if(node.nodeType!==Node.ELEMENT_NODE)return;if(node.matches('pre'))collect(node,node.parentElement);else for(const pre of node.querySelectorAll('pre'))collect(pre,pre.parentElement);};
  const observer=new MutationObserver(records=>{for(const change of records){if(change.target.nodeType!==Node.ELEMENT_NODE)continue;const pre=change.target.closest('pre');if(pre)collect(pre,pre.parentElement);for(const removed of change.removedNodes)if(removed.nodeType===Node.ELEMENT_NODE&&removed.matches('pre'))collect(removed,change.target);for(const added of change.addedNodes)scan(added);}});
  observer.observe(document,{childList:true,subtree:true,characterData:true});document.addEventListener('DOMContentLoaded',()=>scan(document.documentElement),{once:true,capture:true});
  globalThis.__seekDeskTerminalSources=panes;setTimeout(()=>observer.disconnect(),15000);
})()`;

export const extractThreadScript = String.raw`(() => {
  if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.hostname)) return null;
  const route = /^\/post-([1-9]\d*)-([1-9]\d*)\/?$/.exec(location.pathname);
  if (!route) return null;
  const main = document.querySelector('#nsk-body-left');
  const title = main?.querySelector('h1 .post-title-link, .nsk-post-wrapper .post-title-link');
  if (!main || !title) return null;
  const plain = node => (node?.textContent || '').trim();
  const integer = value => (typeof value==='number'||typeof value==='string'&&value.trim()!=='') && Number.isSafeInteger(Number(value)) && Number(value)>=0 ? Number(value) : undefined;
  const safe = (value,link=false) => {
    if (!value) return undefined;
    try { const u = new URL(value, location.href); return (u.protocol === 'https:' || link&&u.protocol==='http:') && !u.username && !u.password ? u.href : undefined; } catch { return undefined; }
  };
  const memberIdFromHref = value => {
    if (typeof value!=='string') return undefined;
    try {
      const url=new URL(value,location.href);
      if(url.protocol!=='https:'||!['www.nodeseek.com','nodeseek.com'].includes(url.hostname)||url.username||url.password||url.port)return undefined;
      const memberId=integer(url.pathname.match(/^\/space\/([1-9]\d*)\/?$/)?.[1]);
      return memberId>0?memberId:undefined;
    } catch {return undefined;}
  };
  // The official comments list starts with hot/pinned copies, including floors
  // from other pages. Keep the root first and retain those off-page comments.
  const items = [...main.querySelectorAll('.nsk-post-wrapper .content-item[id="0"]'), ...main.querySelectorAll('.comments > .content-item[id]')]
    .filter(item => /^\d+$/.test(item.id) && integer(item.id)!==undefined && !item.hidden && !item.closest('.post-content'));
  if (!items.length) return null;
  const byFloor = new Map();
  for(const item of items){const floor=String(Number(item.id));const copies=byFloor.get(floor)||[];copies.push(item);byFloor.set(floor,copies);}
  const configured = window.__config__?.postData;
  const configuredRows = Number(configured?.postId) === Number(route[1]) && Array.isArray(configured.comments) ? configured.comments : [];
  const pageSize=integer(window.__config__?.commmentPerPage);
  const enabled=value=>[true,1,'1'].includes(value);
  const comments = [...byFloor].flatMap(([floorId,copies]) => {
    const item=copies[0];
    const meta = item.querySelector(':scope > .nsk-content-meta-info');
    const author = meta?.querySelector('.author-name');
    const rows=configuredRows.filter(row=>Number(row.floorIndex)===Number(floorId));
    const row=rows.find(row=>Number(row.commentId)===Number(item.getAttribute('data-comment-id')))||rows[0];
    const poster=row?.poster;
    const configuredAuthorId=integer(poster?.uid);
    const authorId=memberIdFromHref(author?.getAttribute('href')) || (configuredAuthorId>0?configuredAuthorId:undefined);
    const isHot=floorId!=='0'&&(rows.some(row=>enabled(row.hot))||copies.some(copy=>copy.querySelector(':scope > .nsk-content-meta-info .floor-link-wrapper > .hot-badge')));
    const isPinned=floorId!=='0'&&rows.some(row=>enabled(row.pined));
    const originalPage=floorId==='0'?1:pageSize&&pageSize<=1000?Math.floor((Number(floorId)-1)/pageSize)+1:!isHot&&!isPinned?Number(route[2]):undefined;
    const sourcePage=Number.isSafeInteger(originalPage)&&originalPage>0&&originalPage<=100000?originalPage:undefined;
    const actionUrl=sourcePage?location.origin+'/post-'+route[1]+'-'+sourcePage+'#'+floorId:undefined;
    const tags=[...(meta?.querySelectorAll('.author-info .role-tag:not(.is-poster), .role-tag:not(.is-poster)') || [])].map(plain).filter(Boolean);
    const levelPattern=/^(?:Lv\.?\s*|等级\s*)(\d+)(?=$|[\s|｜·•/()（）,，-])/i;
    const levelLabels=[...(meta?.querySelectorAll('[data-rank], .user-level, .author-level, .level-tag')||[])].map(plain).concat(tags);
    const levelLabel=levelLabels.find(label=>levelPattern.test(label)) || '';
    const level=[...[...(meta?.querySelectorAll('[data-rank]')||[])].map(node=>node.getAttribute('data-rank')),row?.rank,row?.member_rank,row?.commenter_rank,levelLabel.match(levelPattern)?.[1]].map(integer).find(value=>value!==undefined);
    const roleTags=tags.filter(tag=>!levelPattern.test(tag)&&tag!=='楼主');
    const configuredTags=Array.isArray(poster?.roles)?poster.roles.map(role=>typeof role?.display_text==='string'&&role.display_text.trim()?role.display_text.trim():typeof role?.name==='string'?role.name.trim():'').filter(tag=>tag&&!levelPattern.test(tag)&&tag!=='楼主'):[];
    const role=[...new Set(roleTags.length?roleTags:configuredTags)].join(' · ') || undefined;
    const photo = meta?.querySelector('.avatar-wrapper img');
    const time = meta?.querySelector('time');
    const content = item.querySelector(':scope > .post-content');
    const clone = content?.cloneNode(true);
    if (clone) {
      // Pair the original and cloned DOM before removing anything: xterm's canvas
      // viewport omits offscreen text, whereas captured PRE retains the full report.
      const roots=[...content.querySelectorAll('.terminal-container,.xterm')].filter(node=>!node.parentElement?.closest('.terminal-container,.xterm'));
      const copied=[...clone.querySelectorAll('.terminal-container,.xterm')].filter(node=>!node.parentElement?.closest('.terminal-container,.xterm'));
      roots.forEach((terminal,index)=>{
        const scope=terminal.closest('.nsk-magic-tab-body,.post-content'),records=(globalThis.__seekDeskTerminalSources?.get(scope)||[]).filter(row=>!row.pre.isConnected),peers=roots.filter(node=>node.closest('.nsk-magic-tab-body,.post-content')===scope);
        const related=records.filter(row=>row.parent.contains(terminal));
        const raw=related.length===1?related[0].text:records.length===peers.length?records[peers.indexOf(terminal)]?.text:null;
        const pre=document.createElement('pre');pre.className='seekdesk-terminal';
        if(raw)pre.textContent=raw;
        else {
          const drawn=terminal.querySelector('.xterm-rows');
          if(drawn?.textContent?.trim()){
            [...drawn.children].forEach((row,rowIndex)=>{if(rowIndex)pre.appendChild(document.createTextNode('\n'));for(const original of row.childNodes){if(original.nodeType!==Node.ELEMENT_NODE){pre.appendChild(document.createTextNode(original.textContent||''));continue;}const span=document.createElement('span'),style=getComputedStyle(original);span.className='seekdesk-terminal-span';span.textContent=original.textContent;span.style.color=style.color;span.style.backgroundColor=style.backgroundColor;span.style.fontWeight=style.fontWeight;pre.appendChild(span);}});
          }else{pre.className='seekdesk-terminal-unavailable';pre.textContent='终端报告未提供可读取的文本，请打开官方页面查看。';}
        }
        copied[index]?.replaceWith(pre);
      });
      clone.querySelectorAll('pre').forEach(pre=>{const code=pre.querySelector('code')||pre,raw=code.textContent||'',hint=/ansi|terminal|xterm/i.test(pre.className+' '+code.className)||/基本信息|IP质量/i.test(pre.closest('.nsk-magic-tab-body')?.previousElementSibling?.textContent||'');if(/[\x1b]\[[0-9;:]*m|\u009b[0-9;:]*m/.test(raw)||((hint||/硬件质量|IP质量|NodeQuality|融合怪|ecs\.sh/i.test(raw))&&(raw.match(/\[[0-9;:]{1,24}m/g)||[]).length>=3))pre.className='seekdesk-terminal';});
      clone.querySelectorAll('script,style,iframe,object,embed,form,template').forEach(node => node.remove());
      clone.querySelectorAll('[hidden],[aria-hidden="true"]').forEach(node=>{if(node.matches('.nsk-magic-tab-body')||node.closest('.nsk-magic-tab-body')){node.removeAttribute('hidden');node.removeAttribute('aria-hidden');}else node.remove();});
      clone.querySelectorAll('img').forEach(img => { const src = safe(img.getAttribute('data-src') || img.getAttribute('src')); if (src) img.setAttribute('src', src); else img.remove(); });
      clone.querySelectorAll('a[href]').forEach(a => { const href = safe(a.getAttribute('href'),true); if (href) a.setAttribute('href',href); else a.removeAttribute('href'); });
    }
    const warning = item.querySelector(':scope > .topic-warning');
    const signature=item.querySelector(':scope > .signature, :scope > .user-signature')?.cloneNode(true);
    if(signature)signature.querySelectorAll('a[href]').forEach(a=>{const href=safe(a.getAttribute('href'),true);if(href)a.setAttribute('href',href);else a.removeAttribute('href');});
    const menu=item.querySelector(':scope > .comment-menu');
    const reaction=title=>menu?.querySelector('[title="'+title+'"]');
    const count=(title,fallback)=>integer(/^\d+$/.test(plain(reaction(title)))?plain(reaction(title)):fallback);
    return [{id:floorId, author:plain(author) || (typeof poster?.name==='string'?poster.name.trim():'') || 'NodeSeek 用户',authorId,level,role,isHot,isPinned,sourcePage,actionUrl,
      isAuthor:floorId==='0'||Boolean(meta?.querySelector('.is-poster'))||enabled(poster?.isOp),isOwn:poster?.isMe===true,
      signature:plain(item.querySelector(':scope > .signature, :scope > .user-signature')) || undefined,
      signatureHtml:signature?.innerHTML || undefined,
      likes:count('点赞',row?.upvoteCount),chicken:count('加鸡腿',row?.likeCount),dislikes:count('反对',row?.dislikeCount),
      liked:reaction('点赞')?.classList.contains('clicked') || [true,1,'1'].includes(row?.upvoted),
      gaveChicken:reaction('加鸡腿')?.classList.contains('clicked') || [true,1,'1'].includes(row?.liked),
      disliked:reaction('反对')?.classList.contains('clicked') || [true,1,'1'].includes(row?.disliked),
      ...(typeof row?.followed==='boolean'?{following:row.followed}:{}),
      avatar:safe(photo?.getAttribute('data-src') || photo?.getAttribute('src')) || safe(poster?.avatar) || (authorId?location.origin+'/avatar/'+authorId+'.png':undefined),
      date:time?.getAttribute('datetime') || time?.getAttribute('title') || plain(time),
      floor:floorId === '0' ? '楼主' : '#' + floorId,
      html:(clone?.innerHTML || '') + (warning ? '<p>' + warning.textContent.replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])) + '</p>' : '')}];
  });
  const page = Number(route[2]);
  const knownPages=new Map([[1,location.origin+'/post-'+route[1]+'-1'],[page,location.origin+'/post-'+route[1]+'-'+page]]);
  let totalPages;
  for(const anchor of main.querySelectorAll('[aria-label="pagination"] a[href], .pagination a[href], a.pager-next[href], a[rel="last"][href]')) {
    try {
      const target=new URL(anchor.getAttribute('href'),location.href),match=target.pathname.match(/^\/post-([1-9]\d*)-([1-9]\d*)\/?$/),number=Number(match?.[2]);
      if(target.origin!==location.origin||target.username||target.password||match?.[1]!==route[1]||!Number.isSafeInteger(number)||number>100000)continue;
      knownPages.set(number,location.origin+'/post-'+route[1]+'-'+number);
      if(anchor.rel.split(/\s+/).includes('last')||/^(?:末页|尾页|最后一页|last(?: page)?)$/i.test(anchor.getAttribute('aria-label')||anchor.title||plain(anchor)))totalPages=number;
    } catch { /* Ignore unrelated or malformed navigation. */ }
  }
  if(totalPages!==undefined&&totalPages<page)totalPages=undefined;
  const pages=[...knownPages].sort((a,b)=>a[0]-b[0]).map(([number,url])=>({number,url}));
  const rootAuthorId=comments.find(comment=>comment.id==='0'||comment.isAuthor)?.authorId;
  const replyRestriction=[...(title.closest('h1')?.querySelectorAll('span')||[])].map(plain).find(value=>/^(只读|已锁定|禁止回复)$/.test(value));
  return {id:route[1], url:location.origin + location.pathname, title:plain(title), comments,rootAuthorId,replyRestriction,
    source:'web', page, pages,totalPages,nextPage:knownPages.has(page+1) ? page + 1 : null};
})()`;

export const extractIdentityScript = String.raw`(() => {
  if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.hostname)) return {status:'unknown'};
  if (document.querySelector('#challenge-running, #challenge-stage, .cf-challenge-running') ||
    /^(Just a moment|Attention Required)/i.test(document.title)) return {status:'verification'};
  const config = window.__config__;
  if (config && document.querySelector('#nsk-head')) {
    const id = Number(config.user?.member_id);
    if (config.user && Number.isSafeInteger(id) && id > 0) {
      const level=config.user.rank!=null && config.user.rank!=='' && Number.isSafeInteger(Number(config.user.rank)) && Number(config.user.rank)>=0 ? Number(config.user.rank) : undefined;
      return {status:'signed-in', id,level,avatar:location.origin+'/avatar/'+id+'.png',
      name:typeof config.user.member_name === 'string' ? config.user.member_name.slice(0,200) : 'NodeSeek 用户'};
    }
    if (!config.user) return {status:'signed-out'};
  }
  if (location.pathname === '/signIn.html' && document.querySelector('input[type="password"]')) return {status:'signed-out'};
  return {status:'unknown'};
})()`;

// Legacy inline reader retained for compatibility. Production loads the thread
// first, then progressively obtains every author's metadata through the service.
const profileMetadataBody = String.raw`
  if(location.protocol!=='https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) return [];
  const ids=[...new Set(inputIds)].filter(id=>Number.isSafeInteger(id)&&id>0);
  const rows=[];
  const integer=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='') && Number.isSafeInteger(Number(value)) && Number(value)>=0?Number(value):undefined;
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(3,ids.length)},async()=>{
    while(cursor<ids.length) {
      const memberId=ids[cursor++];
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try {
        const response=await fetch('/api/account/getInfo/'+memberId,{credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
        if(!response.ok || response.headers.get('cf-mitigated')==='challenge') continue;
        const result=await response.json().catch(()=>null),detail=result?.detail;
        if(result?.success!==true || Number(detail?.member_id)!==memberId) continue;
        const role=Array.isArray(detail.roles)?detail.roles.map(role=>typeof role?.display_text==='string'?role.display_text.trim():'').filter(Boolean).join(' · '):undefined;
        const rank=integer(detail.rank);
        const level=rank!==undefined?rank:typeof detail.coin==='number'&&Number.isFinite(detail.coin)&&detail.coin>=0?Math.min(6,Math.floor(Math.sqrt(detail.coin)/10)):undefined;
        rows.push({memberId,level,role:role||undefined,...(typeof detail.followed==='boolean'?{following:detail.followed}:{})});
      } catch { /* Profile metadata is optional; retain the readable thread. */ }
      finally {clearTimeout(timer);}
    }
  }));
  return rows;
`;

/** Legacy optional metadata reader; processes all members with at most three concurrent reads. */
export function createProfileMetadataScript(inputIds: number[]): string {
  const ids=Array.isArray(inputIds)?[...new Set(inputIds)].filter(id=>Number.isSafeInteger(id)&&id>0):[];
  return `(async()=>{const inputIds=${JSON.stringify(ids)};${profileMetadataBody}})()`;
}

// Legacy combined export for compatibility. Production must extract the body
// immediately and load optional profiles separately so slow metadata cannot
// delay or discard an otherwise readable thread.
export const extractThreadWithProfilesScript = `(async()=>{
  const thread=${extractThreadScript};
  if(!thread)return thread;
  const inputIds=thread.comments.filter(comment=>comment.authorId).map(comment=>comment.authorId);
  const profiles=await (async()=>{${profileMetadataBody}})();
  const byId=new Map(profiles.map(profile=>[profile.memberId,profile]));
  thread.comments=thread.comments.map(comment=>{const profile=byId.get(comment.authorId);return profile?{...comment,...(profile.level!==undefined?{level:profile.level}:{}),...(profile.role?{role:profile.role}:{}),...(typeof profile.following==='boolean'?{following:profile.following}:{})}:comment;});
  return thread;
})()`;
