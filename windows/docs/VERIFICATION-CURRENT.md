# 当前源码完整移植验收

日期：2026-11-11。参考上游 `84e99c6cb24e66c5bbccb6382380ae72b9924d4b` 的 README、Swift 源码与用户提供的四张原版截图，并继续按用户最新 10 项测试反馈修改。完整功能位置见 [FEATURE-PARITY.md](FEATURE-PARITY.md)。本轮只修改源码、编译、运行和测试，未打包。

## 已执行并通过

| 检查 | 结果与证据 |
| --- | --- |
| TypeScript + Vite + Electron 编译 | `npm run build` 通过，当前 `dist/` 和 `dist-electron/` 对应最新源码。 |
| 单元与契约回归 | `npm test`：80 项通过，0 失败。覆盖账号边界、官方写协议、失败不重发、草稿、搜索、Markdown/ANSI、图片地址、扩展与日历估价；新增回复目标 URL/楼层、分页大小与非法跳转处理。 |
| Electron 主进程和预加载桥 | `verification/parity-backend-smoke.json`：10 组通过。真实主进程和沙箱 preload，模拟全部读写协议、两账号草稿、DPAPI 密钥隔离、上传/缩图与图片预算。 |
| 原版界面与点击流程 | `verification/parity-ui/report.json`：24 组通过，0 渲染异常。含发帖/编辑/回复、用户空间、通知/私信、8 扩展、实际作者过滤、用户计算器、管理记录、老板键、关键词弹窗、全局最小字体、搜索、标签拖动、两种窗口宽度和分页/滚动重启恢复；新增默认收起/展开回复入口，以及主题不显示空“· #0”、主题和评论有背景、评论仍保留真实楼层。 |
| 阅读器和编辑器 | `verification/parity-reader-smoke.json`：8 组通过。隐藏终端完整 300 行、ANSI 颜色/加粗、报告标签、NQ 125% 与 TQ 150% 独立保存、完整复制、长图预算、图库、保存/复制图片、编辑器选区/撤销/重做/表情/图片、换号草稿隔离。 |
| 登录窗口与回跳 | `verification/embedded-login-smoke.json`：8 组通过。真实官方页嵌入单一主窗口，模拟登录弹窗留在原视图，成功后返回原版块；旧读取失效、调整窗口与原生层隐藏、Ctrl+W、快捷网页中的帖子打开原生标签。 |
| NodeSeek Pro | `verification/nodeseek-pro-electron.json`：真实 Electron 隔离世界、原版菜单和高级设置、本机存储及默认不自动签到通过；主世界没有 Node/应用/GM 桥。 |
| 实际公开读取 | `verification/parity-public-report.json`：RSS 20 条、实时榜 30 条、公开管理记录 16 条、在线汇率读取成功，并实际展示 RSS 摘要和 8 扩展界面。另 `tests/extensions-live.ts` 已读取日榜 50 条、周榜 100 条。 |
| 最新界面反馈 | `verification/feedback/report.json`：10 组通过，0 异常。菜单空白/Esc 关闭且保留正文折叠块，彩色标签/版块/账号底色、热榜粗体/图标/箭头/时间/条数及四项配置落盘、仅 Impart 和源码链接。签名按最新反馈去掉标题与背景，仅用上方虚线分隔，链接绿色、普通文字灰色；正文链接仍蓝色。引用与回复分为独立按钮，前者带原文、后者仅带作者和楼层链接；追加草稿后能从预览切回编辑并聚焦末尾；移除左下总层数。真实 sy.3xme.com 计算 ¥120.00、生成 MD、恢复输入，与官方视图切换保持单主窗口；计算器无 Node 或应用桥。 |
| 回复刷新修复 | `verification/reply-refresh-smoke.json`：4 组通过。从第 1 页发出的回复按服务端返回定位第 3 页 #25；首次 GET 未同步时再次读取，始终只发 1 次 POST；“只看楼主”下临时显示自己的新楼层；确认 CDP 禁缓存命令已执行，变更 hash 和手动刷新实际重新读取文档。测试使用带强缓存头的隔离协议响应，不宣称已验证真实站点 CDN 的延迟。 |

关于页的“GitHub 项目”和“检查更新”已按用户要求暂时移除；等待用户自己的仓库地址，不再向上游查询更新。

界面截图在 `verification/parity-ui/`；公开读取界面在 `verification/parity-public-reading.png`。已查看并对照阅读、写作、扩展、设置四页截图。Windows 的窗口按钮、字体和材质使用对应 Windows 实现。

## 明确的实测边界

所有真实论坛写操作均未执行。发帖、编辑、回复、私信、关注、互动、标记已读、签到，以及 NodeImage 上传在测试中被模拟响应拦截。它们已经接入实际官方协议，但真实账号等级、站点验证、额度、权限和用户自己的图床密钥，需在保留的官方登录窗口中完成登录后验收。

RSS 是最近公开内容和摘要，不是完整正文/回复/历史搜索的替代。Windows 通知能否显示与系统状态有关；自动任务要求客户端运行。

本轮综合检查仍确认旧安装包 SHA-256 为 `014fbe631f8985f3ede86ce47089136ca3b1debb1231aa1e6fb913ca582acdcc`，与修改前一致。`release/` 的旧安装包不包含本轮源码变化。

测试当前编译版：退出旧程序后，双击 `windows/启动调试版.cmd`。命令复现：`npm run build`、`npm test`、`npm run test:app`、`npm run test:public`、`node tests/userscript-electron-run.cjs`。
