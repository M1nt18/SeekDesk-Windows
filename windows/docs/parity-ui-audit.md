# Windows 界面与原版行为核对（2026-11-12）

范围：原版 README.macOS.md 与 Sources/SeekDesk 的首页、侧栏、快捷功能、热榜、扩展、设置、编辑器、通知及私信。个人资料字段/时间、帖子资料补全和正文分页由并行任务核对，未计入下列差异数。此记录是源码路径审计；不将离线接线认作真实账号线上验收。

审计时确认 **10 项具体遗漏或行为差异**。其中前三栏的“缺口”记录初始证据，后续修复必须以代码与回归结果更新状态，不能仅据文案改为完成。

## 修复与验证状态

截至本轮本地代码，UI-01 至 UI-10 均已有对应修复：

- UI-01/02/03/04/05/08：通知分栏与正文预览、私信读写模式、账号联系人、分类未读、最近消息定位、扩展设置草稿保护已接入。新增 inbox-ui-smoke.cjs 的 7 组隔离 Electron 检查通过；inbox-behavior / parity-store / interactions 共 28 项 focused 测试通过，双侧 TypeScript 检查通过。
- UI-06/07：个人空间任务已移除编辑模式中无效的版块/权限选择，并让新帖使用已保存的默认编辑器视图。
- UI-09/10：根任务已为列表收起状态接入工作区持久化，并将关键词提醒改为右上角非模态提示和 12 秒自动隐藏。其综合回归结果由主任务记录。
- 对照个人空间任务，另接回原版默认概况/README、账号设置及作者轻资料卡；详情见个人空间任务验证。

本审计范围内没有仍能确认未接线的功能项。真实登录权限、通知/私信数据和线上写权限仍属于用户会话下验收，不能计为代码未实现。上表问题证据保留用于追溯，本表为修复后的状态。最终交付应以当前主任务的完整构建与综合回归为准。

## 具体缺口

| ID | 问题与影响 | 原版证据 | Windows 证据与修复建议 |
| --- | --- | --- | --- |
| UI-01 | 私信忽略纯文本/Markdown模式。已有纯文本消息会被当Markdown解释；发送只能Markdown。 | ForumAccountSheet.swift:629-650 按message.markdown选择渲染；772-796 提供Markdown复选框。 | src/parity-panels.tsx:52 一律Markdown预览，electron/interactions.ts:79 写死markdown:true，shared/types.ts消息请求无模式字段。补真实模式选择、透传布尔值、按原消息模式呈现。 |
| UI-02 | 缺通知详情和目标楼层正文预览；点击列表直接离开通知页。 | ForumAccountSheet.swift:279-289 分栏详情；379-400 目标楼层入口；693-748 独立正文预览/失败重试。 | src/parity-panels.tsx:52 只有列表直接onOpenPost。恢复选中通知、读取并预览目标楼层，仍保留明确打开帖子按钮。 |
| UI-03 | 较早私信联系人未保存。站点最近消息列表不再包含某联系人时，用户只能再次手输UID。 | ForumSession.swift:405-422 按账号存最多500个联系人；ForumAccountSheet.swift:295-306、313-354 合并最近/较早对话。 | electron/parity-store.ts和shared/parity.ts无联系人存储契约，src/parity-panels.tsx:43、52只显示本次接口会话。补账号隔离的联系人缓存和最近/较早对话分组；不缓存额外私信正文。 |
| UI-04 | 通知分类没有独立未读数，也不会默认打开有未读的分类。 | ForumAccountSheet.swift:208-213 默认首个未读分类；233-246 每分类计数。 | src/parity-panels.tsx:41默认mentions，:52仅@我/回复/私信文案；App.tsx:375只顶栏聚合总数。向面板传当前计数并在首次打开选择首个非零分类，保留用户之后选择。 |
| UI-05 | 长私信不默认定位最近消息；发送成功重读后可能仍在历史开头。 | ForumAccountSheet.swift:629-645消息历史defaultScrollAnchor(.bottom)。 | src/parity-panels.tsx:52的conversation-scroll无滚动ref或锚点；styles.css:311只普通overflow。进入会话/本人发送成功后定位底部；查看旧消息时不要被任意后台数据强制拉走。 |
| UI-06 | 编辑主题展示可编辑版块/阅读限制，但操作不会生效，且版块默认显示日常。 | ForumInlineEdit.swift:126-140只编辑标题正文，阅读限制保留原值；没有改版块控件。 | src/parity-panels.tsx:62编辑主题仍显示两个select，electron/parity-forum.ts:164不返回category，:206提交保留data.rank且不发category。编辑模式去掉无效select或显示只读元信息，新发帖保留真实选择。 |
| UI-07 | 默认编辑器模式设置在新主题中不生效。 | Windows额外设置src/components/PreferencesPanel.tsx有默认编辑器模式，回复/私信使用appearance.composerMode。 | src/parity-panels.tsx:62新主题固定initialMode=split。使用已保存的默认模式，同时保持用户当前编辑过程中的自主切换。 |
| UI-08 | 后台任务可能覆盖尚未保存的扩展设置。用户输入过程中约10秒轮询更新就把草稿还原。 | 原版PluginCenterView.swift:247-260用独立watchInput/watchNoteInput，保存时才赋配置。 | src/parity-panels.tsx:90每次state变化setLocal(state)；electron/extensions.ts:89 emit新对象，关键词/签到等可更新它。打开设置时建本地草稿；运行状态独立更新；保存只合并已编辑配置，避免覆盖后台hits/lastCheck。 |
| UI-09 | 收起帖子列表的偏好不记忆。重启恢复标签后又展开。 | WorkspaceView.swift:16使用workspace.hideListWhileReading的AppStorage，1081-1090切换。 | src/App.tsx:87 listHidden只useState(false)，workspace保存未带该字段。补持久化并区分窄窗口的临时自动收起与用户偏好。 |
| UI-10 | 关键词命中改成阻塞模态框，原版是自动消失的角落提示。会打断阅读与写作。 | WorkspaceView.swift:90-102右上角提示；128-131活动时12秒自动收起。 | src/App.tsx:414使用Modal且无自动关闭。恢复非模态提示卡、手动关闭和12秒收起，历史命中保留在扩展页。 |

## 已追踪到实际实现的功能

下表为代码可达性证据，不代表真实账号权限已经验收。

| 功能 | 界面入口 | 实际处理链与限制 |
| --- | --- | --- |
| 最新帖子/最新回复/版块/精品/刷新/加载旧帖 | App.tsx:381-386、400 | listPosts到electron/forum.ts网页/RSS读取；loadOlder按真实nextPage继续；搜索走queryForum。 |
| 快捷管理记录/幸运抽奖/邀请好友 | App.tsx:386 | openOfficial进入共享官方会话视图；与原版ForumShortcut相同保留官方页面。 |
| 多标签/后台打开/拖动/关闭/总览 | App.tsx:221-235、397 | 标签状态与请求版本取消配合；工作区存储恢复。 |
| 搜索帖子/用户/多版块/历史/帖子直链 | parity-panels.tsx:66-69 | queryForum到parity-forum搜索页面或find API；source URL校验真实站点；搜索权限由官方会话决定。 |
| 全局/正文/作者/列表/板块/热榜字号 | PreferencesPanel.tsx、App.tsx:372 | 实际CSS变量及appearance/store持久化；不是只显示设置文本。 |
| 主题/品牌/尺寸/阅读渐变 | PreferencesPanel.tsx | saveAppearance到主进程保存，App应用；macOS材质映射为Windows/CSS是平台差异。 |
| 原生窗口关闭策略/窗口尺寸/在线更新 | DesktopSettings.tsx、electron/desktop-window.ts、updater.ts | 属于Windows补充功能；不要求复制macOS原生框架。 |
| 新主题/编辑/回复 | parity-panels.tsx:55-62、App.tsx回复链 | 真实IPC到createWriteScript或createForumActionScript；权限及owner复核由官方页面执行；未实发。编辑元信息无效控件另见UI-06。 |
| Markdown格式/撤销重做/三模式/拖动高度 | MarkdownComposer.tsx、composer.css:7 | applyMarkdownCommand、renderMarkdown；resize:vertical真实调整编辑高度。默认模式遗漏见UI-07。 |
| 图片选择/粘贴/拖入/缩图/表情 | MarkdownComposer.tsx:33-48、ComposerMediaPanel.tsx | media IPC、NodeImage上传、尺寸处理、分组存储有处理链；未使用用户真实密钥上传。 |
| 实时/日/周榜/全榜/条数/刷新/分值 | App.tsx:388-391、parity-panels.tsx:72-79、96-100 | ExtensionsService公开热榜API、缓存/并发去重/旧数据保留；榜设置可保存。 |
| 八项扩展安装/启用/停用/卸载 | parity-panels.tsx:87-101 | saveExtensions控制ExtensionsService调度/快捷键/筛选；配置被后台覆盖另见UI-08。 |
| 签到/北京时间自动任务 | parity-panels.tsx:101、electron/extensions.ts | mode、autoAttendance实际调度；真实POST未执行。 |
| 老板键 | parity-panels.tsx:101、App.tsx bossMode | 主进程globalShortcut实际注册与事件；不是静态工作表。 |
| 剩余价值计算器 | parity-panels.tsx value入口、electron/main.ts | 按用户要求使用独立内嵌sy.3xme.com，与原版本机计算器差异为明确需求。 |
| 本机屏蔽/只看楼主 | App.tsx:356、364及楼层渲染 | 根据扩展启用状态应用，保留屏蔽楼层；不是官方账号黑名单。 |
| 关键词监控/系统通知/命中历史 | electron/extensions.ts、parity-panels.tsx:101 | RSS条件请求/规则/去重/退避/系统通知有实现；提示交互偏差见UI-10。 |
| 管理记录查询 | parity-panels.tsx:81-84、101 | queryRulings到公开服务，有缓存/节流与来源。 |
| 友情链接 | parity-panels.tsx FriendsPanel | 按用户要求只保留Impart并另列原代码，属于明确需求变更。 |
| 通知读取/标已读/楼层跳转 | parity-panels.tsx:40-52 | 官方列表API、markViewed、postUrl页/楼层；预览和分类细节遗漏见UI-02/04。 |
| 私信UID打开/读取/发送/草稿 | parity-panels.tsx:40-52 | with API、message/send、账号草稿实际处理；模式/联系人/最近定位遗漏见UI-01/03/05。 |

## 不计为缺失

- Windows无Liquid Glass、macOS钥匙串、Command或Dock实现：已有对应CSS材质、DPAPI、Ctrl和Windows任务栏实现。
- 原版没有通用第三方插件加载器，Windows的固定NodeSeek Pro适配是用户额外要求。
- 明确由用户改为sy.3xme.com计算器、仅Impart友情链接、自有GitHub更新源的行为不按原版差异报错。
- 未完成真实账号线上写操作验收，与“代码未实现”分开记录。现有模拟测试不能证明线上权限/验证码/反爬状态。

后续建议给 UI-01/02/03/04/05/08/09/10 添加行为级回归：纯文本保真与发送flag、通知预览不离页、联系人账号隔离、未读分类、长会话底部、后台状态到来时草稿不变、重启布局、非模态提醒。UI-06/07用现有界面回归覆盖即可。
