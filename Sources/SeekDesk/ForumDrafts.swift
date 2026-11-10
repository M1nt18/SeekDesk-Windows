import SwiftUI

/// Only the confirmed owner can open a partition. Unconfirmed sessions never
/// display the last account's drafts, even when the website cookie is retained.
struct ForumDraftSnapshot: Codable {
    var replies: [String: String] = [:]
    var messages: [Int: String] = [:]
    var discussion = Discussion()
    var images: [String: [URL: MarkdownImageScale]] = [:]

    struct Discussion: Codable, Equatable {
        var title = ""
        var content = ""
        var category = ""
        var rank = 0
    }
}

@MainActor
final class NewDiscussionDraft: ObservableObject {
    @Published var title = "" { didSet { didChange?() } }
    @Published var content = "" { didSet { didChange?() } }
    @Published var category = "" { didSet { didChange?() } }
    @Published var rank = 0 { didSet { didChange?() } }
    let imageSizing = DraftImageSizing()
    var didChange: (() -> Void)?

    var snapshot: ForumDraftSnapshot.Discussion {
        .init(title: title, content: content, category: category, rank: rank)
    }

    func restore(_ value: ForumDraftSnapshot.Discussion) {
        title = value.title; content = value.content; category = value.category; rank = value.rank
    }

    func clear() {
        restore(.init())
        imageSizing.reset()
    }
}
