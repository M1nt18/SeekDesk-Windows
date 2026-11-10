import Foundation

enum AppInformation {
    static let website = URL(string: "https://www.seekdesk.cc/")!
    static let repository = URL(string: "https://github.com/cshaizhihao/SeekDesk")!
    static let releases = repository.appendingPathComponent("releases")
    static let issues = repository.appendingPathComponent("issues")
    static let license = repository.appendingPathComponent("blob/main/LICENSE")
    static let acknowledgements = repository.appendingPathComponent("blob/main/THIRD_PARTY_NOTICES.md")
    static let disclaimer = "SeekDesk 是独立开发的第三方客户端，与 NodeSeek 官方没有隶属关系。帖子内容、账号权限和社区规则均以 [NodeSeek](https://www.nodeseek.com/) 为准。"

    static var versionDescription: String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        guard let version else { return "开发构建" }
        if let build { return "V\(version)（构建 \(build)）" }
        return "V\(version)"
    }
}
