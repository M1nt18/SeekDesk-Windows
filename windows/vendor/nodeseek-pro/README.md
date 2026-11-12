# NodeSeek Pro 1.0.8

原作者：Woodll。原版来源：https://greasyfork.org/scripts/567109-nodeseek-pro

脚本固定为 1.0.8；GPL-3.0-only。`nodeseek-pro.user.js` 保留原始源码。依赖固定 Layui 2.10.3（MIT）与 highlight.js 11.9.0（BSD-3-Clause）。文件摘要与下载来源见 manifest.json。

宿主兼容层在 electron/userscripts.ts；没有修改原版源文件，运行时仅为 addStyle 的 URL 检测增加本地 data:text/css 支持（详见 docs/NODESEEK-PRO.md）。`layui-dark.css` 是本地 GPL 兼容主题，替代原版运行时链接的外部暗色主题。自动签到的初次配置设为关闭；只有用户在脚本设置主动开启后才允许脚本签到。运行范围仅主窗口内官方 NodeSeek 页面，不运行于 React 界面或后台读取页。
