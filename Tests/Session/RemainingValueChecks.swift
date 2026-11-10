import Foundation

func checkRemainingValue() throws {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "America/New_York")!
    func day(_ year: Int, _ month: Int, _ day: Int) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day))!
    }
    let expiry = day(2026, 3, 31)
    let partial = RemainingValueEstimate.calculate(amount: 31, cycle: .monthly, asOf: day(2026, 3, 16), expires: expiry, calendar: calendar)!
    precondition(partial.days == 15 && partial.partialCycleDays == 31 && partial.amount == 15)
    let prepaid = RemainingValueEstimate.calculate(amount: 28, cycle: .monthly, asOf: day(2026, 2, 14), expires: expiry, calendar: calendar)!
    precondition(prepaid.fullCycles == 1 && prepaid.partialDays == 14 && prepaid.partialCycleDays == 28 && prepaid.amount == 42)
    let expired = RemainingValueEstimate.calculate(amount: 31, cycle: .monthly, asOf: day(2026, 4, 1), expires: expiry, calendar: calendar)!
    precondition(expired.days == 0 && expired.amount == 0)
    precondition(ValueNumber.parse("1,200.40", locale: Locale(identifier: "en_US")) == ValueNumber.wire("1200.40"))
    precondition(ValueNumber.parse("1.200,40", locale: Locale(identifier: "de_DE")) == ValueNumber.wire("1200.40"))
    precondition(ValueNumber.parse("30abc", locale: Locale(identifier: "en_US")) == nil)
    precondition(RenewalTitleHint.extract("收 JP，续费 USD 35.99/y，挂 240") == .init(amount: "35.99", currency: "USD", cycle: .yearly))
    precondition(RenewalTitleHint.extract("出海外小鸡 ￥80") == nil)
    precondition(RenewalTitleHint.extract("原价 USD 20/y 或 USD 60/y") == nil)

    let time = Date(timeIntervalSince1970: 1_794_230_000)
    let market = try ValueMarketBook(data: Data("""
    [{"currency":"USD/CNY","bid":"6.66","ask":"6.68","timestamp":"1794230000000"},
     {"currency":"USD/CNH","bid":"6.80","ask":"6.82","timestamp":"1794230000000"},
     {"currency":"EUR/USD","bid":"1.10","ask":"1.12","timestamp":"1794229940000"}]
    """.utf8), now: time)
    let direct = market.quote(.init(base: "USD", quote: "CNY"))
    precondition(direct?.rate == ValueNumber.wire("6.67") && direct?.source == .market && direct?.asOf == time)
    let cross = market.quote(.init(base: "EUR", quote: "CNY"))
    precondition(cross?.rate == ValueNumber.wire("7.4037") && cross?.asOf == time.addingTimeInterval(-60))
    precondition(market.quote(.init(base: "CNY", quote: "USD"))?.rate == Decimal(1) / direct!.rate)
    precondition(market.quote(.init(base: "USD", quote: "JPY")) == nil)
    let hourly = try JSONDecoder().decode(ValueHourlyBook.self, from: Data("""
    {"base":"USD","timestamp":1794229200,"rates":{"CNY":6.5,"HKD":7.8}}
    """.utf8))
    precondition(hourly.quote(.init(base: "CNY", quote: "HKD"), now: time)?.rate == ValueNumber.wire("1.2"))
    precondition(hourly.quote(.init(base: "USD", quote: "CNY"), now: time)?.source == .hourly)
    print("Passed remaining-time, month-end, multi-cycle, title hint and exchange-rate checks.")
}
