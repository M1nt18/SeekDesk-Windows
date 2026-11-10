import AppKit
import SwiftUI

struct DeskIcon: View {
    let symbol: String
    let asset: String?
    let size: CGFloat
    let nativeMenu: Bool
    @Environment(\.colorScheme) private var colorScheme

    init(_ symbol: String, asset: String? = nil, size: CGFloat = 15, nativeMenu: Bool = false) {
        self.symbol = symbol
        self.asset = asset
        self.size = size
        self.nativeMenu = nativeMenu
    }

    var body: some View {
        if let name = asset ?? Self.assets[symbol],
           let image = Self.image(named: name, size: size, menuScheme: nativeMenu ? colorScheme : nil) {
            Image(nsImage: image)
                .renderingMode(nativeMenu ? .original : .template)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: size, height: size)
                .rotationEffect(Self.rotation(for: symbol))
        } else {
            Image(systemName: symbol)
        }
    }

    private static let cache: NSCache<NSString, NSImage> = {
        let cache = NSCache<NSString, NSImage>()
        cache.countLimit = 320
        return cache
    }()

    private static func image(named name: String, size: CGFloat, menuScheme: ColorScheme?) -> NSImage? {
        let appearance = menuScheme.map { $0 == .dark ? "dark" : "light" } ?? "template"
        let key = "\(name):\(size):\(appearance)" as NSString
        if let cached = cache.object(forKey: key) { return cached }
        guard let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Icons"),
              let source = NSImage(contentsOf: url) else { return nil }
        let pointSize = NSSize(width: size, height: size)
        source.size = pointSize
        for representation in source.representations { representation.size = pointSize }
        let image: NSImage
        if let menuScheme {
            // Native menu controls extract the image and can drop SwiftUI tint.
            let ink = menuScheme == .dark ? NSColor(white: 0.83, alpha: 1) : NSColor(white: 0.31, alpha: 1)
            image = NSImage(size: pointSize, flipped: false) { rect in
                guard let context = NSGraphicsContext.current?.cgContext else { return false }
                source.draw(in: rect, from: .zero, operation: .copy, fraction: 1)
                context.setBlendMode(.sourceAtop)
                context.setFillColor(ink.cgColor)
                context.fill(rect)
                return true
            }
        } else {
            source.isTemplate = true
            image = source
        }
        cache.setObject(image, forKey: key)
        return image
    }

    private static func rotation(for symbol: String) -> Angle {
        switch symbol {
        case "chevron.left": .degrees(90)
        case "chevron.right": .degrees(-90)
        case "chevron.up": .degrees(180)
        default: .zero
        }
    }

    // Shared shapes use the SF Symbol name as a fallback. Call sites with a
    // different meaning can choose a more specific asset.
    private static let assets: [String: String] = [
        "diamond": "badge-featured",
        "lock": "badge-reading-lock",
        "shippingbox": "board-sandbox",
        "shield": "nav-rulings",
        "list.bullet.rectangle": "nav-topics",
        "bell": "nav-notifications",
        "paperplane": "action-send",
        "dot.radiowaves.left.and.right": "ext-keyword-watch",
        "square.grid.2x2": "nav-boards",
        "bolt": "nav-shortcuts",
        "flame": "nav-hot",
        "flame.fill": "nav-hot",
        "gift": "nav-lucky",
        "person.badge.plus": "nav-invite",
        "puzzlepiece.extension": "nav-extensions",
        "gearshape": "nav-settings",
        "magnifyingglass": "nav-search",
        "plus": "action-add",
        "sidebar.left": "layout-sidebar",
        "cup.and.saucer": "board-daily",
        "chevron.left.forwardslash.chevron.right": "board-tech",
        "antenna.radiowaves.left.and.right": "board-info",
        "chart.bar.xaxis": "board-review",
        "tag": "board-trade",
        "person.2": "board-carpool",
        "hammer": "board-dev",
        "photo.on.rectangle": "board-photo-share",
        "exclamationmark.bubble": "board-expose",
        "megaphone": "board-promotion",
        "lock.shield": "board-inside",
        "doc.text": "topic-document",
        "doc.badge.ellipsis": "topic-unavailable",
        "rectangle.split.2x1": "layout-topic-split",
        "rectangle.on.rectangle": "layout-tabs",
        "square.on.square": "layout-tabs",
        "xmark.rectangle": "action-close-all-tabs",
        "xmark": "action-close",
        "xmark.circle.fill": "action-clear-search",
        "chevron.down": "action-chevron-down",
        "chevron.left": "action-chevron-down",
        "chevron.right": "action-chevron-down",
        "chevron.up": "action-chevron-down",
        "arrow.clockwise": "action-refresh",
        "arrow.clockwise.circle": "action-refresh-status",
        "clock": "action-history",
        "arrow.up.right": "action-external",
        "arrow.up.right.square": "action-open-browser",
        "doc.on.doc": "action-copy",
        "ellipsis": "action-more",
        "ellipsis.circle": "action-more",
        "arrowshape.turn.up.left": "action-reply",
        "quote.opening": "action-quote",
        "text.quote": "action-quote",
        "link": "action-link",
        "arrow.up.left.and.arrow.down.right": "action-expand",
        "arrow.down.right.and.arrow.up.left": "action-collapse",
        "textformat": "md-format",
        "textformat.size": "md-heading",
        "bold": "md-bold",
        "italic": "md-italic",
        "strikethrough": "md-strike",
        "list.bullet": "md-bullets",
        "list.number": "md-numbered",
        "chevron.left.chevron.right": "md-inline-code",
        "curlybraces.square": "md-code-block",
        "tablecells": "md-table",
        "minus": "md-divider",
        "photo": "media-photo",
        "photo.badge.arrow.down": "media-photo-upload",
        "pencil.line": "action-edit",
        "pencil": "action-edit",
        "eye": "action-eye",
        "face.smiling": "action-emoji",
        "folder.badge.plus": "action-folder-add",
        "arrow.uturn.backward": "action-undo",
        "arrow.uturn.forward": "action-redo",
        "trash": "action-trash",
        "person.crop.circle": "profile-account",
        "person.fill": "profile-avatar-placeholder",
        "person.crop.circle.badge.checkmark": "profile-sign-in",
        "checkmark.shield": "profile-verification",
        "calendar": "profile-calendar",
        "tray.full": "nav-inbox",
        "tray": "state-empty-tray",
        "text.bubble": "notification-detail",
        "bubble": "message-single",
        "bubble.left": "message-single",
        "bubble.left.and.bubble.right": "message-conversation",
        "checkmark": "state-check",
        "checkmark.circle.fill": "state-success",
        "exclamationmark.circle": "state-warning",
        "info.circle": "state-info",
        "wifi.exclamationmark": "state-network",
        "pause.circle": "state-paused",
        "arrow.down.circle": "state-install",
        "calendar.badge.checkmark": "ext-attendance",
        "tablecells.fill": "ext-office",
        "plus.forwardslash.minus": "ext-remaining-value",
        "person.crop.circle.badge.minus": "ext-block-user",
        "person.text.rectangle": "ext-author-only",
        "shield.lefthalf.filled": "ext-ruling-query",
        "doc.text.magnifyingglass": "ext-ruling-query",
        "shield.fill": "ruling-management",
        "exclamationmark.shield": "ruling-penalty",
        "gift.fill": "ruling-reward",
        "text.book.closed": "settings-reading",
        "paintbrush": "settings-appearance",
        "terminal": "media-terminal",
        "plus.magnifyingglass": "media-zoom-in",
        "minus.magnifyingglass": "media-zoom-out"
    ]
}

struct DeskLabel: View {
    let title: String
    let systemImage: String
    let asset: String?
    let size: CGFloat
    let nativeMenu: Bool

    init(_ title: String, systemImage: String, asset: String? = nil, size: CGFloat = 15, nativeMenu: Bool = false) {
        self.title = title
        self.systemImage = systemImage
        self.asset = asset
        self.size = size
        self.nativeMenu = nativeMenu
    }

    var body: some View {
        Label {
            Text(title)
        } icon: {
            DeskIcon(systemImage, asset: asset, size: size, nativeMenu: nativeMenu).accessibilityHidden(true)
        }
    }
}
