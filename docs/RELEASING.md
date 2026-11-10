# 构建与发行

## 版本

`VERSION` 是三段版本号，`BUILD_NUMBER` 是递增的内部构建号。当前为 1.0.0 / 70。`Distribution/Info.plist` 保持相同默认值；打包时脚本使用版本文件，亦允许通过 `SEEKDESK_VERSION`、`SEEKDESK_BUILD` 显式覆盖。

## 检查与打包

```sh
./scripts/test.sh
bash scripts/test-regressions.sh
swift build --arch arm64 -c release
./scripts/build.sh unsigned
```

`unsigned` 使用临时 ad hoc 签名维持包结构完整性，文件名包含 `-unsigned`，不代表 Developer ID 签名或 Apple 公证。V1.0.0 采用此模式。`preview` 使用相同本地签名方式，文件名包含 `-preview`，用于开发验证。

所有模式都校验应用签名结构、创建并验证 DMG，再写入 `dist/` 和配套 SHA-256 校验文件。仅在完整打包验证通过后替换原有 app。公开发行上传最终 DMG 和校验文件到同一版本的 GitHub Release。

## Developer ID 签名和 Apple 公证

准备 Apple Developer Program 会员、安装在钥匙串中的 Developer ID Application 证书及私钥，并用 `notarytool store-credentials` 在钥匙串中配置公证 profile。请交互输入凭据，不把私钥、密码、API key 或证书导出包写进仓库。

```sh
export SEEKDESK_SIGN_IDENTITY='Developer ID Application: YOUR NAME (TEAMID)'
export SEEKDESK_NOTARY_PROFILE='SeekDesk-notary'
./scripts/build.sh release
```

此模式为内嵌可执行组件逐个签名，启用 Hardened Runtime 与安全时间戳，提交 DMG 公证，附加票据并执行校验。手动更新的公证版不要求配置 Sparkle feed。发布前还应验证下载后的首次打开、应用替换、会话和本机数据恢复。

## 可选的应用内自动更新

配置 `SEEKDESK_FEED_URL`（HTTPS）及 `SEEKDESK_UPDATE_PUBLIC_KEY`（32 字节 Ed25519 公钥的 Base64）后，`release` 模式启用 Sparkle。私钥保存在发行环境，使用 Sparkle 的 `generate_appcast` 为最终产物生成签名更新源，验证从旧版到新版的完整升级后再公开 feed。

V1.0.0 没有生产 appcast 或更新签名配置，使用 GitHub Releases 手动更新。

参考：[Apple Developer ID](https://developer.apple.com/developer-id/)、[Apple 公证](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)、[Sparkle 发行](https://sparkle-project.org/documentation/publishing/)。
