# NodeSeek Pro 集成

集成原版 **Woodll / Nodeseek Pro 1.0.8**，GreasyFork 项目 [567109](https://greasyfork.org/scripts/567109-nodeseek-pro)，许可 GPL-3.0-only。不是名称相近的 Max-iSen 衍生版。原始源文件、许可证说明、固定资源及 SHA-256 位于 `vendor/nodeseek-pro/`。

在设置开启 NodeSeek Pro 后，打开客户端内的官方网页。脚本在这个官方页面内运行，右下角“NodeSeek Pro 设置”可打开其菜单和原版高级设置。React 帖子列表和原生阅读区使用自己的实现，网页用户脚本不会在 React DOM 中运行。

首次集成默认关闭自动签到，保留原版 AI 总开关为 false。用户可在脚本高级设置主动启用需要的功能。自动签到启用后属于脚本在官方页面的行为，不是桌面端独立定时服务；关闭客户端后不会继续运行。

## 隔离与本地保存

- 官方页仍是 sandbox、contextIsolation 开启且 Node.js 关闭的 WebContentsView。
- GM 兼容桥仅暴露于隔离世界 1004。站点主世界的 `window.seekdesk`、`window.require`、`window.__seekdeskGM` 均不可用。
- 原版脚本在隔离世界执行，DOM 与官网共享。`unsafeWindow` 兼容对象包含当前页面 `__config__` 快照和 IndexedDB；未暴露应用文件系统、Electron 对象或任意 IPC。
- GM 配置单独保存为用户数据目录下 `nodeseek-pro.json`，不写入项目源码，也不会上传到项目服务器。脚本的站内历史/关系数据仍依照原版使用站点 localStorage / IndexedDB。
- Layui 2.10.3、highlight.js 11.9.0、主题样式和字体均为固定本地文件。宿主预设资源标记，阻止原版再次从第三方 CSS/JS 地址加载同名资源。原版源文件保持不变，运行时仅有一项显式适配：其 addStyle URL 检测增加固定 `data:text/css` 资源支持，否则原版会把 GM 的本地 CSS URL 当作 CSS 正文。

## 兼容范围

支持 GM 同步读取/设置/删除、脚本菜单、样式与元素插入、固定资源 URL、安全打开网页、本地页面通知，以及受限跨域 XMLHttpRequest 兼容。设置和原版高级设置实际运行已验证。

跨域桥目前只允许 HTTPS 的 `api.nodeimage.com` 与 `api.openai.com`，拒绝凭据 URL、非标准端口、Cookie/Host/Origin/代理身份请求头及重定向；外部请求使用独立无 Cookie 的 fetch，不会带出 NodeSeek 登录 Cookie。单次请求/响应限制 8 MB，超时上限 30 秒，支持字符串和 FormData 文件上传。

任意自定义 AI 代理地址不在允许列表中，调用会显示明确错误。NodeImage 自动获取密钥可能需要它自己的账号会话，本集成不会读取外部浏览器 Cookie；可在脚本设置填写自己的 NodeImage API Key。GM_notification 在内嵌页面显示消息，未伪装为已获得系统通知授权。`unsafeWindow` 为快照兼容，瀑布流中新追加评论的原站全局对象同步并非完整 Tampermonkey 实现；相关官网功能以实际兼容测试为准。

## 验证

`npm exec tsx -- --test tests/userscripts.test.ts`：原版脚本、固定 Layui、DOM 菜单和高级设置实际执行；自动签到初始关闭；替换模板保留 `$&`、`$\``、`$'` 与占位符字面量；跨域端点及 Cookie 转发被拒绝。

`npm exec tsc -- -p tsconfig.electron.json` 后运行 `node tests/userscript-electron-run.cjs`：真实 Electron + WebContentsView + 隔离 GM preload，使用本机 mock HTTPS 响应而非真实论坛写请求。确认原版菜单注册、设置面板可见、主世界无 Node/应用/GM 桥、自动签到关闭，没有 POST 请求。结果位于 `verification/nodeseek-pro-electron.json` 和 `verification/nodeseek-pro-settings.png`。

本轮未执行打包，也未向论坛发送测试签到、帖子、回复、私信、关注或点赞。

桌面窄阅读区还注入一条布局兼容样式，将原版固定 620px 的高级设置抽屉限制在官方视图宽度内，并固定靠右。已在 512px 原生视图内检查抽屉坐标，不修改 vendor 原脚本。
