import test from 'node:test';
import assert from 'node:assert/strict';
import MarkdownIt from 'markdown-it';
import {replaceImageLinks,scanImageLinks} from '../electron/image-links';
const md=new MarkdownIt({html:true});
function images(markdown:string):string[]{const result:string[]=[];const walk=(tokens:ReturnType<typeof md.parse>)=>{for(const token of tokens){if(token.type==='image')result.push(token.attrGet('src')||'');if(token.children)walk(token.children);}};walk(md.parse(markdown,{}));return result;}
test('only complete image destinations are replaced; text, normal links and URL prefixes stay intact',()=>{
  const url='https://img.example/a.png',replacement='https://cdn.example/resized.png';
  const source=`原链接 ${url}\n![图](${url} "图片标题")\n[普通链接](${url})\n![其他](${url}?different=1)`;
  const links=scanImageLinks(source);assert.equal(links.length,2);assert.equal(source.slice(links[0].start,links[0].end),url);
  const result=replaceImageLinks(source,{[url]:replacement});
  assert.ok(result.includes(`原链接 ${url}`));assert.ok(result.includes(`[普通链接](${url})`));assert.ok(result.includes(`![其他](${url}?different=1)`));
  assert.ok(result.includes(`![图](${replacement} "图片标题")`));assert.deepEqual(images(result),[replacement,url+'?different=1']);
});
test('escaped and nested parentheses, escaped alt brackets, angle destinations and titles retain valid Markdown',()=>{
  const first='https://img.example/a(1).png',second='https://img.example/nested(a(b)).png',third='https://img.example/a%20b.png';
  const source=String.raw`![方括号\] 说明](https://img.example/a\(1\).png '单引号标题')`+`\n![嵌套](${second})\n![空格](<https://img.example/a b.png> "标题")`;
  const links=scanImageLinks(source);assert.deepEqual(links.map(link=>link.url),[first,second,third]);assert.equal(links[2].angle,true);
  assert.equal(source.slice(links[0].start,links[0].end),String.raw`https://img.example/a\(1\).png`);
  const next='https://cdn.example/new(2).png?x=1&copy;=2';
  const result=replaceImageLinks(source,{[first]:next,[second]:'https://cdn.example/two.png',[third]:'https://cdn.example/a b.png'});
  assert.deepEqual(images(result),[next,'https://cdn.example/two.png','https://cdn.example/a%20b.png']);
  assert.ok(result.includes("'单引号标题'"));assert.ok(result.includes('"标题"'));
});
test('fenced code, indented code, inline backticks, escaped syntax and HTML code are excluded',()=>{
  const url='https://img.example/a.png';
  const source=['```markdown',`![fenced](${url})`,'```','',`    ![indented](${url})`,'',`\`![inline](${url})\``,`\`\`some \` ![inline2](${url})\`\``,String.raw`\![escaped](https://img.example/a.png)`,'',`<pre><img src="${url}">![pre](${url})</pre>`,'',`<!-- <img src="${url}"> -->`,'',`![valid](${url})`].join('\n');
  assert.equal(scanImageLinks(source).length,1);const result=replaceImageLinks(source,{[url]:'https://cdn.example/new.png'});
  assert.equal(result.match(/https:\/\/cdn\.example\/new\.png/g)?.length,1);
});
test('unmatched inline backticks do not swallow images in later paragraphs or headings',()=>{
  const source='unmatched `\n\n![a](https://img.example/a.png)\n\n# heading `\n\n![b](https://img.example/b.png)';
  assert.deepEqual(scanImageLinks(source).map(link=>link.url),['https://img.example/a.png','https://img.example/b.png']);
});
test('images inside blockquotes, list items and table cells are found with original source offsets',()=>{
  const source='> ![quote](https://img.example/q.png)\n\n- ![list](https://img.example/l.png)\n\n| Image |\n| --- |\n| ![table](https://img.example/t.png) |';
  const links=scanImageLinks(source);assert.deepEqual(links.map(link=>link.url),['https://img.example/q.png','https://img.example/l.png','https://img.example/t.png']);
  for(const link of links)assert.equal(source.slice(link.start,link.end),link.url);
});
test('quoted and unquoted HTML img src values decode entities and preserve unrelated attributes',()=>{
  const url='https://img.example/a.png?x=1&y=2';
  const source=`<div>\n<IMG data-src="https://decoy.example/a.png" src='https://img.example/a.png?x=1&amp;y=2' alt="x > y">\n<img src=https://img.example/b.png />\n</div>\n\n<a title="![not an image](https://img.example/x.png)">text</a>`;
  const links=scanImageLinks(source);assert.deepEqual(links.map(link=>link.url),[url,'https://img.example/b.png']);
  const result=replaceImageLinks(source,{[url]:"https://cdn.example/o'k.png?x=1&y=2",'https://img.example/b.png':'https://cdn.example/b.png'});
  assert.ok(result.includes("src='https://cdn.example/o&#39;k.png?x=1&amp;y=2'"));assert.ok(result.includes('data-src="https://decoy.example/a.png"'));assert.ok(result.includes('src=https://cdn.example/b.png />'));
  assert.equal(replaceImageLinks('<img src=https://img.example/a.png >',{'https://img.example/a.png':"https://cdn.example/o'k.png"}),'<img src=https://cdn.example/o%27k.png >');
});
test('reference image replacements preserve ordinary reference links and the shared definition',()=>{
  const url='https://img.example/a(1).png',replacement='https://cdn.example/new.png';
  const source=`![第一张][Avatar]\n![avatar][]\n![avatar]\n[普通链接][avatar]\n\n[avatar]: <${url}> "头像标题"`;
  const links=scanImageLinks(source);assert.equal(links.length,1);assert.equal(links[0].url,url);assert.equal(source.slice(links[0].start,links[0].end),url);
  const result=replaceImageLinks(source,{[url]:replacement});
  assert.deepEqual(images(result),[replacement,replacement,replacement]);assert.ok(result.includes('[普通链接][avatar]'));assert.ok(result.includes(`[avatar]: <${url}> "头像标题"`));
  assert.equal(md.render(result).match(/href="https:\/\/img.example\/a\(1\).png"/)?.length,1);
});
test('unknown, invalid and unused reference images are left unchanged',()=>{
  const source='![missing][unknown]\n\n![invalid](https://img.example/invalid space.png)\n\n[unused]: https://img.example/unused.png';
  assert.deepEqual(scanImageLinks(source),[]);assert.equal(replaceImageLinks(source,{'https://img.example/unused.png':'https://cdn.example/new.png'}),source);
});
