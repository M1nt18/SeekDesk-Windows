import AppKit
import Combine
import SwiftUI
import WebKit

@MainActor
final class ForumSession: ObservableObject {
    enum Account { case unconfirmed, signedOut, signedIn }

    enum AccountPanel { case profile, compose }

    struct Access: Identifiable {
        let id = UUID()
        let url: URL
        let verification: Bool
        let returnTo: AccountPanel?
    }

    enum Presentation: Identifiable {
        case access(Access), profile, compose, rulings(String), user(ForumUserReference)

        var id: String {
            switch self {
            case .access(let access): access.id.uuidString
            case .profile: "profile"
            case .compose: "compose"
            case .rulings(let name): "rulings-\(name)"
            case .user(let person): "user-\(person.id)"
            }
        }
    }

    struct Receipt: Equatable {
        let message: String
        var destination: URL? = nil
        var accepted = false
        var verify = false
    }

    @Published private(set) var account: Account = .unconfirmed
    @Published var presentation: Presentation?
    var access: Access? {
        if case .access(let request) = presentation { return request }
        return nil
    }
    @Published private(set) var accessRevision = 0
    @Published private(set) var memberID: Int?
    var accessDidChange: (() -> Void)?
    var canCompose: Bool { account == .signedIn && memberID != nil }
    struct Authorization: Equatable { let revision: Int; let owner: Int? }
    var authorization: Authorization { Authorization(revision: accessRevision, owner: memberID) }
    func authorizes(_ token: Authorization) -> Bool {
        canCompose && token == authorization
    }
    @Published private(set) var sending: Set<String> = []
    @Published private(set) var receipts: [String: Receipt] = [:]
    @Published private(set) var reactionPending: ForumReactionTarget?
    @Published private(set) var reactionMarks: [ForumReactionTarget: ForumReactionResult] = [:]
    private var pendingReplyNavigation = Set<String>()
    @Published private(set) var titles: [String: String] = [:]
    @Published private(set) var drafts: [String: String] = [:]
    @Published var messageDrafts: [Int: String] = [:] { didSet { persistDrafts() } }
    @Published var messageStatus: [Int: String] = [:]
    @Published var sendingMessages: Set<Int> = []
    @Published private(set) var profiles: [Int: ForumUserProfile] = [:]
    @Published private(set) var ownProfile: ForumProfile?
    @Published private(set) var ownIntroduction: ForumIntroduction?
    @Published private(set) var conversationContacts: [ForumConversationContact] = []
    @Published private(set) var unread = ForumUnreadCounts()
    @Published var requestedPeer: ForumConversation?
    private var profileRequests: [Int: UUID] = [:]
    private var profileUpdated: [Int: Date] = [:]
    @Published private(set) var profileFailures: Set<Int> = []
    @Published private(set) var profileLoading: Set<Int> = []
    private let profileLifetime: TimeInterval = 180
    private var savingIntroduction = false
    private var unreadPage: ForumWebPage?
    private var checkingUnread = false
    private var unreadRevision = 0
    private var queuedUnreadRefresh = false
    private var nextOwnProfileRefresh = Date.distantPast
    private var conversationContactOwner: Int?
    private var threadMemory: [URL: ForumThread] = [:]
    private var recentPages: [URL] = []
    private var readingAnchors: [URL: String] = [:]
    private var pendingEdits: [URL: ForumInlineEdit] = [:]
    enum DraftScope: Hashable {
        case reply(String), message(Int)
        var storageKey: String {
            switch self { case .reply(let id): "reply:" + id; case .message(let id): "message:\(id)" }
        }
        init?(storageKey: String) {
            if storageKey.hasPrefix("reply:") { self = .reply(String(storageKey.dropFirst(6))) }
            else if storageKey.hasPrefix("message:"), let id = Int(storageKey.dropFirst(8)) { self = .message(id) }
            else { return nil }
        }
    }
    private var draftImages: [DraftScope: DraftImageSizing] = [:]
    let dataStore: WKWebsiteDataStore
    @Published private(set) var newDiscussion = NewDiscussionDraft()
    private let defaults: UserDefaults
    private let requests: Requests
    private let profileNow: () -> Date
    struct Requests {
        var reply: (ForumWebPage, Int, String) async throws -> String?
        var profile: (ForumWebPage, Int, Bool) async throws -> String?
        static var live: Self {
            Self(reply: { page, id, content in
                try await page.webView.callAsyncJavaScript(ForumPageScript.reply,
                    arguments: ["postId": id, "content": content], in: nil, contentWorld: .defaultClient) as? String
            }, profile: { page, id, readme in
                try await page.webView.callAsyncJavaScript(ForumAccountScript.userProfile,
                    arguments: ["member": id, "includeReadme": readme], in: nil, contentWorld: .defaultClient) as? String
            })
        }
    }
    private var restoringDrafts = false

    init(defaults: UserDefaults = .standard, dataStore: WKWebsiteDataStore? = nil, requests: Requests? = nil, profileNow: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.requests = requests ?? .live
        self.profileNow = profileNow
        self.dataStore = dataStore ?? .default()
        newDiscussion.didChange = { [weak self] in self?.persistDrafts() }
        newDiscussion.imageSizing.didChange = { [weak self] in self?.persistDrafts() }
    }

    private func persistDrafts() {
        guard !restoringDrafts, let owner = memberID else { return }
        var images = Dictionary(uniqueKeysWithValues: draftImages.map { ($0.key.storageKey, $0.value.sizes) })
        images["discussion"] = newDiscussion.imageSizing.sizes
        let value = ForumDraftSnapshot(replies: drafts, messages: messageDrafts,
                                      discussion: newDiscussion.snapshot, images: images)
        if let data = try? JSONEncoder().encode(value) { defaults.set(data, forKey: "forum.drafts.v1.\(owner)") }
    }

    private func restoreDrafts(for owner: Int?) {
        for sizing in draftImages.values { sizing.didChange = nil }
        newDiscussion.didChange = nil
        newDiscussion.imageSizing.didChange = nil
        restoringDrafts = true
        defer { restoringDrafts = false }
        let saved = owner.flatMap { defaults.data(forKey: "forum.drafts.v1.\($0)") }
            .flatMap { try? JSONDecoder().decode(ForumDraftSnapshot.self, from: $0) } ?? ForumDraftSnapshot()
        drafts = saved.replies
        messageDrafts = saved.messages
        draftImages = [:]
        for (key, sizes) in saved.images {
            guard let scope = DraftScope(storageKey: key) else { continue }
            let sizing = DraftImageSizing()
            sizing.restore(sizes)
            sizing.didChange = { [weak self] in self?.persistDrafts() }
            draftImages[scope] = sizing
        }
        let discussion = NewDiscussionDraft()
        discussion.restore(saved.discussion)
        discussion.imageSizing.restore(saved.images["discussion"] ?? [:])
        discussion.didChange = { [weak self, weak discussion] in
            guard let self, self.newDiscussion === discussion else { return }
            self.persistDrafts()
        }
        discussion.imageSizing.didChange = discussion.didChange
        newDiscussion = discussion
    }

    /// Invalidate every visible/request state derived from the current identity.
    /// The cookie store itself is kept so the official login can be rechecked.
    private func invalidateAccess() {
        persistDrafts()
        memberID = nil
        restoreDrafts(for: nil)
        ownProfile = nil
        ownIntroduction = nil
        requestedPeer = nil
        clearConversationContacts()
        unreadRevision += 1
        unread = ForumUnreadCounts()
        unreadPage = nil
        nextOwnProfileRefresh = .distantPast
        clearThreadMemory()
        pendingEdits.removeAll()
        titles.removeAll()
        receipts.removeAll()
        pendingReplyNavigation.removeAll()
        sending.removeAll()
        sendingMessages.removeAll()
        messageStatus.removeAll()
        reactionPending = nil
        savingIntroduction = false
        profiles.removeAll()
        profileRequests.removeAll()
        profileLoading.removeAll()
        profileUpdated.removeAll()
        profileFailures.removeAll()
        accessRevision += 1
        accessDidChange?()
    }

    func observeIdentity(_ identity: ForumIdentity) {
        observeAccount(identity.signedIn)
        if identity.signedIn, let id = identity.id { confirmOwner(id) }
    }

    private func confirmOwner(_ id: Int) {
        guard account == .signedIn, memberID != id else { return }
        invalidateAccess()
        memberID = id
        restoreDrafts(for: id)
    }

    func signIn() { showAccess(Forum.signIn, verification: false) }
    func verify(_ url: URL) { showAccess(url, verification: true) }

    private func showAccess(_ url: URL, verification: Bool) {
        let panel: AccountPanel?
        switch presentation {
        case .profile: panel = .profile
        case .compose: panel = .compose
        default: panel = nil
        }
        presentation = .access(Access(url: url, verification: verification, returnTo: panel))
    }

    func observeAccount(_ signedIn: Bool) {
        let state: Account = signedIn ? .signedIn : .signedOut
        guard account != state else { return }
        let previous = account
        account = state
        if !signedIn || previous == .signedOut { invalidateAccess() }
    }

    func cachedThread(at url: URL) -> ForumThread? { threadMemory[Forum.pageURL(url)] }

    func invalidateThread(_ id: String) {
        threadMemory = threadMemory.filter { Forum.topicID($0.key) != id }
        recentPages.removeAll { Forum.topicID($0) == id }
    }

    func pendingEdit(at url: URL) -> ForumInlineEdit? { pendingEdits[Forum.pageURL(url)] }

    func rememberEdit(_ edit: ForumInlineEdit?, at url: URL) { pendingEdits[Forum.pageURL(url)] = edit }

    func cacheThread(_ thread: ForumThread, at url: URL) {
        let pageURL = Forum.pageURL(url)
        threadMemory[pageURL] = thread
        recentPages.removeAll { $0 == pageURL }
        recentPages.append(pageURL)
        if recentPages.count > 4 {
            let discarded = recentPages.removeFirst()
            threadMemory.removeValue(forKey: discarded)
            readingAnchors.removeValue(forKey: discarded)
        }
    }

    func anchor(at url: URL) -> String? { readingAnchors[Forum.pageURL(url)] }

    func rememberAnchor(_ anchor: String, at url: URL) {
        let page = Forum.pageURL(url)
        if threadMemory[page] != nil { readingAnchors[page] = anchor }
    }

    private func clearThreadMemory() {
        threadMemory.removeAll()
        recentPages.removeAll()
        readingAnchors.removeAll()
        reactionMarks.removeAll()
    }

    func react(_ target: ForumReactionTarget, approval: ForumReactionApproval, owner: Int, on page: ForumWebPage) async -> ForumReactionResult? {
        guard reactionPending == nil, reactionMarks[target] == nil, account == .signedIn, ownProfile?.id == owner else { return nil }
        let access = accessRevision
        reactionPending = target
        defer { if access == accessRevision { reactionPending = nil } }
        let value = try? await page.webView.callAsyncJavaScript(ForumReactionScript.request,
            arguments: ["postID": target.postID, "floor": target.floor, "kind": target.kind.rawValue,
                        "approval": approval.rawValue, "owner": owner], in: nil, contentWorld: .page)
        guard access == accessRevision, account == .signedIn, ownProfile?.id == owner else { return nil }
        let result = (value as? String).flatMap { try? JSONDecoder().decode(ForumReactionResult.self, from: Data($0.utf8)) }
            ?? ForumReactionResult(kind: approval == .quote ? .rejected : .unknown)
        switch result.kind {
        case .accepted, .already:
            if reactionMarks.count >= 256, let oldest = reactionMarks.keys.first { reactionMarks.removeValue(forKey: oldest) }
            reactionMarks[target] = result
            if result.kind == .accepted, target.kind != .upvote {
                if let coin = result.coin, var profile = ownProfile {
                    profile.coin = coin
                    ownProfile = profile
                }
                nextOwnProfileRefresh = .distantPast
                Task { await refreshUnread(afterWrite: true) }
            }
        case .signedOut: observeAccount(false)
        default: break
        }
        return result
    }

    func acknowledgedRead(_ category: InboxCategory, count: Int) async {
        unreadRevision += 1
        var counts = unread
        counts.markRead(category, count: count)
        if counts != unread { unread = counts }
        await refreshUnread(afterWrite: true)
    }

    func refreshUnread(afterWrite: Bool = false) async {
        guard !checkingUnread else {
            queuedUnreadRefresh = true
            return
        }
        checkingUnread = true
        let revision = unreadRevision
        let access = accessRevision
        defer {
            checkingUnread = false
            if queuedUnreadRefresh {
                queuedUnreadRefresh = false
                Task { await refreshUnread() }
            }
        }
        do {
            let page: ForumWebPage
            if let unreadPage {
                page = unreadPage
            } else {
                page = ForumWebPage(dataStore: dataStore)
                try await page.read(Forum.home)
                guard !page.challenged, let signedIn = try await page.signedIn() else { return }
                try Task.checkCancellation()
                guard access == accessRevision else { return }
                observeAccount(signedIn)
                guard signedIn else { return }
                unreadPage = page
            }
            let value = try await page.webView.callAsyncJavaScript(ForumAccountScript.unread,
                arguments: [:], in: nil, contentWorld: .defaultClient)
            try Task.checkCancellation()
            guard revision == unreadRevision else { return }
            if let json = value as? String {
                let counts = try JSONDecoder().decode(ForumUnreadCounts.self, from: Data(json.utf8))
                if counts != unread { unread = counts }
            } else {
                unreadPage = nil
            }
            if Date() >= nextOwnProfileRefresh { await refreshOwnProfile(using: page) }
        } catch {
            if !Task.isCancelled, access == accessRevision { unreadPage = nil }
        }
    }

    private func refreshOwnProfile(using page: ForumWebPage) async {
        let revision = accessRevision
        do {
            guard let identity = try await page.identity(), identity.signedIn, let id = identity.id,
                  !Task.isCancelled, revision == accessRevision, account == .signedIn else { return }
            observeIdentity(identity)
            let profileAccess = accessRevision
            let raw = try await page.webView.callAsyncJavaScript(ForumAccountScript.read,
                arguments: ["route": "profile", "selfID": id, "peerID": 0], in: nil, contentWorld: .defaultClient)
            guard !Task.isCancelled, profileAccess == accessRevision, account == .signedIn, let json = raw as? String else { return }
            struct Reply: Decodable { let kind: String; let data: ForumProfile? }
            let reply = try JSONDecoder().decode(Reply.self, from: Data(json.utf8))
            if reply.kind == "signedOut" { observeAccount(false) }
            if let profile = reply.data, profile.id == id { updateOwnProfile(profile) }
        } catch {}
    }

    func updateOwnProfile(_ profile: ForumProfile) {
        guard account == .signedIn else { return }
        confirmOwner(profile.id)
        if ownProfile != profile { ownProfile = profile }
        nextOwnProfileRefresh = Date().addingTimeInterval(180)
    }

    func introduction(for owner: Int, draft: ForumIntroduction? = nil, original: ForumIntroduction? = nil) async -> ForumIntroductionResult {
        guard account == .signedIn, ownProfile?.id == owner else { return .init(kind: .signedOut) }
        guard !savingIntroduction else { return .init(kind: .unavailable) }
        let access = accessRevision
        savingIntroduction = draft != nil
        defer { if access == accessRevision, draft != nil { savingIntroduction = false } }
        let page = ForumWebPage(dataStore: dataStore)
        do {
            try await page.read(Forum.home)
            if page.challenged { return .init(kind: .verification) }
            guard access == accessRevision, account == .signedIn, ownProfile?.id == owner else { return .init(kind: .signedOut) }
            let changes = draft.map { ["signature": $0.signature, "readme": $0.readme] as Any } ?? NSNull()
            let baseline = original.map { ["signature": $0.signature, "readme": $0.readme] as Any } ?? NSNull()
            let value = try await page.webView.callAsyncJavaScript(ForumIntroductionScript.request,
                arguments: ["owner": owner, "draft": changes, "original": baseline], in: nil, contentWorld: .page)
            guard access == accessRevision, account == .signedIn, ownProfile?.id == owner else { return .init(kind: .signedOut) }
            guard let json = value as? String else { return .init(kind: draft == nil ? .unavailable : .unknown) }
            let result = try JSONDecoder().decode(ForumIntroductionResult.self, from: Data(json.utf8))
            if (result.kind == .ready || result.kind == .saved), let data = result.data, !Task.isCancelled {
                ownIntroduction = data
                if var profile = profiles[owner] {
                    profile.readme = data.readme
                    profile.signature_markdown = data.signature
                    profiles[owner] = profile
                }
            }
            return result
        } catch { return .init(kind: draft == nil ? .unavailable : .unknown) }
    }

    func rememberConversationContacts(_ contacts: [ForumConversationContact], for member: Int) {
        guard account == .signedIn, ownProfile?.id == nil || ownProfile?.id == member else { return }
        let key = "forum.conversationContacts.\(member)"
        if conversationContactOwner != member {
            conversationContactOwner = member
            conversationContacts = UserDefaults.standard.data(forKey: key).flatMap {
                try? JSONDecoder().decode([ForumConversationContact].self, from: $0)
            } ?? []
        }
        let known = Dictionary(conversationContacts.map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        var seen = Set<Int>()
        let updated = Array((contacts + conversationContacts).compactMap { contact -> ForumConversationContact? in
            guard contact.id != member, seen.insert(contact.id).inserted else { return nil }
            return ForumConversationContact(id: contact.id, name: contact.name.isEmpty ? known[contact.id] ?? "" : contact.name)
        }.prefix(500))
        guard updated != conversationContacts else { return }
        conversationContacts = updated
        if let data = try? JSONEncoder().encode(updated) { UserDefaults.standard.set(data, forKey: key) }
    }

    private func clearConversationContacts() {
        conversationContactOwner = nil
        conversationContacts = []
    }

    func attend(member: Int, mode: ForumAttendanceMode, authorized: () -> Bool) async -> ForumAttendanceResult? {
        let revision = accessRevision
        let page = ForumWebPage(dataStore: dataStore)
        do {
            try await page.read(Forum.home)
            if page.challenged { return ForumAttendanceResult(kind: .verification) }
            guard let identity = try await page.identity() else {
                if page.webView.url?.path == Forum.signIn.path { return ForumAttendanceResult(kind: .signedOut) }
                return ForumAttendanceResult(kind: .failed)
            }
            guard !Task.isCancelled, revision == accessRevision, authorized() else { return nil }
            guard identity.signedIn else {
                observeAccount(false)
                return ForumAttendanceResult(kind: .signedOut)
            }
            guard identity.id == member, ownProfile?.id == member else {
                unreadPage = nil
                nextOwnProfileRefresh = .distantPast
                return nil
            }
            let raw = try await page.webView.callAsyncJavaScript(ForumAccountScript.attendance,
                arguments: ["randomMode": mode == .random], in: nil, contentWorld: .defaultClient)
            guard let json = raw as? String else { return ForumAttendanceResult(kind: .failed) }
            let result = try JSONDecoder().decode(ForumAttendanceResult.self, from: Data(json.utf8))
            if revision == accessRevision, result.done {
                if let current = result.current, var profile = ownProfile, profile.id == member, profile.coin != current {
                    profile.coin = current
                    ownProfile = profile
                }
                nextOwnProfileRefresh = .distantPast
                Task { await refreshUnread(afterWrite: true) }
            } else if revision == accessRevision, result.kind == .signedOut {
                observeAccount(false)
            }
            return result
        } catch {
            if Task.isCancelled { return nil }
            return ForumAttendanceResult(kind: (error as? ForumPageError) == .verification ? .verification : .failed)
        }
    }

    func loadProfile(_ id: Int, using existingPage: ForumWebPage? = nil, includeReadme: Bool = false,
                     force: Bool = false) async {
        let revision = accessRevision
        func loaded() -> Bool {
            guard let date = profileUpdated[id], profileNow().timeIntervalSince(date) < profileLifetime else { return false }
            return profiles[id].map { !includeReadme || $0.readme != nil } ?? false
        }
        guard force || !loaded() else { return }
        while profileRequests.count >= 3 || profileRequests[id] != nil {
            do { try await Task.sleep(for: .milliseconds(160)) } catch { return }
            guard revision == accessRevision else { return }
            if loaded() { return }
        }
        guard !Task.isCancelled, revision == accessRevision else { return }
        let request = UUID()
        profileRequests[id] = request
        profileLoading.insert(id)
        profileFailures.remove(id)
        defer {
            if profileRequests[id] == request {
                profileRequests[id] = nil
                profileLoading.remove(id)
            }
        }
        do {
            let page: ForumWebPage
            if let existingPage { page = existingPage }
            else {
                page = ForumWebPage(dataStore: dataStore)
                try await page.read(Forum.home)
            }
            guard revision == accessRevision, !Task.isCancelled else { return }
            let value = try await requests.profile(page, id, includeReadme)
            try Task.checkCancellation()
            guard revision == accessRevision else { return }
            guard let json = value else { throw ForumPageError.network }
            var profile = try JSONDecoder().decode(ForumUserProfile.self, from: Data(json.utf8))
            guard profile.member_id == id else { throw ForumPageError.changed }
            if includeReadme && profile.readme == nil { profile.readme = "" }
            if !includeReadme, profile.readme == nil { profile.readme = profiles[id]?.readme }
            if id == ownProfile?.id, let ownIntroduction {
                profile.readme = ownIntroduction.readme
                profile.signature_markdown = ownIntroduction.signature
            }
            if profiles.count >= 240, profiles[id] == nil,
               let oldest = profileUpdated.min(by: { $0.value < $1.value })?.key {
                profiles[oldest] = nil
                profileUpdated[oldest] = nil
            }
            profiles[id] = profile
            profileUpdated[id] = profileNow()
        } catch {
            if !Task.isCancelled, revision == accessRevision { profileFailures.insert(id) }
        }
    }

    func finishAccess(_ signedIn: Bool?) {
        if let signedIn { observeAccount(signedIn) }
        let returnTo = access?.returnTo
        invalidateAccess()
        switch returnTo {
        case .profile: presentation = .profile
        case .compose: presentation = .compose
        case nil: presentation = nil
        }
    }

    func edit(_ draft: String, for id: String) {
        guard canCompose else { return }
        if draft.isEmpty { drafts.removeValue(forKey: id) }
        else { drafts[id] = draft }
        persistDrafts()
    }

    func rememberTitle(_ title: String, for id: String) {
        if !title.isEmpty, titles[id] != title { titles[id] = title }
    }

    func clearReceipt(_ id: String) { receipts.removeValue(forKey: id) }

    func consumeReplyNavigation(_ id: String) -> Bool { pendingReplyNavigation.remove(id) != nil }

    func imageSizing(for scope: DraftScope) -> DraftImageSizing {
        if let sizing = draftImages[scope] { return sizing }
        let sizing = DraftImageSizing()
        sizing.didChange = { [weak self] in self?.persistDrafts() }
        draftImages[scope] = sizing
        return sizing
    }

    @discardableResult
    func send(topic: Topic, on page: ForumWebPage) -> Task<Void, Never>? {
        guard let original = drafts[topic.id], !original.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let postID = Int(topic.id), canCompose, !sending.contains(topic.id) else { return nil }
        let sizing = imageSizing(for: .reply(topic.id))
        let token = authorization
        sending.insert(topic.id)
        clearReceipt(topic.id)
        return Task { [self, page] in
            defer { if token == authorization { sending.remove(topic.id) } }
            let content: String
            do { content = try await sizing.prepare(original) }
            catch {
                guard authorizes(token) else { return }
                receipts[topic.id] = Receipt(message: (error as? NodeImageError ?? .connection).localizedDescription + " 草稿已保留。")
                return
            }
            guard authorizes(token) else { return }
            let result: ReplyEnvelope?
            do {
                let value = try await requests.reply(page, postID, content)
                result = value.flatMap { try? JSONDecoder().decode(ReplyEnvelope.self, from: Data($0.utf8)) }
            } catch { result = nil }
            guard authorizes(token) else { return }
            switch result?.kind {
            case "response" where result?.response != nil:
                guard let response = result?.response else { return }
                if response.success {
                    let destination: URL?
                    if response.redirect?.isEmpty != false, response.redirectHash != nil {
                        let floorsPerPage = (try? await page.identity())?.floorsPerPage ?? 10
                        destination = response.destination(from: topic.url, floorsPerPage: floorsPerPage)
                    } else {
                        destination = response.destination(from: topic.url)
                    }
                    guard authorizes(token) else { return }
                    if drafts[topic.id] == original {
                        edit("", for: topic.id)
                        sizing.reset()
                    }
                    invalidateThread(topic.id)
                    pendingReplyNavigation.insert(topic.id)
                    receipts[topic.id] = Receipt(message: "回复已发送", destination: destination, accepted: true)
                } else {
                    let message = response.message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                    receipts[topic.id] = Receipt(message: message.isEmpty ? "NodeSeek 没有接受这条回复，草稿已保留。" : message)
                }
            case "verification":
                receipts[topic.id] = Receipt(message: "请先完成 NodeSeek 站点验证。草稿已保留。", verify: true)
            case "signIn":
                observeAccount(false)
                receipts[topic.id] = Receipt(message: "登录已失效，请重新登录。草稿已保留。")
            case "forbidden":
                receipts[topic.id] = Receipt(message: "NodeSeek 拒绝了回复。请检查账号权限或登录状态，草稿已保留。")
            case "unavailable":
                receipts[topic.id] = Receipt(message: "帖子未就绪。请刷新后再回复，草稿已保留。")
            default:
                receipts[topic.id] = Receipt(message: "未收到发送结果。请刷新确认楼层是否出现，再决定是否重发。草稿已保留。")
            }
        }
    }
}

private struct ReplyEnvelope: Decodable {
    let kind: String
    let response: ForumReplyResponse?
}

@MainActor
final class ForumReaderState: ObservableObject {
    enum Phase { case loading, ready(ForumThread), failed(ForumPageError) }
    @Published private(set) var phase: Phase
    @Published private(set) var isLoading = true
    @Published private(set) var refreshIssue: ForumPageError?
    private(set) var page: ForumWebPage?
    private var visibleURL: URL?
    private var latest: UUID?
    private var accessObserver: AnyCancellable?

    init(topic: Topic, session: ForumSession) {
        visibleURL = Forum.pageURL(topic.url)
        phase = session.cachedThread(at: topic.url).map(Phase.ready) ?? .loading
        accessObserver = session.$accessRevision.dropFirst().sink { [weak self] _ in
            self?.latest = nil
            self?.phase = .loading
            self?.page = nil
            self?.refreshIssue = nil
            self?.isLoading = false
        }
    }

    func load(_ topic: Topic, session: ForumSession,
              fetch: ((URL, ForumSession) async throws -> (ForumThread, ForumWebPage))? = nil) async {
        guard !Task.isCancelled else { return }
        let request = UUID()
        let url = Forum.pageURL(topic.url)
        latest = request
        if visibleURL != url {
            phase = session.cachedThread(at: url).map(Phase.ready) ?? .loading
            visibleURL = url
            page = nil
        } else if case .failed = phase { phase = .loading }
        isLoading = true
        refreshIssue = nil
        defer { if latest == request && !Task.isCancelled { isLoading = false } }
        let access = session.accessRevision
        do {
            let (thread, loader): (ForumThread, ForumWebPage)
            if let fetch { (thread, loader) = try await fetch(url, session) }
            else { (thread, loader) = try await Self.fetch(url, session: session) }
            guard latest == request, !Task.isCancelled, access == session.accessRevision else { return }
            page = loader
            session.cacheThread(thread, at: url)
            session.rememberTitle(thread.title, for: topic.id)
            if case .ready(let existing) = phase, existing == thread { return }
            phase = .ready(thread)
        } catch {
            guard !Task.isCancelled, latest == request, access == session.accessRevision else { return }
            let issue = error as? ForumPageError ?? .network
            if case .ready = phase, issue == .network || issue == .timedOut { refreshIssue = issue }
            else { page = nil; phase = .failed(issue) }
        }
    }

    static func fetch(_ url: URL, floor: String? = nil, session: ForumSession) async throws -> (ForumThread, ForumWebPage) {
        let revision = session.accessRevision
        let loader = ForumWebPage(dataStore: session.dataStore, captureTerminals: true)
        guard let id = Forum.topicID(url) else { throw ForumPageError.missing }
        try await loader.read(Forum.pageURL(url))
        // A challenge can complete with a new navigation after its initial HTML finishes.
        var signedIn = try await loader.signedIn()
        if loader.challenged && signedIn == nil {
            for _ in 0..<3 {
                try await Task.sleep(for: .seconds(1))
                signedIn = try await loader.signedIn()
                if signedIn != nil { break }
            }
        }
        try Task.checkCancellation()
        guard revision == session.accessRevision else { throw CancellationError() }
        if let identity = try await loader.identity() {
            guard revision == session.accessRevision else { throw CancellationError() }
            session.observeIdentity(identity)
        } else if let signedIn { session.observeAccount(signedIn) }
        if loader.challenged && signedIn == nil { throw ForumPageError.verification }
        if let status = loader.status, status == 404 || status == 410 { throw ForumPageError.missing }
        guard let actual = loader.webView.url, Forum.topicID(actual) == id else {
            if signedIn == false || loader.webView.url?.path == Forum.signIn.path { throw ForumPageError.signInRequired }
            throw ForumPageError.missing
        }
        if loader.status == 401 { throw ForumPageError.signInRequired }
        if loader.status == 403 { throw signedIn == false ? ForumPageError.signInRequired : ForumPageError.missing }
        let result = try await loader.webView.callAsyncJavaScript(ForumPageScript.extract,
            arguments: ["onlyFloor": floor ?? ""], in: nil, contentWorld: .defaultClient)
        try Task.checkCancellation()
        guard revision == session.accessRevision else { throw CancellationError() }
        guard let json = result as? String else { throw ForumPageError.changed }
        if let thread = try? JSONDecoder().decode(ForumThread.self, from: Data(json.utf8)) {
            return (thread, loader)
        } else if json == #"{"error":"missing"}"# {
            throw signedIn == false ? ForumPageError.signInRequired : ForumPageError.missing
        } else { throw ForumPageError.changed }
    }
}

@MainActor
final class ForumWebPage: NSObject, WKNavigationDelegate, WKUIDelegate {
    let webView: WKWebView
    private var continuation: CheckedContinuation<Void, Error>?
    private var timeout: Task<Void, Never>?
    private var documentProbe: Task<Void, Never>?
    private var expected: WKNavigation?
    private(set) var status: Int?
    private(set) var challenged = false
    var didSettle: (() -> Void)?
    var didClose: (() -> Void)?
    var openTopic: ((URL) -> Bool)?

    init(dataStore: WKWebsiteDataStore, captureTerminals: Bool = false) {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = dataStore
        if captureTerminals {
            configuration.userContentController.addUserScript(WKUserScript(source: ForumPageScript.captureTerminals,
                injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .defaultClient))
        }
        webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 940, height: 700), configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.uiDelegate = self
    }

    func read(_ url: URL) async throws {
        guard Forum.contains(url) else { throw ForumPageError.missing }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (waiter: CheckedContinuation<Void, Error>) in
                guard !Task.isCancelled else { waiter.resume(throwing: CancellationError()); return }
                continuation = waiter
                expected = webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 25))
                timeout = Task { [weak self] in
                    try? await Task.sleep(for: .seconds(26))
                    guard !Task.isCancelled else { return }
                    self?.finish(.failure(ForumPageError.timedOut))
                    self?.webView.stopLoading()
                }
            }
        } onCancel: {
            Task { @MainActor [weak self] in
                self?.finish(.failure(CancellationError()))
                self?.webView.stopLoading()
            }
        }
    }

    func signedIn() async throws -> Bool? {
        guard let url = webView.url, Forum.contains(url) else { return nil }
        let result = try await webView.callAsyncJavaScript(#"""
            if (window.__config__ && document.querySelector('#nsk-head')) return Boolean(window.__config__.user);
            if (location.pathname === '/signIn.html' && document.querySelector('input[type=password]')) return false;
            return null;
            """#, arguments: [:], in: nil, contentWorld: .page)
        return result as? Bool
    }

    func identity() async throws -> ForumIdentity? {
        guard let url = webView.url, Forum.contains(url) else { return nil }
        let raw = try await webView.callAsyncJavaScript(ForumAccountScript.identity, arguments: [:], in: nil, contentWorld: .page)
        guard let json = raw as? String else { return nil }
        return try JSONDecoder().decode(ForumIdentity.self, from: Data(json.utf8))
    }

    private func finish(_ result: Result<Void, Error>) {
        timeout?.cancel()
        timeout = nil
        documentProbe?.cancel()
        documentProbe = nil
        expected = nil
        let waiter = continuation
        continuation = nil
        waiter?.resume(with: result)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        guard let url = action.request.url, Forum.contains(url) else { decisionHandler(.cancel); return }
        if (action.navigationType == .linkActivated || action.targetFrame == nil),
           Forum.topicID(url) != nil, openTopic?(url) == true { decisionHandler(.cancel); return }
        if action.targetFrame == nil {
            decisionHandler(.cancel)
            if didSettle != nil { webView.load(action.request) }
        } else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.isForMainFrame, let http = response.response as? HTTPURLResponse {
            status = http.statusCode
            challenged = http.value(forHTTPHeaderField: "cf-mitigated")?.lowercased() == "challenge"
        }
        decisionHandler(response.canShowMIMEType ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        guard continuation != nil, !challenged else { return }
        documentProbe?.cancel()
        documentProbe = Task { [weak self] in
            while !Task.isCancelled {
                guard let self, self.continuation != nil, let url = self.webView.url, Forum.contains(url) else { return }
                let ready = try? await self.webView.callAsyncJavaScript(
                    "return document.readyState !== 'loading' && Boolean(document.querySelector('#nsk-head'));",
                    arguments: [:], in: nil, contentWorld: .defaultClient)
                guard !Task.isCancelled else { return }
                if (ready as? Bool) == true { self.finish(.success(())); return }
                try? await Task.sleep(for: .milliseconds(200))
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if continuation != nil, navigation === expected { finish(.success(())) }
        didSettle?()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(navigation, error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(navigation, error) }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { finish(.failure(ForumPageError.network)) }
    func webViewDidClose(_ webView: WKWebView) { didClose?() }

    private func fail(_ navigation: WKNavigation?, _ error: Error) {
        guard navigation === expected, continuation != nil else { return }
        if challenged { finish(.failure(ForumPageError.verification)) }
        else if (error as NSError).code == NSURLErrorTimedOut { finish(.failure(ForumPageError.timedOut)) }
        else { finish(.failure(ForumPageError.network)) }
    }
}

struct ForumAccessSheet: View {
    let request: ForumSession.Access
    @ObservedObject var session: ForumSession

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 11) {
                DeskIcon(request.verification ? "checkmark.shield" : "person.crop.circle.badge.checkmark")
                    .font(.title2).foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 3) {
                    Text(request.verification ? "验证 NodeSeek 访问" : "登录 NodeSeek").font(.headline)
                    Text("www.nodeseek.com · 官方页面").font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("关闭") { session.finishAccess(nil) }.keyboardShortcut(.cancelAction)
            }
            .padding(15)
            Divider()
            ForumAccessWebView(request: request, session: session)
        }
        .frame(idealWidth: 710, idealHeight: 590)
        .frame(width: 710, height: 590)
    }
}

private struct ForumAccessWebView: NSViewRepresentable {
    let request: ForumSession.Access
    let session: ForumSession

    @MainActor final class Coordinator {
        var page: ForumWebPage?
        var monitor: Task<Void, Never>?
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeNSView(context: Context) -> WKWebView {
        let page = ForumWebPage(dataStore: session.dataStore)
        let coordinator = context.coordinator
        coordinator.page = page
        let accessID = request.id
        let forVerification = request.verification
        let target = request.url
        let session = self.session
        page.didClose = { [weak page] in
            guard let page else { return }
            page.webView.load(URLRequest(url: Forum.home, cachePolicy: .reloadIgnoringLocalCacheData))
        }
        let check = { @MainActor [weak session, weak page] in
            guard let page, let session, session.access?.id == accessID,
                  let actual = page.webView.url, Forum.contains(actual),
                  let signedIn = try? await page.signedIn(), session.access?.id == accessID else { return }
            if signedIn || (forVerification && (Forum.topicID(actual) == Forum.topicID(target) || actual.path == Forum.signIn.path)) {
                session.finishAccess(signedIn)
            }
        }
        page.didSettle = { Task { await check() } }
        coordinator.monitor = Task {
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled, session.access?.id == accessID else { break }
                if !page.webView.isLoading { await check() }
            }
        }
        page.webView.load(URLRequest(url: target, cachePolicy: .reloadIgnoringLocalCacheData))
        return page.webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {}

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.monitor?.cancel()
        webView.stopLoading()
        coordinator.page = nil
    }
}
