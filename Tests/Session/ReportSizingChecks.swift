import Foundation

func checkReportSizing() {
    let short = CGSize(width: 900, height: 700)
    let long = CGSize(width: 900, height: 2800)
    let nq = ForumReportSizing.renderedSize(short, width: 950, height: 440, percentage: 100, kind: .nq)
    let nqLong = ForumReportSizing.renderedSize(long, width: 950, height: 220, percentage: 100, kind: .nq)
    precondition(nq.width == nqLong.width && nq.width == ForumReportSizing.nqReadingWidth)
    precondition(abs(nqLong.height / nq.height - 4) < 0.001)
    let narrow = ForumReportSizing.renderedSize(long, width: 380, height: 160, percentage: 100, kind: .nq)
    precondition(narrow.width == 380 && narrow.height > 1000)
    let nqHalf = ForumReportSizing.renderedSize(long, width: 950, height: 440, percentage: 50, kind: .nq)
    precondition(nqHalf.width == nqLong.width / 2)

    let tqNatural = CGSize(width: 900, height: 1100)
    let tq = ForumReportSizing.renderedSize(tqNatural, width: 900, height: 440, percentage: 100, kind: .tq)
    precondition(abs(tq.height - 440 * 1.75) < 0.001)
    let tqSmall = ForumReportSizing.renderedSize(tqNatural, width: 400, height: 440, percentage: 100, kind: .tq)
    precondition(tqSmall.width <= 400.001)
    let tqZoom = ForumReportSizing.renderedSize(tqNatural, width: 900, height: 440, percentage: 150, kind: .tq)
    precondition(abs(tqZoom.height / tq.height - 1.5) < 0.001)
    precondition(ForumReportKind.nq.preference != ForumReportKind.tq.preference)
    precondition(ForumReportKind.nq.scale(.nan) == 100 && ForumReportKind.tq.scale(.infinity) == 100)
    let suite = "SeekDesk.report-sizing.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.set(200, forKey: "workspace.nqReportWidth")
    ForumReportSizing.migratePreferences(in: defaults)
    precondition(defaults.double(forKey: ForumReportKind.nq.preference) == 100)
    defaults.set(125, forKey: ForumReportKind.nq.preference)
    ForumReportSizing.migratePreferences(in: defaults)
    precondition(defaults.double(forKey: ForumReportKind.nq.preference) == 125)
    precondition(ForumReportKind.classify(labels: ["💻基本信息", "🎬IP质量", "📍回程路由"], hasTerminal: false) == .nq)
    precondition(ForumReportKind.classify(labels: ["IPv4回程", "IPv4大包回程", "单线程测速"], hasTerminal: false) == .tq)
    precondition(ForumReportKind.classify(labels: ["测试"], hasTerminal: true) == .nq)
    precondition(ForumReportKind.classify(labels: ["正文", "评论"], hasTerminal: false) == nil)
    print("Passed stable NQ width and proportional long reports, TQ baseline, narrow columns and separate zoom preferences.")
}
