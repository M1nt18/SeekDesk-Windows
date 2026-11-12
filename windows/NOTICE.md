# SeekDesk Windows 0.1.0

本目录是 SeekDesk 的独立 Windows 重写版本，使用 Electron、React、TypeScript；上游 macOS Swift 源码保持在父目录。

上游：https://github.com/cshaizhihao/SeekDesk
参考版本：84e99c6cb24e66c5bbccb6382380ae72b9924d4b
上游作者：NodeSeek @cshaizhihao / GitHub @cshaizhihao
许可：GPL-3.0-only（父目录 LICENSE）。本 Windows 改写遵循同一许可，发行时请提供完整对应源码与本声明。

Windows 修改：重新实现桌面窗口、隔离会话与 IPC、公开 RSS 解析、网页读取桥接、React 多栏多标签阅读及设置、NSIS 安装程序。论坛 DOM 提取逻辑参考上游 ForumListing、ForumThread 和 ForumAccountData。

SeekDesk 为独立第三方客户端，与 NodeSeek 官方没有隶属关系。网站内容、商标及用户发布的内容归各自权利人所有。登录和受限操作通过 NodeSeek 官方页面完成。

React / React DOM：MIT；Electron：MIT，包含 Chromium 和 Node.js 的独立许可；Lucide：ISC；fast-xml-parser：MIT；sanitize-html：MIT。依赖的完整许可见各发行依赖及 Electron 的 LICENSE、LICENSES.chromium.html。

本轮源码另使用 markdown-it（MIT）、DOMPurify（Apache-2.0 OR MPL-2.0）、decimal.js（MIT）、sharp（Apache-2.0，所用 libvips 及二进制依赖许可见安装包内的 THIRD-PARTY-NOTICES）。榜单数据来自 api.bimg.eu.org；管理记录来自 api.xxboxx.de 的 NS Seek 服务；汇率来自 Live-Rates 与 ExchangeRate.fun；图片上传由用户自行配置的 NodeImage 服务提供。六色任务栏图标由上游品牌资源生成，权利归相应作者。

在线更新使用 electron-updater（MIT），仅访问本项目公开稳定版仓库，不携带维护者令牌或论坛登录 Cookie。依赖许可随对应源代码与安装载荷保留。

本地生成的 Windows 安装程序尚未进行代码签名。

Windows 版另集成 Woodll 的 Nodeseek Pro 1.0.8（GreasyFork 567109，GPL-3.0-only），仅在内嵌官方网页的隔离世界运行。固定资源包括 Layui 2.10.3（MIT）和 highlight.js 11.9.0（BSD-3-Clause）；原脚本、依赖许可、来源和 SHA-256 见 vendor/nodeseek-pro/。原脚本源文件保持原样，宿主的资源/视口适配记录见 docs/NODESEEK-PRO.md。
