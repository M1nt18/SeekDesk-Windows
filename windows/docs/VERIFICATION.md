# Windows 0.1.0 实测记录

> 历史安装包记录。当前源码的完整移植与实测请看 [VERIFICATION-CURRENT.md](VERIFICATION-CURRENT.md)，本文件中的旧功能范围、测试数量与打包命令不适用于本轮“不打包”的源码验收。

本文件保留首次安装包的历史验收。当前源码已按用户第 1–10 项继续修订，但未重新打包；最新范围与结果见 `PORT-AUDIT.md`、`TEST-FIXES.md`、`NODESEEK-PRO.md` 和 `verification/revision-smoke.json`。最新单测为 28 项，写操作全部使用隔离 mock；不可把当前源码功能套用到旧 release 安装包。

测试日期：2026-11-11（北京时间）。环境：Windows 10 x64 10.0.19045、Node.js 24.16、Electron 45.3.0、React 19、TypeScript 5.9。当前已生成 x64 NSIS 安装包；未使用代码签名证书。

## 已通过

- `npm test`：11 项，包括 RSS/DOM 提取、XML 实体与 XSS 拒绝、参数白名单、设置/标签持久化和关闭恢复后的状态清除。
- `npm run build`、`npm run dist`：类型检查、React 生产构建、Electron 编译、NSIS 安装包生成。
- 真实官网首页：2 组列表分别为置顶 1 帖和普通列表 102 帖，合并读取 103 帖并识别下一页；证据 `verification/public-list-dom-check.json`。
- 真实公开正文：帖子 1045557，经应用返回 `source: web`、1 楼、净化后 399 字符；官网 DOM 选择器命中，未遇到验证页。证据 `verification/public-thread-dom-check.json`。
- 真实公开 RSS：HTTP 200、20 帖；元数据与可用摘要解析成功。RSS 内容随站点实时变化。证据 `verification/public-rss-check.json`。
- **安装后实测**：将实际 NSIS 安装包安装到隔离目录，再运行已安装 exe；读取官网 103 帖、独立 RSS 20 帖、真实摘要、多标签与后台打开、空筛选、设置保存、两种尺寸布局、键盘焦点、两套主题文字对比度、非法 IPC 参数拒绝、官方窗口隔离、网络失败重试、重启恢复及清会话全部通过。完整结果 `verification/installed-smoke.json` 和 `verification/installation.json`。
- 持久会话链路：在 `seekdesk.invalid` 测试域名写入无凭证 Cookie，退出重启后存在，执行清除会话后官方分区 Cookie 数为 0。测试未访问你的浏览器、账号密码或已有会话。
- 官方窗口安全：实际打开 `https://www.nodeseek.com/signIn.html`，页面在本轮出现 Cloudflare 安全验证。Node.js 关闭、sandbox/contextIsolation 开启，`window.seekdesk`、`window.require` 都不存在。
- 开发模式：修复跨盘目录联接路径问题；Vite + Electron 渲染、IPC、设置交互、React Refresh CSP 和真实文件热更新通过。证据 `verification/dev-smoke.json`。
- 生产依赖 `npm audit --omit=dev` 无已知漏洞。构建工具链的 minimatch 依赖链仍有 6 条 moderate 审计记录，未对工具链强制降级。

截图和设计状态记录见 `verification/design-evidence.json`。宽窗口 1440×920；窄窗口 980×720，文档无横向或纵向溢出，内容在各自面板滚动。

## 留给用户操作的部分

真实账号登录、人工完成 Cloudflare 验证、登录后受限内容、真实账号跨次启动的权限仍需你在官方窗口完成。测试 Cookie 只验证 Chromium 持久存储链路，不代表真实登录已成功。公开页有时可直接读取，有时要求验证；应用提供明确的 RSS 回退。

发帖、回复、私信、点赞、签到等账号操作使用官方网页，本版未重写这些界面。未向论坛提交任何测试帖子、评论或私信。未移植 macOS 扩展中心、上传、通知或自动更新。

## 复现

在 windows 目录：`npm ci`、`npm test`、`npm run build`、`npm run test:app`。

完整安装验证：先 `npm run dist`，再 `node scripts/install-smoke.cjs`；脚本使用本工程 `.test-data/installed-app` 安装目录和独立测试配置。官方网页测试：`npx tsx tests/live-dom.ts`、`npx tsx tests/live-thread.ts`；开发测试：`node scripts/dev-smoke.cjs`。

生成对应源码包与 SHA-256：`python scripts/release-source.py`。源码包含父目录上游、Windows 源码、依赖锁、GPL 许可、第三方声明和验收证据；排除依赖安装目录、二进制构建产物及所有浏览器测试配置。
