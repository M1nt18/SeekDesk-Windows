# 原版核心流程核对（2026-11-12）

本次按 Swift 实现追踪 Windows 的界面入口、IPC、请求与最终状态，范围是帖子阅读、互动、屏蔽、多标签、官方会话、Windows 生命周期与更新。个人主页、通知面板、编辑器和扩展设置由并行审计覆盖。这里的“已接线”只表示实现链路完整，不表示已使用真实账号执行发布、收费互动或私信。

原版没有独立的帖子收藏或浏览历史中心：`Workspace.swift` 的 history 是搜索历史，`ForumSession.swift` 的 threadMemory 是短期阅读缓存，不能把它们写成已支持收藏。

## 已发现并在本轮补修的差异

下表保留审计时的问题与来源证据。CORE-01 至 CORE-07 已在本轮源码中补修；摘要增加账号 epoch/request 守卫。正文、资料与分页的隔离 Electron 验证结果见文末。在线账户写入仍保留人工验证边界。

| 编号 | 差异与影响 | 原版证据 | Windows 证据与修复方向 |
| --- | --- | --- | --- |
| CORE-01 | 合法 HTTP 超链接被去掉地址，正文与签名只剩文字。 | `ForumThread.swift:178`：图片仅 HTTPS，普通链接允许 HTTP/HTTPS；`MarkdownPreview.swift:145` 同样允许 HTTP/HTTPS。 | `electron/forum.ts` 的 `contentUrl`、线程脚本 `safe` 及 `sanitizeContent.allowedSchemes` 一律仅 HTTPS。应拆分链接/媒体校验，保留无凭据 HTTP/HTTPS 链接，图片仍仅 HTTPS。 |
| CORE-02 | 鸡腿或点踩成功后，右上角余额没有立即同步；关闭轮询时可持续显示旧值。 | `ForumSession.swift` 的 `react` 使用返回的 coin 更新 ownProfile，并安排刷新。 | `src/App.tsx` 的 `reactToComment` 仅刷新帖子，忽略 `ForumActionResult.coin`。应在相同账号范围内同步余额并刷新摘要。 |
| CORE-03 | 管理记录扩展停用后，作者菜单的查询入口仍能使用。 | `ThreadReader.swift:357` 要求 `extensions.active(.rulings)`。 | `src/App.tsx` 的作者菜单只检查 `installed.includes('rulings')`，需同时检查 enabled。 |
| CORE-04 | 屏蔽内容临时展开后无法再次收起。 | `ThreadReader.swift` 的 `BlockedFloor` 显示“展开/收起”和“解除屏蔽”。 | `src/App.tsx` 只有“临时展开”，没有移除 `expandedBlocked` 对应键的按钮。 |
| CORE-05 | 只读/锁定帖子仍可点击楼层引用和回复，再进入不可回复提示。 | `ThreadReader.swift:331` 仅在 `replyRestriction == nil` 时显示楼层回复与引用。 | `src/App.tsx` 的 `canInteract` 没有检查 replyRestriction。应只对回复/引用加限制，不误禁允许的其他互动。 |
| CORE-06 | 个人签名仅使用 DOM 字段，没有原版的资料回退。官方 DOM 没渲染签名时，有公开签名也不显示。 | `ThreadReader.swift:310-316`：本人资料/楼层签名/用户资料 signature_markdown/bio 依次回退。 | `electron/forum.ts` 仅抽取直系 `.signature/.user-signature`；`src/App.tsx` 仅使用 comment.signatureHtml/signature。渐进资料应可提供经限长、安全渲染的公开签名回退；不可伪造不存在的签名。 |
| CORE-07 | 原站仅提供“昨天/2小时前”等时间文字时，界面会把非空日期变成空白。 | `ThreadReader.swift:298-300` 直接保留 `item.date` 或 `item.dateLabel`。 | `src/App.tsx` 的 `dateLabel` 对无法解析的非空字符串返回空。应保留原站时间文本，并提供完整时间提示。 |

## 额外的状态防护与平台差异

- `App.refreshSummary` 已增加账号 epoch/request 守卫，防止账号变化后较早的摘要回调覆盖已清空的 UI。主进程 `queryForum/onWebsite` 已有 generation 防护，因此这是界面层的补充防护，不能宣称已重现跨账号泄露。
- 已让恢复的标签先只保留安全位置，重新读取后再显示实际标题和作者。标签数据只保存在本机，没有据此推断发布包包含用户数据。
- 原版按规范化 page URL 保存少量页缓存和阅读锚点（`ForumSession.threadMemory/readingAnchors`），Windows 按帖子 ID 保存当前页与像素滚动位置。后者能恢复当前阅读，但不等于保留每一页各自的阅读锚点。
- 已为完成的点赞、鸡腿和点踩禁用对应按钮；后端真实状态复核继续保留。
- 已恢复缺少 UID 的作者菜单及用户名屏蔽/解除，只有依赖有效 UID 的资料、关注和私信操作不可用。

## 已追踪到真实实现的流程

| 流程 | 入口与数据链路 | 核对结果 |
| --- | --- | --- |
| 官方完整正文与 RSS 降级 | App.loadThread → preload.readThread → main.readThread → onWebsite/extractThreadScript；降级明确标识 RSS 摘要 | 已接线，RSS 不是完整回复页，后续分页不伪造 RSS 内容。资料读取与分页的本轮新增接线由主任务单独验证。 |
| 帖子安全渲染 | forum.sanitizeContent → ReaderContent DOMPurify → React 内容组件 | 已接线；脚本、iframe、表单被去除；HTTP 链接差异见 CORE-01。 |
| 正文链接与楼层定位 | ReaderContent.onNavigate → postFromUrl/openPost(explicit) → loadThread → hash定位 effect | 已接线；官方页面、外部网页与原生帖子分流，官方同帖楼层能回到对应分页。 |
| 代码/ANSI/测评报告 | captureTerminalsScript → forum 抽取 → ReaderContent.CodePanel/Tabs/ScaleControls | 已接线，含复制、终端颜色、NQ/TQ 独立比例、报告标签及放大窗口。 |
| 帖子图片 | LazyReaderImage → loadReaderImage → media.readerImage；ImageGallery 支持缩放/旋转/实际尺寸/复制/保存 | 已接线，使用解码预算；不能据此宣称所有复杂长图已线上验证。 |
| 引用与回复分离 | insertFloorReference(comment,true/false) → 草稿 → 展开编辑器与聚焦 | 已接线，引用包含截取正文，回复仅插入作者/楼层链接；锁帖差异见 CORE-05。 |
| 回复发布 | sendReply → prepareImages → forumAction → interactions `/api/content/new-comment` → destination page/floor → GET刷新 | 已接线，POST不自动重发；接受后只有GET重试；新楼层未同步时给出明确提示。 |
| 点赞/鸡腿/点踩 | reactToComment → forumAction → interactions → 官方 statistics 接口 → 本页刷新 | 已接线，收费或免费额度确认分别核验，真实评论ID由站点配置解析；余额显示差异见 CORE-02。 |
| HOT/置顶 | forum读取pined/热榜标记/鸡腿 → 去重并保留actionUrl → prioritizeComments → HOT标签 | 已接线，楼主优先、鸡腿回复优先，保留站点顺序与跨页操作位置。 |
| 编辑本人楼层 | 作者操作/楼层“编辑” → TopicComposerPanel → edit-source查询 → parity写入 | 已接线，主进程验证owner与实际帖子归属；个人编辑器和完整写作控件由其他审计负责。 |
| 关注与私信 | followUser/showMessages → forumAction/queryForum → 官方 fans/message 接口 | 已接线；原页面following初始状态由本轮渐进资料补充；真实写入待用户账号验证。 |
| 本地屏蔽 | toggleBlock → saveExtensions + setBlockedUsers → isBlocked → 折叠楼层 | 已接线，UID优先、规范化名称回退；启停有效；再次收起缺失见 CORE-04。它是本地过滤，原版也未实现论坛服务端黑名单。 |
| 只看楼主 | toolbar/扩展状态 → onlyAuthor → rootAuthorId/isAuthor筛选 | 已接线，安装与启用同时控制；新发布楼层定位可例外保留。 |
| 多标签 | openPost/后台打开/拖动/closeTab/closeAll → saveWorkspace → Store校验与持久化 | 已接线，关闭使进行中的读取失效；Ctrl+Tab、Ctrl+W、滚动恢复与30标签上限有实际代码。 |
| 官方网页登录留在主窗口 | openOfficial → WebContentsView；secureRemote弹窗同视图loadURL；inspectOfficial后closeOfficial | 已接线，使用persist:nodeseek共享会话，没有将登录结果转到独立客户端窗口。账号操作由用户完成。 |
| 换号与清会话 | setAccount generation → 读取与写入校验；clearSession销毁视图、清Storage/Cache/连接；UI账号事件清缓存/草稿/私有标签 | 已接线；摘要界面层额外守卫见上文。 |
| 关闭确认与托盘 | app:window close → DesktopWindowController.closing → askClose/hideToTray/quit | 已接线，可取消、记忆选择、托盘恢复、明确退出。 |
| 窗口尺寸和位置恢复 | DesktopWindowController move/resize/maximize → flush → desktop-window.json → fitWindowBounds | 已接线，含多显示器/越界拟合/最小化保护；退出先flush。 |
| 安装桌面与开始菜单图标 | build/installer.nsh → 自定义选择页 → CreateShortCut | 已接线，默认勾选，更新保存已存在快捷方式选择；没有本轮对用户系统真实安装/卸载。 |
| 在线更新和旧包清理 | DesktopSettings → IPC → AppUpdateController → 固定用户仓库feed → 下载SHA512 → quitAndInstall → cleanup | 已接线，安装版支持自动安装，便携版明确手动；失败/取消清临时文件、新版本启动清旧包、保留正在运行安装器和待安装新包。 |

## 仍需真实账号或独立安装环境验证

没有在此只读审计中向论坛发布、编辑、发私信、关注、签到、送鸡腿或点踩。需要登录后人工确认：受限帖子实际权限、账号字段在当前官方接口的可用性、付费额度与余额同步、服务端接受后的实时刷新、真实通知/私信读取与已读状态、官方登录挑战与续期。安装器及跨版本升级应在隔离安装环境验证，不能在用户真实安装和登录会话上冒险重装。

## 本轮完成后的隔离回归

以下命令在最终源码构建后通过，使用独立 `SEEKDESK_TEST` 数据目录，没有操作用户的真实安装或登录会话：

- `node scripts/profile-pagination-smoke.cjs`：真实主进程、preload 和 React 界面，本地 HTTPS protocol 夹具阻止所有论坛写入。14 位作者先显示正文，资料最多 3 路并发；第 9 位以后的作者、合法 Lv 0、1.8 秒慢响应、失败重试均覆盖。资料到达前后滚动位置为 420 → 420。上下两处四页数字按钮从第 3 页直回第 1 页并清除旧楼层 hash；旧页资料不会恢复旧页面，换号后旧的同 UID 等级先被清除，新账号的 14 位等级才重新填入。无界面异常，零 POST。报告在 `verification/profile-pagination/report.json`。
- `npm run test:app`：后端契约、完整 React 界面、正文/图片/终端报告以及嵌入登录流程四个脚本通过。个人主题列表明确校验两条完整发帖日期/时间和一条“时间未知”，新默认概况、上下分页及非模态关键词提醒按最终交互核对。
- `npm run test:reply-refresh`：仅一次模拟回复 POST，随后读取真实目标第 3 页并仅重试 GET；新楼层在只看楼主模式下仍可定位，手动刷新使用新文档且不重复发布。
- `npm run test:desktop`：关闭确认、托盘、位置/尺寸/最大化恢复、退出时保存、设置刷新、更新状态界面以及 HOT/跨页回复/草稿关闭三组脚本通过。

原版代码存在不代表每项能力都能在当前论坛服务上使用，线上权限和第三方服务行为必须单独记载。单元、类型、构建与公开只读实测的最终汇总由主任务统一记录。
