import AppKit
import ImageIO
import Security
import SwiftUI
import UniformTypeIdentifiers

enum NodeImageKey {
    private static let query = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "com.seekdesk.client.nodeimage",
        kSecAttrAccount as String: "api-key"
    ] as [String: Any]

    static func read() throws -> String? {
        var options = query
        options[kSecReturnData as String] = true
        options[kSecMatchLimit as String] = kSecMatchLimitOne
        var data: CFTypeRef?
        let status = SecItemCopyMatching(options as CFDictionary, &data)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = data as? Data else { throw NodeImageError.keychain }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ key: String) throws {
        let data = Data(key.utf8)
        let update = [kSecValueData as String: data] as CFDictionary
        let status = SecItemUpdate(query as CFDictionary, update)
        if status == errSecSuccess { return }
        guard status == errSecItemNotFound else { throw NodeImageError.keychain }
        var attributes = query
        attributes[kSecValueData as String] = data
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else { throw NodeImageError.keychain }
    }

    static func remove() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw NodeImageError.keychain }
    }
}

enum NodeImageError: LocalizedError {
    case keychain, missingKey, invalidFile, invalidKey, rejected, connection
    case unreadableOriginal, animatedImage

    var errorDescription: String? {
        switch self {
        case .keychain: "无法访问钥匙串，请检查 macOS 提示。"
        case .missingKey: "请在「上传图片」中配置 NodeImage 密钥，或将图片调回 100%。"
        case .invalidFile: "请选择不超过 100 MB 的图片。"
        case .invalidKey: "NodeImage 拒绝了密钥，请检查图床设置。"
        case .rejected: "NodeImage 未返回可用的图片链接，请检查格式和上传额度。"
        case .connection: "无法连接 NodeImage，请稍后重试。"
        case .unreadableOriginal: "无法读取或缩小原图，请检查图片链接。"
        case .animatedImage: "暂不支持缩小动图。请调回 100% 以保留动画。"
        }
    }
}

struct MarkdownImageScale: Hashable, Codable, Sendable {
    static let maximumWidth = 1080
    static let maximumEdge = 3600
    let ratio: Double
    private let previewWidth: Int

    init(ratio: Double, previewWidth: Double) {
        self.ratio = min(1, max(0.1, ratio))
        self.previewWidth = Int(min(Double(Self.maximumWidth), max(1, previewWidth)).rounded())
    }

    func width(for sourceWidth: Int) -> Int {
        max(1, Int((Double(min(sourceWidth, previewWidth)) * ratio).rounded()))
    }
}

enum NodeImageUpload {
    static let endpoint = URL(string: "https://api.nodeimage.com/api/upload")!
    static let website = URL(string: "https://www.nodeimage.com/")!
    static let sizeLimit = 100 * 1024 * 1024

    struct Picture {
        let data: Data
        let name: String
        let mime: String

        static func file(_ url: URL) throws -> Self {
            let resources = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentTypeKey])
            guard resources.isRegularFile == true, let size = resources.fileSize, size > 0, size <= sizeLimit,
                  let type = resources.contentType, type.conforms(to: .image), let mime = type.preferredMIMEType else {
                throw NodeImageError.invalidFile
            }
            let ext = type.preferredFilenameExtension ?? "img"
            return Picture(data: try Data(contentsOf: url, options: .mappedIfSafe), name: "image.\(ext)", mime: mime)
        }
    }

    static func multipart(_ picture: Picture, key: String, boundary: String) -> (URLRequest, Data) {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue(key, forHTTPHeaderField: "X-API-Key")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        var body = Data(("--\(boundary)\r\n" +
            "Content-Disposition: form-data; name=\"image\"; filename=\"\(picture.name)\"\r\n" +
            "Content-Type: \(picture.mime)\r\n\r\n").utf8)
        body.append(picture.data)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        return (request, body)
    }

    static func link(from data: Data) throws -> URL {
        struct Response: Decodable {
            struct Links: Decodable { let direct: URL? }
            let success: Bool
            let links: Links?
        }
        guard let response = try? JSONDecoder().decode(Response.self, from: data),
              response.success, let url = response.links?.direct,
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else {
            throw NodeImageError.rejected
        }
        return url
    }

    static func upload(_ picture: Picture, key: String) async throws -> URL {
        guard !picture.data.isEmpty, picture.data.count <= sizeLimit else { throw NodeImageError.invalidFile }
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.timeoutIntervalForResource = 90
        let session = URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        let (request, body) = multipart(picture, key: key, boundary: "SeekDesk-\(UUID().uuidString)")
        let (data, response) = try await session.upload(for: request, from: body)
        guard let http = response as? HTTPURLResponse, http.url == endpoint else { throw NodeImageError.connection }
        if http.statusCode == 401 || http.statusCode == 403 { throw NodeImageError.invalidKey }
        guard (200..<300).contains(http.statusCode) else { throw NodeImageError.rejected }
        return try link(from: data)
    }

    static func resizedPicture(from url: URL, scale: MarkdownImageScale) async throws -> Picture {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForResource = 30
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: url)
        request.setValue(Forum.home.absoluteString, forHTTPHeaderField: "Referer")
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        let (file, response) = try await session.download(for: request)
        defer { try? FileManager.default.removeItem(at: file) }
        try Task.checkCancellation()
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              http.url?.scheme == "https", (1...sizeLimit).contains(size) else { throw NodeImageError.unreadableOriginal }
        return try resizedPicture(file: file, scale: scale)
    }

    static func resizedPicture(file: URL, scale: MarkdownImageScale) throws -> Picture {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              let storedWidth = info[kCGImagePropertyPixelWidth as String] as? Int,
              let storedHeight = info[kCGImagePropertyPixelHeight as String] as? Int,
              storedWidth > 0, storedHeight > 0 else { throw NodeImageError.unreadableOriginal }
        guard CGImageSourceGetCount(source) == 1 else { throw NodeImageError.animatedImage }
        let orientation = info[kCGImagePropertyOrientation as String] as? Int ?? 1
        let width = (5...8).contains(orientation) ? storedHeight : storedWidth
        let longest = max(storedWidth, storedHeight)
        let targetWidth = scale.width(for: width)
        let desired = Double(targetWidth) / Double(width)
        let budget = sqrt(24_000_000 / Double(storedWidth) / Double(storedHeight))
        let targetEdge = Int((Double(longest) * min(desired, budget)).rounded(.down))
        guard let bitmap = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, targetEdge)
        ] as CFDictionary) else { throw NodeImageError.unreadableOriginal }

        let jpeg = CGImageSourceGetType(source) as String? == UTType.jpeg.identifier
        let type = jpeg ? UTType.jpeg : UTType.png
        let bytes = NSMutableData()
        guard let output = CGImageDestinationCreateWithData(bytes, type.identifier as CFString, 1, nil) else {
            throw NodeImageError.unreadableOriginal
        }
        let options = jpeg ? [kCGImageDestinationLossyCompressionQuality: 0.92] as CFDictionary : nil
        CGImageDestinationAddImage(output, bitmap, options)
        guard CGImageDestinationFinalize(output) else { throw NodeImageError.unreadableOriginal }
        return Picture(data: bytes as Data, name: jpeg ? "image.jpg" : "image.png", mime: jpeg ? "image/jpeg" : "image/png")
    }

    private final class NoRedirect: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
        func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                        newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
            completionHandler(nil)
        }
    }
}

struct NodeImageSettingsView: View {
    let close: () -> Void
    @StateObject private var state = State()

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            DeskLabel("NodeImage 图床", systemImage: "photo.badge.arrow.down").font(.headline)
            Text("在 NodeImage 网站授权后，从「API」复制自己的密钥。密钥保存在此 Mac 的钥匙串。")
                .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Link("打开 NodeImage 网站", destination: NodeImageUpload.website)
            SecureField("粘贴 API 密钥", text: $state.key).textFieldStyle(.roundedBorder)
            if let message = state.message { Text(message).font(.caption).foregroundStyle(.secondary) }
            HStack {
                Button("移除已保存密钥") {
                    do { try NodeImageKey.remove(); state.key = ""; state.message = "密钥已移除。" }
                    catch { state.message = error.localizedDescription }
                }
                Spacer()
                Button("关闭", action: close).keyboardShortcut(.cancelAction)
                Button("保存") {
                    let key = state.key.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !key.isEmpty, !key.contains(where: \.isNewline) else { return }
                    do { try NodeImageKey.save(key); state.key = ""; close() }
                    catch { state.message = error.localizedDescription }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(state.key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20).frame(width: 440)
    }

    @MainActor private final class State: ObservableObject {
        @Published var key = ""
        @Published var message: String?
    }
}
