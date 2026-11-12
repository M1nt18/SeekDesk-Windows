/* README illustrations captured from the actual Electron/React application.
   Account, topics, notifications and balances below are synthetic demonstration
   data. No existing user profile is read and no forum content is published. */
const {_electron}=require('playwright-core');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const project=path.resolve(__dirname,'..');
const output=path.resolve(project,'../assets');
const profile=path.join(project,'.test-data','readme-'+Date.now());
let app,page;
const errors=[];

async function avatar(letter,color){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="22" fill="${color}"/><text x="48" y="65" font-size="57" font-family="Segoe UI,Arial,sans-serif" font-weight="600" text-anchor="middle" fill="white">${letter}</text></svg>`;
  return 'data:image/png;base64,'+(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64');
}
async function capture(name){
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForTimeout(280);
  const toastClose=page.getByRole('button',{name:'关闭提示',exact:true});
  if(await toastClose.count())await toastClose.click();
  await page.mouse.move(700,45);
  await page.screenshot({path:path.join(output,name)});
  console.log('Saved '+name);
}

(async()=>{
  await fs.mkdir(profile,{recursive:true});await fs.mkdir(output,{recursive:true});
  await fs.writeFile(path.join(profile,'preferences.json'),JSON.stringify({settings:{theme:'dark',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'rss'},workspace:{tabs:[],activeId:null,overviewOpen:true}}));
  const env={...process.env,SEEKDESK_TEST:'1',SEEKDESK_USER_DATA:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.SEEKDESK_DEV_URL;
  app=await _electron.launch({executablePath:require('electron'),args:[project],env,timeout:45000});
  page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.locator('.workspace').waitFor();
  const avatars={4242:'data:image/png;base64,'+(await fs.readFile(path.join(project,'public/assets/app-icon.png'))).toString('base64'),4243:await avatar('L','#517a70'),4244:await avatar('N','#6d6aa8'),4245:await avatar('M','#9e734a')};
  await app.context().route('https://www.nodeseek.com/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><html><div id="nsk-head"></div><script>window.__config__={user:null}</script><div id="nsk-body-left"><ul class="post-list"></ul></div></html>'}));
  await app.evaluate(({ipcMain,BrowserWindow},avatars)=>{
    const account={id:4242,name:'SeekDesk',avatar:avatars[4242],level:6,status:'signed-in'};
    const now=new Date(),stamp=minutes=>new Date(now.getTime()-minutes*60000).toISOString();
    const titles=[
      ['分享一次三网晚高峰线路实测','review','Lin',4243],
      ['香港 VPS 选购与剩余价值计算','trade','Noah',4244],
      ['从零部署一个轻量的个人服务','tech','Milo',4245],
      ['给常用的 Linux 命令做一份速查表','tech','Lin',4243],
      ['在桌面上，把多篇讨论放在一起读','daily','SeekDesk',4242],
      ['一张图看懂常见网络线路与回程','info','Noah',4244],
      ['周末折腾：整理我的家用网络','life','Milo',4245],
      ['给新项目选域名，有哪些经验？','daily','Lin',4243],
      ['开源小工具：让日常工作少一点重复','dev','SeekDesk',4242],
      ['分享几款轻量好用的服务器监控工具','tech','Noah',4244],
      ['本周社区好帖与实用资源整理','info','Milo',4245],
      ['给终端换一套舒服的配色','daily','Lin',4243],
    ];
    const posts=titles.map(([title,category,author,authorId],i)=>({id:String(600000+i),url:`https://www.nodeseek.com/post-${600000+i}-1`,title,category,author,authorId,avatar:avatars[authorId],published:stamp(i*4+2),summary:'',replies:[18,32,9,24,6,15,8,21,13,16,7,5][i],featured:i===0}));
    const comments=[
      {id:'0',author:'Lin',authorId:4243,avatar:avatars[4243],date:stamp(28),floor:'楼主',isAuthor:true,isOwn:false,level:5,role:'社区成员',likes:26,chicken:8,dislikes:0,
        html:'<p>把白天和晚高峰的结果放在一起，记录一下这次的线路体验。测试只作为日常选购参考，也欢迎补充不同地区的观察。</p><h3>三网测试记录</h3><table><thead><tr><th>接入网络</th><th>白天延迟</th><th>晚高峰延迟</th><th>观察</th></tr></thead><tbody><tr><td>电信</td><td>38 ms</td><td>42 ms</td><td>整体稳定</td></tr><tr><td>联通</td><td>34 ms</td><td>39 ms</td><td>波动较小</td></tr><tr><td>移动</td><td>45 ms</td><td>53 ms</td><td>偶有变化</td></tr></tbody></table><p>我习惯先保存完整输出，再对比不同时段的变化。需要进一步核实时，也可以回到 <a href="https://www.nodeseek.com/">NodeSeek 原帖</a> 查看讨论。</p>',
        signature:'记录、分享，也欢迎认真交流。',signatureHtml:'<p>记录、分享，也欢迎认真交流。 · <a href="https://www.nodeseek.com/">我的分享</a></p>'},
      {id:'1',author:'Noah',authorId:4244,avatar:avatars[4244],date:stamp(16),floor:'#1',isAuthor:false,isOwn:false,level:4,likes:4,chicken:1,dislikes:0,html:'<p>感谢整理！晚高峰的数据放在一起对照直观很多，准备再补一组本地的结果。</p>'},
      {id:'2',author:'SeekDesk',authorId:4242,avatar:avatars[4242],date:stamp(9),floor:'#2',isAuthor:false,isOwn:true,level:6,likes:2,chicken:0,dislikes:0,html:'<p>已经把相关讨论留在标签中，切换着看会方便一些。</p>'}
    ];
    const extensions={hotDefaultPeriod:'realtime',hotSidebarCount:10,hotRefreshSeconds:180,hotShowScore:false,installed:['hot','attendance','office','value','block','authorOnly','keywords','rulings'],enabled:['hot','attendance','office','value','block','authorOnly','keywords','rulings'],attendanceMode:'fixed',autoAttendance:false,officeTitle:'工作计划',officeButton:'返回',officeKey:'9',watchWords:'香港+VPS,日本+软银',watchNote:'关注有用的讨论',watchSystemNotifications:false,authorOnly:false,blocked:[],hits:[],unread:0};
    const appearance={brand:'purple',readerGradient:true,sidebarWidth:250,listWidth:370,listFontSize:16,authorFontSize:100,boardFontSize:15,rankingFontSize:14,nqScale:100,tqScale:100,sendShortcut:'ctrl-enter',composerMode:'split',notificationPolling:false,autoRefresh:false,autoLoadOlder:false};
    const settings={theme:'dark',fontSize:18,uiFontSize:16,nodeSeekPro:false,compact:false,restoreTabs:true,defaultSource:'auto'};
    const drafts={};let workspace={tabs:[],activeId:null,overviewOpen:true};
    const mock=(channel,handler)=>{ipcMain.removeHandler(channel);ipcMain.handle(channel,handler);};
    mock('app:bootstrap',()=>({account,settings,workspace,official:{visible:false,url:'',loading:false,purpose:'login'},blockedUsers:[],version:'0.1.0',buildNumber:'20261112090000'}));
    mock('parity:bootstrap',()=>({extensions,appearance,media:{hasApiKey:false,defaultImageWidth:0},stickers:[],searchHistory:[]}));
    mock('forum:list',()=>({posts,source:'web',fetchedAt:stamp(0),nextPage:2}));
    mock('forum:thread',(_event,post,page=1)=>({id:post.id,url:`https://www.nodeseek.com/post-${post.id}-${page}`,title:post.title,comments,source:'web',page,nextPage:2,rootAuthorId:4243}));
    mock('forum:avatar',(_event,id)=>avatars[id]||null);
    mock('parity:query',(_event,request)=>{
      if(request.kind==='account')return {profile:{id:4242,name:'SeekDesk',rank:6,coin:128,topics:9,replies:66,following:4,followers:8},unread:{mentions:1,replies:2,messages:1}};
      if(request.kind==='composer-options')return {options:{canPost:true,categories:[{id:'daily',title:'日常'},{id:'tech',title:'技术'},{id:'review',title:'测评'}],ranks:[{value:0,title:'公开'},{value:1,title:'Lv 1 及以上'}]}};
      return {};
    });
    mock('parity:write',()=>{throw new Error('README 演示禁止论坛写入');});
    mock('forum:action',()=>{throw new Error('README 演示禁止论坛写入');});
    mock('parity:draft-load',(_event,key)=>drafts[key]||null);mock('parity:draft-save',(_event,key,value)=>{if(value)drafts[key]=value;else delete drafts[key];});
    mock('media:prepare',(_event,value)=>value);mock('media:stickers',()=>[]);mock('media:settings',()=>({hasApiKey:false,defaultImageWidth:0}));
    mock('extensions:get',()=>extensions);mock('extensions:save',(_event,value)=>{Object.assign(extensions,value);return extensions;});
    mock('extensions:ranking',(_event,period)=>({period,items:posts.map((post,i)=>({...post,position:i+1,score:98-i*3})),fetchedAt:stamp(0)}));
    mock('parity:appearance',(_event,value)=>{Object.assign(appearance,value);return appearance;});
    mock('app:settings',(_event,value)=>{Object.assign(settings,value);return settings;});
    mock('app:workspace',(_event,value)=>{workspace=value;});
    mock('app:clipboard',()=>{throw new Error('README 演示不访问系统剪贴板');});
    const main=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().startsWith('file:'));
    const send=main.webContents.send.bind(main.webContents);main.webContents.send=(channel,...args)=>{if(channel!=='forum:account-change')send(channel,...args);};
    main.setSize(1991,1226);
  },avatars);
  await page.reload();await page.getByTestId('post-row').first().waitFor();
  await page.getByTestId('post-row').nth(1).click({modifiers:['Control']});
  await page.getByTestId('post-row').nth(2).click({modifiers:['Control']});
  await page.getByTestId('post-row').first().click();await page.getByTestId('reader-content').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.toolbar-account img,.comment-heading img')].every(image=>image.complete&&image.naturalWidth));
  await capture('windows-reading-dark.png');
  await page.getByTestId('settings-button').click();await page.getByRole('button',{name:'外观',exact:true}).click();
  await page.getByRole('button',{name:'白天',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.getByRole('button',{name:'返回论坛',exact:true}).click();await capture('windows-reading-light.png');
  await page.getByTestId('settings-button').click();await page.getByRole('button',{name:'外观',exact:true}).click();await page.getByRole('button',{name:'黑夜',exact:true}).click();await page.getByRole('button',{name:'返回论坛',exact:true}).click();
  await page.getByTestId('new-topic-button').click();
  await page.getByRole('textbox',{name:'帖子标题',exact:true}).fill('和 SeekDesk 一起，把讨论写清楚');
  await page.locator('.topic-editor-container .md-editor textarea').fill('# 今天，分享一点新发现\n\n在 Windows 上逛 NodeSeek，也能写得顺手。\n\n## 一篇好帖子，从这里开始\n\n- 用 **Markdown** 整理思路\n- 代码、链接和图片，各就各位\n- 一边编辑，一边看见最终效果\n\n> 这是一份用于项目介绍的演示草稿，未发布。\n\n```bash\necho "Hello, NodeSeek!"\n```\n\n把有用的信息留给下一位读者。');
  await page.locator('.topic-editor-container .md-preview h1').waitFor();
  await page.locator('.topic-editor-container .md-editor textarea').blur();
  await capture('windows-writing-dark.png');
  await page.getByRole('button',{name:'返回论坛',exact:true}).first().click();
  await page.locator('.sidebar-bottom').getByRole('button',{name:'扩展中心',exact:true}).click();
  assert.equal(await page.locator('.extension-card').count(),8);await capture('windows-extensions-dark.png');
  await page.getByTestId('settings-button').click();await page.getByRole('button',{name:'外观',exact:true}).click();
  assert.equal(await page.locator('.brand-option').count(),6);await capture('windows-appearance-dark.png');
  assert.deepEqual(errors,[]);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(app)await app.close();});
