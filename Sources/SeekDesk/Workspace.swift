import AppKit
import SwiftUI

@MainActor
final class Workspace: ObservableObject {
    enum Destination: Equatable {
        case board(Board), shortcut(ForumShortcut), plugins, notifications, hot, settings, friends
        case mySpace, space(ForumUserReference)

        init(shortcut: ForumShortcut) {
            self = shortcut == .award ? .board(.award) : .shortcut(shortcut)
        }
    }

    enum PostDirection { case previous, next }
    enum SearchKind: String, Codable, CaseIterable, Identifiable {
        case all, posts, people
        var id: Self { self }
        var title: String {
            switch self { case .all: "帖子和用户"; case .posts: "仅帖子"; case .people: "仅用户" }
        }
    }

    private struct FeedSnapshot: Codable {
        let posts: [FeedPost]
        let refreshedAt: Date?
    }

    @Published private(set) var session: ReadingSession
    @Published private(set) var destination: Destination = .board(.home)
    @Published private(set) var showReader = false
    @Published private var feed: FeedSnapshot
    private struct ListingSnapshot {
        var posts: [FeedPost]
        var next: URL?
        var refreshedAt: Date
        var hasOlderPages = false
    }

    private struct ListingKey: Hashable {
        let board: Board
        let order: ForumFeedOrder
    }

    struct SearchHistory: Codable, Identifiable {
        let query: String
        private let boardID: String?
        private let boardIDs: [String]?
        private let searchKind: SearchKind?

        init(query: String, scope: Set<String>, kind: SearchKind) {
            self.query = query
            boardIDs = scope.sorted()
            boardID = nil
            searchKind = kind
        }

        var scope: Set<String> {
            // Older versions stored one category as boardID.
            Set(boardIDs ?? boardID.map { [$0] } ?? []).intersection(Board.searchableIDs)
        }

        var kind: SearchKind { searchKind ?? .posts }
        var id: String { kind.rawValue + "|" + scope.sorted().joined(separator: ",") + "|" + query }
    }

    @Published private var listings: [ListingKey: ListingSnapshot] = [:]
    @Published private var loadingBoards: Set<ListingKey> = []
    @Published private var failedBoards: Set<ListingKey> = []
    @Published private var olderFailures: Set<ListingKey> = []
    @Published private var searchResult: ListingSnapshot?
    @Published private var searchBusy = false
    @Published private var searchFailed = false
    @Published private(set) var searchPeople: [ForumUserReference] = []
    @Published private(set) var peopleBusy = false
    @Published private(set) var peopleError: ForumPageError?
    @Published private(set) var searchHistory: [SearchHistory] = []
    @Published private(set) var feedOrder: ForumFeedOrder
    @Published private(set) var homeRefreshRevision = 0
    @Published private(set) var searchRevision = 0
    private var searchRequest: UUID?
    private var peopleRequest: UUID?
    @Published private(set) var query = ""
    @Published private(set) var keyboardPostID: FeedPost.ID?
    @Published var showingSearch = false
    @Published var searchText = ""
    @Published var searchScope: Set<String> = []
    @Published var searchKind = SearchKind.all
    @Published private(set) var appliedSearchScope: Set<String> = []
    @Published private(set) var appliedSearchKind = SearchKind.all
    @Published var showingSidebar = true
    @Published var presentingOfficeCover = false

    private let defaults: UserDefaults
    private let fetchFeed: () async throws -> [FeedPost]
    private let fetchPage: ((URL) async throws -> ForumListingPage)?
    private let fetchPeople: ((String) async throws -> [ForumUserReference])?
    private var accessRevision = 0
    private var lastBoard: Board = .home
    private(set) var readingReturnURL: URL?
    private static let sessionKey = "readingSession.v1"
    private static let feedKey = "latestFeed.v1"

    init(defaults: UserDefaults = .standard, fetchFeed: @escaping () async throws -> [FeedPost] = ForumFeed.fetch,
         fetchPage: ((URL) async throws -> ForumListingPage)? = nil,
         fetchPeople: ((String) async throws -> [ForumUserReference])? = nil) {
        self.defaults = defaults
        self.fetchFeed = fetchFeed
        self.fetchPage = fetchPage
        self.fetchPeople = fetchPeople
        feedOrder = defaults.string(forKey: "feed.order").flatMap(ForumFeedOrder.init(rawValue:)) ?? .topics
        if let data = defaults.data(forKey: "search.history"),
           let recent = try? JSONDecoder().decode([SearchHistory].self, from: data) {
            searchHistory = recent
        }
        var savedSession = defaults.data(forKey: Self.sessionKey).flatMap {
            try? JSONDecoder().decode(ReadingSession.self, from: $0)
        } ?? ReadingSession()
        // Saved tab metadata can include a privileged title from the previous
        // login. Keep navigation URLs, but wait for this session's own reads.
        if fetchPage != nil {
            for topic in savedSession.topics {
                savedSession.update(topic.id) { $0.title = ""; $0.preview = nil }
            }
        }
        session = savedSession
        let savedFeed = defaults.data(forKey: Self.feedKey)
        if let data = savedFeed,
           let snapshot = try? JSONDecoder().decode(FeedSnapshot.self, from: data) {
            feed = snapshot
        } else {
            let previousPosts = savedFeed.flatMap {
                try? JSONDecoder().decode([FeedPost].self, from: $0)
            } ?? []
            feed = FeedSnapshot(posts: previousPosts, refreshedAt: nil)
        }
    }

    private var listingKey: ListingKey { ListingKey(board: board, order: board == .award ? .topics : feedOrder) }
    private var fallbackPosts: [FeedPost] { board == .award ? [] : feed.posts }
    var isSearchingForum: Bool { !query.isEmpty && (fetchPage != nil || fetchPeople != nil) }
    var showsPeopleResults: Bool { !query.isEmpty && appliedSearchKind != .posts && fetchPeople != nil }
    var showsPostResults: Bool { query.isEmpty || appliedSearchKind != .people }
    var posts: [FeedPost] {
        if isSearchingForum, let searchResult { return searchResult.posts + localFuzzyMatches }
        return listings[listingKey]?.posts ?? fallbackPosts
    }
    var lastRefresh: Date? {
        (isSearchingForum ? searchResult?.refreshedAt : listings[listingKey]?.refreshedAt) ?? (board == .award ? nil : feed.refreshedAt)
    }
    var hasForumPage: Bool { listings[listingKey] != nil }
    var isBrowsingHistory: Bool { listings[listingKey]?.hasOlderPages == true }
    var hasOlderPosts: Bool { (isSearchingForum ? searchResult?.next : listings[listingKey]?.next) != nil }
    var isLoading: Bool { isSearchingForum ? searchBusy || peopleBusy : loadingBoards.contains(listingKey) }
    var failedToRefresh: Bool { isSearchingForum ? searchFailed : failedBoards.contains(listingKey) }
    var failedToLoadOlder: Bool { isSearchingForum ? searchFailed : olderFailures.contains(listingKey) }
    var inForum: Bool { if case .board = destination { return true }; return false }

    var board: Board {
        if case .board(let board) = destination { return board }
        return lastBoard
    }

    private var localFuzzyMatches: [FeedPost] {
        let terms = ForumSearch.terms(query)
        var seen = Set(searchResult?.posts.map(\.id) ?? [])
        let scopedListings = Board.sections.filter { appliedSearchScope.contains($0.id) }.flatMap {
            listings[ListingKey(board: $0, order: feedOrder)]?.posts ?? []
        }
        let candidates = (listings[listingKey]?.posts ?? []) + scopedListings + feed.posts
        return candidates.filter {
            (appliedSearchScope.isEmpty || appliedSearchScope.contains($0.category)) &&
                ForumSearch.matches(terms, in: [$0.title, $0.author, $0.summary]) &&
                seen.insert($0.id).inserted
        }
    }

    var filteredPosts: [FeedPost] {
        guard showsPostResults else { return [] }
        let categoryID = query.isEmpty ? board.categoryID : nil
        let candidates = !query.isEmpty && searchResult == nil ? localFuzzyMatches : posts
        return candidates.filter { categoryID == nil || $0.category == categoryID }
    }

    func invalidateForumAccess() {
        accessRevision += 1
        listings.removeAll()
        loadingBoards.removeAll()
        failedBoards.removeAll()
        olderFailures.removeAll()
        clearSearch()
        for topic in session.topics {
            session.update(topic.id) { $0.title = ""; $0.preview = nil }
        }
        persist()
        homeRefreshRevision += 1
    }

    func refresh() async {
        if isSearchingForum {
            async let people: Void = loadPeople()
            if showsPostResults { await loadSearch(reset: true) }
            await people
            return
        }
        let access = accessRevision
        let requestedBoard = board
        let key = listingKey
        guard loadingBoards.insert(key).inserted else { return }
        defer { if access == accessRevision { loadingBoards.remove(key) } }
        if let fetchPage {
            do {
                let page = try await fetchPage(requestedBoard.latestURL(order: key.order))
                try Task.checkCancellation()
                guard access == accessRevision else { return }
                listings[key] = ListingSnapshot(posts: page.posts,
                    next: requestedBoard.nextListingURL(page.next, order: key.order), refreshedAt: Date())
                failedBoards.remove(key)
                olderFailures.remove(key)
                didRefresh(page.posts, board: requestedBoard)
                return
            } catch {
                guard !Task.isCancelled, access == accessRevision else { return }
                if (error as? ForumPageError) == .signInRequired { listings[key] = nil }
                failedBoards.insert(key)
                if listings[key] != nil || requestedBoard != .home { return }
            }
        }

        guard requestedBoard != .award else { return }
        do {
            let refreshed = try await fetchFeed()
            try Task.checkCancellation()
            guard access == accessRevision else { return }
            feed = FeedSnapshot(posts: refreshed, refreshedAt: Date())
            if let data = try? JSONEncoder().encode(feed) { defaults.set(data, forKey: Self.feedKey) }
            if fetchPage == nil { failedBoards.remove(key) }
            didRefresh(refreshed, board: requestedBoard)
        } catch {
            if !Task.isCancelled, access == accessRevision { failedBoards.insert(key) }
        }
    }

    private func loadPeople() async {
        guard showsPeopleResults, let fetchPeople, !peopleBusy else { return }
        let request = UUID()
        peopleRequest = request
        peopleBusy = true
        peopleError = nil
        defer { if peopleRequest == request { peopleBusy = false } }
        do {
            let result = try await fetchPeople(query)
            try Task.checkCancellation()
            guard peopleRequest == request else { return }
            searchPeople = result
        } catch {
            guard !Task.isCancelled, peopleRequest == request else { return }
            peopleError = (error as? ForumPageError) ?? .network
        }
    }

    func loadOlder() async {
        if isSearchingForum {
            await loadSearch(reset: false)
            return
        }
        let access = accessRevision
        let requestedBoard = board
        let key = listingKey
        guard let fetchPage, var snapshot = listings[key], let next = snapshot.next,
              loadingBoards.insert(key).inserted else { return }
        defer { if access == accessRevision { loadingBoards.remove(key) } }
        do {
            let page = try await fetchPage(next)
            try Task.checkCancellation()
            guard access == accessRevision else { return }
            var seen = Set(snapshot.posts.map(\.id))
            snapshot.posts.append(contentsOf: page.posts.filter { seen.insert($0.id).inserted })
            let nextPage = requestedBoard.nextListingURL(page.next, order: key.order)
            snapshot.next = nextPage == next ? nil : nextPage
            snapshot.hasOlderPages = true
            listings[key] = snapshot
            olderFailures.remove(key)
        } catch {
            if !Task.isCancelled, access == accessRevision {
                if (error as? ForumPageError) == .signInRequired { listings[key] = nil }
                olderFailures.insert(key)
            }
        }
    }

    private func loadSearch(reset: Bool) async {
        guard let fetchPage, !query.isEmpty, !searchBusy else { return }
        let term = query
        let scope = appliedSearchScope
        let first = Forum.search(term)
        guard let address = reset ? first : searchResult?.next else { return }
        let token = UUID()
        searchRequest = token
        searchBusy = true
        searchFailed = false
        defer {
            if searchRequest == token { searchBusy = false }
        }
        var posts = reset ? [] : searchResult?.posts ?? []
        var seen = Set(posts.map(\.id))
        var next: URL? = address
        do {
            // Search is global on NodeSeek. Follow the site's cursor for scoped results.
            for _ in 0..<(scope.isEmpty ? 1 : 3) {
                guard let target = next else { break }
                let result = try await fetchPage(target)
                try Task.checkCancellation()
                guard searchRequest == token, query == term, appliedSearchScope == scope else { return }
                let matches = result.posts.filter { scope.isEmpty || scope.contains($0.category) }
                posts.append(contentsOf: matches.filter { seen.insert($0.id).inserted })
                next = Forum.searchPage(result.next, query: term)
                if next == target { next = nil }
                if !matches.isEmpty { break }
            }
            searchResult = ListingSnapshot(posts: posts, next: next, refreshedAt: Date())
        } catch {
            guard !Task.isCancelled, searchRequest == token else { return }
            searchFailed = true
        }
    }

    private func didRefresh(_ refreshed: [FeedPost], board requestedBoard: Board) {
        if board == requestedBoard, let id = keyboardPostID, !filteredPosts.contains(where: { $0.id == id }) {
            keyboardPostID = nil
        }
        let updates = Dictionary(refreshed.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var updated = session
        for topic in session.topics {
            if let post = updates[topic.id], topic.preview?.summary.isEmpty != false {
                updated.update(post.id) { $0.preview = post }
            }
        }
        if updated.topics != session.topics {
            session = updated
            persist()
        }
    }

    func choose(_ board: Board) {
        readingReturnURL = nil
        searchScope = board.categoryID.map { [$0] } ?? []
        destination = .board(board)
        clearSearch()
        showReader = false
    }

    func goHome() {
        choose(.home)
        homeRefreshRevision += 1
    }

    func chooseFeedOrder(_ order: ForumFeedOrder) {
        guard feedOrder != order else { return }
        feedOrder = order
        defaults.set(order.rawValue, forKey: "feed.order")
        homeRefreshRevision += 1
    }
    func showPlugins() { show(.plugins) }
    func showFriends() { show(.friends) }
    func showNotifications() { show(.notifications) }
    func showMySpace() { show(.mySpace) }
    func showUserSpace(_ person: ForumUserReference) { show(.space(person)) }
    func showHot() { show(.hot) }

    func showShortcut(_ shortcut: ForumShortcut) {
        let target = Destination(shortcut: shortcut)
        if case .board(let board) = target { choose(board) }
        else { show(target) }
    }
    func showSettings() { show(.settings) }

    private func show(_ target: Destination) {
        if case .board(let board) = destination { lastBoard = board }
        destination = target
    }

    func returnToForum() {
        guard !inForum else { return }
        readingReturnURL = showReader ? session.selectedTopic?.url : nil
        destination = .board(lastBoard)
    }

    func beginSearch() {
        guard !presentingOfficeCover, !showingSearch else { return }
        searchScope = query.isEmpty ? (board.categoryID.map { [$0] } ?? []) : appliedSearchScope
        searchKind = query.isEmpty ? .all : appliedSearchKind
        searchText = query
        showingSearch = true
    }

    func search() {
        let input = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let url = URL(string: input), openTopicLink(url) {
            showingSearch = false
            return
        }
        let kind = searchKind
        let scope = kind == .people ? [] : searchScope.intersection(Board.searchableIDs)
        let target = scope.count == 1 ? Board.sections.first { scope.contains($0.id) } ?? .home : .home
        if board != target { choose(target) }
        if !inForum { returnToForum() }
        clearSearch()
        searchScope = scope
        query = input
        if !input.isEmpty {
            appliedSearchScope = scope
            appliedSearchKind = kind
        }
        searchRevision += 1
        if !input.isEmpty {
            let entry = SearchHistory(query: input, scope: scope, kind: kind)
            searchHistory.removeAll { $0.id == entry.id }
            searchHistory.insert(entry, at: 0)
            searchHistory = Array(searchHistory.prefix(12))
            defaults.set(try? JSONEncoder().encode(searchHistory), forKey: "search.history")
        }
        keyboardPostID = nil
        showingSearch = false
        showReader = false
    }

    func repeatSearch(_ item: SearchHistory) {
        searchScope = item.scope
        searchKind = item.kind
        searchText = item.query
        search()
    }

    func clearSearchHistory() {
        searchHistory = []
        defaults.removeObject(forKey: "search.history")
    }

    func clearSearch() {
        query = ""
        appliedSearchScope = []
        appliedSearchKind = .all
        searchRequest = nil
        peopleRequest = nil
        peopleBusy = false
        peopleError = nil
        searchPeople = []
        searchResult = nil
        searchBusy = false
        searchFailed = false
        keyboardPostID = nil
    }

    @discardableResult
    func movePostFocus(_ direction: PostDirection) -> Bool {
        let visible = filteredPosts
        guard let first = visible.indices.first, let last = visible.indices.last else { return false }
        let current = visible.firstIndex { $0.id == keyboardPostID }
            ?? visible.firstIndex { $0.id == session.selection }
        let index: Int
        switch direction {
        case .previous: index = current.map { max(first, $0 - 1) } ?? last
        case .next: index = current.map { min(last, $0 + 1) } ?? first
        }
        let id = visible[index].id
        if keyboardPostID != id { keyboardPostID = id }
        return true
    }

    @discardableResult
    func openFocusedPost(background: Bool) -> Bool {
        guard let id = keyboardPostID,
              let post = filteredPosts.first(where: { $0.id == id }) else { return false }
        open(post, background: background)
        return true
    }

    func open(_ post: FeedPost, background: Bool) {
        var updated = session
        updated.open(post.url, title: post.title, background: background)
        updated.update(post.id) { $0.preview = post }
        session = updated
        keyboardPostID = post.id
        if !background {
            readingReturnURL = nil
            showReader = true
        }
        persist()
    }

    @discardableResult
    func openTopicLink(_ url: URL) -> Bool {
        guard let id = Forum.topicID(url) else { return false }
        let preview = posts.first { $0.id == id }
        var updated = session
        updated.open(url, title: preview?.title ?? "", background: false, explicitLocation: true)
        if let preview { updated.update(id) { $0.preview = preview } }
        if !inForum { returnToForum() }
        readingReturnURL = nil
        session = updated
        keyboardPostID = filteredPosts.first { $0.id == id }?.id
        showReader = true
        persist()
        return true
    }

    func select(_ id: String) {
        if !inForum { returnToForum() }
        readingReturnURL = nil
        session.select(id)
        showReader = true
        persist()
    }

    func close(_ id: String) {
        session.close(id)
        if session.selectedTopic == nil { showReader = false }
        persist()
    }

    @discardableResult
    func moveTab(_ id: String, to target: String) -> Bool {
        var updated = session
        guard updated.move(id, to: target) else { return false }
        session = updated
        persist()
        return true
    }

    func closeAllTabs() {
        session = ReadingSession()
        showReader = false
        persist()
    }

    @discardableResult
    func closeCurrentTab() -> Bool {
        guard inForum, let id = session.selection ?? session.topics.last?.id else { return false }
        close(id)
        return true
    }

    @discardableResult
    func selectAdjacentTab(_ direction: PostDirection) -> Bool {
        let tabs = session.topics
        guard inForum, !tabs.isEmpty else { return false }
        let current = tabs.firstIndex { $0.id == session.selection }
        let offset = direction == .next ? 1 : -1
        let index = current.map { ($0 + offset + tabs.count) % tabs.count }
            ?? (direction == .next ? tabs.startIndex : tabs.index(before: tabs.endIndex))
        select(tabs[index].id)
        return true
    }

    func showList() {
        readingReturnURL = nil
        keyboardPostID = filteredPosts.first { $0.id == session.selection }?.id
        showReader = false
    }

    func openCurrentInBrowser() {
        guard inForum else { return }
        let url = showReader ? session.selectedTopic?.url ?? board.url : board.url
        if Forum.contains(url) { NSWorkspace.shared.open(url) }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(session) { defaults.set(data, forKey: Self.sessionKey) }
    }
}
