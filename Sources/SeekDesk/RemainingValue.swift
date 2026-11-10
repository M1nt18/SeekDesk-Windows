import Foundation

enum RenewalCycle: Int, CaseIterable, Identifiable {
    case monthly = 1, quarterly = 3, halfYear = 6, yearly = 12, twoYears = 24, threeYears = 36
    var id: Int { rawValue }
    var title: String {
        switch self {
        case .monthly: "月付"
        case .quarterly: "季付"
        case .halfYear: "半年付"
        case .yearly: "年付"
        case .twoYears: "两年付"
        case .threeYears: "三年付"
        }
    }
}

struct RemainingValueEstimate: Equatable {
    let days: Int
    let fullCycles: Int
    let partialDays: Int
    let partialCycleDays: Int
    let amount: Decimal

    var fraction: Double {
        if fullCycles > 0 { return 1 }
        return partialCycleDays > 0 ? Double(partialDays) / Double(partialCycleDays) : 0
    }

    static func calculate(amount: Decimal, cycle: RenewalCycle, asOf: Date, expires: Date,
                          calendar: Calendar = .current) -> Self? {
        guard amount >= 0, !amount.isNaN else { return nil }
        let today = calendar.startOfDay(for: asOf)
        let end = calendar.startOfDay(for: expires)
        let days = calendar.dateComponents([.day], from: today, to: end).day ?? 0
        guard days > 0 else { return Self(days: 0, fullCycles: 0, partialDays: 0, partialCycleDays: 0, amount: 0) }
        // Anchor every boundary to the original expiry so that month-end renewals
        // are not shifted permanently after passing through a shorter month.
        var upper = end
        for complete in 0..<1200 {
            guard let lower = calendar.date(byAdding: .month, value: -(complete + 1) * cycle.rawValue, to: end),
                  lower < upper else { return nil }
            if today >= lower {
                let partial = max(0, calendar.dateComponents([.day], from: today, to: upper).day ?? 0)
                let span = max(1, calendar.dateComponents([.day], from: lower, to: upper).day ?? 1)
                let result = amount * Decimal(complete) + (amount * Decimal(partial)) / Decimal(span)
                return Self(days: days, fullCycles: complete, partialDays: partial, partialCycleDays: span, amount: result)
            }
            upper = lower
        }
        return nil
    }
}

enum ValueNumber {
    static func parse(_ input: String, locale: Locale = .current) -> Decimal? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.count <= 32 else { return nil }
        if let parsed = parse(value, decimal: locale.decimalSeparator ?? ".", group: locale.groupingSeparator ?? ",") { return parsed }
        return parse(value, decimal: ".", group: ",")
    }

    static func wire(_ value: String) -> Decimal? { parse(value, decimal: ".", group: "") }

    private static func parse(_ value: String, decimal: String, group: String) -> Decimal? {
        let decimalPattern = NSRegularExpression.escapedPattern(for: decimal)
        let groupPattern = NSRegularExpression.escapedPattern(for: group)
        let whole = group.isEmpty || group == decimal ? "[0-9]+" : "(?:[0-9]+|[0-9]{1,3}(?:\(groupPattern)[0-9]{3})+)"
        let pattern = "^(?:\(whole)(?:\(decimalPattern)[0-9]{0,12})?|\(decimalPattern)[0-9]{1,12})$"
        guard value.range(of: pattern, options: .regularExpression) != nil else { return nil }
        let plain = group.isEmpty || group == decimal ? value : value.replacingOccurrences(of: group, with: "")
        return Decimal(string: plain.replacingOccurrences(of: decimal, with: "."), locale: Locale(identifier: "en_US_POSIX"))
    }
}

enum ValueCurrency {
    static let common = ["CNY", "USD", "HKD", "EUR", "JPY", "GBP", "SGD", "TWD", "KRW"]
    static let other = ["AED", "ARS", "AUD", "BRL", "CAD", "CHF", "CLP", "CZK", "DKK", "HUF", "IDR", "ILS", "INR",
                        "MXN", "MYR", "NOK", "NZD", "PHP", "PLN", "RON", "SAR", "SEK", "THB", "TRY", "UAH", "VND", "ZAR"]
    static let supported = Set(common + other)
    static let locale = Locale(identifier: "zh_CN")
    static func title(_ code: String) -> String {
        guard let name = locale.localizedString(forCurrencyCode: code) else { return code }
        return "\(code)  \(name)"
    }

    static func money(_ value: Decimal, _ code: String) -> String {
        return rounded(value, code).formatted(.number.precision(.fractionLength(digits(code)))) + " " + code
    }

    static func rounded(_ value: Decimal, _ code: String) -> Decimal {
        var source = value
        var result = Decimal()
        NSDecimalRound(&result, &source, digits(code), .plain)
        return result
    }

    private static func digits(_ code: String) -> Int { ["JPY", "KRW", "VND", "CLP"].contains(code) ? 0 : 2 }
}

struct RenewalTitleHint: Equatable {
    let amount: String
    let currency: String
    let cycle: RenewalCycle

    static func extract(_ title: String) -> Self? {
        // Require an unambiguous ISO currency (or US$/HK$) and a cadence.
        // A bare price, e.g. a seller's asking price, must never seed renewal.
        let pattern = #"(?i)(?<![A-Z0-9])([A-Z]{3}|US\$|HK\$)\s*([0-9]{1,8}(?:\.[0-9]{1,4})?)\s*(?:/\s*(month|quarter|year|mo|yr|m|y|月|季|年)(?![A-Z])|(月付|季付|半年付|年付|两年付|三年付))"#
        let reverse = #"(?i)(?<![A-Z0-9.])([0-9]{1,8}(?:\.[0-9]{1,4})?)\s*([A-Z]{3}|美元|人民币|港币|刀)\s*(?:/\s*(month|quarter|year|mo|yr|m|y|月|季|年)(?![A-Z])|(月付|季付|半年付|年付|两年付|三年付))"#
        var candidates: [Self] = []
        for (expression, prefix) in [(pattern, true), (reverse, false)] {
            guard let regex = try? NSRegularExpression(pattern: expression) else { continue }
            let source = title as NSString
            for match in regex.matches(in: title, range: NSRange(location: 0, length: source.length)) {
                let amount = source.substring(with: match.range(at: prefix ? 2 : 1))
                let raw = source.substring(with: match.range(at: prefix ? 1 : 2)).uppercased()
                let currency = ["US$": "USD", "HK$": "HKD", "美元": "USD", "人民币": "CNY", "港币": "HKD", "刀": "USD"][raw] ?? raw
                let group = match.range(at: 3).location == NSNotFound ? 4 : 3
                let unit = source.substring(with: match.range(at: group)).lowercased()
                let cycles: [String: RenewalCycle] = [
                    "month": .monthly, "mo": .monthly, "m": .monthly, "月": .monthly, "月付": .monthly,
                    "quarter": .quarterly, "季": .quarterly, "季付": .quarterly, "半年付": .halfYear,
                    "year": .yearly, "yr": .yearly, "y": .yearly, "年": .yearly, "年付": .yearly,
                    "两年付": .twoYears, "三年付": .threeYears
                ]
                if let cycle = cycles[unit], ValueCurrency.supported.contains(currency) {
                    candidates.append(Self(amount: amount, currency: currency, cycle: cycle))
                }
            }
        }
        guard let first = candidates.first, candidates.allSatisfy({ $0 == first }) else { return nil }
        return first
    }
}
