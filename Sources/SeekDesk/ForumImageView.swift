import AppKit
import ImageIO
import SwiftUI

struct ForumImageView: View {
    let url: URL
    let label: String
    let sticker: Bool
    var report = false
    var reportKind: ForumReportKind = .tq
    var thumbnail = false
    var previewSize: MarkdownImageScale? = nil
    @StateObject private var state = ImageState()

    private var bitmap: CGImage? { state.loadedURL == url ? state.bitmap : ForumImageRequest.cached(url) }

    var body: some View {
        Group {
            if let bitmap {
                if sticker {
                    image(bitmap).frame(maxWidth: thumbnail ? 68 : 60, maxHeight: thumbnail ? 68 : 54).accessibilityLabel(label)
                } else if report {
                    ForumReportPanel(naturalSize: CGSize(width: bitmap.width, height: bitmap.height), minimumWidth: 390, kind: reportKind) {
                        HStack(spacing: 8) {
                            Text("测评报告").font(.caption.weight(.semibold))
                            Spacer()
                            ForumReportScaleControls(kind: reportKind)
                            Button { state.showingPreview = true } label: {
                                DeskLabel("查看大图", systemImage: "arrow.up.left.and.arrow.down.right")
                            }
                            .font(.caption).buttonStyle(.borderless)
                        }
                        .padding(.horizontal, 10).frame(height: 35)
                    } content: { _ in
                            pictureButton(bitmap)
                    }
                    .background(.black.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
                    .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(.secondary.opacity(0.15)).allowsHitTesting(false) }
                } else if let previewSize {
                    PreviewImageWidth(maxWidth: CGFloat(previewSize.width(for: bitmap.width))) {
                        pictureButton(bitmap)
                    }
                } else {
                    pictureButton(bitmap).frame(maxWidth: min(CGFloat(MarkdownImageScale.maximumWidth), CGFloat(bitmap.width)), alignment: .leading)
                }
            } else if thumbnail {
                DeskIcon(state.failed ? "photo" : "face.smiling", size: 12).font(.caption).foregroundStyle(.tertiary)
            } else if state.failed {
                Link(destination: url) { DeskLabel("图片加载失败 · 打开图片", systemImage: "photo") }.font(.callout)
            } else {
                DeskLabel("正在加载图片", systemImage: "photo").font(.caption).foregroundStyle(.secondary).padding(.vertical, 5)
            }
        }
        .task(id: url) { await state.load(url) }
        .sheet(isPresented: $state.showingPreview) {
            if let bitmap {
                let preview = state.previewBitmap ?? bitmap
                let original = ForumImageRequest.originalSize(url) ?? CGSize(width: bitmap.width, height: bitmap.height)
                VStack(spacing: 0) {
                    HStack {
                        Text(label).font(.headline).lineLimit(1)
                        Spacer()
                        Button { state.zoom = max(0.75, state.zoom - 0.25) } label: { DeskIcon("minus.magnifyingglass") }
                            .accessibilityLabel("缩小图片").disabled(state.zoom <= 0.75)
                        Text("\(Int(state.zoom * 100))%").font(.caption.monospacedDigit()).frame(width: 39)
                        Button { state.zoom = min(3, state.zoom + 0.25) } label: { DeskIcon("plus.magnifyingglass") }
                            .accessibilityLabel("放大图片").disabled(state.zoom >= 3)
                        Toggle("原尺寸", isOn: $state.fullSize).toggleStyle(.switch).controlSize(.small)
                        Button("关闭") { state.showingPreview = false }.keyboardShortcut(.cancelAction)
                    }
                    .padding(13)
                    if state.loadingOriginal {
                        ProgressView("正在读取高清图片…").controlSize(.small).padding(8)
                    } else if state.previewFailed || CGFloat(preview.width) + 1 < original.width || CGFloat(preview.height) + 1 < original.height {
                        HStack {
                            Text(state.previewFailed ? "高清图片读取失败" : "超大图片已按内存限制优化显示")
                            Link("打开原图", destination: url)
                        }.font(.caption).foregroundStyle(.secondary).padding(8)
                    }
                    Divider()
                    GeometryReader { geometry in
                        ScrollView([.horizontal, .vertical]) {
                            image(preview)
                                .frame(width: (state.fullSize ? original.width : max(1, geometry.size.width - 24)) * state.zoom)
                                .padding(12)
                        }
                    }
                }
                .frame(minWidth: 520, idealWidth: 900, minHeight: 380, idealHeight: 650)
                .task(id: url) { await state.loadOriginal(url) }
            }
        }
    }

    private func image(_ bitmap: CGImage) -> some View {
        Image(decorative: bitmap, scale: 1).resizable().scaledToFit()
    }

    private func pictureButton(_ bitmap: CGImage) -> some View {
        Button { state.showingPreview = true } label: {
            image(bitmap).clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label).help("点开看大图")
    }

    @MainActor private final class ImageState: ObservableObject {
        @Published var bitmap: CGImage?
        @Published var previewBitmap: CGImage?
        @Published var loadingOriginal = false
        @Published var previewFailed = false
        private(set) var loadedURL: URL?
        @Published var failed = false
        @Published var showingPreview = false
        @Published var fullSize = false
        @Published var zoom = 1.0

        func load(_ url: URL) async {
            if loadedURL == url, bitmap != nil { return }
            loadedURL = url
            previewBitmap = nil
            bitmap = ForumImageRequest.cached(url)
            failed = false
            guard bitmap == nil else { return }
            do {
                let result = try await ForumImageRequest.fetch(url)
                try Task.checkCancellation()
                guard loadedURL == url else { return }
                bitmap = result
            } catch {
                if !Task.isCancelled, loadedURL == url { failed = true }
            }
        }

        func loadOriginal(_ url: URL) async {
            loadingOriginal = true
            previewFailed = false
            defer { if loadedURL == url { loadingOriginal = false } }
            do {
                let result = try await ForumImageRequest.fetch(url, kind: .original)
                try Task.checkCancellation()
                guard loadedURL == url else { return }
                previewBitmap = result
            } catch {
                if !Task.isCancelled, loadedURL == url { previewFailed = true }
            }
        }
    }
}

private struct PreviewImageWidth: Layout {
    let maxWidth: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = min(maxWidth, proposal.width ?? maxWidth)
        return subviews[0].sizeThatFits(ProposedViewSize(width: width, height: nil))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews[0].place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: nil))
    }
}

enum ForumImageRequest {
    enum Kind { case post, avatar, original }
    private static let dimensions = NSCache<NSURL, NSValue>()
    private static let originalCache = cache(megabytes: 96, count: 2)
    static func originalSize(_ url: URL) -> CGSize? { dimensions.object(forKey: url as NSURL)?.sizeValue }
    private static func memory(for kind: Kind) -> NSCache<NSURL, CGImage> {
        switch kind { case .post: postCache; case .avatar: avatarCache; case .original: originalCache }
    }

    private static let postCache = cache(megabytes: 28, count: 32)
    private static let avatarCache = cache(megabytes: 16, count: 256)

    private static func cache(megabytes: Int, count: Int) -> NSCache<NSURL, CGImage> {
        let cache = NSCache<NSURL, CGImage>()
        cache.totalCostLimit = megabytes * 1024 * 1024
        cache.countLimit = count
        return cache
    }
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForResource = 20
        return URLSession(configuration: config)
    }()

    static func cached(_ url: URL, kind: Kind = .post) -> CGImage? {
        memory(for: kind).object(forKey: url as NSURL)
    }

    static func fetch(_ url: URL, kind: Kind = .post) async throws -> CGImage {
        guard url.scheme == "https", url.user == nil, url.password == nil else { throw URLError(.badURL) }
        if let image = cached(url, kind: kind) { return image }
        var request = URLRequest(url: url)
        // Match the origin referrer used for embedded images on the forum.
        request.setValue(Forum.home.absoluteString, forHTTPHeaderField: "Referer")
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        let (file, response) = try await session.download(for: request)
        defer { try? FileManager.default.removeItem(at: file) }
        try Task.checkCancellation()
        let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let sourceURL = http.url, sourceURL.scheme == "https",
              size > 0, size <= (kind == .avatar ? 4 : 25) * 1024 * 1024
        else { throw URLError(.cannotDecodeContentData) }
        let image: CGImage?
        if kind == .avatar, http.mimeType == "image/svg+xml", size <= 256 * 1024,
           Forum.contains(url), url.path.hasPrefix("/avatar/"), Forum.contains(sourceURL) {
            // NodeSeek generates default avatars as SVG, even at URLs ending in .png.
            let data = try Data(contentsOf: file)
            image = await MainActor.run {
                guard let avatar = NSImage(data: data), avatar.size.width > 0, avatar.size.height > 0,
                      avatar.size.width <= 1024, avatar.size.height <= 1024 else { return nil }
                return avatar.cgImage(forProposedRect: nil, context: nil, hints: nil)
            }
        } else {
            let decoded = try decode(file, kind: kind)
            dimensions.setObject(NSValue(size: decoded.originalSize), forKey: url as NSURL)
            image = decoded.image
        }
        guard let image else { throw URLError(.cannotDecodeContentData) }
        let memory = memory(for: kind)
        let cost = image.bytesPerRow * image.height
        if cost <= memory.totalCostLimit { memory.setObject(image, forKey: url as NSURL, cost: cost) }
        return image
    }
    struct Decoded {
        let image: CGImage
        let originalSize: CGSize
    }

    static func decode(_ file: URL, kind: Kind = .post) throws -> Decoded {
        guard let source = CGImageSourceCreateWithURL(file as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
              let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any],
              let w = info[kCGImagePropertyPixelWidth as String] as? Double,
              let h = info[kCGImagePropertyPixelHeight as String] as? Double,
              w > 0, h > 0, w.isFinite, h.isFinite else { throw URLError(.cannotDecodeContentData) }
        let rotated = (5...8).contains(info[kCGImagePropertyOrientation as String] as? Int ?? 1)
        let width = rotated ? h : w, height = rotated ? w : h
        // Long reports retain a readable width instead of shrinking their width
        // whenever height grows. A pixel budget bounds decoded memory (~96 MB).
        let readingScale = kind == .avatar ? min(1, 256 / max(width, height)) :
            (kind == .original ? 1 : min(1, 2160 / width))
        let pixelBudget = kind == .avatar ? 256.0 * 256 : 24_000_000
        let factor = min(readingScale, sqrt(pixelBudget / width / height))
        let edge = max(1, Int((max(width, height) * factor).rounded(.down)))
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: edge,
            kCGImageSourceShouldCacheImmediately: true
        ] as CFDictionary) else { throw URLError(.cannotDecodeContentData) }
        return Decoded(image: image, originalSize: CGSize(width: width, height: height))
    }

}
