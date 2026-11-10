import Foundation

enum ForumReportKind {
    case nq, tq

    var preference: String {
        switch self {
        case .nq: "workspace.nqReportScale"
        case .tq: "workspace.tqReportScale"
        }
    }

    var standard: Double { 100 }
    var range: ClosedRange<Double> { self == .nq ? 25...200 : 50...200 }
    var menuValues: [Int] { self == .nq ? [25, 50, 75, 100, 125, 150, 200] : [50, 75, 100, 125, 150, 200] }
    var resetTitle: String { self == .nq ? "恢复默认宽度（100%）" : "恢复默认大小（100%）" }
    var help: String {
        self == .nq ? "100% 为默认阅读宽度，长报告按原比例向下展开" : "100% 为默认阅读大小，缩放设置会自动记住"
    }

    func scale(_ value: Double) -> Double {
        value.isFinite ? min(range.upperBound, max(range.lowerBound, value)) : standard
    }

    static func classify(labels: [String], hasTerminal: Bool) -> Self? {
        if hasTerminal || labels.contains(where: {
            $0.range(of: #"基本信息|IP质量|网络质量|回程路由|NodeQuality|\bNQ\b"#, options: [.regularExpression, .caseInsensitive]) != nil
        }) { return .nq }
        if labels.contains(where: {
            $0.range(of: #"回程|路由|测速|互联|质量|IPv[46]|TCP|UDP"#, options: [.regularExpression, .caseInsensitive]) != nil
        }) { return .tq }
        return nil
    }
}

enum ForumReportSizing {
    // NQ uses a stable reading width: report length must never shrink its text.
    static let nqReadingWidth: CGFloat = 640
    static let tqBaselineMultiplier = 1.75

    static func migratePreferences(in defaults: UserDefaults = .standard) {
        let key = ForumReportKind.nq.preference
        if defaults.object(forKey: key) == nil, let previous = defaults.object(forKey: "workspace.nqReportWidth") as? NSNumber {
            defaults.set(ForumReportKind.nq.scale(previous.doubleValue / 2), forKey: key)
        }
    }

    static func height(in viewport: CGSize) -> CGFloat {
        max(160, min(440, viewport.height * 0.55))
    }

    static func renderedSize(_ natural: CGSize, width: CGFloat, height: CGFloat, percentage: Double, kind: ForumReportKind) -> CGSize {
        guard natural.width.isFinite, natural.height.isFinite, natural.width > 0, natural.height > 0 else { return .zero }
        let available = max(1, width)
        let factor: CGFloat
        switch kind {
        case .nq:
            factor = min(nqReadingWidth, available) / natural.width * kind.scale(percentage) / kind.standard
        case .tq:
            let fit = min(1, available / natural.width, max(1, height) / natural.height)
            // The former 175% is the new 100%; keep that baseline inside the column.
            factor = min(fit * tqBaselineMultiplier, available / natural.width) * kind.scale(percentage) / kind.standard
        }
        return CGSize(width: natural.width * factor, height: natural.height * factor)
    }
}
