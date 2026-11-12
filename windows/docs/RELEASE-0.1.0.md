# SeekDesk Windows 0.1.0

首个 Windows 源码版本，基于 SeekDesk V1.0.0 移植，使用 Electron + React + TypeScript。保留原版导航与多栏阅读组织，支持发帖、完整回复、个人空间、通知私信、Markdown、图床与表情、按账号草稿、ANSI/NQ/TQ 报告和八项内置扩展。

本次发布源码，**不附带这次修订对应的 Windows 安装包**。

## 从源码运行

Windows 10 / 11 x64，Node.js 22.12+：

```bat
git clone https://github.com/M1nt18/SeekDesk-Windows.git
cd SeekDesk-Windows\windows
npm ci
npm run build
npm start
```

## 本版重点

- 三栏与多标签阅读，标签排序、后台打开、栏宽调整与阅读位置恢复。
- 默认收起的回复编辑器，独立回复/引用；发布后按官方返回跳转新楼层，有限重试仅重新读取，不重复提交。
- 原版侧栏、顶部账号/通知、四类设置、六色品牌和独立阅读字号。
- 完整 Markdown 工具、图片处理、官方及分组本机表情、每账号草稿。
- 热榜、签到、老板键、屏蔽、只看楼主、关键词、管理记录，以及独立内嵌的 sy.3xme.com 计算器。
- 可选 Nodeseek Pro 1.0.8 官方网页集成。

## 验证范围

80 项单元/契约测试及真实 Electron 的界面、会话、阅读器和回复刷新回归通过。公开读取与计算器已实际联网验证；论坛写操作和图片上传使用隔离替身，真实账号权限仍需用户通过客户端内官方页面登录后验收。

当前没有应用内自动更新。站点验证、论坛权限和第三方服务可用性以各服务为准。

完整介绍和截图见 [项目 README](https://github.com/M1nt18/SeekDesk-Windows#readme)，更新记录见 [CHANGELOG](https://github.com/M1nt18/SeekDesk-Windows/blob/main/CHANGELOG.md)。

原版作者：[@cshaizhihao](https://github.com/cshaizhihao)。Windows 移植维护：[@M1nt18](https://github.com/M1nt18)。源码许可：GPL-3.0-only。
