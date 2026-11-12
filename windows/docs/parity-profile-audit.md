# 个人空间与个人资料对照审计

审计日期：2026-11-12。范围为仓库内原版 Swift 个人空间、用户资料卡、资料编辑，以及相关主题编辑入口；不以 README 宣传文字代替实现核对。

## 发帖时间为什么丢失

原版的 `ForumDirectory.publicationDates(for:using:)` 会额外请求每篇主题的 `/post-ID-1`，从楼主楼层的 `.date-created time[datetime]` 读取真正的发表时间。`ForumSpacePane.TopicPublicationDate` 将它按本机时区分成 `yyyy-MM-dd` 和 `HH:mm:ss` 两行显示。

Windows 旧实现只读取 `list-discussions` 动态接口的 `created_at`。原版的动态模型本来没有这个字段，因此接口没有提供时，Windows 就完全不显示时间。新实现恢复独立、只读的补充读取，并让主题列表先显示，不等待时间请求。

对应文件：

- 原版：`Sources/SeekDesk/ForumDirectory.swift`、`Sources/SeekDesk/ForumSpacePane.swift`。
- Windows：`windows/electron/parity-forum.ts` 的 `publication-dates`、`windows/src/parity-panels.tsx` 的逐批加载和 `TopicPublicationDate`、`windows/shared/publication-date.ts`。

每批最多 4 篇，单篇 8 秒期限覆盖响应正文。仅接受同源、同一帖子第一页；用不执行脚本、不加载媒体的 template 读取楼主时间。失败的日期保留“时间未知”和单独重试入口，不伪造日期；离开栏目、切换用户或账号后丢弃迟到结果。

## 功能逐项核对

| 原版功能与实现证据 | Windows 核对结果 |
| --- | --- |
| `ForumSpacePane` 默认概况、统计与 README | 恢复概况默认页及 README；统计保留在个人空间上方。 |
| `ForumSpacePane.metric` 可点击主题、评论及本人粉丝/关注 | 恢复统计项跳转；他人的粉丝/关注仅显示数量，移除服务端不开放的列表入口。 |
| `ForumSpacePane` 注册时间 | 原有 `joined` 映射仍保留；新增测试覆盖官方注册时间文本。此项不是本次新恢复的字段。 |
| `ForumUserCard.UserBadges` 等级、身份角色 | 增加 `roles[].display_text` 映射、去重与最多 4 个徽章；合法等级 0 和统计值 0 保留。 |
| `ForumSpacePane.activityList` 主题、评论、楼层跳转 | 保留评论楼层和目标页；主题不显示 `#0`；主题显示精确时间，评论保留时间与实际楼层。 |
| `ForumSpacePane` 15 条末页规则 | 修复非空短末页仍出现“下一页”的问题。 |
| `ForumSpacePane` 查看原页、刷新资料 | 恢复查看原页入口，刷新仍分别更新资料和当前栏目。 |
| `ForumSpacePane` 本人账号设置、资料编辑 | 恢复账号设置入口，接入现有 Windows 会话设置；简介、签名和 README 编辑仍使用既有官方写入路径与冲突检查。 |
| `ForumUserCard` 轻资料卡、刷新、失败重试、完整主页和私信 | 新增 `UserProfileCard`，根界面已接到作者名和头像；显示头像、UID、等级/身份、主题/回复/粉丝、注册时间、简介。刷新失败保留已有资料；异步结果按用户和账号版本隔离。 |
| `ForumUserCard` 加载、失败和关闭行为 | 保留加载/错误提示、重试、关闭按钮及 Modal 的空白关闭/Escape 行为。自私信及未登录私信入口禁用。 |
| `ProfileIntroductionEditor` 保存与重新读取 | 保留已有保存逻辑，并刷新资料；补充切换用户后迟到关注/保存响应隔离。真实账号写入未在本轮执行。 |
| 原版主题编辑只修改真实可保存的字段 | Windows 编辑模式不再显示不会被保存的版块/等级选择器，保留标题/正文。新帖的版块与阅读限制仍可选。 |
| Windows 编辑器模式设置 | 新帖编辑器不再写死 `split`，使用保存的 `composerMode`。 |

## 已执行验证

- `tests/profile-space.test.ts` 与 `tests/parity-forum.test.ts` 合计 **19 项通过**。覆盖参数边界、原始楼主时间、惰性解析、外站/错误帖子拒绝、部分失败、账号变化、注册文本、角色去重、等级/统计 0、年月日与秒数、短末页。
- Renderer TypeScript 检查通过。
- `node scripts/profile-space-smoke.cjs` 已实跑 **7 组通过**：默认概况/README及账号设置最终面板、列表先于日期、4+2 分批及失败仅补缺失日期、轻资料卡及刷新失败旧资料、注册/角色/统计跳转及私有目录、离开后的迟到结果、无 renderer 异常。
- 轻资料卡已检查暗色、亮色与 860px 窄窗口；无页面横向溢出。图片与报告位于忽略目录 `windows/verification/profile-space/`。
- 所有论坛写入均由测试桩拦截；账号和私有数据为合成数据，使用独立临时测试会话。

## 最终构建复验

7 组 smoke 通过后，视觉检查发现概况的只读 README 仍露出 disabled Markdown 编辑器工具栏和 footer。已将独立 `ProfileOverview` 组件改成经过同一 Markdown 清洗器处理的只读文章，并保留可点击链接；此调整已纳入主任务最终构建，个人空间 7 组 smoke 再次通过。

本记录不代表站点所有登录接口已用真实账号验证。本轮未提交真实回复、私信、资料修改、关注操作，也未打包、安装、发布或上传。
