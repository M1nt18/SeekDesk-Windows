import AppKit
import SwiftUI

struct RemainingValueButton: View {
    let palette: DeskPalette
    var topic: Topic?
    var topicName: String?
    var title = "估价"
    @StateObject private var panel = ValuePanel()

    var body: some View {
        Button { panel.open = true } label: {
            DeskLabel(title, systemImage: "plus.forwardslash.minus")
                .font(.system(size: 12, weight: .semibold)).padding(.horizontal, 8).frame(height: 28)
                .foregroundStyle(palette.accent)
                .background(palette.selection, in: RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(DeskButtonStyle(compresses: true))
        .accessibilityLabel(topic == nil ? title : "帖子估价")
        .help("剩余价值计算器")
        .popover(isPresented: $panel.open, arrowEdge: .bottom) {
            RemainingValueView(palette: palette, topicTitle: topicName ?? topic?.label, fields: panel.draft(for: topic?.id)) { panel.open = false }
                .id(topic?.id)
        }
        .onChange(of: topic?.id) { panel.open = false }
    }

    @MainActor private final class ValuePanel: ObservableObject {
        @Published var open = false
        private var drafts: [String: ValueCalculatorFields] = [:]
        private var recent: [String] = []

        func draft(for topic: String?) -> ValueCalculatorFields {
            let key = topic ?? "standalone"
            let fields = drafts[key] ?? ValueCalculatorFields()
            drafts[key] = fields
            recent.removeAll { $0 == key }
            recent.append(key)
            if recent.count > 6 { drafts.removeValue(forKey: recent.removeFirst()) }
            return fields
        }
    }
}

private struct RemainingValueView: View {
    let palette: DeskPalette
    let topicTitle: String?
    @ObservedObject var fields: ValueCalculatorFields
    let close: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var pair: ValueCurrencyPair { .init(base: fields.base, quote: fields.quote) }
    private var estimate: RemainingValueEstimate? {
        guard let amount = ValueNumber.parse(fields.amount) else { return nil }
        return RemainingValueEstimate.calculate(amount: amount, cycle: fields.cycle, asOf: fields.asOf, expires: fields.expires)
    }
    private var quote: ValueExchangeQuote? { fields.pricePair == pair ? fields.price : nil }
    private var activeRate: Decimal? {
        if pair.isSame { return 1 }
        if fields.mode == .manual, let value = ValueNumber.parse(fields.manualRate), value > 0 { return value }
        return fields.mode == .auto ? quote?.rate : nil
    }
    private var converted: Decimal? {
        guard let estimate, let activeRate else { return nil }
        let value = estimate.amount * activeRate
        return value.isNaN ? nil : value
    }

    private var request: RateRequest {
        .init(pair: pair, auto: fields.mode == .auto, revision: fields.refresh)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                DeskIcon("plus.forwardslash.minus", size: 14).font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(palette.accent).frame(width: 32, height: 32)
                    .background(palette.selection, in: RoundedRectangle(cornerRadius: 7))
                VStack(alignment: .leading, spacing: 3) {
                    Text("剩余价值计算器").font(.system(size: 17, weight: .semibold))
                        .accessibilityAddTraits(.isHeader)
                    if let topicTitle {
                        Text(topicTitle).lineLimit(1).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 5)
                Button(action: close) { DeskIcon("xmark").frame(width: 23, height: 23) }
                    .buttonStyle(DeskButtonStyle()).foregroundStyle(.secondary)
                    .keyboardShortcut(.cancelAction).accessibilityLabel("关闭估价")
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            Rectangle().fill(palette.line).frame(height: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 15) {
                    ticket
                    renewalFields
                    Rectangle().fill(palette.line).frame(height: 1)
                    exchangeFields
                    Rectangle().fill(palette.line).frame(height: 1)
                    askingPrice
                }
                .padding(.horizontal, 16).padding(.vertical, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(width: 430, height: 598)
        .background(palette.reader)
        .task(id: request) { await load(request) }
        .onChange(of: pair) { previous, current in
            fields.manualRate = ""
            if previous.quote != current.quote { fields.asking = "" }
            fields.refresh = 0
        }
    }

    private var ticket: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("按剩余时长估算").font(.caption.weight(.semibold)).foregroundStyle(palette.accent)
                Spacer()
                Button {
                    if let estimate { copy(estimate) }
                } label: {
                    DeskLabel(fields.copied ? "已复制" : "复制结果", systemImage: fields.copied ? "checkmark" : "doc.on.doc")
                        .font(.caption.weight(.medium)).frame(width: 78, height: 24)
                        .contentTransition(.opacity)
                }
                .buttonStyle(DeskButtonStyle()).disabled(estimate == nil)
                .animation(reduceMotion ? nil : DeskMotion.feedback, value: fields.copied)
            }
            Text(converted.map { ValueCurrency.money($0, fields.quote) } ??
                 (pair.isSame ? "— \(fields.base)" : "— \(fields.quote)"))
                .font(.system(size: 30, weight: .semibold, design: .monospaced))
                .minimumScaleFactor(0.62).lineLimit(1)
                .accessibilityLabel("折算剩余价值")
                .accessibilityValue(converted.map { ValueCurrency.money($0, fields.quote) } ?? "待计算")
            if let estimate {
                HStack(spacing: 8) {
                    if !pair.isSame {
                        Text("原币 \(ValueCurrency.money(estimate.amount, fields.base))")
                            .lineLimit(1).minimumScaleFactor(0.75)
                    }
                    Spacer(minLength: 4)
                    Text(estimate.days > 0 ? "剩余 \(estimate.days) 天" : "剩余 0 天")
                        .fontWeight(.semibold).monospacedDigit()
                }
                .font(.caption).foregroundStyle(.secondary)
                progress(estimate)
                Text(basis(estimate)).font(.caption2).foregroundStyle(.secondary)
            } else {
                Text(fields.amount.isEmpty ? "填写续费金额和到期日，结果会随输入更新。" : "请输入有效的续费金额。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(13).frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.selection.opacity(palette.dark ? 0.52 : 0.60), in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).strokeBorder(palette.accent.opacity(0.18)).allowsHitTesting(false) }
    }

    private func progress(_ estimate: RemainingValueEstimate) -> some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(palette.accent.opacity(0.13))
                Capsule().fill(palette.accent).frame(width: geometry.size.width * estimate.fraction)
            }
        }
        .frame(height: 4).accessibilityHidden(true)
    }

    private var renewalFields: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                Text("续费与到期").font(.system(size: 13, weight: .semibold))
                Spacer()
                if let topicTitle, let hint = RenewalTitleHint.extract(topicTitle) {
                    Button("从标题带入") {
                        fields.amount = hint.amount
                        fields.base = hint.currency
                        fields.cycle = hint.cycle
                    }
                    .font(.caption).buttonStyle(.borderless)
                    .help("采用标题里的 \(hint.amount) \(hint.currency) / \(hint.cycle.title)，请核对是否为续费价。")
                }
            }
            HStack(alignment: .top, spacing: 12) {
                field("每期续费金额") {
                    HStack(spacing: 4) {
                        number("例如 35.99", value: $fields.amount, label: "每期续费金额")
                        currency("续费币种", selection: $fields.base)
                    }
                }
                field("续费周期") {
                    Picker("续费周期", selection: $fields.cycle) {
                        ForEach(RenewalCycle.allCases) { Text($0.title).tag($0) }
                    }
                    .labelsHidden().frame(maxWidth: .infinity, alignment: .leading)
                }.frame(width: 114, alignment: .leading)
            }
            HStack(alignment: .top, spacing: 12) {
                field("到期日期") {
                    DatePicker("到期日期", selection: $fields.expires, displayedComponents: .date)
                        .datePickerStyle(.field).labelsHidden()
                }.frame(maxWidth: .infinity, alignment: .leading)
                field("计算日期") {
                    DatePicker("计算日期", selection: $fields.asOf, displayedComponents: .date)
                        .datePickerStyle(.field).labelsHidden()
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var exchangeFields: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("汇率换算").font(.system(size: 13, weight: .semibold))
                Spacer()
                Text("折算成").font(.caption).foregroundStyle(.secondary)
                currency("折算币种", selection: $fields.quote)
            }
            if pair.isSame {
                Text("同币种，无需换算。").font(.caption).foregroundStyle(.secondary)
            } else {
                Picker("汇率方式", selection: $fields.mode) {
                    Text("自动报价").tag(ValueRateMode.auto)
                    Text("手动汇率").tag(ValueRateMode.manual)
                }
                .pickerStyle(.segmented).labelsHidden()
                if fields.mode == .manual {
                    HStack(spacing: 7) {
                        Text("1 \(pair.base) =").monospacedDigit()
                        number("输入汇率", value: $fields.manualRate, label: "手动汇率")
                        Text(pair.quote)
                    }
                    .font(.callout)
                    if !fields.manualRate.isEmpty && activeRate == nil {
                        Text("请输入大于 0 的汇率。").font(.caption).foregroundStyle(.secondary)
                    }
                } else {
                    HStack(spacing: 7) {
                        if let quote {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(rateLine(quote.rate)).font(.system(size: 12, weight: .semibold, design: .monospaced))
                                HStack(spacing: 5) {
                                    Text(quote.caption())
                                    Text(quote.asOf.formatted(date: .abbreviated, time: .shortened)).monospacedDigit()
                                    Link(quote.source.name, destination: quote.source.link)
                                }.font(.caption2).foregroundStyle(.secondary)
                            }
                        } else if fields.fetching || fields.pricePair != pair {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.mini)
                                Text("正在获取汇率…").font(.caption).foregroundStyle(.secondary)
                            }
                        } else {
                            Text("暂时取不到报价。可重试或切到手动汇率。").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Button { fields.refresh += 1 } label: {
                            DeskIcon("arrow.clockwise").frame(width: 24, height: 24)
                        }
                        .buttonStyle(DeskButtonStyle()).disabled(fields.fetching)
                        .help("更新汇率").accessibilityLabel("更新汇率")
                    }
                    .frame(minHeight: 32)
                }
            }
        }
    }

    private var askingPrice: some View {
        HStack(alignment: .center, spacing: 12) {
            field("挂价（选填）") {
                HStack {
                    number("例如 180", value: $fields.asking, label: "挂价")
                    Text(fields.quote).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            .frame(width: 148, alignment: .leading)
            Spacer(minLength: 0)
            if let converted, let asking = ValueNumber.parse(fields.asking) {
                let delta = ValueCurrency.rounded(asking, fields.quote) - ValueCurrency.rounded(converted, fields.quote)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(delta > 0 ? "比剩余价值高" : delta < 0 ? "比剩余价值低" : "与剩余价值相同")
                        .font(.caption).foregroundStyle(.secondary)
                    Text(ValueCurrency.money(abs(delta), fields.quote)).font(.system(.callout, design: .monospaced).weight(.semibold))
                        .foregroundStyle(delta > 0 ? palette.categoryInk("trade") : palette.categoryInk("review"))
                        .lineLimit(1).minimumScaleFactor(0.65)
                }
            } else {
                Text(fields.asking.isEmpty || ValueNumber.parse(fields.asking) != nil ? "与折算价值对比" : "挂价格式无效")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            content().frame(minHeight: 25)
        }
    }

    private func number(_ placeholder: String, value: Binding<String>, label: String) -> some View {
        TextField(placeholder, text: value).textFieldStyle(.roundedBorder)
            .font(.system(.callout, design: .monospaced)).accessibilityLabel(label)
    }

    private func currency(_ title: String, selection: Binding<String>) -> some View {
        Menu {
            ForEach(ValueCurrency.common, id: \.self) { code in
                currencyOption(code, selection: selection)
            }
            Menu("更多币种") {
                ForEach(ValueCurrency.other, id: \.self) { code in
                    currencyOption(code, selection: selection)
                }
            }
        } label: {
            Text(selection.wrappedValue).font(.system(.callout, design: .monospaced).weight(.medium))
                .frame(minWidth: 29)
        }
        .menuStyle(.borderlessButton).fixedSize()
        .accessibilityLabel(title).accessibilityValue(selection.wrappedValue)
    }

    private func currencyOption(_ code: String, selection: Binding<String>) -> some View {
        Button { selection.wrappedValue = code } label: {
            if code == selection.wrappedValue { DeskLabel(ValueCurrency.title(code), systemImage: "checkmark", nativeMenu: true) }
            else { Text(ValueCurrency.title(code)) }
        }
    }

    private func basis(_ estimate: RemainingValueEstimate) -> String {
        if estimate.days == 0 { return "到期日不晚于计算日，剩余价值为 0。" }
        let partial = "\(estimate.partialDays) / \(estimate.partialCycleDays) 天"
        if estimate.fullCycles == 0 { return "续费金额 × \(partial)" }
        if estimate.partialDays == 0 { return "续费金额 × \(estimate.fullCycles) 个完整周期" }
        return "\(estimate.fullCycles) 个完整周期，另加 \(partial)"
    }

    private func rateLine(_ rate: Decimal) -> String {
        "1 \(pair.base) = \(rate.formatted(.number.precision(.fractionLength(2...9)))) \(pair.quote)"
    }

    @MainActor private func load(_ input: RateRequest) async {
        guard input.auto, !input.pair.isSame else { fields.fetching = false; return }
        fields.fetching = true
        let result = await ValueExchangeRates.shared.latest(input.pair, force: input.revision > 0)
        guard !Task.isCancelled, input == request else { return }
        fields.pricePair = input.pair
        fields.price = result
        fields.fetching = false
    }

    private func copy(_ estimate: RemainingValueEstimate) {
        var result = "剩余 \(estimate.days) 天 · \(ValueCurrency.money(estimate.amount, fields.base))"
        if !pair.isSame, let converted, let activeRate {
            result += " ≈ \(ValueCurrency.money(converted, fields.quote))（\(rateLine(activeRate))"
            if fields.mode == .manual { result += "，手动汇率" }
            else if let quote { result += "，\(quote.source.name) \(quote.asOf.formatted(date: .abbreviated, time: .shortened))" }
            result += "）"
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(result, forType: .string)
        fields.copied = true
        fields.resetCopy?.cancel()
        fields.resetCopy = Task { [weak fields] in
            try? await Task.sleep(for: .seconds(1.2))
            if !Task.isCancelled { fields?.copied = false }
        }
    }

    private struct RateRequest: Equatable { let pair: ValueCurrencyPair; let auto: Bool; let revision: Int }
}

private enum ValueRateMode { case auto, manual }

@MainActor private final class ValueCalculatorFields: ObservableObject {
    @Published var amount = ""
    @Published var base = "USD"
    @Published var quote = "CNY"
    @Published var cycle = RenewalCycle.yearly
    @Published var asOf = Date()
    @Published var expires = Date()
    @Published var asking = ""
    @Published var mode = ValueRateMode.auto
    @Published var manualRate = ""
    @Published var refresh = 0
    @Published var price: ValueExchangeQuote?
    @Published var pricePair: ValueCurrencyPair?
    @Published var fetching = false
    @Published var copied = false
    var resetCopy: Task<Void, Never>?
}
