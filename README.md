<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png">
    <img src="assets/logo-light.png" alt="SeekDesk Logo" width="440">
  </picture>
</p>

<h1 align="center">SeekDesk</h1>

<p align="center"><strong>在 Mac 上，舒服地逛 NodeSeek。</strong></p>
<p align="center">为阅读、交流与日常逛坛打造的 macOS 原生第三方客户端。</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-161b22?logo=apple&amp;logoColor=white" alt="平台：macOS">
  <img src="https://img.shields.io/badge/architecture-Apple%20Silicon-007AFF" alt="架构：Apple Silicon">
  <img src="https://img.shields.io/badge/built%20with-Swift%20%2B%20SwiftUI-F05138?logo=swift&amp;logoColor=white" alt="使用 Swift 和 SwiftUI 构建">
  <img src="https://img.shields.io/badge/status-in%20development-D69A22" alt="状态：开发中">
</p>

<p align="center">
  <a href="https://seekdesk.com/">官网（建设中）</a> ·
  <a href="https://github.com/cshaizhihao/SeekDesk">GitHub</a> ·
  <a href="https://github.com/cshaizhihao/SeekDesk/issues">反馈问题</a> ·
  <a href="https://www.nodeseek.com/">NodeSeek 社区</a>
</p>

> **当前发布状态**：本仓库先公开 README、Logo 与真实应用截图。应用仍在进行全局审查和问题修复，源码、安装包与 Release 暂未发布。下文展示的是当前本地预览版已经实现的功能；源码计划采用 **GPL-3.0-only**，待修复完成后再正式公开。

## 简介

SeekDesk 把 NodeSeek 的帖子列表、阅读、写作、通知和常用工具整合进一个 Mac 工作区。宽窗口下可以边看列表边读正文，收起列表后专注阅读；多篇帖子放在独立标签里，随时切换，也能用熟悉的键盘操作完成浏览。

界面使用 SwiftUI 与 AppKit 构建，围绕桌面上的阅读习惯重新组织布局，提供原生帖子列表、楼层阅读、账户入口和扩展管理。官方登录及部分站点交互使用 WebKit，与 NodeSeek 自身的账号和权限体系衔接。

**作者：NodeSeek @cshaizhihao** · GitHub：[@cshaizhihao](https://github.com/cshaizhihao)

SeekDesk 是独立开发的第三方客户端，与 NodeSeek 官方没有隶属关系。帖子内容、账号权限和社区规则均以 [NodeSeek](https://www.nodeseek.com/) 为准。

## 应用预览

以下均为本地预览版的真实运行截图。论坛内容与界面细节会随开发进度变化。

### 多栏阅读，随时切换

侧栏导航、帖子列表和阅读区各有位置；热榜和正在阅读的帖子可以同时查看。

![SeekDesk 深色模式：侧栏热榜、帖子列表与原生阅读区](assets/reading-dark.jpg)

### 一边写，一边看效果

独立写作区提供 Markdown 格式工具、版块与阅读权限选择，以及正文和预览的并排显示。

![SeekDesk 写作区：Markdown 编辑与实时预览](assets/writing-dark.jpg)

<details>
<summary><strong>展开查看：扩展中心与六色外观</strong></summary>

按需要添加、启用、停用或移除内置工具。

![SeekDesk 扩展中心：八种内置扩展](assets/extensions-dark.jpg)

白天、黑夜或跟随系统；六种 Logo 配色与运行中的 Dock 图标联动。

![SeekDesk 外观设置：主题和六种 Logo 配色](assets/appearance-dark.jpg)

</details>

## 功能介绍

### 浏览与阅读

- **原生帖子列表**：最新帖子、最新回复、版块筛选、精品区、刷新与分页；首页列表不可用时可回退读取公开 RSS。
- **独立帖子标签**：点击打开、⌘ 点击后台打开、拖动排序、关闭当前标签和关闭全部；返回总览后保留已打开标签。
- **自适应布局**：宽窗口显示多栏，窄窗口切换到阅读区；侧栏与列表宽度可调整，也可以收起帖子列表。
- **楼层阅读**：显示头像、等级、角色、签名、楼层和分页；支持表格、图片放大，以及回复、引用和楼层定位。
- **NQ / TQ 报告**：彩色终端报告与测评图片有专门的展示方式，缩放独立记忆；NQ 长报告按宽度展开。相关长图与超长报告的边界问题仍在修复。
- **搜索帖子与用户**：可选多个版块、保留最近搜索，也可粘贴 NodeSeek 帖子链接直接打开；历史搜索需要相应登录权限。

### 写作与互动

- **Markdown 编辑器**：发帖、回复和私信共用格式工具，支持编辑、对照和预览模式；编辑区高度可拖动调整。
- **图片与表情**：本地选图、剪贴板图片上传、NodeSeek 官方表情，以及可分组导入的本机表情；支持调整普通图片的发送尺寸。
- **帖子互动**：回复、引用、点赞、送鸡腿、点踩，以及编辑自己有权修改的主题和评论；操作权限由 NodeSeek 校验。
- **个人空间**：查看主题、评论、粉丝和关注，编辑自己的个人 README 与帖子签名。
- **通知与私信**：查看 @我、主题回复和私信，跳转对应帖子或楼层；可按 UID 或个人主页链接打开私信会话。

### 外观与阅读设置

- 白天、黑夜与跟随系统；在支持的系统上使用 macOS Liquid Glass。
- 六种品牌配色：原版钴蓝、海松青、蕨叶绿、鸢尾紫、琥珀橙、珊瑚红。
- 帖子列表、正文、作者栏、侧栏版块和热榜均可调整阅读尺寸，并提供实时预览。
- 从设置、扩展中心或个人页面返回原帖，继续阅读；动效遵循系统的“减少动态效果”设置。

## 扩展中心

目前提供八种内置扩展，可按需启用。扩展中心管理的是应用内置工具，尚不提供通用第三方插件加载接口。

| 扩展 | 能做什么 | 使用条件 |
| --- | --- | --- |
| NodeSeek 热榜 | 实时榜、日榜、周榜；侧栏前十名与完整榜单 | 使用社区公开热榜服务 |
| 每日签到 | 固定或运气签到，可设置北京时间零点自动签到 | 已登录，应用保持运行，站点允许操作 |
| 摸鱼老板键 | 将论坛窗口切换为工作表外观，支持自定义快捷键 | 在扩展设置中配置 |
| 剩余价值计算器 | 按续费周期和剩余天数估价，换算币种并对比挂价 | 汇率可在线获取，也可手动输入 |
| 屏蔽用户 | 折叠指定用户正文和回复，保留楼层位置，可临时展开或解除 | 本机配置 |
| 只看楼主 | 聚焦主题作者的正文与回复 | 在帖子阅读时使用 |
| 关键词监控 | 运行期间约每 10 秒检查 RSS，命中后弹窗，可启用系统通知 | 受公开 RSS 范围、网络状态和通知授权影响 |
| 管理记录查询 | 从作者旁查询社区管理记录并查看来源帖子 | 使用 NS Seek 社区服务 |

关键词监控支持多组规则，用逗号分组、用 `+` 连接同组必含词。例如：

```text
香港+VPS, 日本+软银, 优惠
```

表示匹配“同时包含香港和 VPS”，或“同时包含日本和软银”，或“包含优惠”的公开订阅内容。

## 使用方式

### 获取应用

目前处于开发和审查阶段，**尚无公开安装包**。后续下载和版本说明将统一放在本仓库的 [Releases](https://github.com/cshaizhihao/SeekDesk/releases)；正式发布后，再补充对应版本的安装与校验说明。

首版面向 **Apple Silicon Mac**，项目设定的系统目标是 **macOS 14 及以上**。当前预览主要在 Apple Silicon 的新版 macOS 环境验证，旧系统兼容性仍在核对；Liquid Glass 效果需要 macOS 26 及以上。Intel Mac、Windows 和 Linux 暂未提供发行版。

### 基本流程

1. 从“最新帖子”或“论坛版块”开始浏览，点击帖子进入阅读；用“返回总览”回到列表。
2. 点击右上角账户图标，在应用内打开 **NodeSeek 官方登录页**。登录后的读取与互动仍受站点等级、阅读权限和账号状态限制。
3. 点击“＋ 发帖”进入写作区，选择版块和阅读权限；在帖子底部回复，或用楼层上的入口引用内容。
4. 上传图片时，在编辑器的图床设置中配置自己的 [NodeImage](https://www.nodeimage.com/) 密钥。密钥保存在 macOS 钥匙串；本机导入的自定义表情在插入时才上传。
5. 在“设置 → 阅读”中调整字号、作者栏与报告缩放；在“设置 → 外观”中选择主题和 Logo 配色。
6. 在“扩展中心”添加需要的工具。关键词监控、自动签到等任务依赖客户端运行，退出应用后不会继续执行。

### 常用快捷键

| 操作 | 快捷键 |
| --- | --- |
| 搜索或打开 NodeSeek 帖子链接 | `⌘ K` |
| 刷新帖子列表 | `⌘ R` |
| 列表中选择上一帖 / 下一帖 | `↑` / `↓` |
| 打开选中的帖子 | `Return` |
| 在后台打开帖子 | `⌘ Return` 或 `⌘ 点击` |
| 关闭当前帖子标签 | `⌘ W` |
| 切换到下一个 / 上一个标签 | `⌃ Tab` / `⌃ ⇧ Tab` |
| 返回列表或关闭当前搜索面板 | `Esc`，视当前位置而定 |
| 打开设置 | `⌘ ,` |

发送回复的快捷键可在设置中选择。`⌘` 为 Command，`⌃` 为 Control，`⇧` 为 Shift。

## 和网页版的区别

SeekDesk 与 NodeSeek 网页版使用同一个社区和账号体系，重点在于桌面阅读布局与日常操作方式。

| 对比项 | SeekDesk | NodeSeek 网页版 |
| --- | --- | --- |
| 使用环境 | 面向 Apple Silicon 的 macOS 应用 | 支持现代浏览器的设备 |
| 界面组织 | SwiftUI / AppKit 原生列表、阅读区与工具栏，部分交互使用 WebKit | 站点网页与浏览器界面 |
| 多帖阅读 | 应用内独立标签、后台打开、可收起列表和分栏 | 通过站点页面与浏览器标签浏览 |
| 写作体验 | 集成 Markdown 工具与并排预览，发帖、回复和私信操作统一 | 使用站点提供的编辑器 |
| 阅读定制 | 独立调整列表、正文、作者栏与 NQ / TQ 报告缩放 | 使用站点选项及浏览器缩放 |
| 常用工具 | 内置热榜、估价、签到、关键词监控等扩展 | 使用站点功能，也可自行搭配浏览器脚本或扩展 |
| 功能与兼容性 | 覆盖常用浏览和互动流程；站点变化可能需要客户端跟进 | 直接使用站点最新提供的完整页面 |
| 登录与权限 | 通过官方登录页建立会话，遵循站点权限 | 直接在站点登录并遵循相同权限 |

公开 RSS 仅用于部分订阅读取与监控，不提供受限帖访问能力。客户端也不提供完整离线论坛功能。遇到暂未覆盖的页面或兼容性问题，可以回到网页版操作。

## 技术栈

| 层面 | 当前实现 |
| --- | --- |
| 主要语言 | Swift；Swift Package 清单工具版本为 5.10 |
| 桌面界面 | SwiftUI、AppKit；按系统版本适配 Liquid Glass 与原生材质 |
| 登录与网页交互 | WebKit / WKWebView |
| 网络与内容 | Foundation、URLSession、站点页面解析与公开 RSS |
| 正文与编辑 | 原生内容块、Markdown 编辑与 WebKit 预览、ANSI 彩色终端报告展示 |
| 本机存储 | UserDefaults；NodeImage 密钥使用 Security / Keychain |
| 系统通知 | UserNotifications |
| 构建与打包 | Swift Package Manager、Shell 构建脚本、macOS 应用与 DMG 打包 |
| 应用更新 | Sparkle 2.10.1；正式发行需另行配置签名、公证和更新源 |

源码正式公开后，会同步补充可复现的构建步骤、测试说明和目录结构。当前仓库不包含可用于本地编译的完整工程。

## 开源与授权

- **源码计划许可：GPL-3.0-only**。本地工程已选择这一许可；正式公开时会一并提交源码、`LICENSE` 与构建说明。许可全文可查阅 [GNU GPL v3](https://www.gnu.org/licenses/gpl-3.0.html)。
- **当前公开范围：项目说明、Logo 与应用截图**。源码、安装包和正式版本尚未发布；本仓库当前不是完整的源码发行包。
- **图片与第三方内容**：Logo、品牌素材、截图中的论坛内容及合作伙伴标识不因源码的许可计划而自动获得相同授权。相关权利归各自权利人，另行使用时请遵循对应授权。
- **第三方组件**：应用集成 [Sparkle](https://sparkle-project.org/)，使用其独立许可；源码发布时会保留相应第三方许可说明。

## 反馈与参与

欢迎通过 [GitHub Issues](https://github.com/cshaizhihao/SeekDesk/issues) 提交问题或建议。报告问题时，请尽量提供 macOS 版本、设备架构、应用版本、复现步骤，以及便于定位的截图或公开帖子链接。请隐藏私信、Cookie、密钥和其他个人信息。

当前优先完成会话与草稿隔离、请求状态、私信未读计算、长图和报告渲染等问题的修复与验证，再推进源码和安装包发布。

官网地址为 **[seekdesk.com](https://seekdesk.com/)**，目前正在建设。NodeSeek 项目介绍帖将在发布后补充。

## 社区项目与致谢

感谢 NodeSeek 社区及以下项目提供的内容与工具支持：

- **NodeSeek 热榜**：[@小号](https://www.nodeseek.com/space/10539) 的 [热榜项目](https://greasyfork.org/scripts/560065)，客户端使用其公开榜单服务。
- **管理记录查询**：@slugger 的 [原脚本](https://greasyfork.org/scripts/567915) 与 [NS Seek 后端](https://github.com/theslugger/ns-seek)，以及 @sss1231 的 [北京时间修正说明](https://www.nodeseek.com/post-870735-1)。
- **NodeImage**：[图片托管服务](https://www.nodeimage.com/)，供用户自行配置图床密钥。
- **Sparkle**：[macOS 应用更新框架](https://sparkle-project.org/)。

以上服务由各自维护者运营，数据可用性和使用规则以对应项目为准。

## 友情链接

感谢以下伙伴对本项目的支持，排名不分先后。

| 伙伴 | 简介 | 访问 |
| --- | --- | --- |
| <img src="assets/partner-impart.png" width="48" alt="Impart Logo"><br>**Impart** | 全球自建家宽测速，VPS与IDC、银行卡、电话卡交流与优惠。 | [Telegram 群组](https://t.me/Impart_Cloud) |
| <img src="assets/partner-shlii.png" width="48" alt="Shlii Logo"><br>**Shlii** | 高性价比的 VPS、NAT 平台 | [官网](https://shlii.io/) · [Telegram 群组](https://t.me/IncuShliidlb) |
| <img src="assets/partner-pickmyvps.png" width="48" alt="PickMyVPS Logo"><br>**PickMyVPS** | 自购 400+ 台热门线路 / 落地机探针站 | [官网](https://www.pickmyvps.com/) · [Telegram 群组](https://t.me/PickMyVPS_Group) |

---

<p align="center">SeekDesk · 由 NodeSeek @cshaizhihao 开发</p>
