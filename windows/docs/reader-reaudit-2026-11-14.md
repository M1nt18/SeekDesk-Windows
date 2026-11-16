# 阅读器与工作区逐段复核（2026-11-14）

本记录针对用户要求重新对照原版，不以 README 中列有某功能或有同名按钮作为完成证据。检查的是原版 `ThreadReader.swift`、`ForumThread.swift`、`ForumDirectory.swift`、`Workspace.swift`、`WorkspaceView.swift`、`FloorAuthorHeader.swift`、`TopicListRowLabel.swift`，以及 Windows 的 `App.tsx`、`ReaderContent.tsx`、`MarkdownComposer.tsx`、`forum.ts` 与现有操作处理链。

单页隐藏两个分页控件、写回复靠右是本轮用户明确指出的已知问题，由主任务修复；个人主页 Markdown 和统计卡样式由另一个并行任务核对，不在此重复计算。前一轮尚未发布的一键更新、等宽标签及自动连读也不应因本次修复被回退。

以下表格保留本次检查时的差异及原版依据，具体修复状态需由主任务结合最终代码和行为测试更新。该记录不能读作“原版全部功能已经完整”。行号是检查时快照，后续修改可能移动位置。

## 确认的实质差异

| 编号 | 影响 | 原版依据 | Windows 检查结果与最小修复方向 |
| --- | --- | --- | --- |
| READ-01 | 上传未完成时仍能点击编辑器外部的发送按钮，导致正文先发出而漏图；上传晚到还可能插入下一份草稿。 | `ThreadReader.swift:526-528`、`:584-586` 明确要求 `!editor.uploading` / `!editEditor.uploading` 才能发送或保存。 | `MarkdownComposer.tsx:17-19` 的 uploading 只锁自己的输入和快捷键；`:33-45` 上传结束后才插入图片，却没有向父组件报告上传状态。`App.tsx:370` 的 sendReply 和 `:508` 外部回复按钮只检查 actionBusy/文字。应把上传状态传给所有父发送入口，并在操作函数中复核，不能只禁用按钮；安装前保存也不能在上传中给成功确认。源码链已确认，未向真实论坛发送。 |
| READ-02 | 原站通过 CSS 隐藏的楼层/正文可能在客户端显示出来。 | `ForumThread.swift:183-184` 的 excluded 检查 `display:none` 和 `visibility:hidden`；`:194-195` 排除隐藏楼层，`:295-296` 对终端报告有明确例外。 | `forum.ts:204` 仅检查 item.hidden；`:258-259` 仅删除 hidden/aria-hidden 节点，随后 sanitizer 删除 style。合成 DOM 实测 `<p style="display:none">HIDDEN_SENTINEL</p>` 变成可见 `<p>HIDDEN_SENTINEL</p>`，而 aria-hidden 已正确删除。应按原 DOM 的 computed visibility 筛选对应克隆节点，保留报告标签/终端的特例，不能笼统删掉所有报告面板。 |
| READ-03 | 阅读标题缺少精品、阅读等级/私有和锁定状态，用户从标签或 URL 打开帖子后看不到列表里的重要元信息。 | `ThreadReader.swift:230-247` header 显示 category、`TopicTitleBadges` 和 replyRestriction；`TopicListRowLabel.swift:67-73` 把 rank 255 解释为“私有”。 | `App.tsx:505` 的 reader-toolbar/thread-heading 只有 category/title/操作；featured 与 readingRank 仅在帖子列表显示，replyRestriction 藏在展开的回复区。`forum.ts:298-299` 也没有传回原帖 category。应恢复阅读 header 的元信息，并让 255 显示“私有”，不要显示裸数字 255。 |
| READ-04 | 主楼与跟帖之间缺少原版的“楼层回复”分区及空回复提示，分页成为孤立控件；只看楼主后没有回复时界面难以理解。 | `ThreadReader.swift:278-291` discussionHeader 有分隔线、楼层回复标题、只看楼主及当前页；`:176-182` 明确显示本页无回复或无楼主回复。 | `App.tsx:506` 从主楼直接接分页与评论 map，缺少该分区标题和筛选后的空态。只看楼主开关被移到全局 reader-toolbar，但没有相应回复区域的结构提示。应恢复讨论分区和准确空态，同时遵守用户“只有第二页存在才显示分页”的要求。 |
| READ-05 | 未登录点击楼层互动不能像原版一样进入登录，只看到不可点击按钮。 | `ThreadReader.swift:394-395` 的 startReaction、`:436-440` 的 floorAction 都先打开官方登录；未登录本身并不使这些入口永久禁用。 | `App.tsx:436` canInteract 要求 signed-in，`:506` 所有互动/引用/回复都以 !canInteract 禁用。应恢复未登录点击后的官方登录引导，登录后仍需用户再次明确提交互动，不能登录后擅自补发。 |
| READ-06 | 未取得反应数时显示假“0”，把未知状态当成真实计数。 | `ThreadReader.swift:382-389` 只有 count 非空才渲染对应反应；`ForumThread.swift:376-378` 未知计数保留 null。 | `forum.ts:268/273` 未读到计数确实返回 undefined，但 `App.tsx:506` 用 likes/chicken/dislikes `??0` 全部显示。应保留未知语义，按原版隐藏该反应或呈现明确未知态，不应伪造零。合成 DOM 已确认缺计数时提取结果为 `{}`。 |
| READ-07 | 标签很多时，快捷切换或下拉选择的当前标签可能留在可视范围之外。 | `WorkspaceView.swift:1100-1108` 在出现及 selection 变化时都 scrollTo 当前标签。 | 当前 App 中 scrollIntoView 用于列表选中、楼层等，没有针对选中 `.reading-tab` 的自动入视口操作。等宽标签使这个缺口更容易出现。应在 activeId 变化后滚动标签容器到当前标签，保留页面本身的阅读滚动。 |
| READ-08 | 屏蔽作者后帖子列表整行消失，与原版“保留帖子并标已屏蔽”的语义不同，也失去列表里直接解除屏蔽的入口。 | `Workspace.swift:178-183` filteredPosts 只按版块过滤；`TopicListRowLabel.swift:33` 显示“已屏蔽”；`WorkspaceView.swift:1052-1062` 的列表右键支持解除/屏蔽。 | `App.tsx:434` filtered 用 `!isBlocked` 删除列表项；App 无 onContextMenu。应按原版保留行并标记屏蔽状态，恢复列表作者管理入口；正文的折叠仍由屏蔽扩展控制。 |

## 仍存在的交互与表现差异

这些是对原布局和行为的差异，不应混同于接口完全没有实现。

- **编辑位置不同。** 原版 `ThreadReader.swift:482-488`、`:536-604` 在原阅读页底部内联编辑，允许取消回到原阅读状态；Windows 作者菜单跳到全屏 TopicComposerPanel。编辑接口本身存在，但这层“读帖中编辑”的布局没有复刻。若要求布局一致，应在阅读页复用编辑器而不是把用户送去新帖页。
- **反馈位置不同。** 原版 `ThreadReader.swift:337-347`、`:410-432` 把失败/站点验证反馈放在对应楼层下方，并提供该层的验证入口；Windows 主要通过全局 toast 告知。接口错误已处理，但上下文与可恢复路径不相同。
- **角色标签被合并。** 原版 `ForumUserCard.swift:82-94` 对去重后的最多四个 tags 分别使用有颜色填充的胶囊；`FloorAuthorHeader.swift:45` 复用该组件。Windows comment/profile compact 服务将 role 拼成字符串，AuthorBadges 用一枚 role badge 呈现，多个角色的独立色块和标签结构没有保留。资料卡与楼层应共同核对，而不是只改其中一处。
- **标签右键移动入口遗漏。** 原版 `WorkspaceView.swift:1161-1171` 提供向左/向右移动与关闭全部；Windows 有拖动排序和全局关闭全部，缺右键入口。已有能力不等于入口布局一致。
- **本人签名更新的优先级不同。** 原版 `ThreadReader.swift:310-316` 优先当前本人 introduction.signature，再用楼层/公开资料回退。Windows 优先缓存的 comment.signatureHtml/signature，没有同等的本人简介更新直达链。应在个人签名成功保存后使阅读中自己的签名及时刷新；未模拟线上保存，不将其说成已观察到的服务器故障。

## 已逐段对照到的实际处理链

| 范围 | 已核对到的实现与边界 |
| --- | --- |
| 完整正文及明确 RSS 摘要 | readThread → onWebsite → extractThreadScript → sanitizer → ReaderContent；RSS 后页不伪造完整评论。 |
| 楼层身份和跨页 HOT | ID 去重、poster.uid/name/avatar 回退、HOT/pined、sourcePage/actionUrl；比原始 Swift 的简单 DOM 解析增加了真实站点兼容。 |
| 回复与引用 | 两个独立操作，引用附正文，回复附作者/楼层链接；服务端仍复核真正楼层和当前账号，成功后只重试 GET。上传中的发送边界见 READ-01。 |
| 鸡腿、点赞和点踩 | 官方请求、免费/付费确认、已完成状态禁用、余额刷新；未知计数和游客引导见 READ-05/06。 |
| 锁帖 | 提取 replyRestriction，楼层引用/回复已限制；header 的显式状态仍缺，见 READ-03。 |
| 本地屏蔽 | UID/用户名匹配，正文可临时展开/再次收起及解除；列表过滤语义见 READ-08。 |
| 只看楼主 | 原始身份/UID 筛选、扩展启停、自动读取的无可见增量暂停；回复区域空态见 READ-04。 |
| 数字分页与连续阅读 | 真实页链接、首页跳转、同帖下一页合并、楼主/HOT 去重、旧账号/页请求失效及阅读锚点；本轮单页控件显示由主任务修复。 |
| 正文块和媒体 | 表格、代码、折叠、HTTPS 图片、图集、复制/保存、普通安全 HTTP/HTTPS 链接均有处理链。隐藏 CSS 内容见 READ-02。 |
| ANSI 与网页终端 | 原始 PRE 捕获、xterm 回退、隐藏报告标签、NQ/TQ 比例、放大和复制已有实现；未对真实站点的每一种异步渲染进行线上验证。 |
| 标签与快捷键 | Ctrl+点击/中键后台打开、拖动、Ctrl+Tab、Ctrl+W、列表键盘选择、保存当前页和位置；当前标签可视性见 READ-07。 |
| 目录与楼层定位 | ForumDirectory 的实际时间补读、真实 floorsPerPage 定位与 Windows 对应 query/space destination 有链路；个人页样式另由并行任务核对。 |

## 本次实际验证与限制

本次只读审计执行了一个隔离 JSDOM 提取验证，输入全部为合成内容，没有真实网络请求或论坛写入。它确认 CSS 隐藏正文在当前 Windows 提取器中变成可见，也确认缺失互动计数仍为 undefined；没有把此前测试数量当成本次新发现的验收结果。

没有读取现有用户会话、Cookie 或私有资料，没有执行安装、打包和发布。上述各项修复后仍需对应的行为回归；源码有处理链和真实账号当前有权限是两种不同的证据。
