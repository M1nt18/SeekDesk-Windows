# SeekDesk Windows 0.1.0

完整介绍、界面截图和使用方式请看仓库首页 [README](README.md)。

Electron + React + TypeScript 源码在 [windows/](windows/)，原 macOS Swift 源码作为移植参考保留。

在仓库根目录使用 cmd.exe：

```bat
cd windows
npm ci
npm run build
npm start
```

安装包、免安装版、对应源码和 SHA-256 校验见 [0.1.0 发布页](https://github.com/M1nt18/SeekDesk-Windows/releases/tag/v0.1.0)。版本以 `windows/package.json` 为准；根目录 `VERSION`、`BUILD_NUMBER` 是保留的 macOS 参考构建元数据。

开发与测试见 [Windows 开发说明](windows/README.md)，功能及验证边界见 [功能对照](windows/docs/FEATURE-PARITY.md) 和 [验收记录](windows/docs/VERIFICATION-CURRENT.md)。
