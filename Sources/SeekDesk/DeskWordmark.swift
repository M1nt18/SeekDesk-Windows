import AppKit
import SwiftUI

enum DeskLogo: String, CaseIterable {
    case cobalt = "Cobalt"
    case teal = "Teal"
    case fern = "Fern"
    case iris = "Iris"
    case amber = "Amber"
    case coral = "Coral"

    static let preference = "workspace.logoPalette"

    var title: String {
        switch self {
        case .cobalt: "原版钴蓝"
        case .teal: "海松青"
        case .fern: "蕨叶绿"
        case .iris: "鸢尾紫"
        case .amber: "琥珀橙"
        case .coral: "珊瑚红"
        }
    }

    private static let images = NSCache<NSString, NSImage>()

    func image(dark: Bool) -> NSImage? {
        let name = self == .cobalt
            ? (dark ? "Wordmark-Dark" : "Wordmark")
            : "Wordmark-\(rawValue)-\(dark ? "Dark" : "Light")"
        let key = name as NSString
        if let cached = Self.images.object(forKey: key) { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: "png"),
              let image = NSImage(contentsOf: url) else { return nil }
        Self.images.setObject(image, forKey: key)
        return image
    }

    var dockImage: NSImage? {
        Bundle.main.url(forResource: "SeekDesk-Dock-\(rawValue)", withExtension: "icns", subdirectory: "DockIcons")
            .flatMap { NSImage(contentsOf: $0) }
    }
}

struct DeskWordmark: View {
    let logo: DeskLogo
    let dark: Bool
    let height: CGFloat

    var body: some View {
        Group {
            if let mark = logo.image(dark: dark) ?? DeskLogo.cobalt.image(dark: dark) {
                Image(nsImage: mark).resizable().interpolation(.high).scaledToFit()
            } else {
                DeskLabel("SeekDesk", systemImage: "square.on.square").font(.headline)
            }
        }
        .frame(width: height * 3.1, height: height)
    }
}
