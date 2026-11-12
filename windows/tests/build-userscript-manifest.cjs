const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../vendor/nodeseek-pro');
const sources={
 'nodeseek-pro.user.js':['https://update.greasyfork.org/scripts/567109/Nodeseek%20Pro.user.js','GPL-3.0-only'],
 'layui.js':['https://cdn.jsdelivr.net/npm/layui@2.10.3/dist/layui.js','MIT'],
 'layui.css':['https://cdn.jsdelivr.net/npm/layui@2.10.3/dist/css/layui.css','MIT'],
 'layui-icon.woff2':['https://cdn.jsdelivr.net/npm/layui@2.10.3/dist/font/iconfont.woff2','MIT'],
 'layui-dark.css':['SeekDesk local compatibility CSS','GPL-3.0-only'],
 'highlight.js':['https://s4.zstatic.net/ajax/libs/highlight.js/11.9.0/highlight.min.js','BSD-3-Clause'],
 'highlight-light.css':['https://s4.zstatic.net/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css','BSD-3-Clause'],
 'highlight-dark.css':['https://s4.zstatic.net/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css','BSD-3-Clause'],
};
const files=Object.entries(sources).map(([name,[source,license]])=>{const bytes=fs.readFileSync(path.join(root,name));return {name,source,license,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};});
fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({name:'Nodeseek Pro',version:'1.0.8',author:'Woodll',source:'https://greasyfork.org/scripts/567109-nodeseek-pro',license:'GPL-3.0-only',files},null,2));
console.log('Pinned manifest recorded',files.length,'assets');
