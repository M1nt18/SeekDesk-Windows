import Foundation

struct ValueCurrencyPair: Hashable {
    let base: String
    let quote: String
    var isSame: Bool { base == quote }
}

struct ValueExchangeQuote: Equatable {
    enum Source: Equatable {
        case market, hourly

        var name: String { self == .market ? "Live-Rates" : "ExchangeRate.fun" }
        var link: URL {
            URL(string: self == .market ? "https://www.live-rates.com/" : "https://www.exchangerate.fun/docs/")!
        }
    }

    let rate: Decimal
    let asOf: Date
    let source: Source

    func caption(now: Date = Date()) -> String {
        if source == .hourly { return "小时参考价" }
        return now.timeIntervalSince(asOf) <= 5 * 60 ? "市场报价" : "最近市场报价"
    }
}

struct ValueMarketBook {
    private struct Row: Decodable {
        let currency: String?
        let bid: String?
        let ask: String?
        let timestamp: String?
    }

    private let quotes: [ValueCurrencyPair: ValueExchangeQuote]

    init(data: Data, now: Date = Date()) throws {
        let rows = try JSONDecoder().decode([Row].self, from: data)
        var book: [ValueCurrencyPair: ValueExchangeQuote] = [:]
        for row in rows {
            guard let components = row.currency?.split(separator: "/"), components.count == 2,
                  ValueCurrency.supported.contains(String(components[0])), ValueCurrency.supported.contains(String(components[1])),
                  let bid = row.bid.flatMap(ValueNumber.wire), let ask = row.ask.flatMap(ValueNumber.wire), bid > 0, ask >= bid,
                  let stamp = row.timestamp.flatMap(Double.init), stamp.isFinite else { continue }
            let asOf = Date(timeIntervalSince1970: stamp / 1000)
            guard asOf <= now.addingTimeInterval(300), asOf >= now.addingTimeInterval(-7 * 24 * 60 * 60) else { continue }
            let pair = ValueCurrencyPair(base: String(components[0]), quote: String(components[1]))
            if let existing = book[pair], existing.asOf > asOf { continue }
            book[pair] = ValueExchangeQuote(rate: (ask + bid) / 2, asOf: asOf, source: .market)
        }
        guard !book.isEmpty else { throw URLError(.cannotParseResponse) }
        quotes = book
    }

    func quote(_ pair: ValueCurrencyPair) -> ValueExchangeQuote? {
        if let direct = directOrInverse(pair) { return direct }
        if let baseLeg = directOrInverse(.init(base: pair.base, quote: "USD")),
           let quoteLeg = directOrInverse(.init(base: "USD", quote: pair.quote)) {
            return ValueExchangeQuote(rate: baseLeg.rate * quoteLeg.rate,
                                      asOf: min(baseLeg.asOf, quoteLeg.asOf), source: .market)
        }
        return nil
    }

    private func directOrInverse(_ pair: ValueCurrencyPair) -> ValueExchangeQuote? {
        if let direct = quotes[pair] { return direct }
        guard let reverse = quotes[.init(base: pair.quote, quote: pair.base)] else { return nil }
        return ValueExchangeQuote(rate: 1 / reverse.rate, asOf: reverse.asOf, source: .market)
    }
}

struct ValueHourlyBook: Decodable {
    let base: String
    let timestamp: TimeInterval
    let rates: [String: Decimal]

    func quote(_ pair: ValueCurrencyPair, now: Date = Date()) -> ValueExchangeQuote? {
        let asOf = Date(timeIntervalSince1970: timestamp)
        guard base == "USD", timestamp.isFinite, asOf <= now.addingTimeInterval(300),
              asOf >= now.addingTimeInterval(-7 * 24 * 60 * 60) else { return nil }
        let original = pair.base == base ? Decimal(1) : rates[pair.base]
        let converted = pair.quote == base ? Decimal(1) : rates[pair.quote]
        guard let original, let converted, original > 0, converted > 0 else { return nil }
        return ValueExchangeQuote(rate: converted / original, asOf: asOf, source: .hourly)
    }
}

actor ValueExchangeRates {
    static let shared = ValueExchangeRates()

    private var market: ValueMarketBook?
    private var marketTask: Task<ValueMarketBook?, Never>?
    private var marketAttempts: [Date] = []
    private var hourly: ValueHourlyBook?
    private var hourlyTask: Task<ValueHourlyBook?, Never>?
    private var lastHourlyRequest: Date?

    private static let marketURL = URL(string: "https://www.live-rates.com/rates")!
    private static let hourlyURL = URL(string: "https://api.exchangerate.fun/latest?base=USD")!
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.timeoutIntervalForResource = 8
        return URLSession(configuration: config)
    }()

    func latest(_ pair: ValueCurrencyPair, force: Bool = false) async -> ValueExchangeQuote? {
        guard !pair.isSame, ValueCurrency.supported.contains(pair.base), ValueCurrency.supported.contains(pair.quote) else { return nil }
        let now = Date()
        let market = await marketSnapshot(now: now, force: force)?.quote(pair)
        guard !Task.isCancelled else { return nil }
        if let market, now.timeIntervalSince(market.asOf) <= 5 * 60 { return market }
        let hourly = await hourlySnapshot(now: now, force: force)?.quote(pair, now: now)
        if let market, now.timeIntervalSince(market.asOf) <= 7 * 24 * 60 * 60,
           market.asOf >= (hourly?.asOf ?? .distantPast) { return market }
        return hourly
    }

    private func marketSnapshot(now: Date, force: Bool) async -> ValueMarketBook? {
        if let marketTask { return await marketTask.value ?? market }
        marketAttempts.removeAll { now.timeIntervalSince($0) >= 60 * 60 }
        // One snapshot covers every pair. Respect the keyless limit across all
        // open posts, including fast switching and repeated manual refreshes.
        guard marketAttempts.count < 3,
              marketAttempts.last.map({ now.timeIntervalSince($0) >= (force ? 20 : 300) }) ?? true else { return market }
        marketAttempts.append(now)
        let task = Task {
            guard let data = try? await Self.get(Self.marketURL) else { return nil as ValueMarketBook? }
            return try? ValueMarketBook(data: data)
        }
        marketTask = task
        if let response = await task.value { market = response }
        marketTask = nil
        return market
    }

    private func hourlySnapshot(now: Date, force: Bool) async -> ValueHourlyBook? {
        if let hourlyTask { return await hourlyTask.value ?? hourly }
        guard lastHourlyRequest.map({ now.timeIntervalSince($0) >= (force ? 60 : 20 * 60) }) ?? true else { return hourly }
        lastHourlyRequest = now
        let task = Task {
            guard let data = try? await Self.get(Self.hourlyURL) else { return nil as ValueHourlyBook? }
            return try? JSONDecoder().decode(ValueHourlyBook.self, from: data)
        }
        hourlyTask = task
        if let response = await task.value { hourly = response }
        hourlyTask = nil
        return hourly
    }

    private static func get(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 6)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse, response.statusCode == 200, response.url?.scheme == "https",
              response.url?.host == url.host, !data.isEmpty, data.count < 512 * 1024 else { throw URLError(.badServerResponse) }
        return data
    }
}
