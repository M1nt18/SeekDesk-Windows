# SeekDesk Windows 功能对照与验证边界

对照来源是仓库根目录 `README.md` 的“日常逛坛”“扩展中心”“实现原理”及对应 Swift 源码。Windows 代码在 `windows/` 内，原 Swift 源码保留。本文件用于逐项检查实现和证据；“已接线”不代表已经使用真实账号完成线上写操作。

## 浏览、写作和账号

| 原版能力 | Windows 实现位置 | 验证依据及尚需人工验证的部分 |
| --- | --- | --- |
| 最新帖子、最新回复、版块、精品区、分页和刷新 | `src/App.tsx`、`electron/forum.ts` | `tests/forum.test.ts`；公开 RSS 已实际读取 20 条。完整网页列表仍受官方验证页和登录状态影响。 |
| 多标签、后台打开、拖动排序、关闭当前/全部、总览关闭 | `src/App.tsx`、`electron/store.ts` | UI 入口已接线；工作区持久化见 `tests/store.test.ts`。 |
| 多栏、收起列表、自适应布局、调整两栏宽度 | `src/App.tsx`、`src/styles.css` | 外观边界及重启持久化见 `tests/parity-store.test.ts`；窗口布局需结合实际截图检查。 |
| 官方登录和共享会话 | `electron/main.ts` 的 `WebContentsView` 与 `persist:nodeseek` 分区 | 官方页嵌入主窗口，官方弹窗被导向原视图。真实账号登录和验证由用户操作。 |
| 等级、角色、签名、头像、楼层、分页、引用与定位 | `electron/forum.ts`、`src/App.tsx` | DOM 解析和互动契约见 `tests/forum.test.ts`、`tests/interactions.test.ts`；真实账号的受限帖需登录后检查。 |
| 帖子搜索、用户搜索、多版块、搜索历史、直接打开链接 | `src/parity-panels.tsx`、`electron/parity-forum.ts` | `tests/parity-forum.test.ts`；历史搜索和用户搜索的线上权限需登录后检查。 |
| 全半角/大小写/重音统一及轻度拼写容错 | `src/search.ts` | `tests/search.test.ts`，照上游 `ForumFeed.swift` 的 `ForumSearch` 规则；中文和短词保持精确子串匹配。 |
| 发帖、回复、私信的 Markdown 工具、编辑/对照/预览、高度拖动 | `src/MarkdownComposer.tsx`、`src/markdown.ts`、`src/parity-panels.tsx` | UI 与同源提交 API 已接线；未经用户账号执行真实发布或私信。 |
| 发帖版块、阅读限制、编辑自己的主题与回复 | `electron/parity-forum.ts`、`src/parity-panels.tsx` | `tests/parity-forum.test.ts` 使用模拟网页和请求验证，未向真实论坛发布或编辑内容。 |
| 回复、点赞、鸡腿、点踩、关注 | `electron/interactions.ts`、`src/App.tsx` | `tests/interactions.test.ts`；鸡腿额度/收费确认由官方结果控制，真实写操作待用户验证。 |
| 本地图片、剪贴板图片、官方/分组自定义表情 | `src/MarkdownComposer.tsx`、`src/ComposerMediaPanel.tsx`、`electron/media.ts` | 官方表情契约见 `tests/parity-forum.test.ts`；NodeImage 需要用户配置密钥，未调用真实上传。 |
| 发送前按预览尺寸缩图、替换正确的图片地址 | `electron/media.ts`、`electron/image-links.ts` | `tests/image-links.test.ts` 覆盖转义/嵌套括号、标题、angle URL、HTML src、引用图片和代码排除；实际上传待用户密钥验证。 |
| 每账号的回复、私信、新帖、编辑草稿及图片宽度 | `electron/parity-store.ts`、`electron/main.ts`、各编辑界面 | `tests/parity-store.test.ts` 覆盖账号隔离、重启、并发保存、实际编辑 URL 键和原型属性隔离。 |
| 个人主题/评论/粉丝/关注、README、签名 | `electron/parity-forum.ts`、`src/parity-panels.tsx` | 模拟契约见 `tests/parity-forum.test.ts`；本人粉丝/关注权限遵循站点，资料真实写入待用户验证。 |
| @我、回复、私信、未读聚合、UID/个人链接会话 | `electron/parity-forum.ts`、`src/parity-panels.tsx` | 模拟通知、私信及标记已读契约见 `tests/parity-forum.test.ts`；真实私信读取与标记待登录验证。 |

## 阅读和外观

| 原版能力 | Windows 实现位置 | 验证依据及边界 |
| --- | --- | --- |
| 白天、黑夜、跟随系统、六色品牌与图标 | `src/components/PreferencesPanel.tsx`、`electron/main.ts`、`electron/parity-store.ts` | UI 设置和窗口图标已接线；Windows 使用 CSS 材质，macOS 的 Liquid Glass API 不在 Windows 上运行。 |
| 列表/正文/作者/版块/热榜独立大小与预览 | `src/components/PreferencesPanel.tsx`、`src/styles.css` | `tests/parity-store.test.ts` 覆盖全部滑块上下限和百分比值持久化。 |
| 进入设置/扩展/个人页后返回原帖与阅读位置 | `src/App.tsx`、`electron/store.ts` | 保留标签、当前分页和滚动位置；实际回归覆盖返回设置及重新加载后恢复第 2 页和 180px 滚动位置；切换确认账号时清空阅读缓存。 |
| ANSI 基础色、256 色、RGB、加粗和完整文本复制 | `src/ansi.ts`、`src/ReaderContent.tsx`、`electron/forum.ts` | 读取前保留网页终端原文；复杂真实测评帖还需逐帖抽查。 |
| 报告分页、NQ/TQ 各自缩放、长图按像素预算解码 | `src/ReaderContent.tsx`、`electron/media.ts` | 缩放分别保存；超限图片可打开原图，不能将一次成功解码视为所有长图已验证。 |
| 关于、版本、许可、致谢 | `src/components/PreferencesPanel.tsx`、`electron/main.ts` | 按用户最新要求先移除“GitHub 项目”和“检查更新”按钮，更新查询地址也停用，待配置用户自己的仓库。 |
| Windows 快捷键 | `src/App.tsx`、`src/MarkdownComposer.tsx` | Command 对应 Ctrl；搜索、刷新、列表上下键、回车/后台打开、关闭标签、切换标签、设置、Esc、发送方式均有入口。 |

## 八种内置扩展

默认只安装并启用热榜。安装/启用/停用/移除通过 `ExtensionsService` 实际控制轮询、自动签到、老板键和阅读筛选；不是只显示状态文案。

| 扩展 | 实现与行为 | 已有验证 |
| --- | --- | --- |
| NodeSeek 热榜 | `electron/extensions.ts`；实时/日/周独立快照、请求去重、周期缓存、失败保留旧数据、屏蔽过滤 | 离线测试；实际公开读取 30/50/100 条。 |
| 每日签到 | 固定/随机、账号与北京时间日期归属、并发互斥、零点与失败重试、关闭自动任务前复核 | 离线模拟，包含换号、手动模式、取消自动任务和零点调度；没有真实签到 POST。 |
| 摸鱼老板键 | `electron/main.ts` 注册 Ctrl+Shift+自定义字母/数字；`src/App.tsx` 工作表外观 | 实际全局快捷键还需在用户当前键位环境中验证。 |
| 剩余价值 | 按用户最新要求改为 `electron/main.ts` 内嵌 `https://sy.3xme.com/`，使用独立 `persist:calculator` 分区；论坛和计算器视图相互切换 | `scripts/feedback-smoke.cjs` 已实际计算 ¥120.00、检查 MD 输出和重新加载后的输入恢复；旧本地引擎仅保留于源码与单元回归，不再作为计算器界面。 |
| 屏蔽用户 | 本地 UID 优先、无 UID 时规范化名称匹配、楼层折叠/临时展开/解除 | `tests/extensions.test.ts` 验证启停、UID 优先与名称回退；UI 可操作。 |
| 只看楼主 | 按帖子根作者筛选，受安装与启用状态控制 | `src/App.tsx` 已接线；跨分页的真实帖子需登录后抽查。 |
| 关键词监控 | RSS 条件请求、约 10 秒轮询、规则 AND/OR、退避/Retry-After、持久去重、提醒与未读 | `tests/extensions.test.ts`；真实 RSS 读取成功；系统通知是否展示取决于 Windows 通知状态。 |
| 管理记录 | 按用户名查询 NS Seek，UID 可先解析用户名；作者旁入口、来源帖、北京时间转换、全局限流 | 离线测试；实际查询 `cshaizhihao` 得到 16 条公开记录。 |

## 额外请求与剩余验证

NodeSeek Pro 是用户额外指定的脚本集成，入口在 `electron/userscripts.ts` 和官方网页视图。它作用于官方网页 DOM；React 重建的列表/阅读区不伪装成该网页 DOM。脚本本地存储和兼容桥有 `tests/userscripts.test.ts` 与 Electron 脚本验证入口。

账号相关的在线写操作、NodeImage 上传、真实受限帖、用户通知/私信、Windows 通知权限及全局快捷键，需要用户在保留的官方页面完成登录后验证。本轮没有用模拟响应冒充这些线上操作已经成功。

当前综合结果见 [VERIFICATION-CURRENT.md](VERIFICATION-CURRENT.md)。可重复运行的检查入口：

```bat
npm test
npm run typecheck
npm run test:app
npm run test:public
npx tsx tests/extensions-live.ts
```

`extensions-live.ts` 仅访问公开 RSS、热榜、汇率和裁决服务。构建与打包是分离命令；本次按用户要求不运行 `npm run pack` 或 `npm run dist`。
