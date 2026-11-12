# SeekDesk Windows 历史差距审计

> 本文整体保留的是完整移植前的历史基线，包含当时的缺失项、布局要求和计划，不能用于判断当前源码状态。后续用户已要求按原版完整复刻，并覆盖早期居中品牌等布局要求。当前实现请看 [FEATURE-PARITY.md](FEATURE-PARITY.md)，最终测试请看 [VERIFICATION-CURRENT.md](VERIFICATION-CURRENT.md)。`release/` 未重新打包。

审计日期：2026-11-11。上游参考提交：`84e99c6cb24e66c5bbccb6382380ae72b9924d4b`。范围为父目录 `Sources/SeekDesk`、`Tests`、README，与 Windows 的 `src`、`electron`、`shared`、构建配置及验收记录逐项对照。本报告未登录用户账号，未向论坛提交任何测试帖子、回复、私信或互动。

模块对照表保留“内嵌官方登录修正已完成、用户第 2–10 项开始修改”的审计基线，文件行号对应该基线，同时给出函数和组件名便于定位。本轮新增内容与验收结果在下一节单列；基线的“未移植”不能自动当作当前状态，新增的入口也不等于整个模块已移植。

## 本轮修改及验收结果

| 用户项 | 本轮结果 | 验证范围 |
| --- | --- | --- |
| 2 列表密度 | 分类标记在标题前同行，时间与作者同一行；压缩上下间距，保留长标题两行。 | 1440×920 默认字号 fixture 一屏完整显示 9 条，实际 bbox 检查标记与标题同行。 |
| 3/4 所有文字 | 默认菜单 15px、标题 16px、正文 18px；全局 14–24、正文 14–40；辅助文字不低于 12px，不再用窄屏缩小字体。 | 对所有可见直接文本检查最小字号；最大字号覆盖菜单、列表、标签、设置和正文，980×720 可滚动、可收起列表。 |
| 5 头像 | 账号与楼层读取真实 UID/头像；直链失败可通过受限官方会话图片 API 回退，无效图才显示字母。 | Electron fixture 实际 `<img>` 加载，API 固定官方头像路径、图片 MIME 和大小上限；不读取用户已有 Cookie。 |
| 6 阅读总览 | 可关闭、重新打开，并保存关闭状态；关闭后不保留不可关闭的标签。 | 点击关闭、重载后仍关闭、重新打开及标签恢复通过。 |
| 7 回复与用户操作 | 新增 React 回复/引用、点赞、鸡腿/点踩确认、关注/取关、私信发送、本机屏蔽和真实等级/称号/签名。 | 官方接口由上游与公开站点 JS 确认；写入全部 mock。失败保留文本、用户明确重试才重发，免费额度变化重新确认。站内权限仍由用户真实账号实测。 |
| 8 品牌和色块 | 顶部只保留居中 SeekDesk；侧栏去掉重复品牌/标语；统一背景、分隔和选中状态。 | 新尺寸/字号截图验收。 |
| 9 NodeSeek Pro | 集成 Woodll 原版 1.0.8（GreasyFork 567109）及固定本地依赖；仅在客户端内官方网页运行，默认关闭。 | 原版菜单、高级设置、隔离 GM 存储运行通过；主世界无 Node/应用/GM 桥，默认自动签到关闭。详见 `NODESEEK-PRO.md`。 |
| 10 全面审计 | 下方逐模块保留完整原版/Windows 差距与证据、优先级和限制。 | 本轮仅源码编译与测试，已有安装程序 SHA-256 不变。 |

“关注”是官网的实际关系操作；原版脚本的“好友”是脚本关系标记，不能把它们混称。React 提供的屏蔽明确为**本机折叠**，不会修改官网账号黑名单。NodeSeek Pro 的关系管理在官方网页内运行，不属于 React 原生用户中心。

当前仍未补齐：原生新主题/编辑、完整 Markdown 预览与图片/表情上传、按账号的磁盘草稿、通知收件箱与完整私信会话、个人空间编辑、服务器搜索、ANSI/NQ/TQ 专用报告、图片放大及原版扩展中心。回复草稿当前只在进程内按账号边界清理，重启不会恢复。不能称为完整功能移植。

本轮新增验证见 `verification/revision-smoke.json`、`verification/nodeseek-pro-electron.json`、forum/interactions/store/userscripts 测试；账号写入没有发往真实论坛。

## 结论

Windows 当前是能够启动、安装和阅读真实公开内容的早期重写版，不是上游完整移植版。已经形成了隔离会话、官网提取、RSS 回退、三栏、多标签和基础设置的可用路径；写作、账号资料、通知、扩展、复杂报告渲染等仍存在成组缺失。

原版有原生回复编辑器和发送状态、楼层互动、个人空间、通知与私信、按账号草稿、图片上传及表情、八项内置扩展。把相应网页放进官方视图只能记为**官方入口**，不能记为对应 React 功能已经实现。也不应把公开 RSS 摘要记作完整主题和回复。

## 本轮用户问题与源码根因（审计开始时）

| 编号 | 基线根因和证据 | 级别 | 当时的修复计划；最终验收见上文 |
| --- | --- | --- | --- |
| 2 列表可见帖子过少 | `src/App.tsx:300` 的 `post-row-top` 把版块、阅读限制和时间放在独立行，下面再排标题和作者，单帖至少三层；CSS 另有较大的上下留白。 | P1 可用性 | 修复中：版块置于标题前，时间归入元数据，减少重复行和留白。 |
| 3/4 字体过小且不能全局调节 | `electron/store.ts:6–10` 只有正文字号 13–24；`src/App.tsx` 只设置 `--reader-font-size`。`src/styles.css` 含大量固定 7/8/9/10px，窄屏媒体查询还继续缩字，列表、菜单、标签和说明不随正文设置改变。 | P1 可用性 | 修复中：全局界面字号与正文字号分开，清理微小字号、固定高度和窄屏缩字。需要实际渲染验收。 |
| 5 左下角头像不显示 | `src/App.tsx:289` 账户栏调用 `<Avatar name={account.name || ''} />`，从未传入 `src`；已知 UID 没有用于构造官方 `/avatar/{id}.png`。 | P1 可用性 | 修复中：读取或构建真实头像 URL，保留加载失败回退。 |
| 6 阅读总览不可关闭 | `src/App.tsx:305` 的总览按钮常驻且没有关闭控制；保存的工作区也没有总览开关状态。 | P1 可用性 | 修复中：可关闭、可重新打开、恢复偏好。 |
| 7 回复、用户操作、等级缺失 | `shared/types.ts` 基线只定义读取 API；`src/App.tsx:312–318` 只绘制楼层，无回复编辑器或写入操作。`electron/forum.ts:188–200` 未保留 UID、等级、角色、签名、互动状态。 | P1 功能 | 修复中：补元数据和有确认/结果反馈的原生交互；具体支持以本轮接口与测试为准，不以官方入口替代。 |
| 8 品牌重复和杂字占位 | `src/App.tsx:283` 标题栏同时显示图标、SeekDesk、Windows、标语，侧栏又有品牌、介绍和英文眉题。 | P2 界面 | 修复中：按用户要求仅保留正上方 SeekDesk，清理重复说明。 |
| 9 油猴脚本 | 基线没有用户脚本运行时。用户后续确认 NodeSeek Pro，原版定位为 Woodll / GreasyFork 567109。 | P2 扩展 | 本轮已补官方视图的隔离运行时、固定资源和设置开关；兼容范围与限制见上方结果和 `NODESEEK-PRO.md`，并非完整 Tampermonkey。 |
| 10 全面审计 | 之前的公开读取和安装验收是首版验收，不足以证明所有 macOS 功能或界面质量已经移植。 | P1 交付范围 | 本文逐项列出基线差距与优先级。 |

级别说明：P1 为日常阅读、账号写作或身份边界需要优先解决；P2 为明确功能差距或重要体验；P3 为分发完善和可选能力。它不是仅针对安全漏洞的分级。

## 模块与功能对照

### 会话、导航与列表

| 功能 | 上游证据 | Windows 基线 | 判定与后续 |
| --- | --- | --- | --- |
| 官方登录、站点验证、持久会话 | `ForumSession.swift:727` 的 `ForumWebPage`；`ForumAccountData.swift:246` 的 identity。 | `electron/main.ts:146` 的 `WebContentsView` 与 `persist:nodeseek`，用户手动登录；`inspectAccount`、`generation` 拦截旧结果。 | **已实现核心路径**。内嵌视图和模拟登录回归有记录；真实账号登录及权限仍由用户实测。不能把 Cookie 存储测试等同真实登录验收。 |
| 账号切换后清除旧数据 | `ForumSession.swift:166/199/205` 清派生状态、确认 owner。 | `electron/main.ts:35` 身份变化递增 generation；React 账号订阅清楼层、标签并刷新列表。 | **部分实现**。读取缓存边界已建立；新增草稿、写操作、私信必须继续携带 owner 和版本校验。 |
| 最新发布、最新回复、版块和官网分页 | `ForumFeed.swift:158/166`、`ForumListing.swift:48`、`Workspace.swift:210/272`。 | `electron/forum.ts:29/116` 构建/提取；`main.ts:247` 加回退；`App.tsx:145` 刷新及页码。 | **已实现基础路径**。RSS 本身没有完整历史或回复排序，界面需要始终保留范围说明。 |
| 精品区、曝光、站点快捷入口 | `Forum.swift` 中 `ForumShortcut`、`Board.award` 与 `Board.sections`。 | URL 白名单支持 `award` 和 `expose`，基线 `App.tsx` 的 `boards` 没有对应入口。 | **部分实现**。不是网络接口未知，属于导航遗漏。 |
| RSS 回退 | `ForumFeed.swift:19–95`，独立无 Cookie 会话、ETag、Last-Modified、Retry-After。 | `main.ts:213` 独立公开分区、固定 URL、禁止凭证、15 秒缓存。 | **已实现基础读取**。没有上游条件请求和 Retry-After 退避；普通手动读取可用，关键词轮询移植时必须补齐。 |
| 自动刷新、自动加载更早、每版块快照 | `WorkspaceView.swift:17–18`；`Workspace.swift:216/278`。 | 单个 React `listing`，手动刷新/上一下一页，切换版块重新读。 | **未实现自动策略/多版块缓存**。不得因频繁操作而无节制请求。 |
| 全站历史搜索、用户搜索、多版块范围、最近记录 | `Workspace.swift:49–64/293–324/397–437`；`ForumDirectory.swift:102`。 | `App.tsx:276` 仅过滤当前列表标题、作者、版块；支持粘贴帖子 URL。 | **仅本地筛选已实现**。缺全站/用户搜索、范围组合、搜索历史和模糊匹配。可以移植明确读取流程。 |
| 三栏与窄窗口阅读 | `WorkspaceView.swift:53–66` 和宽度拖动状态。 | CSS Grid、手动收起列表、980px 尺寸回归。 | **部分实现**。缺拖动调宽、独立侧栏折叠；大字号/系统缩放需要重新验收，不能用旧字号截图覆盖。 |
| 多标签、后台打开、关闭、恢复 | `Forum.swift` 的 `ReadingSession`；`Workspace.swift:523`；`TopicTabPointer.swift:66`。 | `App.tsx:179/192/305`，Ctrl/中键后台打开、关闭、最多 30 标签及设置恢复。 | **部分实现**。基线总览常驻；缺拖动排序、Ctrl+Tab/反向切换、右键关闭其他/右侧等效率功能。 |
| 滚动和楼层锚点 | `ForumActivity.destination`、`ForumReplyResponse.destination`、`ThreadReader` 的 floor ID。 | 保留帖 URL 的页码/hash，进程内保存当前帖子 scrollTop；楼层 `<article>` 未设可定位 ID。 | **部分实现且有缺口**。粘贴 `#楼层` 不等于已经滚动到楼层；重启也不恢复 scrollTop。 |

### 正文、楼层与媒体

| 功能 | 上游证据 | Windows 基线 | 判定与后续 |
| --- | --- | --- | --- |
| 帖子/逐楼正文、回复分页 | `ForumThread.swift:3–47/180–406`；`ThreadReader.swift`。 | `electron/forum.ts:158` 提取当前页、净化 HTML；`App.tsx` 逐楼渲染与下一页。 | **已实现基础路径**。DOM 变化、删除/受限主题的错误语义仍需细分；回复分页不能从 RSS 得到。 |
| 阅读等级、回复限制、楼主状态 | `ForumListing.swift:70–77`；`ForumThread.swift:10/382/403`；`ThreadReader.swift:214/489`。 | 列表保留 `readingRank`；基线线程模型没有 `replyRestriction`，楼主标签按“第一页第一个楼层”推定。 | **部分实现**。新回复 UI 应读取真实限制和作者身份，不能只以“已登录”推定能回复。 |
| UID、等级、角色、签名 | `ForumThread.swift:14–28/382`；`ForumUserCard.swift:12/83`；`ThreadReader.swift:290–316`。 | 基线只保存作者名字、头像和日期，丢弃这些元数据。 | **基线缺失，本轮修复中**。等级应来自 DOM/config/用户资料，不可编造默认等级。 |
| 常见段落、代码、表格、图片 | `ForumBlocksView.swift`、`ForumThread.swift` 的内容块解析。 | `sanitizeContent` 标签白名单，React HTML/CSS 展示。 | **已实现普通内容**。需持续验证长行、表格宽度、链接和空正文；安全净化是必要条件，不能因此宣称复杂布局等价。 |
| ANSI 彩色终端、xterm 延迟绘制 | `ForumThread.swift:119–221` 捕获终端源；`ForumTerminalView.swift:4/69/86`。 | 仅复制 `.post-content` 的 HTML；净化删除 style、终端脚本，没有捕获/解析 ANSI。 | **未移植**。可能丢彩色、只剩空 canvas 或未渲染终端。保留安全边界后需移植结构化文本/颜色跨度，不能开启远端脚本到本地 React。 |
| NQ/TQ、多标签报告、独立比例与完整复制 | `ForumReportSizing.swift:3/36/52`、`ForumReportView.swift`、`ForumThread.swift` 的 block tabs。 | 通用 `<div>/<pre>/<img>`，没有报告类型、专用尺寸、标签状态和完整复制。 | **未移植**。纯结构与尺寸逻辑可稳定移植，先做真实公开报告样例回归。 |
| 长图解码、放大、原图、加载失败入口 | `ForumImageView.swift:25–78/164–237`；独立 post/avatar/original 缓存与尺寸解码。 | `<img loading="lazy">`、`max-width:100%`；头像加载失败有文本替代。 | **部分实现**。没有点击放大、原图读取、独立缩放和长图内存策略。普通图片可显示不代表长图能力已移植。 |
| 本机正文缓存/离线 | `ForumSession.swift:232/243` 有有限线程内存缓存。 | React `threads` 缓存当前打开的内容，不写私帖正文到偏好文件。 | **部分实现**。两者都不是完整离线资料库；不应新增“离线已完成”的承诺。 |

### 写作、互动和账号功能

| 功能 | 上游证据 | Windows 基线 | 判定与后续 |
| --- | --- | --- | --- |
| 回复、引用、发送结果和跳转 | `ThreadReader.swift:436/501/527`；`ForumSession.swift:563–618`；`ForumThread.swift:409–434`。 | 基线没有回复编辑器/写入 API，只有打开原帖。 | **基线缺失，本轮修复中**。明确接口可移植；必须防重复提交、保留失败草稿，并处理结果未知而非自动重发。 |
| 上赞、送鸡腿、点踩 | `ForumReaction.swift:22–89`；`ThreadReader.swift:380–431`。 | 基线无按钮、计数、已选状态或确认流程。 | **基线缺失，本轮修复中**。三者语义不同，鸡腿与踩存在费用/额度确认，不能简单新增三个直接 POST 按钮。 |
| 新主题、版块和阅读权限 | `NewDiscussion.swift:46–77`；`NewDiscussionView.swift:59–108/147–198`。 | 没有 React 发帖页、合法版块/等级读取和发布动作。 | **未移植**。已有明确上游接口，不是“无法开发”；需保留只读/内版费用确认等规则。 |
| 编辑自己的主题/评论 | `ForumInlineEdit.swift:61/80/123–158`；`ThreadReader.swift:538–602`。 | 没有原文读取、所有者校验、编辑器或保存动作。 | **未移植**。需校验 config owner、帖子和楼层 `isMe`，不能凭本地 UID 直接允许编辑。 |
| Markdown 工具、编辑/对照/预览、发送快捷键 | `MarkdownComposer.swift:18/170/218/313–456`、`MarkdownEdit.swift`、`MarkdownPreviewDocument.swift`。 | 基线只有只读 HTML；本轮简单 textarea 不能等同完整 Markdown 编辑器。 | **未移植完整编辑器**。文字回复补齐后仍需预览、格式工具、撤销/选区、拖动调整等。 |
| 图片、剪贴板上传、发送尺寸、密钥 | `NodeImageUpload.swift:7–36/76–142/203`；`MarkdownComposer.swift:319–351/529`。 | 没有上传 API、选图/剪贴板处理或密钥设置。 | **未移植**。Windows 凭据应使用 safeStorage/系统凭据能力，不能把图床密钥写进普通设置 JSON。 |
| 官方表情、自定义分组表情 | `ForumStickers.swift:17`；`StickerPicker.swift:26–78/213`。 | 没有选择器和本机素材管理。 | **未移植**。展示已有图片不等于表情发送支持。 |
| 按账号保存回复/私信/新主题草稿与图片设置 | `ForumDrafts.swift:5–40`；`ForumSession.swift:130–153/199`。 | `electron/store.ts` 只存设置和标签，主动剔除 summary，不含草稿。 | **未移植**。新增编辑器必须明确会话内/持久草稿范围，并按已确认 UID 隔离，未知身份不能加载上一个账号内容。 |
| 用户卡片、个人空间、活动/粉丝/关注列表 | `ForumUserCard.swift:12–64`；`ForumSpacePane.swift:128/239–248`；`ForumDirectory.swift:24/125–145`。 | 基线没有原生用户卡/空间页，部分链接只能官方浏览。 | **未移植原生页面**。已知资料/活动读取接口可移植；不把个人主页按钮算作完整用户中心。 |
| 个人 README 与签名编辑 | `ForumAccountData.swift:36–97`；`ProfileIntroductionEditor.swift`；`ForumSession.swift:375–402`。 | 没有资料编辑和冲突检测。 | **未移植**。需要先读最新值、只改本次字段，遵守签名限制。 |
| 加好友/关注写操作 | 上游 `ForumDirectory.swift:129` 只读取 fans/follow；`ForumUserCard.swift:60` 只包含主页和私信入口。 | 基线无操作。 | **上游也未提供可复用的关注写实现**。不能臆造 API；需确认官网实际协议和“关注/好友”语义再开发。用户主页中的官方按钮只能记作官方操作。 |
| 拉黑/屏蔽用户 | `DeskExtensions.swift:50/130/173–189`；`ThreadReader.swift:282–284`。 | 基线无屏蔽数据与折叠。 | **基线缺失，本轮修复中**。上游是本机隐藏指定作者正文/回复，不等于向 NodeSeek 提交账号级黑名单。界面必须注明本地屏蔽。 |
| 通知、@我、主题回复、未读聚合与已读 | `ForumAccountData.swift:139–182/263/330–378`；`ForumAccountSheet.swift`。 | 没有通知列表、未读标记或已读 API。 | **未移植**。已有明确上游读取和标记逻辑；未读不能只根据会话最新一条消息推定。 |
| 私信列表、会话、发送 | `ForumAccountData.swift:299–326/394–416`；`ForumAccountSheet.swift`。 | 基线无原生私信。 | **未移植**。已知同源 GET/POST 可移植；没有上游证据支持猜测 `/message?to=UID` 网页链接。 |

### 八项扩展与系统能力

八项枚举来自 `Sources/SeekDesk/DeskExtensions.swift:4–43`。基线 Windows 没有插件中心、安装/启停配置或这些扩展的模块。用户脚本和内置扩展是两种能力，不应混称。

| 扩展/能力 | 上游定位 | Windows 基线与优先级 |
| --- | --- | --- |
| NodeSeek 热榜 | `HotRankingView.swift:13/38/63`，实时/日/周榜与轮询快照。 | 未移植，P2。公开接口可独立无论坛 Cookie 读取。 |
| 每日签到 | `ForumAccountData.swift:215–243`、`AttendanceState.swift`，北京时间日界、身份确认和重试。 | 未移植，P2。手动与自动签到应分开；不能因移植 API 就默认启用自动写操作。 |
| 摸鱼老板键 | `DeskExtensions.swift:87–112/325`、`ExtensionTools.swift`。 | 未移植，P3。纯 UI/快捷键逻辑可移植。 |
| 剩余价值计算器 | `RemainingValue.swift:30–46` 使用 Decimal/真实月历周期，`ExchangeRates.swift:100–101`。 | 未移植，P2。金额精度、月末/闰年和多币种规则可移植，不能统一除以 30 天替代。 |
| 屏蔽用户 | `DeskExtensions.swift:173–189`。 | 本轮修复中；基线未移植，P1/P2。 |
| 只看楼主 | `ThreadReader.swift:260–272`。 | 基线未移植，P2。可按真实 UID/楼主标记过滤；未知 UID 不应把同名者一律当楼主。 |
| 关键词监控 | `DeskExtensions.swift:277–321`、`KeywordNotification.swift`，RSS 10 秒轮询、去重、退避和系统通知。 | 未移植，P2。需要先移植条件请求、去重、通知授权和运行期限制。 |
| 管理记录查询 | `RulingClient.swift:110–129`、`RulingsView.swift`。 | 未移植，P2。属于第三方服务，不应附带论坛 Cookie。 |
| 图标/主题/字号/布局偏好 | `PreferencesPane.swift:20–34/97–148/212–254`。 | 浅/深/系统、正文大小、紧凑和标签恢复已实现；六色 Logo、作者栏独立缩放、报告独立比例和可拖宽度未移植。全局字号本轮修复中。 |
| 系统通知、通知跳转 | `SeekDeskApp.swift:62–89`。 | 未移植。Electron 需实现 Windows 通知入口及回帖定位，不等于浏览器允许通知权限。 |
| 友情链接、关于和站点快捷页 | `FriendLinksPane.swift`、`AppInformation.swift:3–10`、`WorkspaceView.swift:506`。 | 关于、上游与许可链接已有；友情链接面板、管理记录/抽奖/邀请等快捷导航没有完整移植，P3。静态内容可直接迁移，但应标注外部服务。 |
| 安装、许可、更新 | 上游 `scripts/build.sh`、`SeekDeskApp.swift:124–153` 的 Sparkle 配置检查。 | Windows 已有 NSIS、GPL/NOTICE、对应源码及历史安装验证；没有 Windows 更新服务/签名发布流程。当前用户要求不打包，应保持 release 安装包不变。 |

AppKit/SwiftUI 的 Liquid Glass、Dock 图标和 Sparkle 二进制不能直接用于 Windows；应以 Windows 窗口/任务栏、适合 Windows 的视觉层次、系统凭据和更新机制实现同等目的。平台材质不同本身不是功能缺陷，缺少相应用户操作和状态反馈才是移植差距。

## 可复用协议与需要确认的边界

以下是源码证据，不代表本次已经向论坛实际写入验证：

| 操作 | 上游已知协议 | 必须保留的行为 |
| --- | --- | --- |
| 回复 | `POST /api/content/new-comment`，JSON `{postId,content,mode:'new-comment'}`，`csrf-token` 为随机请求值；`ForumThread.swift:418–434`。 | 同源会话；发前重新确认账号、帖子和权限；检查 JSON success 与重定向；未知结果保留草稿且不自动重发。 |
| 新主题 | `POST /api/content/new-discussion`，`{mode,title,content,category,rank}`；`NewDiscussion.swift:65–77`。 | 版块/等级从当前官网表单读取；内版等消耗操作要求明确确认；接受后才清草稿。 |
| 修改主题/评论 | `POST /api/content/{mode}`，`ForumInlineEdit.swift:123–158`。 | 同步检查当前 owner、postId、楼层 isMe；不能把可见编辑按钮当服务端已授权。 |
| 上赞/鸡腿/踩 | `POST /api/statistics/{kind}`；免费额度 `GET /api/progress/today?scope=freelike`；`ForumReaction.swift:59–87`。 | 上赞 kind=upvote，鸡腿 kind=like，踩 kind=dislike；保留免费/付费报价、确认与已操作状态。 |
| 用户资料 | `GET /api/account/getInfo/{member}`，可带 `?readme=1`；`ForumAccountData.swift:380–391`。 | 校验响应 member_id，等级/角色缺失时显示未知，不能造数据。 |
| 个人简介/签名 | `GET/POST /api/account/introduction`；`ForumAccountData.swift:36–97`。 | 先读最新值并检测并发修改、签名语法限制；错误不清编辑内容。 |
| 用户搜索/列表 | `GET /api/account/find/{term}`；`/api/content/list-discussions?uid=...&page=...`；`/api/content/list-comments?...`；`/api/fans/fans`、`/api/fans/follow`；`ForumDirectory.swift:102/125–145`。 | 按官方登录权限读取；找不到用户与网络失败分开。 |
| 私信 | `GET /api/notification/message/with/{peerID}`；`POST /api/notification/message/send`，`{receiverUid,content,markdown}`；`ForumAccountData.swift:263/402–415`。 | 校验对话双方 UID、账号世代；明确成功才清草稿；未知响应不自动重发。 |
| 关注/好友、官网账号黑名单 | 上游没有相应写协议。官网公开 JS 本轮确认关注 `POST /api/fans/add|del`、`{followed_member_id}`；NodeSeek Pro 源码含站内 blacklist 接口。 | Windows 本轮实现真实关注/取关；本机屏蔽独立说明，脚本的好友标记不冒充服务端好友。证据 `verification/public-actions-research.json`。 |

Node.js 不应获得论坛 Cookie 字符串来构造这些请求。按上游方式在隔离官方页面的同源上下文发送，主进程只接收经校验的结构化结果。账号写操作的 mock 回归只能证明客户端状态语义，真实权限和返回结果仍需要用户在自己的账号下测试。

## 界面与文本审计要求

本节是基线源码发现与本轮验收要求，不是宣称全部视觉检查已经通过。

- 字号：消除靠 7–10px 文字压缩信息的布局。菜单、列表、标签、设置说明和页脚都应受全局字号控制；正文单独可调，设置预览要反映真实区域。高字号时让行高、按钮、侧栏和设置滚动区自然增长。
- 密度：版块放标题前方、时间放作者行；标题可换行，分类不能整行占位。用实际可见行数和长标题截图验证，而非只看 CSS padding 数值。
- 信息层级：顶部仅一个 SeekDesk；去掉重复品牌、英文眉题和标语。来源/摘要/验证提示必须保留，不能为了紧凑删掉数据边界。
- 色块：用稳定的侧栏/列表/阅读区背景和分隔线表达区域；选中、悬停、已打开与未读不要靠多层同色卡片混在一起。警告色只用于有意义的受限/部分数据状态。
- 空/错状态：基线列表失败后来源仍显示“连接中”、页脚仍“正在读取”；应显示读取失败或未连接，保留明确重试/官方页面动作。受限版块 RSS 空结果不能写成“整个版块没有帖子”。
- 交互：总览、普通帖子和官方页面的关闭/返回模型一致；用户卡、回复提交、费用确认和屏蔽应有明确标签、键盘焦点与失败反馈。
- 显示尺寸：至少覆盖 1440×920、980×720、全局字号最大值、正文最大值、长标题/长用户名/楼层角色/签名、深浅主题。此前小字体截图不能替代本轮验收。
- 头像：账户、列表、楼层各处都检查真实图片请求与回退；字母替代只能作为加载失败或未知身份的回退，不能因忘传 src 就当头像功能已完成。
- 辅助功能：图标按钮保留 aria-label/tooltip，弹层焦点可返回，文本选择、输入法、滚动与减少动效生效；本轮截图不足以宣称完成全面无障碍认证。

## 安全、测试与验收差距

已有正向基础：`main.ts` 的 IPC 主窗口/主 frame 来源校验；官网与 RSS 分区隔离；官方页面 Node.js 关闭、sandbox/contextIsolation 开启；URL 白名单；HTML 白名单净化和 RSS XML 实体拒绝；账号世代过期拒绝；偏好保存不写私人正文。原生官网视图仍不能获得 React 的 preload/IPC。

原版 `Tests/Session` 与 `Tests/Regression/FixesChecks.swift:17/128/156/189/213` 覆盖账号草稿隔离、资料、报告/Markdown、长图、未读聚合等。Windows 基线的 11 项单测、公开内容读取、安装后 smoke、内嵌登录 smoke 只覆盖已经实现的部分，不能证明尚未移植模块正确。

新增写操作至少需要：身份切换前后拒绝旧提交、空/超长输入、只读主题、HTTP 200 但 success=false、401/403/429/验证页、超时且服务端可能已接受、双击防重、失败草稿保留、付费互动明确确认。测试采用 mock 同源返回，不能为验收向真实论坛发送垃圾内容。

新增字号/布局至少需要：两套主题、窗口变窄/最大字体、标题长短、表格/代码横滚、总览关闭恢复、真实头像和加载失败、菜单/弹层不被原生 WebContentsView 遮挡。支持新功能后再扩充对应测试，不要用只验证按钮存在的测试代替端到端行为。

## 建议实施顺序

1. **本轮优先**：字号与列表布局、唯一顶栏品牌、头像、可关闭总览；回复/引用/可靠结果反馈、用户身份与等级、本地屏蔽、费用正确的楼层互动；保持上次修好的内嵌登录和身份边界。按用户要求仅编译测试，不打包。
2. **接下来的核心功能**：按 UID 隔离草稿、完整 Markdown 编辑器、真正私信与通知、个人卡/空间、发帖和自己的楼层编辑、服务器搜索、楼层定位、图片放大及完整报告解析。上游已经给出大部分稳定逻辑，不需要从零猜测。
3. **扩展及分发完善**：扩展中心和八工具逐个迁移、通知跳转、图床凭据、Windows 更新/签名。待用户提供具体油猴脚本后，单独评估它的 DOM、运行时和授权需求。

完成本轮优先项后，产品仍应标注已实现范围和剩余清单，不能将“UI 修订完成”或“公开读取成功”改写成“完整移植完成”。
