import SwiftUI
import UserNotifications

enum DeskExtension: String, CaseIterable, Identifiable {
    case hot, attendance, office, value, block, authorOnly, keywords, rulings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .hot: "NodeSeek 热榜"
        case .attendance: "每日签到"
        case .office: "摸鱼老板键"
        case .value: "剩余价值计算器"
        case .block: "屏蔽用户"
        case .authorOnly: "只看楼主"
        case .keywords: "关键词监控"
        case .rulings: "管理记录查询"
        }
    }

    var icon: String {
        switch self {
        case .hot: "flame"
        case .attendance: "calendar.badge.checkmark"
        case .office: "tablecells.fill"
        case .value: "plus.forwardslash.minus"
        case .block: "person.crop.circle.badge.minus"
        case .authorOnly: "person.text.rectangle"
        case .keywords: "dot.radiowaves.left.and.right"
        case .rulings: "shield.lefthalf.filled"
        }
    }

    var description: String {
        switch self {
        case .hot: "查看实时、日榜和周榜。"
        case .attendance: "每天零点签到领鸡腿，可选固定或运气签到。"
        case .office: "把论坛窗口切换为工作表，支持自定义快捷键。"
        case .value: "在帖子里估算剩余价值、换算币种并对比挂价。"
        case .block: "折叠指定用户的主题正文和回复，可在原楼层解除屏蔽。"
        case .authorOnly: "在帖子内显示楼主的正文和回复。"
        case .keywords: "后台每 10 秒检查 RSS 新帖，命中时显示弹窗。"
        case .rulings: "从帖子作者旁打开 NodeSeek 的管理记录查询。"
        }
    }
}

@MainActor
final class DeskExtensions: ObservableObject {
    struct BlockedAuthor: Codable, Identifiable, Equatable {
        let memberID: Int?
        let name: String
        var id: String { memberID.map { "member:\($0)" } ?? "name:\(ForumSearch.normalized(name))" }

        func matches(_ id: Int?, name: String) -> Bool {
            if let id, let memberID { return id == memberID }
            return ForumSearch.normalized(self.name) == ForumSearch.normalized(name)
        }
    }

    struct Hit: Identifiable {
        let post: FeedPost
        let words: [String]
        var id: String { post.id }
    }

    struct WatchPopup {
        let id = UUID()
        let hits: [Hit]
    }

    private struct WatchHistory: Codable {
        let terms: [String]
        var ids: [String]
    }

    private let defaults: UserDefaults
    private let fetchWatchPosts: (() async throws -> [FeedPost]?)?
    private var watchHistory: WatchHistory?
    private var monitoringStarted = false
    private var monitoredTerms: [String] = []
    private var watchTask: Task<Void, Never>?
    @Published private(set) var installed: Set<DeskExtension>
    @Published private(set) var enabled: Set<DeskExtension>
    @Published private(set) var blocked: [BlockedAuthor]
    @Published private(set) var pendingBlock: BlockedAuthor?
    @Published var officeTitle: String { didSet { defaults.set(officeTitle, forKey: "extensions.office.title") } }
    @Published var officeButton: String { didSet { defaults.set(officeButton, forKey: "extensions.office.button") } }
    @Published var officeKey: String { didSet { defaults.set(officeKey, forKey: "extensions.office.key") } }
    @Published var watchWords: String {
        didSet {
            defaults.set(watchWords, forKey: "extensions.keywords.words")
            updateKeywordMonitoring()
        }
    }
    @Published var watchNote: String {
        didSet { defaults.set(watchNote, forKey: "extensions.keywords.note") }
    }
    @Published private(set) var watchSystemNotifications: Bool
    @Published private(set) var watchNotificationAccess: UNAuthorizationStatus = .notDetermined
    @Published private(set) var watchPopup: WatchPopup?
    @Published var attendanceMode: ForumAttendanceMode {
        didSet { defaults.set(attendanceMode.rawValue, forKey: "extensions.attendance.mode") }
    }
    @Published var autoAttendance: Bool {
        didSet { defaults.set(autoAttendance, forKey: "extensions.attendance.automatic") }
    }
    @Published private(set) var hits: [Hit] = []
    @Published private(set) var unread = 0
    @Published private(set) var lastCheck: Date?
    @Published private(set) var watchFailed = false
    @Published var officePresented = false

    init(defaults: UserDefaults = .standard, fetchWatchPosts: (() async throws -> [FeedPost]?)? = nil) {
        self.defaults = defaults
        self.fetchWatchPosts = fetchWatchPosts
        installed = Set((defaults.stringArray(forKey: "extensions.installed") ?? ["hot"]).compactMap(DeskExtension.init(rawValue:)))
        enabled = Set((defaults.stringArray(forKey: "extensions.enabled") ?? ["hot"]).compactMap(DeskExtension.init(rawValue:)))
        officeTitle = defaults.string(forKey: "extensions.office.title") ?? "工作计划"
        officeButton = defaults.string(forKey: "extensions.office.button") ?? "切换办公视图"
        officeKey = defaults.string(forKey: "extensions.office.key") ?? "9"
        watchWords = defaults.string(forKey: "extensions.keywords.words") ?? ""
        watchNote = defaults.string(forKey: "extensions.keywords.note") ?? ""
        watchSystemNotifications = defaults.bool(forKey: "extensions.keywords.systemNotifications")
        watchHistory = defaults.data(forKey: "extensions.keywords.history").flatMap {
            try? JSONDecoder().decode(WatchHistory.self, from: $0)
        }
        attendanceMode = defaults.string(forKey: "extensions.attendance.mode").flatMap(ForumAttendanceMode.init(rawValue:)) ?? .fixed
        autoAttendance = defaults.bool(forKey: "extensions.attendance.automatic")
        blocked = defaults.data(forKey: "extensions.block.authors").flatMap {
            try? JSONDecoder().decode([BlockedAuthor].self, from: $0)
        } ?? []
    }

    func active(_ item: DeskExtension) -> Bool { installed.contains(item) && enabled.contains(item) }

    func install(_ item: DeskExtension) {
        installed.insert(item)
        setEnabled(item, true)
    }

    func setEnabled(_ item: DeskExtension, _ isEnabled: Bool) {
        guard installed.contains(item) else { return }
        if isEnabled { enabled.insert(item) } else { enabled.remove(item) }
        if item == .office && !isEnabled { officePresented = false }
        if item == .block && !isEnabled { cancelBlock() }
        if item == .keywords {
            if !isEnabled { dismissWatchPopup() }
            updateKeywordMonitoring()
        }
        persistExtensions()
    }

    func remove(_ item: DeskExtension) {
        setEnabled(item, false)
        if item == .attendance { autoAttendance = false }
        if item == .keywords { setWatchSystemNotifications(false) }
        installed.remove(item)
        persistExtensions()
    }

    func requestBlock(_ id: Int?, name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard active(.block), !name.isEmpty, !blocks(id, name: name) else { return }
        pendingBlock = BlockedAuthor(memberID: id, name: name)
    }

    func cancelBlock() { pendingBlock = nil }

    func confirmBlock(_ author: BlockedAuthor) {
        cancelBlock()
        guard active(.block), !blocks(author.memberID, name: author.name) else { return }
        blocked.append(author)
        persistBlocklist()
    }

    func unblock(_ author: BlockedAuthor) {
        blocked.removeAll { $0.id == author.id }
        persistBlocklist()
    }

    func unblock(_ id: Int?, name: String) {
        blocked.removeAll { $0.matches(id, name: name) }
        persistBlocklist()
    }

    func blocks(_ id: Int?, name: String) -> Bool {
        guard active(.block) else { return false }
        return blocked.contains { $0.matches(id, name: name) }
    }

    var watchTerms: [String] {
        let groups = watchWords.split(whereSeparator: { ",，、;；\n".contains($0) }).compactMap { group -> String? in
            let words = group.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "+" || $0 == "＋" })
                .map { ForumSearch.normalized($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
            guard !words.isEmpty, words.allSatisfy({ !$0.isEmpty }) else { return nil }
            return Set(words).sorted().joined(separator: "+")
        }
        return Array(Set(groups).sorted().prefix(25))
    }

    func acknowledgeHits() { unread = 0 }
    func dismissWatchPopup() { watchPopup = nil }

    func setWatchSystemNotifications(_ enabled: Bool) {
        watchSystemNotifications = enabled
        defaults.set(enabled, forKey: "extensions.keywords.systemNotifications")
        guard enabled else { return }
        Task {
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            if watchSystemNotifications, settings.authorizationStatus == .notDetermined {
                _ = try? await center.requestAuthorization(options: [.alert, .sound])
            }
            await refreshWatchNotificationAccess()
        }
    }

    func refreshWatchNotificationAccess() async {
        watchNotificationAccess = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
    }

    func checkKeywords(in posts: [FeedPost]) {
        let terms = watchTerms
        guard active(.keywords), !terms.isEmpty else { return }
        prepareWatch(for: terms)
        lastCheck = Date()
        let groups = terms.map { $0.split(separator: "+") }
        let matches = posts.compactMap { post -> Hit? in
            guard !blocks(post.authorID, name: post.author) else { return nil }
            let body = ForumSearch.normalized(post.title + " " + post.summary)
            let found = groups.filter { $0.allSatisfy { body.contains($0) } }
                .map { $0.joined(separator: " + ") }
            return found.isEmpty ? nil : Hit(post: post, words: found)
        }
        var known = Set(watchHistory?.ids ?? [])
        let fresh = matches.filter { known.insert($0.id).inserted }
        var visible = Set(hits.map(\.id))
        let newRows = matches.filter { visible.insert($0.id).inserted }
        if !newRows.isEmpty { hits = Array((newRows + hits).prefix(60)) }
        guard !fresh.isEmpty else { return }
        let ids = Array((fresh.map(\.id) + (watchHistory?.ids ?? [])).prefix(1000))
        let history = WatchHistory(terms: terms, ids: ids)
        watchHistory = history
        if let data = try? JSONEncoder().encode(history) { defaults.set(data, forKey: "extensions.keywords.history") }
        unread += fresh.count
        watchPopup = WatchPopup(hits: Array((fresh + (watchPopup?.hits ?? [])).prefix(60)))
        if watchSystemNotifications {
            Task { await notifyWatchMatches(fresh) }
        }
    }

    private var displayedWatchTerms: [String] = []

    private func prepareWatch(for terms: [String]) {
        guard displayedWatchTerms != terms else { return }
        displayedWatchTerms = terms
        if watchHistory?.terms != terms { watchHistory = nil }
        hits = []
        unread = 0
        watchPopup = nil
        lastCheck = nil
        watchFailed = false
    }

    private func notifyWatchMatches(_ hits: [Hit]) async {
        let center = UNUserNotificationCenter.current()
        let status = await center.notificationSettings().authorizationStatus
        watchNotificationAccess = status
        guard watchSystemNotifications, active(.keywords),
              status == .authorized || status == .provisional,
              let request = KeywordNotification.request(for: hits) else { return }
        try? await center.add(request)
    }

    func startKeywordMonitoring() {
        monitoringStarted = true
        updateKeywordMonitoring()
    }

    private func updateKeywordMonitoring() {
        guard monitoringStarted else { return }
        let terms = active(.keywords) ? watchTerms : []
        guard terms != monitoredTerms else { return }
        monitoredTerms = terms
        watchTask?.cancel()
        watchTask = nil
        if active(.keywords) { prepareWatch(for: terms) }
        guard !terms.isEmpty else { return }

        watchTask = Task { [weak self, fetchWatchPosts] in
            var poller = ForumFeed.Poller()
            defer { poller.stop() }
            let clock = ContinuousClock()
            var failures = 0
            while !Task.isCancelled && self != nil {
                var next = clock.now.advanced(by: .seconds(10))
                do {
                    let posts: [FeedPost]?
                    if let fetchWatchPosts { posts = try await fetchWatchPosts() }
                    else { posts = try await poller.poll() }
                    try Task.checkCancellation()
                    if let posts { self?.checkKeywords(in: posts) }
                    else { self?.lastCheck = Date() }
                    if self?.watchFailed == true { self?.watchFailed = false }
                    failures = 0
                } catch {
                    if Task.isCancelled { return }
                    if self?.watchFailed == false { self?.watchFailed = true }
                    failures = min(failures + 1, 4)
                    let delay: TimeInterval
                    if let retry = error as? ForumFeed.RetryLater {
                        delay = retry.seconds
                    } else {
                        delay = min(120, 10 * pow(2, Double(failures)))
                    }
                    next = clock.now.advanced(by: .seconds(delay))
                }
                let deadline = max(next, clock.now.advanced(by: .seconds(1)))
                do { try await clock.sleep(until: deadline, tolerance: .milliseconds(200)) } catch { return }
            }
        }
    }

    var shortcut: KeyEquivalent { KeyEquivalent(officeKey.first ?? "9") }

    private func persistExtensions() {
        defaults.set(installed.map(\.rawValue), forKey: "extensions.installed")
        defaults.set(enabled.map(\.rawValue), forKey: "extensions.enabled")
    }

    private func persistBlocklist() {
        defaults.set(try? JSONEncoder().encode(blocked), forKey: "extensions.block.authors")
    }
}
