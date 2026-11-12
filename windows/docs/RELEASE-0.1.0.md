# SeekDesk Windows 0.1.0

首个 Windows 版本，基于 SeekDesk V1.0.0 移植，使用 Electron + React + TypeScript。保留原版导航与多栏阅读组织，支持发帖、完整回复、个人空间、通知私信、Markdown、图床与表情、按账号草稿、ANSI/NQ/TQ 报告和八项内置扩展。

**0.1.0 下载文件已重新打包。** 版本和标签保持不变，安装版、免安装版与配套源码均已更新。早前下载的 0.1.0 旧包没有更新器，同版本也不会自动升级，请重新下载并手动安装一次；之后安装版可在线更新到更高版本。

## 下载应用

- **安装版**：`SeekDesk-Windows-0.1.0-x64-Setup.exe`，运行并选择安装位置。
- **免安装版**：`SeekDesk-Windows-0.1.0-x64-portable.zip`，完整解压后运行 `SeekDesk Windows.exe`。
- **配套源码**：`SeekDesk-Windows-0.1.0-source.zip`，从此次构建提交的已跟踪文件生成，用于复现本次打包。
- **校验文件**：`SHA256SUMS.txt`。可用 `certutil -hashfile 文件名 SHA256` 核对。
- **更新清单**：`latest.yml`，为安装版更新器提供配套安装程序地址、版本和 SHA-512 校验信息；后续稳定发布需一并提供。

Windows 10 / 11 x64，无需另外安装 Node.js。当前首版未做 Windows 代码签名，可能显示未知发布者。

安装载荷、实际 ASAR、依赖与全新配置启动均已检查。不包含维护者的登录会话、Cookie、草稿、API Key、测试目录、调试日志或本机源码映射。

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

- 点击窗口右上角 X 可选择最小化到托盘、退出或取消，并可记住选择；窗口尺寸、位置与最大化状态自动恢复。
- NSIS 安装器提供默认勾选的桌面、开始菜单快捷方式选项，普通重装可修复缺失图标。
- 安装版检查本仓库 GitHub 稳定发布，支持更新校验、取消下载、重启续装及应用更新缓存清理，由用户确认安装。
- 热评/获鸡腿回复优先显示，跨页热门楼层保留 HOT 角标；回复编辑器右上角 X 收起编辑器并保留草稿。

- 三栏与多标签阅读，标签排序、后台打开、栏宽调整与阅读位置恢复。
- 默认收起的回复编辑器，独立回复/引用；发布后按官方返回跳转新楼层，有限重试仅重新读取，不重复提交。
- 原版侧栏、顶部账号/通知、四类设置、六色品牌和独立阅读字号。
- 完整 Markdown 工具、图片处理、官方及分组本机表情、每账号草稿。
- 热榜、签到、老板键、屏蔽、只看楼主、关键词、管理记录。
- 可选 Nodeseek Pro 1.0.8 官方网页集成。

## 验证范围

129 项单元/契约测试及相关 Electron 桌面界面回归通过，源码提交 `166c3c0` 的 Windows 源码 CI 通过。安装器经过静态载荷检查和 NSIS 模板编译，更新链路通过隔离适配器测试，未执行真实安装或升级。公开读取与计算器此前已实际联网验证；论坛写操作和图片上传使用隔离替身，真实账号权限仍需用户通过客户端内官方页面登录后验收。

开发版与免安装版提供手动下载入口；在线安装仅适用于安装版。站点验证、论坛权限和第三方服务可用性以各服务为准。

完整介绍和截图见 [项目 README](https://github.com/M1nt18/SeekDesk-Windows#readme)，更新记录见 [CHANGELOG](https://github.com/M1nt18/SeekDesk-Windows/blob/main/CHANGELOG.md)。

原版作者：[@cshaizhihao](https://github.com/cshaizhihao)。Windows 移植维护：[@M1nt18](https://github.com/M1nt18)。源码许可：GPL-3.0-only。
