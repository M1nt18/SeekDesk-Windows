import Foundation

struct RulingRecord: Decodable, Identifiable {
    enum Kind: String { case punish, reward, management }

    let id: Int
    let reason: String?
    let actions: String?
    let category: String?
    let points: Int?
    let postAddress: String?

    enum CodingKeys: String, CodingKey {
        case id = "record_id"
        case reason = "reason_text"
        case actions = "actions_text"
        case category = "action_category"
        case points = "action_points_delta"
        case postAddress = "post_url"
    }

    var kind: Kind {
        if category == "punish" || (points ?? 0) < 0 { return .punish }
        if category == "reward" || (points ?? 0) > 0 { return .reward }
        return .management
    }

    var postURL: URL? {
        guard let postAddress, let url = URL(string: postAddress, relativeTo: Forum.home)?.absoluteURL,
              Forum.topicID(url) != nil else { return nil }
        return url
    }

    var beijingActions: String? { actions.map(Self.beijingTimes) }

    static func beijingTimes(in text: String) -> String {
        guard let expression = try? NSRegularExpression(
            pattern: #"\b[0-9]{1,2}/[0-9]{1,2}/[0-9]{4},\s*[0-9]{1,2}:[0-9]{2}:[0-9]{2}\s*(?:AM|PM)\b"#,
            options: .caseInsensitive) else { return text }
        let input = text as NSString
        let matches = expression.matches(in: text, range: NSRange(location: 0, length: input.length))
        guard !matches.isEmpty else { return text }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "M/d/yyyy, h:mm:ss a"
        let output = DateFormatter()
        output.locale = formatter.locale
        output.calendar = formatter.calendar
        output.timeZone = TimeZone(identifier: "Asia/Shanghai")
        output.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let converted = NSMutableString(string: text)
        for match in matches.reversed() {
            guard let date = formatter.date(from: input.substring(with: match.range)) else { continue }
            converted.replaceCharacters(in: match.range, with: output.string(from: date) + "（北京时间）")
        }
        return converted as String
    }
}

actor RulingClient {
    static let shared = RulingClient()
    static let limit = 200

    enum LookupError: LocalizedError {
        case unavailable
        case rateLimited(Int)

        var errorDescription: String? {
            switch self {
            case .unavailable: "NS Seek 查询服务暂时无法连接。"
            case .rateLimited(let seconds): "查询过于频繁，请在约 \(seconds) 秒后重试。"
            }
        }
    }

    struct Reply: Decodable {
        let ok: Bool
        let rows: [RulingRecord]?
        let error: String?
        let retryAfter: Int?

        enum CodingKeys: String, CodingKey {
            case ok, rows, error
            case retryAfter = "retry_after"
        }
    }

    private struct Cached {
        let rows: [RulingRecord]
        let time: Date
    }

    private var cache: [String: Cached] = [:]
    private var nextRequest = Date.distantPast
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpShouldSetCookies = false
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.timeoutIntervalForResource = 15
        return URLSession(configuration: configuration)
    }()

    static func request(for name: String) -> URLRequest? {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.utf8.count <= 256 else { return nil }
        var address = URLComponents()
        address.scheme = "https"
        address.host = "api.xxboxx.de"
        address.path = "/api/seek"
        address.queryItems = [URLQueryItem(name: "username", value: name), URLQueryItem(name: "limit", value: String(limit))]
        if let query = address.percentEncodedQuery {
            address.percentEncodedQuery = query.replacingOccurrences(of: "+", with: "%2B")
        }
        guard let url = address.url else { return nil }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    func lookup(_ name: String) async throws -> [RulingRecord] {
        if let cached = cache[name], Date().timeIntervalSince(cached.time) < 120 { return cached.rows }
        if nextRequest > Date() { throw LookupError.rateLimited(max(1, Int(ceil(nextRequest.timeIntervalSinceNow)))) }
        guard let request = Self.request(for: name) else { throw LookupError.unavailable }
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              http.url?.scheme == "https", http.url?.host == request.url?.host else { throw LookupError.unavailable }
        let reply = try? JSONDecoder().decode(Reply.self, from: data)
        if http.statusCode == 429 || reply?.error == "rate_limited" {
            let delay = max(1, min(86_400, reply?.retryAfter ?? Int(http.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 60))
            nextRequest = Date().addingTimeInterval(TimeInterval(delay))
            throw LookupError.rateLimited(delay)
        }
        guard (200..<300).contains(http.statusCode), reply?.ok == true, let rows = reply?.rows else {
            throw LookupError.unavailable
        }
        if cache.count >= 32, let oldest = cache.min(by: { $0.value.time < $1.value.time })?.key {
            cache.removeValue(forKey: oldest)
        }
        cache[name] = Cached(rows: rows, time: Date())
        return rows
    }
}
