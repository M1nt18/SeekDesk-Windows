import Foundation

enum Forum {
    static let home = URL(string: "https://www.nodeseek.com/")!
    static func avatar(_ id: Int) -> URL { home.appendingPathComponent("avatar/\(id).png") }

    static func memberID(from input: String) -> Int? {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = Int(text), id > 0 { return id }
        guard let url = URL(string: text), contains(url) else { return nil }
        let path = url.path.split(separator: "/")
        guard path.count == 2, path[0] == "space", let id = Int(path[1]), id > 0 else { return nil }
        return id
    }

    static let signIn = home.appendingPathComponent("signIn.html")

    static func contains(_ url: URL) -> Bool {
        url.scheme == "https" && ["www.nodeseek.com", "nodeseek.com"].contains(url.host ?? "")
            && url.user == nil && url.password == nil && (url.port == nil || url.port == 443)
    }

    static func topicID(_ url: URL) -> String? {
        guard contains(url), url.pathComponents.count == 2 else { return nil }
        let parts = url.lastPathComponent.split(separator: "-", omittingEmptySubsequences: false)
        guard parts.count >= 2, parts[0] == "post", let number = Int(parts[1]), number > 0 else { return nil }
        return String(number)
    }

    static func pageURL(_ url: URL) -> URL {
        var location = URLComponents(url: url, resolvingAgainstBaseURL: false)
        location?.fragment = nil
        return location?.url ?? url
    }

    static func searchPage(_ link: URL?, query: String) -> URL? {
        guard let link, contains(link),
              link.path == "/search" || link.path.hasPrefix("/search/page-"),
              var components = URLComponents(url: link, resolvingAgainstBaseURL: false) else { return nil }
        var parameters = components.queryItems ?? []
        if let value = parameters.first(where: { $0.name == "q" })?.value, value != query { return nil }
        if !parameters.contains(where: { $0.name == "q" }) { parameters.append(URLQueryItem(name: "q", value: query)) }
        components.queryItems = parameters
        components.fragment = nil
        return components.url
    }

    static func search(_ query: String) -> URL {
        var components = URLComponents(url: home.appendingPathComponent("search"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return components.url!
    }
}

enum ForumShortcut: String, CaseIterable, Identifiable {
    case award, ruling, lucky, invite

    var id: String { rawValue }
    var url: URL { Forum.home.appendingPathComponent(rawValue) }
    var title: String {
        switch self {
        case .award: "精品区"
        case .ruling: "管理记录"
        case .lucky: "幸运抽奖"
        case .invite: "邀请好友"
        }
    }
    var icon: String {
        switch self {
        case .award: "diamond"
        case .ruling: "shield"
        case .lucky: "gift"
        case .invite: "person.badge.plus"
        }
    }
}

struct Board: Identifiable, Hashable {
    let id: String
    let title: String
    let icon: String

    var url: URL {
        if self == .award { return ForumShortcut.award.url }
        if let categoryID { return Forum.home.appendingPathComponent("categories").appendingPathComponent(categoryID) }
        return Forum.home
    }

    var categoryID: String? { self == .home || self == .award ? nil : id }

    static let award = Board(id: "award", title: ForumShortcut.award.title, icon: ForumShortcut.award.icon)
    static let home = Board(id: "", title: "最新帖子", icon: "list.bullet.rectangle")
    static let inside = Board(id: "inside", title: "内版", icon: "lock.shield")
    static let sections = [
        Board(id: "daily", title: "日常", icon: "cup.and.saucer"),
        Board(id: "tech", title: "技术", icon: "chevron.left.forwardslash.chevron.right"),
        Board(id: "info", title: "情报", icon: "antenna.radiowaves.left.and.right"),
        Board(id: "review", title: "测评", icon: "chart.bar.xaxis"),
        Board(id: "trade", title: "交易", icon: "tag"),
        Board(id: "carpool", title: "拼车", icon: "person.2"),
        Board(id: "dev", title: "Dev", icon: "hammer"),
        Board(id: "photo-share", title: "贴图", icon: "photo.on.rectangle"),
        Board(id: "expose", title: "曝光", icon: "exclamationmark.bubble"),
        Board(id: "promotion", title: "推广", icon: "megaphone"),
        Board(id: "life", title: "生活", icon: "leaf"),
        inside,
        Board(id: "sandbox", title: "沙盒", icon: "shippingbox")
    ]
    static let searchableIDs = Set(sections.map(\.id))

    static func searchScopeTitle(_ scope: Set<String>) -> String {
        let titles = sections.filter { scope.contains($0.id) }.map(\.title)
        return titles.isEmpty ? "全部版块" : titles.joined(separator: "、")
    }

    static func title(for id: String) -> String {
        sections.first { $0.id == id }?.title ?? id
    }
}

struct Topic: Identifiable, Codable, Equatable {
    let id: String
    var url: URL
    var title: String
    var scroll = 0.0
    var draft = ""
    var preview: FeedPost?

    var label: String { preview?.title ?? (title.isEmpty ? "帖子 #\(id)" : title) }
}

struct ReadingSession: Codable {
    private(set) var topics: [Topic] = []
    private(set) var selection: String?
    private var recent: [String] = []

    var selectedTopic: Topic? { topics.first { $0.id == selection } }

    mutating func open(_ url: URL, title: String, background: Bool, explicitLocation: Bool = false) {
        guard let id = Forum.topicID(url) else { return }
        if let index = topics.firstIndex(where: { $0.id == id }) {
            // List rows reuse the open tab. Pasted links navigate to the requested page or floor.
            if explicitLocation || url.fragment?.isEmpty == false {
                topics[index].url = url
                topics[index].scroll = 0
            }
            if topics[index].title.isEmpty { topics[index].title = title }
        } else {
            topics.append(Topic(id: id, url: url, title: title))
        }
        if !background { select(id) }
    }

    mutating func select(_ id: String) {
        guard topics.contains(where: { $0.id == id }) else { return }
        selection = id
        recent.removeAll { $0 == id }
        recent.append(id)
    }

    mutating func close(_ id: String) {
        guard let index = topics.firstIndex(where: { $0.id == id }) else { return }
        topics.remove(at: index)
        recent.removeAll { $0 == id }
        guard selection == id else { return }
        selection = nil
        if let previous = recent.last ?? topics.last?.id { select(previous) }
    }

    mutating func move(_ id: String, to target: String) -> Bool {
        guard id != target, let source = topics.firstIndex(where: { $0.id == id }),
              let destination = topics.firstIndex(where: { $0.id == target }) else { return false }
        let topic = topics.remove(at: source)
        topics.insert(topic, at: destination)
        return true
    }

    mutating func update(_ id: String, change: (inout Topic) -> Void) {
        guard let index = topics.firstIndex(where: { $0.id == id }) else { return }
        change(&topics[index])
    }
}
