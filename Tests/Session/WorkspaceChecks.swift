import Foundation

@MainActor
func checkBlockConfirmation() {
    let suite = "SeekDesk.tests.block.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let extensions = DeskExtensions(defaults: defaults)
    extensions.install(.block)
    extensions.requestBlock(42, name: "作者")
    precondition(extensions.pendingBlock?.memberID == 42 && !extensions.blocks(42, name: "作者"))
    extensions.cancelBlock()
    precondition(extensions.pendingBlock == nil && extensions.blocked.isEmpty)
    extensions.requestBlock(42, name: "作者")
    extensions.confirmBlock(extensions.pendingBlock!)
    precondition(extensions.blocks(42, name: "改名后") && !extensions.blocks(43, name: "作者"))
    precondition(DeskExtensions(defaults: defaults).blocks(nil, name: "作者"))

    // Old name-only entries can coexist with a member ID. The floor should recover in one click.
    let legacy = #"[{"name":"作者"},{"memberID":42,"name":"作者"},{"memberID":43,"name":"另一位作者"}]"#
    defaults.set(Data(legacy.utf8), forKey: "extensions.block.authors")
    let restored = DeskExtensions(defaults: defaults)
    restored.unblock(42, name: "作者")
    precondition(!restored.blocks(42, name: "作者") && restored.blocks(43, name: "另一位作者"))
    precondition(DeskExtensions(defaults: defaults).blocked.map(\.memberID) == [43])
    print("Passed block confirmation, cancellation, persistence and legacy unblock checks.")
}

@MainActor
func checkWorkspace() async {
    let suite = "SeekDesk.tests.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }

    func post(_ id: String) -> FeedPost {
        FeedPost(id: id, url: URL(string: "https://www.nodeseek.com/post-\(id)-1")!,
                 title: "帖子 \(id)", author: "作者", category: "tech", published: nil, summary: "摘要")
    }

    let a = post("101"), b = post("102"), c = post("103")
    var result: Result<[FeedPost], URLError> = .success([a, b])
    let workspace = Workspace(defaults: defaults, fetchFeed: { try result.get() })
    await workspace.refresh()
    precondition(!workspace.openFocusedPost(background: false))
    precondition(workspace.movePostFocus(.next) && workspace.keyboardPostID == a.id)

    result = .success([b, a])
    await workspace.refresh()
    precondition(workspace.keyboardPostID == a.id)
    result = .success([c, b])
    await workspace.refresh()
    precondition(workspace.keyboardPostID == nil && !workspace.openFocusedPost(background: false))
    precondition(workspace.session.topics.isEmpty)

    precondition(workspace.movePostFocus(.next) && workspace.keyboardPostID == c.id)
    precondition(workspace.openFocusedPost(background: true))
    precondition(workspace.session.selection == nil && !workspace.showReader)
    precondition(workspace.selectAdjacentTab(.next) && workspace.session.selection == c.id)
    precondition(workspace.movePostFocus(.next) && workspace.keyboardPostID == b.id)
    precondition(workspace.openFocusedPost(background: true) && workspace.session.selection == c.id)
    precondition(workspace.selectAdjacentTab(.next) && workspace.session.selection == b.id)
    precondition(workspace.selectAdjacentTab(.next) && workspace.session.selection == c.id)
    precondition(workspace.selectAdjacentTab(.previous) && workspace.session.selection == b.id)
    workspace.showList()
    precondition(!workspace.showReader && workspace.closeCurrentTab())
    precondition(workspace.session.topics.map(\.id) == [c.id] && !workspace.showReader)

    workspace.searchText = " https://www.nodeseek.com/post-103-4#comment-27 \n"
    workspace.search()
    precondition(workspace.session.topics.count == 1 && workspace.showReader)
    precondition(workspace.session.selectedTopic?.url.fragment == "comment-27")
    precondition(workspace.session.selectedTopic?.preview == c)
    let restored = Workspace(defaults: defaults)
    precondition(!restored.showReader && restored.session.selectedTopic?.id == c.id)
    restored.select(c.id)
    precondition(restored.showReader && restored.closeCurrentTab() && !restored.showReader)

    let tech = Board.sections.first { $0.id == "tech" }!
    workspace.choose(tech)
    workspace.searchText = c.title
    workspace.search()
    workspace.select(c.id)
    workspace.showPlugins()
    workspace.showPlugins()
    precondition(workspace.destination == .plugins && !workspace.closeCurrentTab())
    workspace.returnToForum()
    precondition(workspace.destination == .board(tech) && workspace.filteredPosts == [c])
    precondition(workspace.showReader && workspace.session.selectedTopic?.id == c.id)
    let openLocation = workspace.session.selectedTopic?.url
    workspace.showSettings()
    workspace.showMySpace()
    workspace.returnToForum()
    precondition(workspace.showReader && workspace.readingReturnURL == openLocation && workspace.session.selectedTopic?.url == openLocation)

    workspace.showSettings()
    let linkedFloor = URL(string: "https://www.nodeseek.com/post-103-4#comment-28")!
    precondition(workspace.openTopicLink(linkedFloor))
    precondition(workspace.readingReturnURL == nil && workspace.session.selectedTopic?.url == linkedFloor)

    workspace.searchText = "https://www.nodeseek.com/post-103-2"
    workspace.search()
    precondition(workspace.session.selectedTopic?.url.lastPathComponent == "post-103-2")
    workspace.searchText = "https://nodeseek.com/post-900-3"
    workspace.search()
    precondition(workspace.session.selectedTopic?.label == "帖子 #900")
    precondition(workspace.session.selectedTopic?.preview == nil)
    workspace.searchText = "https://www.nodeseek.com.evil.example/post-500-1"
    workspace.search()
    precondition(workspace.session.topics.map(\.id) == [c.id, "900"] && !workspace.showReader)
    precondition(workspace.closeCurrentTab() && workspace.closeCurrentTab() && !workspace.closeCurrentTab())

    let previousRefresh = workspace.lastRefresh
    result = .failure(URLError(.notConnectedToInternet))
    await workspace.refresh()
    precondition(workspace.failedToRefresh && workspace.posts == [c, b] && workspace.lastRefresh == previousRefresh)
    let reopened = Workspace(defaults: defaults)
    precondition(reopened.posts == [c, b] && reopened.lastRefresh == previousRefresh)
    let boardPage = URL(string: "https://www.nodeseek.com/categories/tech/page-2")!
    let foreignPage = URL(string: "https://www.nodeseek.com/categories/review/page-2")!
    let homePage = URL(string: "https://www.nodeseek.com/page-2")!
    precondition(tech.nextListingURL(foreignPage) == nil)
    let paged = Workspace(defaults: defaults, fetchPage: { url in
        switch url {
        case tech.latestURL: return ForumListingPage(posts: [c, b], next: boardPage)
        case tech.nextListingURL(boardPage): return ForumListingPage(posts: [b, a], next: nil)
        case Board.home.latestURL: return ForumListingPage(posts: [b], next: homePage)
        default: throw URLError(.badURL)
        }
    })
    paged.choose(tech)
    await paged.refresh()
    precondition(paged.hasOlderPosts && paged.posts == [c, b])
    await paged.loadOlder()
    precondition(!paged.hasOlderPosts && paged.isBrowsingHistory && paged.posts == [c, b, a])
    paged.choose(.home)
    await paged.refresh()
    precondition(paged.hasOlderPosts && paged.posts == [b])
    paged.choose(tech)
    precondition(paged.posts == [c, b, a])
    let awardPage = ForumShortcut.award.url.appendingPathComponent("page-2")
    let fromAnotherBoard = FeedPost(id: "104", url: Forum.home.appendingPathComponent("post-104-1"),
        title: "精品主题", author: "作者", category: "review", published: nil, summary: "")
    var awardUnavailable = true
    let awards = Workspace(defaults: defaults, fetchPage: { url in
        switch url {
        case ForumShortcut.award.url where !awardUnavailable:
            return ForumListingPage(posts: [a, fromAnotherBoard], next: awardPage)
        case awardPage:
            return ForumListingPage(posts: [a, b], next: nil)
        default: throw URLError(.badURL)
        }
    })
    awards.chooseFeedOrder(.replies)
    awards.showShortcut(.award)
    precondition(awards.destination == .board(.award) && awards.posts.isEmpty && awards.lastRefresh == nil)
    await awards.refresh()
    precondition(awards.failedToRefresh && awards.posts.isEmpty)
    awardUnavailable = false
    await awards.refresh()
    precondition(awards.filteredPosts == [a, fromAnotherBoard] && awards.hasOlderPosts)
    await awards.loadOlder()
    precondition(awards.filteredPosts == [a, fromAnotherBoard, b] && !awards.hasOlderPosts)
    precondition(Board.award.nextListingURL(boardPage) == nil)
    awards.showShortcut(.ruling)
    precondition(awards.destination == .shortcut(.ruling))
    precondition(awards.openTopicLink(a.url) && awards.destination == .board(.award) && awards.showReader)
    awards.beginSearch()
    precondition(awards.searchScope.isEmpty)
    defaults.removeObject(forKey: "feed.order")

    let ancient = post("17")
    let term = "旧帖关键字"
    let findOlder = Workspace(defaults: defaults, fetchPage: { url in
        if url == Forum.search(term) { return ForumListingPage(posts: [ancient], next: nil) }
        if url == Board.home.latestURL(order: .replies) { return ForumListingPage(posts: [b], next: nil) }
        throw URLError(.badURL)
    })
    findOlder.chooseFeedOrder(.replies)
    await findOlder.refresh()
    precondition(findOlder.posts == [b])
    findOlder.searchText = term
    findOlder.search()
    await findOlder.refresh()
    precondition(findOlder.filteredPosts == [ancient] && findOlder.searchHistory.first?.query == term)
    findOlder.repeatSearch(findOlder.searchHistory[0])
    await findOlder.refresh()
    precondition(findOlder.searchHistory.filter { $0.query == term }.count == 1)
    findOlder.goHome()
    precondition(findOlder.query.isEmpty && findOlder.feedOrder == .replies)

    let scopedTerm = "干杯云"
    func scopedPost(_ id: String, _ category: String) -> FeedPost {
        FeedPost(id: id, url: Forum.home.appendingPathComponent("post-\(id)-1"),
                 title: "\(scopedTerm) \(category)", author: "作者", category: category, published: nil, summary: "")
    }
    let daily = scopedPost("201", "daily"), trade = scopedPost("202", "trade"), technical = scopedPost("203", "tech")
    let second = Forum.searchPage(Forum.home.appendingPathComponent("search/page-2"), query: scopedTerm)!
    let third = Forum.searchPage(Forum.home.appendingPathComponent("search/page-3"), query: scopedTerm)!
    defaults.set(Data(#"[{"query":"旧记录","boardID":"tech"}]"#.utf8), forKey: "search.history")
    let scoped = Workspace(defaults: defaults, fetchPage: { url in
        switch url {
        case Forum.search(scopedTerm): return ForumListingPage(posts: [technical], next: second)
        case second: return ForumListingPage(posts: [daily, technical], next: third)
        case third: return ForumListingPage(posts: [trade, daily, technical], next: nil)
        default: throw URLError(.badURL)
        }
    })
    precondition(scoped.searchHistory.first?.scope == ["tech"])
    scoped.searchScope = ["trade", "daily"]
    scoped.searchText = scopedTerm
    scoped.search()
    await scoped.refresh()
    precondition(scoped.filteredPosts == [daily] && scoped.hasOlderPosts)
    await scoped.loadOlder()
    precondition(scoped.filteredPosts == [daily, trade] && !scoped.hasOlderPosts)
    let saved = Workspace(defaults: defaults)
    precondition(saved.searchHistory.first?.scope == ["trade", "daily"])
    scoped.beginSearch()
    precondition(scoped.searchScope == ["trade", "daily"])
    scoped.searchScope = []
    scoped.search()
    await scoped.refresh()
    precondition(scoped.filteredPosts == [technical] && scoped.searchHistory.count == 3)
    scoped.repeatSearch(saved.searchHistory[0])
    await scoped.refresh()
    precondition(scoped.appliedSearchScope == ["daily", "trade"] && scoped.filteredPosts == [daily])

    let offline = Workspace(defaults: defaults, fetchFeed: { [trade, daily, technical] })
    await offline.refresh()
    offline.searchScope = ["daily", "trade"]
    offline.searchText = scopedTerm
    offline.search()
    precondition(offline.filteredPosts == [trade, daily])

    let match = ForumUserReference(id: 1769, name: "VMISS", avatar: nil, tags: [])
    var topicCalls = 0
    let directory = Workspace(defaults: defaults, fetchPage: { _ in
        topicCalls += 1
        return ForumListingPage(posts: [trade], next: nil)
    }, fetchPeople: { query in query == "VMISS" ? [match] : [] })
    directory.searchText = "VMISS"
    directory.searchKind = .people
    directory.search()
    await directory.refresh()
    precondition(directory.searchPeople == [match] && directory.filteredPosts.isEmpty && topicCalls == 0)
    directory.showUserSpace(match)
    precondition(directory.destination == .space(match))
    directory.returnToForum()
    precondition(directory.searchPeople == [match] && directory.query == "VMISS")
    directory.searchKind = .all
    directory.search()
    await directory.refresh()
    precondition(directory.searchPeople == [match] && directory.filteredPosts == [trade] && topicCalls == 1)

    // Clearing history must update the live model and persistence without changing an active search.
    directory.beginSearch()
    directory.searchText = "尚未提交的搜索文字"
    let activeScope = directory.searchScope
    let activeKind = directory.searchKind
    precondition(!directory.searchHistory.isEmpty && defaults.data(forKey: "search.history") != nil)
    directory.clearSearchHistory()
    precondition(directory.searchHistory.isEmpty && defaults.object(forKey: "search.history") == nil)
    precondition(Workspace(defaults: defaults).searchHistory.isEmpty)
    precondition(directory.showingSearch && directory.searchText == "尚未提交的搜索文字")
    precondition(directory.query == "VMISS" && directory.searchScope == activeScope && directory.searchKind == activeKind)
    precondition(directory.searchPeople == [match] && directory.filteredPosts == [trade])
    directory.search()
    precondition(directory.searchHistory.count == 1 && directory.searchHistory[0].query == "尚未提交的搜索文字")
    print("Passed isolated search history clearing, persistence and new history checks.")
    print("Passed refresh and keyboard focus, tab shortcuts, pasted links, and offline cache checks.")
}

@MainActor
func checkKeywordWatch() async {
    let suite = "SeekDesk.tests.keywords.\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let first = FeedPost(id: "401", url: Forum.home.appendingPathComponent("post-401-1"),
                         title: "分享 BERO 测评", author: "作者", category: "review", published: nil, summary: "")
    let second = FeedPost(id: "402", url: Forum.home.appendingPathComponent("post-402-1"),
                          title: "新款线路", author: "作者", category: "review", published: nil, summary: "有 Bero 回程")
    let extensions = DeskExtensions(defaults: defaults, fetchWatchPosts: { [first] })
    extensions.install(.keywords)
    extensions.watchWords = "Bero，bero"
    precondition(extensions.watchTerms.count == 1 && !extensions.watchSystemNotifications)
    extensions.startKeywordMonitoring()
    for _ in 0..<30 where extensions.watchPopup == nil {
        try? await Task.sleep(for: .milliseconds(10))
    }
    precondition(extensions.watchPopup?.hits.map(\.id) == ["401"] && extensions.unread == 1)
    extensions.dismissWatchPopup()
    extensions.checkKeywords(in: [first, second, second])
    precondition(extensions.watchPopup?.hits.map(\.id) == ["402"] && extensions.unread == 2)
    let notification = KeywordNotification.request(for: extensions.watchPopup?.hits ?? [])
    precondition(notification?.content.userInfo[KeywordNotification.topicKey] as? String == second.url.absoluteString)
    let reopened = DeskExtensions(defaults: defaults)
    reopened.checkKeywords(in: [first, second])
    precondition(reopened.hits.count == 2 && reopened.watchPopup == nil)
    reopened.watchWords = "回程 ＋ BERO，测评，Bero+"
    reopened.watchNote = "关注回程线路"
    let partial = FeedPost(id: "403", url: Forum.home.appendingPathComponent("post-403-1"),
                           title: "Bero 补货", author: "作者", category: "review", published: nil, summary: "")
    reopened.checkKeywords(in: [first, second, partial])
    precondition(reopened.watchPopup?.hits.map(\.id) == ["401", "402"])
    precondition(reopened.watchPopup?.hits.last?.words == ["bero + 回程"])
    precondition(DeskExtensions(defaults: defaults).watchNote == "关注回程线路")
    extensions.setEnabled(.keywords, false)
    precondition(extensions.watchPopup == nil)
    print("Passed background RSS alerts, grouped keyword rules, duplicate suppression and notification destination.")
}
