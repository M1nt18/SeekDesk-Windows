import Foundation

struct FeedPost: Identifiable, Codable, Equatable {
    let id: String
    let url: URL
    let title: String
    let author: String
    let category: String
    let published: Date?
    let summary: String
    var authorID: Int? = nil
    var readingRank: Int? = nil
    var featured: Bool? = nil
    var listedAvatarURL: URL? = nil
    var avatarURL: URL? { listedAvatarURL ?? authorID.map { Forum.avatar($0) } }
}

enum ForumFeed {
    static let url = URL(string: "https://rss.nodeseek.com/")!

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForResource = 20
        return URLSession(configuration: configuration)
    }

    private static func makeRequest() -> URLRequest {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("application/rss+xml, application/xml, text/xml", forHTTPHeaderField: "Accept")
        return request
    }

    static func fetch() async throws -> [FeedPost] {
        let session = makeSession()
        defer { session.finishTasksAndInvalidate() }
        let (data, response) = try await session.data(for: makeRequest())
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode),
              http.url?.scheme == "https", http.url?.host == url.host else {
            throw URLError(.badServerResponse)
        }
        return try parse(data)
    }

    struct Poller {
        private let session = ForumFeed.makeSession()
        private var etag: String?
        private var lastModified: String?

        mutating func poll() async throws -> [FeedPost]? {
            var request = ForumFeed.makeRequest()
            request.setValue(etag, forHTTPHeaderField: "If-None-Match")
            request.setValue(lastModified, forHTTPHeaderField: "If-Modified-Since")
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  http.url?.scheme == "https", http.url?.host == ForumFeed.url.host else {
                throw URLError(.badServerResponse)
            }
            if http.statusCode == 304 { return nil }
            if http.statusCode == 429 || http.statusCode == 503 {
                throw RetryLater(seconds: retryDelay(http.value(forHTTPHeaderField: "Retry-After")))
            }
            guard (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            let posts = try ForumFeed.parse(data)
            etag = http.value(forHTTPHeaderField: "ETag")
            lastModified = http.value(forHTTPHeaderField: "Last-Modified")
            return posts
        }

        func stop() { session.invalidateAndCancel() }

        private func retryDelay(_ value: String?) -> TimeInterval {
            guard let value else { return 60 }
            if let seconds = Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return max(10, Double(seconds))
            }
            let format = DateFormatter()
            format.locale = Locale(identifier: "en_US_POSIX")
            format.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
            return max(10, format.date(from: value)?.timeIntervalSinceNow ?? 60)
        }
    }

    struct RetryLater: Error { let seconds: TimeInterval }

    static func parse(_ data: Data) throws -> [FeedPost] {
        let delegate = RSSParser()
        let parser = XMLParser(data: data)
        parser.delegate = delegate
        parser.shouldResolveExternalEntities = false
        guard parser.parse(), delegate.hasChannel,
              delegate.itemCount == 0 || !delegate.posts.isEmpty else {
            throw URLError(.cannotParseResponse)
        }
        return delegate.posts
    }
}

private final class RSSParser: NSObject, XMLParserDelegate {
    private var path: [String] = []
    private var fields: [String: String] = [:]
    private var seen: Set<String> = []
    private let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return formatter
    }()
    private(set) var posts: [FeedPost] = []
    private(set) var hasChannel = false
    private(set) var itemCount = 0

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
                qualifiedName qName: String?, attributes attributeDict: [String: String]) {
        path.append(elementName)
        if path == ["rss", "channel"] { hasChannel = true }
        if path == ["rss", "channel", "item"] {
            fields.removeAll(keepingCapacity: true)
            itemCount += 1
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { collect(string) }
    func parser(_ parser: XMLParser, foundCDATA CDATABlock: Data) { collect(String(decoding: CDATABlock, as: UTF8.self)) }

    private func collect(_ string: String) {
        guard path.count == 4, path[0] == "rss", path[1] == "channel", path[2] == "item" else { return }
        fields[path[3], default: ""] += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        if path == ["rss", "channel", "item"] { appendPost() }
        path.removeLast()
    }

    private func field(_ key: String) -> String {
        fields[key, default: ""].trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func appendPost() {
        let title = field("title")
        guard !title.isEmpty, let url = URL(string: field("link")),
              let id = Forum.topicID(url), seen.insert(id).inserted else { return }
        posts.append(FeedPost(id: id, url: url, title: title, author: field("dc:creator"),
                              category: field("category"), published: dateFormatter.date(from: field("pubDate")),
                              summary: field("description")))
    }
}

struct ForumListingPage {
    let posts: [FeedPost]
    let next: URL?
}

enum ForumFeedOrder: String, CaseIterable, Identifiable {
    case topics = "postTime"
    case replies = "replyTime"

    var id: String { rawValue }
    var title: String { self == .topics ? "最新帖子" : "最新回复" }
}

extension Board {
    var latestURL: URL { listingURL(url, order: .topics) }
    func latestURL(order: ForumFeedOrder) -> URL { listingURL(url, order: order) }

    func nextListingURL(_ link: URL?, order: ForumFeedOrder = .topics) -> URL? {
        guard let link, Forum.contains(link),
              link.deletingLastPathComponent().path == url.path,
              link.lastPathComponent.hasPrefix("page-"),
              let number = Int(link.lastPathComponent.dropFirst(5)), number > 1 else { return nil }
        return listingURL(link, order: order)
    }

    private func listingURL(_ source: URL, order: ForumFeedOrder) -> URL {
        var parts = URLComponents(url: source, resolvingAgainstBaseURL: false)!
        parts.queryItems = self == .award ? nil : [URLQueryItem(name: "sortBy", value: order.rawValue)]
        parts.fragment = nil
        return parts.url!
    }
}

enum ForumSearch {
    static func normalized(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive, .widthInsensitive], locale: Locale(identifier: "zh_CN"))
    }

    static func terms(_ query: String) -> [String] {
        normalized(query).split { $0.isWhitespace || ",，、".contains($0) }.prefix(12).map(String.init)
    }

    static func matches(_ terms: [String], in fields: [String]) -> Bool {
        guard !terms.isEmpty else { return true }
        let fields = fields.map(normalized)
        return terms.allSatisfy { term in
            fields.contains { field in
                field.contains(term) || (
                    term.count >= 4 && term.count <= 24 && term.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) } &&
                    field.split(whereSeparator: { !$0.isASCII || (!$0.isLetter && !$0.isNumber) })
                        .contains { oneEditApart(Array(term), Array($0)) }
                )
            }
        }
    }

    private static func oneEditApart(_ left: [Character], _ right: [Character]) -> Bool {
        guard abs(left.count - right.count) <= 1 else { return false }
        if left.count == right.count {
            let differences = left.indices.filter { left[$0] != right[$0] }
            if differences.count <= 1 { return true }
            guard differences.count == 2 else { return false }
            let a = differences[0], b = differences[1]
            return b == a + 1 && left[a] == right[b] && left[b] == right[a]
        }
        let shorter = left.count < right.count ? left : right
        let longer = left.count < right.count ? right : left
        let mismatch = shorter.indices.first { shorter[$0] != longer[$0] } ?? shorter.count
        return shorter[mismatch...].elementsEqual(longer[(mismatch + 1)...])
    }
}
