import AppKit
import SwiftUI

struct WorkspaceView: View {
    @ObservedObject var workspace: Workspace
    @ObservedObject var updates: Updates
    @StateObject private var forumSession = ForumSession()
    @ObservedObject var extensions: DeskExtensions
    @StateObject private var attendance = AttendanceState()
    @StateObject private var sidebarState = SidebarNavigationState()
    @StateObject private var paneWidths = PaneDragState()
    @StateObject private var tabPointers = TopicTabPointers()
    @StateObject private var searchAnchors = WorkspaceSearchAnchors()
    @AppStorage("workspace.sidebarWidth") private var storedSidebarWidth = DeskSidebarSizing.standard
    @AppStorage("workspace.topicColumnWidth") private var storedListWidth = 340.0
    @AppStorage("workspace.hideListWhileReading") private var hideListWhileReading = false
    @AppStorage("workspace.autoLoadOlder") private var autoLoadOlder = false
    @AppStorage("workspace.autoRefresh") private var autoRefresh = true
    @AppStorage(DeskLogo.preference) private var selectedLogo = DeskLogo.cobalt
    @AppStorage(DeskTextSize.bodyKey) private var bodyTextSize = DeskTextSize.bodyDefault
    @AppStorage(DeskTextSize.listKey) private var listTextSize = DeskTextSize.listDefault
    @AppStorage(DeskTextSize.boardKey) private var boardTextSize = DeskTextSize.boardDefault
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.scenePhase) private var scenePhase
    @FocusState private var listHasFocus: Bool

    private var palette: DeskPalette { DeskPalette(dark: colorScheme == .dark, readingSize: bodyTextSize) }
    private var motion: Animation? { reduceMotion ? nil : DeskMotion.selection }
    private var inForum: Bool { workspace.inForum }
    private var forumReturnTitle: String {
        workspace.showReader && workspace.session.selectedTopic != nil ? "返回帖子" : "返回论坛"
    }
    private var composing: Bool {
        if case .compose = forumSession.presentation { return true }
        return false
    }
    private var presentedSheet: Binding<ForumSession.Presentation?> {
        Binding(get: { composing ? nil : forumSession.presentation }, set: { value in
            if !composing || value != nil { forumSession.presentation = value }
        })
    }
    private var sessionPollingKey: Int { forumSession.accessRevision }
    private var automaticAttendanceMember: Int? {
        guard extensions.active(.attendance), extensions.autoAttendance, forumSession.account == .signedIn else { return nil }
        return forumSession.ownProfile?.id
    }
    private let navigationRailWidth: CGFloat = 39

    var body: some View {
        GeometryReader { geometry in
            let compact = geometry.size.width < 990
            let sidebarRange = DeskSidebarSizing.bounds(window: geometry.size.width)
            let baseWidth = clamp(CGFloat(storedSidebarWidth), in: sidebarRange)
            let sidebarWidth = !compact && workspace.showingSidebar ? clamp(baseWidth + paneWidths.sidebar, in: sidebarRange) : 0
            if extensions.officePresented {
                OfficeCoverView(palette: palette)
            } else {
                mainLayout(width: geometry.size.width, compact: compact, sidebarWidth: sidebarWidth, sidebarRange: sidebarRange)
                    .toolbar { workspaceToolbar(compact: compact) }
                    .background {
                        RankingPolling(state: sidebarState.ranking, active: extensions.active(.hot) && !composing &&
                            (workspace.destination == .hot || (sidebarState.section == .ranking &&
                                (compact ? sidebarState.compactOpen : workspace.showingSidebar))))
                    }
                    .onChange(of: compact) { sidebarState.compactOpen = false }
                    .allowsHitTesting(!composing && !workspace.showingSearch)
                    .accessibilityHidden(composing || workspace.showingSearch)
                    .overlay {
                        if composing {
                            NewDiscussionView(session: forumSession, draft: forumSession.newDiscussion, palette: palette) { url in
                                workspace.goHome()
                                if let url { _ = workspace.openTopicLink(url) }
                                forumSession.presentation = nil
                            }
                            .id(forumSession.accessRevision)
                            .transition(.opacity)
                        }
                    }
                    .animation(reduceMotion ? nil : DeskMotion.reader, value: composing)
            }
        }
        .toolbar(extensions.officePresented ? .hidden : .automatic, for: .windowToolbar)
        .toolbarBackground(windowToolbarBackground, for: .windowToolbar)
        .environmentObject(extensions)
        .background {
            palette.list.ignoresSafeArea()
        }
        .overlay { TopicTabDragCanvas(group: tabPointers).allowsHitTesting(false).accessibilityHidden(true) }
        .overlay(alignment: .topTrailing) {
            if !extensions.officePresented && !composing {
                VStack(alignment: .trailing, spacing: 9) {
                    if let reward = attendance.reward, reward.member == forumSession.ownProfile?.id {
                        attendancePopup(reward.result).transition(popupTransition)
                    }
                    if let popup = extensions.watchPopup {
                        keywordPopup(popup).transition(popupTransition)
                    }
                }
                .padding(.top, 9).padding(.trailing, 13)
                .animation(motion, value: attendance.reward?.member)
                .animation(motion, value: extensions.watchPopup?.id)
            }
        }
        .overlay { searchOverlay }
        .tint(palette.accent)
        .frame(minWidth: 630, minHeight: 460)
        .defaultFocus($listHasFocus, true)
        .alert("屏蔽此用户？", isPresented: Binding(
            get: { extensions.pendingBlock != nil },
            set: { if !$0 { extensions.cancelBlock() } }
        ), presenting: extensions.pendingBlock) { author in
            Button("取消", role: .cancel) {}.keyboardShortcut(.defaultAction)
            Button("确认屏蔽", role: .destructive) { extensions.confirmBlock(author) }
        } message: { author in
            Text("\(author.name) 的主题正文和回复会折叠。你可以在原楼层或扩展中心解除屏蔽。")
        }
        .onAppear {
            let currentWorkspace = workspace
            forumSession.accessDidChange = { [weak currentWorkspace] in currentWorkspace?.invalidateForumAccess() }
        }
        .onChange(of: extensions.officePresented, initial: true) { _, active in
            workspace.presentingOfficeCover = active
        }
        .onChange(of: extensions.active(.hot)) { _, enabled in
            if !enabled && workspace.destination == .hot { workspace.returnToForum() }
        }
        .task(id: scenePhase == .active && !extensions.officePresented ? extensions.watchPopup?.id : nil) {
            guard scenePhase == .active, !extensions.officePresented, let id = extensions.watchPopup?.id else { return }
            do { try await Task.sleep(for: .seconds(12)) } catch { return }
            if extensions.watchPopup?.id == id { extensions.dismissWatchPopup() }
        }
        .task(id: automaticAttendanceMember) {
            if let member = automaticAttendanceMember {
                await attendance.run(member: member, session: forumSession, extensions: extensions)
            }
        }
        .task(id: FeedTaskKey(board: workspace.board, order: workspace.feedOrder, refresh: workspace.homeRefreshRevision,
                             access: forumSession.accessRevision)) {
            if workspace.query.isEmpty { await workspace.refresh() }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(60)) } catch { return }
                if autoRefresh && inForum && workspace.board == .home && NSApp.isActive && !workspace.isBrowsingHistory && workspace.query.isEmpty { await workspace.refresh() }
            }
        }
        .task(id: sessionPollingKey) {
            while !Task.isCancelled {
                if !extensions.officePresented { await forumSession.refreshUnread() }
                do { try await Task.sleep(for: .seconds(45)) } catch { return }
                if !NSApp.isActive {
                    do { try await Task.sleep(for: .seconds(30)) } catch { return }
                }
            }
        }
        .task(id: workspace.searchRevision) {
            if workspace.isSearchingForum { await workspace.refresh() }
        }
        .sheet(item: presentedSheet) { presentation in
            Group {
            switch presentation {
            case .access(let request): ForumAccessSheet(request: request, session: forumSession)
            case .compose: EmptyView()
            case .profile: ForumAccountSheet(section: .profile, session: forumSession, palette: palette, openTopic: workspace.openTopicLink)
            case .rulings(let name):
                RulingsView(name: name, session: forumSession, palette: palette, openTopic: workspace.openTopicLink)
            case .user(let person):
                ForumUserCard(person: person, session: forumSession, palette: palette, openSpace: {
                    forumSession.presentation = nil
                    workspace.showUserSpace(person)
                }) {
                    openMessage(person)
                }
            }
            }.id(forumSession.accessRevision)
        }
    }

    private var windowToolbarBackground: Visibility {
        if #available(macOS 26.0, *) { return .hidden }
        return .automatic
    }

    private func mainLayout(width: CGFloat, compact: Bool, sidebarWidth: CGFloat, sidebarRange: ClosedRange<CGFloat>) -> some View {
        let navigationWidth = sidebarWidth > 0 ? sidebarWidth + DeskSidebarSizing.divider : navigationRailWidth
        return HStack(spacing: 0) {
            if sidebarWidth > 0 {
                HStack(spacing: 0) {
                    sidebar(compact: false)
                        .frame(width: sidebarWidth - 14, alignment: .leading)
                        .clipped()
                        .deskGlass(in: RoundedRectangle(cornerRadius: 18), solid: palette.sidebar)
                        .padding(.leading, 8).padding(.trailing, 6).padding(.vertical, 7)
                    resizeDivider("侧栏宽度", width: sidebarWidth, range: sidebarRange, preferred: $storedSidebarWidth,
                        standard: DeskSidebarSizing.standard, drag: $paneWidths.sidebar)
                }
                .transition(.opacity)
                .zIndex(2)
            } else {
                navigationRail(compact: compact).transition(.opacity).zIndex(2)
            }
            switch workspace.destination {
            case .board:
                forumPanes(width: max(1, width - navigationWidth), compact: compact)
            case .shortcut(let shortcut):
                ForumShortcutPane(shortcut: shortcut, session: forumSession, palette: palette,
                    openTopic: workspace.openTopicLink)
                    .id("\(shortcut)|\(forumSession.accessRevision)")
            case .notifications:
                ForumAccountSheet(section: .inbox, session: forumSession, palette: palette, openTopic: workspace.openTopicLink)
                    .id(forumSession.accessRevision)
                    .modifier(DeskArrival())
            case .mySpace:
                spacePane(nil)
            case .space(let person):
                spacePane(person).id(person.id)
            case .plugins:
                PluginCenterView(palette: palette, returnTitle: forumReturnTitle, returnToForum: workspace.returnToForum, showHot: workspace.showHot,
                                 openTopic: workspace.openTopicLink, session: forumSession, attendance: attendance)
            case .hot:
                HotRankingView(palette: palette, openTopic: workspace.openTopicLink, state: sidebarState.ranking)
            case .settings:
                PreferencesPane(updates: updates, palette: palette, returnTitle: forumReturnTitle,
                                returnToForum: workspace.returnToForum).modifier(DeskArrival())
            case .friends:
                FriendLinksPane(palette: palette, returnTitle: forumReturnTitle,
                                returnToForum: workspace.returnToForum).modifier(DeskArrival())
            }
        }
        .animation(reduceMotion ? nil : DeskMotion.selection, value: workspace.showingSidebar)
    }

    private func spacePane(_ person: ForumUserReference?) -> some View {
        ForumSpacePane(person: person, session: forumSession, palette: palette,
                       openTopic: workspace.openTopicLink, openPerson: workspace.showUserSpace,
                       openMessage: openMessage, returnTitle: forumReturnTitle, goBack: workspace.returnToForum)
            .id(forumSession.accessRevision)
    }

    private func openMessage(_ person: ForumUserReference) {
        forumSession.presentation = nil
        forumSession.requestedPeer = ForumConversation(id: person.id, name: person.name, preview: "", date: "", unread: false)
        workspace.showNotifications()
    }

    private var rule: some View { Rectangle().fill(palette.line).frame(height: 1) }
    private var verticalRule: some View { Rectangle().fill(palette.line).frame(width: 1) }

    @ToolbarContentBuilder
    private func workspaceToolbar(compact: Bool) -> some ToolbarContent {
        let home = ToolbarItem(placement: .navigation) {
            logo(height: 36).fixedSize().disabled(composing || workspace.showingSearch)
        }
        let controls = ToolbarItem {
            HStack(spacing: 9) {
                searchButton(compact: compact)
                toolbarAccountControls(compact: compact)
                    .frame(height: 36)
                    .padding(.horizontal, 5)
                    .deskGlass(in: Capsule(), solid: palette.chrome)
                    .disabled(workspace.showingSearch)
            }
            .fixedSize()
            .disabled(composing)
            .accessibilityElement(children: .contain)
        }
        if #available(macOS 26.0, *) {
            home.sharedBackgroundVisibility(.hidden)
            ToolbarSpacer(.flexible)
            controls.sharedBackgroundVisibility(.hidden)
        } else {
            home
            controls
        }
    }

    private func searchButton(compact: Bool) -> some View {
        let expandedWidth: CGFloat = compact ? 150 : 236
        let expanded = searchAnchors.hovering
        return Button(action: workspace.beginSearch) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .scaleEffect(expanded && !reduceMotion ? 1.13 : 1)
                    .animation(reduceMotion ? nil : .spring(duration: 0.24, bounce: 0.22),
                               value: expanded)
                Text(compact ? "搜索" : "搜索帖子").fontWeight(.medium).fixedSize()
            }
            .font(.system(size: 12))
            .foregroundStyle(.secondary)
            .padding(.leading, 11)
            .frame(width: expanded ? expandedWidth : expandedWidth / 2, height: 36, alignment: .leading)
            .overlay(alignment: .trailing) {
                Text("⌘ K").font(.caption.monospaced()).foregroundStyle(.secondary)
                    .padding(.trailing, 11)
                    .opacity(expanded ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .background(palette.chrome.opacity(0.20), in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(DeskButtonStyle())
        .deskGlass(in: Capsule(), solid: palette.chrome, interactive: true)
        .animation(reduceMotion ? nil : .smooth(duration: 0.23), value: expanded)
        .onHover { searchAnchors.hovering = $0 }
        .background { WorkspaceSearchAnchor { searchAnchors.button = $0 } }
        // The search capsule grows toward the center without shifting adjacent controls.
        .frame(width: expandedWidth, alignment: .trailing)
        .accessibilityHidden(workspace.showingSearch)
        .help("按版块搜索或打开帖子链接 · ⌘K")
    }

    private func toolbarAccountControls(compact: Bool) -> some View {
        HStack(spacing: 7) {
            if extensions.active(.office) {
                toolButton(extensions.officeButton.isEmpty ? "切换办公视图" : extensions.officeButton, icon: "tablecells.fill") { extensions.officePresented = true }
                    .keyboardShortcut(extensions.shortcut, modifiers: [.command, .shift])
            }
            Button(action: showNotifications) {
                Label("通知", systemImage: "bell").labelStyle(.iconOnly)
                    .font(.system(size: 15, weight: .medium)).frame(width: 27, height: 27)
            }
            .buttonStyle(DeskButtonStyle(compresses: true))
            .help("通知").accessibilityLabel("通知")
            .overlay(alignment: .topTrailing) { unreadBadge }
            .accessibilityValue(forumSession.unread.total > 0 ? "\(forumSession.unread.total) 条未读" : "无未读")
            accountButton(compact: compact)
        }
        .padding(.horizontal, 5)
    }

    @ViewBuilder private func accountButton(compact: Bool) -> some View {
        if let profile = forumSession.ownProfile {
            Button(action: workspace.showMySpace) {
                HStack(spacing: 8) {
                    ForumAvatar(url: Forum.avatar(profile.id), size: 28, palette: palette)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(profile.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                                .frame(maxWidth: compact ? 94 : 135, alignment: .leading)
                            if !compact {
                                Text("#\(profile.id)").font(.system(size: 11).monospacedDigit())
                                    .foregroundStyle(.secondary)
                            }
                        }
                        HStack(spacing: 6) {
                            if let rank = profile.rank {
                                Text("Lv \(rank)").foregroundStyle(palette.accent)
                            }
                            if let coin = profile.coin {
                                HStack(spacing: 3) {
                                    DeskIcon("fork.knife", asset: "asset-chicken-leg", size: 12).foregroundStyle(palette.featured)
                                    Text(coin.formatted()).monospacedDigit()
                                }
                            }
                        }
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                    }
                    DeskIcon("chevron.down", size: 9).font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .padding(.leading, 4).padding(.trailing, 2).frame(height: 34)
                .contentShape(Capsule())
            }
            .buttonStyle(DeskButtonStyle())
            .fixedSize(horizontal: true, vertical: false)
            .accessibilityLabel("个人资料 · \(profile.name) · 用户 #\(profile.id)")
            .accessibilityValue([profile.rank.map { "等级 \($0)" }, profile.coin.map { "\($0) 个鸡腿" }].compactMap { $0 }.joined(separator: "，"))
            .help("个人资料 · 用户 #\(profile.id)")
        } else if forumSession.account == .signedOut {
            toolButton("登录 NodeSeek", icon: "person.crop.circle", action: forumSession.signIn)
        } else {
            toolButton(forumSession.account == .signedIn ? "个人资料 · NodeSeek 已登录" : "NodeSeek 账户",
                icon: "person.crop.circle") { forumSession.presentation = .profile }
        }
    }

    private func attendancePopup(_ reward: ForumAttendanceResult) -> some View {
        HStack(spacing: 11) {
            DeskIcon("checkmark.circle.fill", size: 23)
                .font(.system(size: 23, weight: .medium))
                .foregroundStyle(palette.categoryInk("review"))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text("已成功签到").font(.system(size: 14, weight: .semibold))
                HStack(spacing: 4) {
                    Text(reward.rewardText).font(.system(size: 13)).foregroundStyle(.secondary)
                    DeskIcon("fork.knife", asset: "asset-chicken-leg", size: 15).foregroundStyle(palette.featured)
                        .accessibilityHidden(true)
                }
            }
            toolButton("关闭签到提示", icon: "xmark", action: attendance.dismissReward)
                .padding(.leading, 8)
        }
        .padding(12)
        .background(palette.reader, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.line).allowsHitTesting(false) }
        .shadow(color: .black.opacity(palette.dark ? 0.35 : 0.12), radius: 12, x: 0, y: 4)
        .accessibilityElement(children: .contain)
    }

    private var popupTransition: AnyTransition {
        reduceMotion ? .identity : .opacity.combined(with: .offset(y: -5))
    }

    private func keywordPopup(_ popup: DeskExtensions.WatchPopup) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 7) {
                DeskLabel("关键词命中", systemImage: "dot.radiowaves.left.and.right")
                    .font(.system(size: 14, weight: .semibold)).foregroundStyle(palette.accent)
                Spacer()
                Text("\(popup.hits.count) 篇").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                toolButton("关闭关键词提示", icon: "xmark", action: extensions.dismissWatchPopup)
            }
            ForEach(popup.hits.prefix(3)) { hit in
                Button {
                    if workspace.openTopicLink(hit.post.url) { extensions.dismissWatchPopup() }
                } label: {
                    HStack(spacing: 7) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(hit.post.title).font(.system(size: 13, weight: .medium)).lineLimit(2)
                            Text(hit.words.joined(separator: "、")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 2)
                        DeskIcon("arrow.up.right", size: 12).font(.caption).foregroundStyle(palette.accent)
                    }
                    .padding(.horizontal, 8).padding(.vertical, 6)
                    .background(palette.list, in: RoundedRectangle(cornerRadius: 6))
                }
                .buttonStyle(DeskButtonStyle())
                .help("打开帖子")
            }
            if popup.hits.count > 3 {
                Text("其余命中可在扩展中心的关键词监控中查看。")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(12).frame(width: 332)
        .background(palette.reader, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(palette.line).allowsHitTesting(false) }
        .shadow(color: .black.opacity(palette.dark ? 0.35 : 0.12), radius: 12, x: 0, y: 4)
        .accessibilityElement(children: .contain)
    }

    private func navigationRail(compact: Bool) -> some View {
        VStack(spacing: 0) {
            if compact {
                sidebarControl("打开导航") { sidebarState.compactOpen.toggle() }
                    .popover(isPresented: $sidebarState.compactOpen, arrowEdge: .trailing) {
                        sidebar(compact: true)
                            .frame(width: clamp(CGFloat(storedSidebarWidth), in: DeskSidebarSizing.range), height: 440)
                    }
            } else {
                sidebarControl("展开侧栏") { workspace.showingSidebar = true }
            }
        }
        .padding(.top, 12)
        .frame(width: navigationRailWidth)
        .frame(maxHeight: .infinity, alignment: .top)
        .background(palette.chrome)
        .overlay(alignment: .trailing) { verticalRule.allowsHitTesting(false) }
    }

    private func sidebarControl(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DeskIcon("sidebar.left", size: 14)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: 29, height: 35)
                .background(palette.reader.opacity(0.7), in: RoundedRectangle(cornerRadius: 7))
                .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(palette.line).allowsHitTesting(false) }
        }
        .buttonStyle(DeskButtonStyle(compresses: true))
        .help(title).accessibilityLabel(title)
    }

    private func sidebar(compact: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Button {
                    sidebarState.compactOpen = false
                    if forumSession.newDiscussion.category.isEmpty, let category = workspace.board.categoryID {
                        forumSession.newDiscussion.category = category
                    }
                    forumSession.presentation = .compose
                } label: {
                    DeskLabel("发帖", systemImage: "plus")
                        .font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity).frame(height: 35)
                        .foregroundStyle(.white)
                        .background(palette.publish, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(DeskButtonStyle(compresses: true))
                sidebarControl("收起侧栏") {
                    if compact { sidebarState.compactOpen = false }
                    else { workspace.showingSidebar = false }
                }
            }
            .padding(.horizontal, 11).padding(.top, 12).padding(.bottom, 5)
            boardButton(.home).padding(.horizontal, 11).padding(.bottom, 9)
            GeometryReader { geometry in
                sidebarRoll(height: geometry.size.height)
            }
            .padding(.horizontal, 11).padding(.bottom, 8)
            rule.padding(.horizontal, 16).padding(.bottom, 8)
            navButton("友情链接", icon: "link", selected: workspace.destination == .friends) {
                workspace.showFriends()
                sidebarState.compactOpen = false
            }
            .padding(.horizontal, 10)
            navButton("我的", icon: "person.crop.circle", selected: workspace.destination == .mySpace) {
                workspace.showMySpace()
                sidebarState.compactOpen = false
            }
            .padding(.horizontal, 10)
            navButton("扩展中心", icon: "puzzlepiece.extension", selected: workspace.destination == .plugins) {
                workspace.showPlugins()
                sidebarState.compactOpen = false
            }
                .overlay(alignment: .trailing) {
                    if extensions.active(.keywords) && extensions.unread > 0 {
                        Text(String(extensions.unread)).font(.system(size: 10, weight: .semibold)).foregroundStyle(palette.accent)
                            .padding(5).background(palette.selection, in: Capsule()).padding(.trailing, 9).allowsHitTesting(false)
                    }
                }
                .padding(.horizontal, 10)
            navButton("设置", icon: "gearshape", selected: workspace.destination == .settings) {
                workspace.showSettings()
                sidebarState.compactOpen = false
            }
            .padding(.horizontal, 10).padding(.bottom, 12)
        }
    }

    private func sidebarRoll(height: CGFloat) -> some View {
        let active = sidebarState.section
        let hasRanking = extensions.active(.hot)
        let headerHeight = max(34, boardTextSize + 19)
        let rowHeight = max(34, boardTextSize + 17)
        let bodyHeight = max(0, height - headerHeight * (hasRanking ? 3 : 2) - (hasRanking ? 12 : 6))
        return VStack(spacing: 6) {
            VStack(spacing: 0) {
                rollHeader("论坛版块", icon: "square.grid.2x2", section: .boards, height: headerHeight)
                ScrollView {
                    VStack(spacing: 2) { ForEach(Board.sections, content: boardButton) }
                        .padding(.top, 4)
                }
                .scrollIndicators(.never)
                .frame(height: active == .boards ? min(bodyHeight, CGFloat(Board.sections.count) * (rowHeight + 2) + 4) : 0, alignment: .top)
                .clipped().opacity(active == .boards ? 1 : 0)
                .allowsHitTesting(active == .boards).accessibilityHidden(active != .boards)
            }
            VStack(spacing: 0) {
                rollHeader("快捷功能区", icon: "bolt", section: .shortcuts, height: headerHeight)
                ScrollView {
                    VStack(spacing: 2) {
                        ForEach(ForumShortcut.allCases) { shortcut in
                            navButton(shortcut.title, icon: shortcut.icon,
                                selected: workspace.destination == .init(shortcut: shortcut), fontSize: boardTextSize) {
                                sidebarState.compactOpen = false
                                workspace.showShortcut(shortcut)
                            }
                        }
                    }
                    .padding(.top, 4)
                }
                .scrollIndicators(.never)
                .frame(height: active == .shortcuts ? min(bodyHeight, CGFloat(ForumShortcut.allCases.count) * (rowHeight + 2) + 4) : 0, alignment: .top)
                .clipped().opacity(active == .shortcuts ? 1 : 0)
                .allowsHitTesting(active == .shortcuts).accessibilityHidden(active != .shortcuts)
            }
            if hasRanking {
                VStack(spacing: 0) {
                    rollHeader("热榜", icon: "flame", section: .ranking, height: headerHeight)
                    SidebarHotRanking(palette: palette, state: sidebarState.ranking, availableHeight: max(0, bodyHeight - 4)) {
                        workspace.showHot()
                        sidebarState.compactOpen = false
                    } openTopic: { url in
                        sidebarState.compactOpen = false
                        return workspace.openTopicLink(url)
                    }
                    .padding(.top, 4)
                    .frame(height: active == .ranking ? bodyHeight : 0, alignment: .top)
                    .clipped().opacity(active == .ranking ? 1 : 0)
                    .allowsHitTesting(active == .ranking).accessibilityHidden(active != .ranking)
                }
            }
        }
        .animation(reduceMotion ? nil : DeskMotion.pane, value: active)
    }

    private func rollHeader(_ title: String, icon: String, section: SidebarNavigationState.Section, height: CGFloat) -> some View {
        let open = sidebarState.section == section
        return Button { sidebarState.section = open ? nil : section } label: {
            HStack(spacing: 9) {
                DeskIcon(icon, size: 12).font(.system(size: 12, weight: .medium))
                    .foregroundStyle(palette.accent).frame(width: 18)
                Text(title).font(.system(size: boardTextSize, weight: .semibold))
                Spacer()
                DeskIcon("chevron.down", size: 10).font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.secondary).rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.horizontal, 10).frame(height: height)
            .background(palette.reader.opacity(0.54), in: RoundedRectangle(cornerRadius: 7))
            .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(palette.line.opacity(0.84)).allowsHitTesting(false) }
            .contentShape(Rectangle())
        }
        .buttonStyle(DeskButtonStyle())
        .accessibilityValue(open ? "已展开" : "已收起")
        .help(open ? "收起" + title : "展开" + title)
    }

    private func logo(height: CGFloat) -> some View {
        Button {
            workspace.goHome()
            sidebarState.compactOpen = false
        } label: {
            DeskWordmark(logo: selectedLogo, dark: palette.dark, height: height)
        }
        .buttonStyle(DeskButtonStyle(compresses: true))
        .accessibilityLabel("SeekDesk 首页")
        .help("返回最新帖子")
    }

    private func boardButton(_ board: Board) -> some View {
        navButton(board.title, icon: board.icon, selected: workspace.destination == .board(board), fontSize: boardTextSize) {
            workspace.choose(board)
            sidebarState.compactOpen = false
        }
    }

    private func navButton(_ title: String, icon: String, selected: Bool, fontSize: Double = 13, action: @escaping () -> Void) -> some View {
        Button(action: action) { navLabel(title, icon: icon, selected: selected, fontSize: fontSize) }
            .buttonStyle(DeskButtonStyle())
            .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func navLabel(_ title: String, icon: String, selected: Bool, fontSize: Double) -> some View {
        HStack(spacing: 9) {
            Group {
                if icon == ForumShortcut.award.icon {
                    FeaturedDiamondIcon(size: max(14, fontSize), color: palette.featured).accessibilityHidden(true)
                } else {
                    DeskIcon(icon, size: min(18, max(13, fontSize)))
                }
            }
            .frame(width: 18)
            Text(title)
        }
        .font(.system(size: fontSize, weight: selected ? .semibold : .medium))
        .foregroundStyle(selected ? palette.accent : Color.primary)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 11).frame(height: max(34, fontSize + 17))
        .background(selected ? palette.selection : .clear, in: RoundedRectangle(cornerRadius: 7))
        .animation(motion, value: selected)
    }

    private func forumPanes(width: CGFloat, compact: Bool) -> some View {
        let topic = workspace.showReader ? workspace.session.selectedTopic : nil
        let reading = topic != nil
        let listVisible = !reading || (!compact && !hideListWhileReading)
        let split = reading && listVisible
        let divider = DeskSidebarSizing.divider
        let maxListWidth = max(240, min(620, width - 412 - divider))
        let listRange: ClosedRange<CGFloat> = 240...maxListWidth
        let hasListColumn = reading && !compact
        let listWidth = hasListColumn ? clamp(clamp(CGFloat(storedListWidth), in: listRange) + paneWidths.list, in: listRange) : width
        let visibleListWidth = listVisible ? listWidth + (split ? divider : 0) : 0
        let panes = HStack(spacing: 0) {
            HStack(spacing: 0) {
                feedPane
                    .frame(width: listWidth)
                    .focusable(listVisible, interactions: .edit)
                    .focused($listHasFocus)
                    .focusEffectDisabled()
                    .onKeyPress(keys: [.upArrow, .downArrow, .return, KeyEquivalent("\u{3}")], action: handleListKey)
                if hasListColumn {
                    resizeDivider("帖子列表宽度", width: listWidth, range: listRange, preferred: $storedListWidth,
                        standard: 340, drag: $paneWidths.list)
                }
            }
            .frame(width: visibleListWidth, alignment: .trailing)
            .mask {
                Rectangle().ignoresSafeArea(.container, edges: .top)
            }
            .disabled(!listVisible)
            .accessibilityHidden(!listVisible)
            .allowsHitTesting(listVisible)
            if let topic {
                readerPane(topic: topic)
                    .transition(.opacity)
            }
        }
        .frame(width: width, alignment: .leading)
        let canToggleList = reading && !compact
        return Group {
            if #available(macOS 26.0, *) {
                panes.safeAreaBar(edge: .top, spacing: 0) { topicTabs(canToggleList: canToggleList) }
            } else {
                panes.safeAreaInset(edge: .top, spacing: 0) { topicTabs(canToggleList: canToggleList) }
            }
        }
        .animation(reduceMotion ? nil : DeskMotion.selection, value: reading)
        .animation(reduceMotion ? nil : DeskMotion.pane, value: split)
        .onChange(of: listVisible, initial: true) { _, visible in
            if !visible { listHasFocus = false }
            else if !reading { listHasFocus = true }
        }
        .onChange(of: workspace.showReader) {
            if !workspace.showReader { listHasFocus = true }
        }
        .onChange(of: workspace.showingSearch) {
            if !workspace.showingSearch && listVisible { listHasFocus = true }
        }
        .onChange(of: workspace.board) {
            if listVisible { listHasFocus = true }
        }
    }

    @ViewBuilder private func topicTabs(canToggleList: Bool) -> some View {
        if !workspace.session.topics.isEmpty {
            VStack(spacing: 0) {
                tabBar(canToggleList: canToggleList)
                rule
            }
        }
    }

    private func resizeDivider(_ title: String, width: CGFloat, range: ClosedRange<CGFloat>, preferred: Binding<Double>,
                               standard: Double, drag: Binding<CGFloat>) -> some View {
        let base = clamp(CGFloat(preferred.wrappedValue), in: range)
        let dragging = drag.wrappedValue != 0
        return ZStack {
            Rectangle().fill(palette.list)
            verticalRule
            Capsule().fill(palette.accent.opacity(dragging ? 0.92 : 0.37))
                .frame(width: 3, height: dragging ? 34 : 24)
        }
            .frame(width: DeskSidebarSizing.divider)
            .overlay {
                DeskResizeHandle(
                    change: { drag.wrappedValue = $0 },
                    finish: { delta in
                        withTransaction(Transaction(animation: nil)) {
                            drag.wrappedValue = 0
                            if delta != 0 { preferred.wrappedValue = Double(clamp(base + delta, in: range)) }
                        }
                    },
                    reset: { preferred.wrappedValue = standard }
                )
            }
            .zIndex(1)
            .help("拖动调整\(title)，双击恢复默认")
            .accessibilityElement()
            .accessibilityLabel(title)
            .accessibilityValue("\(Int(width)) 点")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: preferred.wrappedValue = Double(clamp(base + 24, in: range))
                case .decrement: preferred.wrappedValue = Double(clamp(base - 24, in: range))
                @unknown default: break
                }
            }
    }

    private func clamp(_ value: CGFloat, in bounds: ClosedRange<CGFloat>) -> CGFloat {
        min(bounds.upperBound, max(bounds.lowerBound, value))
    }

    private func handleListKey(_ press: KeyPress) -> KeyPress.Result {
        guard !workspace.showingSearch else { return .ignored }
        let modifiers = press.modifiers.intersection([.command, .option, .shift, .control])
        switch press.key {
        case .upArrow where modifiers.isEmpty:
            return workspace.movePostFocus(.previous) ? .handled : .ignored
        case .downArrow where modifiers.isEmpty:
            return workspace.movePostFocus(.next) ? .handled : .ignored
        case .return, KeyEquivalent("\u{3}"):
            guard modifiers.isEmpty || modifiers == .command else { return .ignored }
            if press.phase != .repeat { workspace.openFocusedPost(background: modifiers == .command) }
            return .handled
        default:
            return .ignored
        }
    }

    private var feedPane: some View {
        VStack(alignment: .leading, spacing: 0) {
            feedBody
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 0) {
                rule
                if workspace.hasOlderPosts {
                    Button {
                        Task { await workspace.loadOlder() }
                    } label: {
                        DeskLabel(workspace.failedToLoadOlder ? "重试加载更早帖子" : (workspace.query.isEmpty ? "加载更早帖子" : "搜索更早帖子"), systemImage: "chevron.down")
                            .font(.system(size: 12, weight: .medium))
                            .frame(maxWidth: .infinity).frame(height: 32)
                    }
                    .buttonStyle(DeskButtonStyle()).disabled(workspace.isLoading)
                    rule
                }
                feedStatus
            }
            .background(palette.list)
        }
        .background(palette.list)
    }

    private var feedHeader: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                if workspace.board == .award {
                    FeaturedDiamondIcon(size: 20, color: palette.featured).accessibilityHidden(true)
                }
                Text(workspace.query.isEmpty ? workspace.board.title : "搜索结果").font(.system(size: 20, weight: .bold))
                Spacer()
                Button { Task { await workspace.refresh() } } label: {
                    DeskRefreshLabel(title: "刷新列表", loading: workspace.isLoading)
                }
                .buttonStyle(DeskButtonStyle(compresses: true))
                .disabled(workspace.isLoading)
                .help("刷新当前列表 · ⌘R")
            }
            if workspace.query.isEmpty && workspace.board == .home {
                Picker("首页排序", selection: Binding(get: { workspace.feedOrder }, set: workspace.chooseFeedOrder)) {
                    ForEach(ForumFeedOrder.allCases) { order in Text(order.title).tag(order) }
                }
                .pickerStyle(.segmented).labelsHidden().accessibilityLabel("首页排序")
            } else if workspace.query.isEmpty {
                Text(workspace.board == .award ? "论坛推荐" : workspace.feedOrder.title)
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 9).padding(.vertical, 4)
                    .background(palette.surface, in: RoundedRectangle(cornerRadius: 5))
            } else {
                HStack(spacing: 7) {
                    Button(action: workspace.clearSearch) {
                        DeskLabel(workspace.query, systemImage: "xmark.circle.fill")
                            .font(.system(size: 11, weight: .semibold)).lineLimit(1)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                    }
                    .buttonStyle(DeskButtonStyle())
                    .help("清除搜索")
                    Button(action: workspace.beginSearch) {
                        DeskLabel(workspace.showsPostResults ? Board.searchScopeTitle(workspace.appliedSearchScope) : "仅用户",
                                  systemImage: "line.3.horizontal.decrease")
                            .font(.system(size: 11, weight: .semibold)).lineLimit(1)
                            .padding(.horizontal, 9).padding(.vertical, 4)
                            .background(palette.surface, in: RoundedRectangle(cornerRadius: 5))
                    }
                    .buttonStyle(DeskButtonStyle())
                    .help("调整搜索版块")
                }
            }
        }
        .padding(.horizontal, 17).padding(.vertical, 15)
    }

    private var feedStatus: some View {
        let cached = workspace.failedToRefresh && !workspace.posts.isEmpty
        return HStack(spacing: 6) {
            if workspace.isSearchingForum {
                if workspace.appliedSearchKind == .people {
                    Text("搜索结果 · \(workspace.searchPeople.count) 位用户")
                } else {
                    Text(workspace.failedToRefresh ? "站内搜索未连接 · 显示可用结果" : "搜索结果 · \(workspace.filteredPosts.count) 篇")
                }
            } else if workspace.board == .award && !workspace.hasForumPage {
                Text(workspace.failedToRefresh ? "精品区暂不可用" : "NodeSeek 精品帖")
            } else if cached {
                DeskLabel(workspace.hasForumPage ? "刷新失败 · 保留当前列表" : "论坛列表不可用 · 备用订阅", systemImage: "arrow.clockwise.circle")
            } else {
                Text("\(workspace.hasForumPage ? "已加载" : "订阅") · \(workspace.filteredPosts.count) 篇")
            }
            Spacer(minLength: 2)
            if workspace.isLoading {
                ProgressView().controlSize(.mini).accessibilityLabel("正在刷新")
            } else if cached {
                Button("重试") { Task { await workspace.refresh() } }
                    .buttonStyle(.borderless).foregroundStyle(palette.accent)
            } else if let date = workspace.lastRefresh {
                Text(date.formatted(date: .omitted, time: .shortened)).monospacedDigit()
                    .accessibilityLabel("上次刷新时间 \(date.formatted(date: .abbreviated, time: .shortened))")
            }
        }
        .lineLimit(1)
        .font(.caption).foregroundStyle(.secondary)
        .padding(.horizontal, 14).frame(height: 32)
        .help(workspace.lastRefresh.map { "上次成功刷新 \($0.formatted(date: .abbreviated, time: .shortened))" } ?? "帖子列表")
    }

    @ViewBuilder private var feedBody: some View {
        let posts = workspace.filteredPosts
        let contentName = switch workspace.board {
        case .award: "精品帖"
        case .inside: "内版帖子"
        default: "新帖"
        }
        if !posts.isEmpty || workspace.showsPeopleResults {
            ScrollViewReader { proxy in
                let scroll = ScrollView {
                    feedHeader
                    rule
                    if workspace.showsPeopleResults {
                        peopleResults
                        if workspace.showsPostResults {
                            rule
                            Text("相关帖子").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
                                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 17).padding(.top, 12)
                            if posts.isEmpty {
                                Text(workspace.isLoading ? "正在搜索帖子…" :
                                    (workspace.failedToRefresh ? "暂时无法读取帖子结果。" : "当前页没有匹配的帖子。"))
                                    .font(.callout).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 17).padding(.vertical, 8)
                            }
                        }
                    }
                    LazyVStack(spacing: 0) {
                        ForEach(posts) { post in
                            VStack(spacing: 0) {
                                feedRow(post)
                                rule.padding(.leading, 10)
                            }
                            .id(post.id)
                        }
                        if autoLoadOlder && workspace.query.isEmpty && workspace.hasOlderPosts {
                            Color.clear.frame(height: 1)
                                .id("older-\(posts.last?.id ?? "")")
                                .onAppear {
                                    guard !workspace.isLoading, !workspace.failedToLoadOlder else { return }
                                    Task { await workspace.loadOlder() }
                                }
                                .accessibilityHidden(true)
                        }
                    }
                    .padding(.horizontal, 8).padding(.vertical, 5)
                }
                .scrollContentBackground(.hidden)
                Group {
                    if #available(macOS 26.0, *) {
                        scroll.scrollEdgeEffectStyle(.soft, for: .top)
                    } else {
                        scroll
                    }
                }
                .onChange(of: workspace.keyboardPostID) {
                    if listHasFocus, let id = workspace.keyboardPostID { proxy.scrollTo(id) }
                }
                .onChange(of: listHasFocus) {
                    if listHasFocus, let id = workspace.keyboardPostID { proxy.scrollTo(id) }
                }
            }
            .id(FeedFilter(board: workspace.board, query: workspace.query, scope: workspace.appliedSearchScope,
                           kind: workspace.appliedSearchKind))
        } else {
            feedHeader
            rule
            Group {
                if workspace.isLoading && (workspace.posts.isEmpty || workspace.isSearchingForum) {
                    ProgressView(workspace.isSearchingForum ? "正在搜索论坛历史帖子…" : "正在读取\(contentName)…").controlSize(.small)
                } else if workspace.failedToRefresh && workspace.board == .inside && workspace.query.isEmpty {
                    ContentUnavailableView {
                        DeskLabel("暂时无法读取内版", systemImage: "lock", size: 32)
                    } description: {
                        Text("内版需要登录，并由 NodeSeek 检查账号的访问权限。")
                    } actions: {
                        if forumSession.account != .signedIn { Button("登录 NodeSeek", action: forumSession.signIn) }
                        Button("重试") { Task { await workspace.refresh() } }
                    }
                } else if workspace.failedToRefresh && (workspace.posts.isEmpty || workspace.isSearchingForum) {
                    ContentUnavailableView {
                        DeskLabel(workspace.isSearchingForum ? "暂时无法搜索论坛" : "暂时无法读取\(contentName)", systemImage: "wifi.exclamationmark", size: 32)
                    } actions: {
                        Button("重试") { Task { await workspace.refresh() } }
                        if workspace.isSearchingForum && forumSession.account != .signedIn {
                            Button("登录 NodeSeek", action: forumSession.signIn)
                        }
                    }
                } else {
                    ContentUnavailableView {
                        DeskLabel(workspace.query.isEmpty ? "暂无\(contentName)" : "没有匹配的帖子", systemImage: "tray", size: 32)
                    } description: {
                        Text("可刷新列表，或加载更早的帖子。")
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var peopleResults: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("最相关用户").font(.subheadline.weight(.semibold)).accessibilityAddTraits(.isHeader)
            if workspace.peopleBusy && workspace.searchPeople.isEmpty {
                ProgressView("正在搜索用户…").controlSize(.small).padding(.vertical, 6)
            } else if let error = workspace.peopleError {
                HStack {
                    Text(error == .signInRequired ? "登录 NodeSeek 后可搜索用户。" : "暂时无法读取用户结果。")
                        .font(.callout).foregroundStyle(.secondary)
                    if error == .signInRequired { Button("登录", action: forumSession.signIn) }
                    else { Button("重试") { Task { await workspace.refresh() } } }
                }
            } else if workspace.searchPeople.isEmpty {
                Text("没有匹配的用户。").font(.callout).foregroundStyle(.secondary).padding(.vertical, 5)
            }
            ForEach(workspace.searchPeople.prefix(workspace.appliedSearchKind == .people ? 50 : 5), id: \.id) { person in
                Button { workspace.showUserSpace(person) } label: {
                    HStack(spacing: 9) {
                        ForumAvatar(url: person.avatar, size: 28, palette: palette)
                        Text(person.name).font(.callout.weight(.semibold))
                        Text("#\(person.id)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption).foregroundStyle(.secondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 3).contentShape(Rectangle())
                }
                .buttonStyle(DeskButtonStyle())
                .help("查看 \(person.name) 的主页")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 17).padding(.vertical, 12)
    }

    private func feedRow(_ post: FeedPost) -> some View {
        let selected = workspace.showReader && workspace.session.selection == post.id
        let focused = listHasFocus && workspace.keyboardPostID == post.id
        let blocked = extensions.blocks(post.authorID, name: post.author)
        return Button {
            listHasFocus = true
            workspace.open(post, background: NSEvent.modifierFlags.contains(.command))
        } label: {
            TopicListRowLabel(title: post.title, author: post.author, time: post.published?.formatted(.relative(presentation: .named)),
                              category: post.category, avatarURL: post.avatarURL, titleSize: listTextSize, palette: palette, selected: selected,
                              readingRank: post.readingRank, featured: post.featured == true, blocked: blocked)
            .background(selected ? palette.selection : .clear, in: RoundedRectangle(cornerRadius: 7))
            .overlay(alignment: .leading) {
                Capsule().fill(palette.accent).frame(width: 2).padding(.vertical, 10)
                    .opacity(selected ? 1 : 0).allowsHitTesting(false)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 7).strokeBorder(palette.accent.opacity(focused ? 0.75 : 0))
                    .allowsHitTesting(false)
            }
            .animation(motion, value: selected)
            .animation(reduceMotion ? nil : DeskMotion.feedback, value: focused)
        }
        .buttonStyle(DeskButtonStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityValue(focused ? "键盘选中" : "")
        .contextMenu {
            Button("在后台打开") { workspace.open(post, background: true) }
            Link("在 NodeSeek 打开", destination: post.url)
            if !post.author.isEmpty {
                if extensions.active(.rulings) {
                    Button("管理记录查询") { forumSession.presentation = .rulings(post.author) }
                }
                if extensions.active(.block) {
                    if blocked { Button("解除屏蔽") { extensions.unblock(post.authorID, name: post.author) } }
                    else { Button("屏蔽此用户") { extensions.requestBlock(post.authorID, name: post.author) } }
                }
            }
        }
    }

    private func tabBar(canToggleList: Bool) -> some View {
        HStack(spacing: 8) {
            if workspace.showReader {
                Button(action: workspace.showList) {
                    DeskLabel("返回总览", systemImage: "chevron.left")
                        .font(.system(size: 12, weight: .medium))
                        .padding(.horizontal, 8).frame(height: 29)
                }
                .buttonStyle(DeskButtonStyle())
                .help("返回帖子总览 · Esc")
                .padding(.leading, 10)
                .fixedSize()
            }
            if canToggleList {
                Button { hideListWhileReading.toggle() } label: {
                    DeskLabel(hideListWhileReading ? "展开列表" : "收起列表", systemImage: "rectangle.split.2x1")
                        .font(.system(size: 12, weight: .medium))
                        .padding(.horizontal, 8).frame(height: 29)
                }
                .buttonStyle(DeskButtonStyle())
                .foregroundStyle(hideListWhileReading ? palette.accent : Color.secondary)
                .fixedSize()
                .accessibilityLabel(hideListWhileReading ? "展开帖子列表" : "收起帖子列表")
                .help(hideListWhileReading ? "展开帖子列表" : "收起帖子列表，腾出阅读空间")
            }
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 6) {
                        ForEach(workspace.session.topics) { topic in
                            tab(topic).id(topic.id)
                        }
                    }
                    .padding(.leading, 12).padding(.vertical, 8)
                }
                .scrollIndicators(.hidden)
                .onAppear {
                    if let id = workspace.session.selection { proxy.scrollTo(id) }
                }
                .onChange(of: workspace.session.selection) {
                    if let id = workspace.session.selection {
                        withAnimation(reduceMotion ? nil : DeskMotion.pane) { proxy.scrollTo(id) }
                    }
                }
            }
            if extensions.active(.value), workspace.showReader, let topic = workspace.session.selectedTopic {
                RemainingValueButton(palette: palette, topic: topic, topicName: topicTitle(topic))
            }
            toolButton("关闭全部帖子标签", icon: "xmark.rectangle", action: workspace.closeAllTabs)
            Menu {
                ForEach(workspace.session.topics) { topic in Button(topicTitle(topic)) { workspace.select(topic.id) } }
            } label: { DeskIcon("rectangle.on.rectangle", nativeMenu: true).foregroundStyle(.secondary) }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help("已打开的帖子 · ⌃Tab 切换标签").accessibilityLabel("已打开的帖子")
        }
        .padding(.trailing, 12)
        .frame(height: 45)
        .background(palette.chrome, ignoresSafeAreaEdges: [])
        .accessibilityElement(children: .contain)
        .accessibilityLabel("帖子标签")
    }

    private func tab(_ topic: Topic) -> some View {
        let selected = workspace.session.selection == topic.id
        return HStack(spacing: 3) {
            Button { workspace.select(topic.id) } label: {
                DeskLabel(topicTitle(topic), systemImage: "doc.text", size: 13)
                    .lineLimit(1)
                    .frame(maxWidth: 218, alignment: .leading)
                    .padding(.leading, 8).padding(.trailing, 4).frame(height: 29)
            }
            .buttonStyle(DeskButtonStyle())
            .accessibilityAddTraits(selected ? .isSelected : [])
            .help(topicTitle(topic))
            .overlay {
                TopicTabPointer(id: topic.id, title: topicTitle(topic), group: tabPointers,
                                select: { workspace.select(topic.id) }, move: { target in
                    withAnimation(reduceMotion ? nil : DeskMotion.selection) {
                        _ = workspace.moveTab(topic.id, to: target)
                    }
                })
                .accessibilityHidden(true)
            }
            Button { workspace.close(topic.id) } label: {
                DeskIcon("xmark", size: 9).font(.system(size: 9, weight: .semibold)).frame(width: 22, height: 23)
            }
            .buttonStyle(DeskButtonStyle(compresses: true))
            .accessibilityLabel("关闭 \(topicTitle(topic))")
            .padding(.trailing, 3)
        }
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(selected ? palette.accent : .secondary)
        .background(selected ? palette.selection : palette.surface, in: RoundedRectangle(cornerRadius: 6))
        .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(selected ? palette.accent : .clear).allowsHitTesting(false) }
        .animation(motion, value: selected)
        .contextMenu {
            let ids = workspace.session.topics.map(\.id)
            if let index = ids.firstIndex(of: topic.id) {
                if index > 0 {
                    Button("向左移动") { workspace.moveTab(topic.id, to: ids[index - 1]) }
                }
                if index + 1 < ids.count {
                    Button("向右移动") { workspace.moveTab(topic.id, to: ids[index + 1]) }
                }
            }
            Button("关闭全部标签", action: workspace.closeAllTabs)
        }
    }

    private func topicTitle(_ topic: Topic) -> String { forumSession.titles[topic.id] ?? topic.label }

    private func readerPane(topic: Topic) -> some View {
        TopicReader(topic: topic, palette: palette, session: forumSession,
            restoreReadingPosition: workspace.readingReturnURL == topic.url,
            openTopic: workspace.openTopicLink,
            isCurrent: { workspace.session.selectedTopic?.url == topic.url && workspace.showReader && inForum })
            .id("\(Forum.pageURL(topic.url))|\(forumSession.accessRevision)")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
    }

    private var searchOverlay: some View {
        GeometryReader { geometry in
            let origin = searchAnchors.buttonFrame ??
                CGRect(x: geometry.size.width - 250, y: -30, width: 180, height: 30)
            let center = CGPoint(x: geometry.size.width / 2, y: geometry.size.height / 2)
            ZStack {
                if workspace.showingSearch {
                    Rectangle().fill(.black.opacity(palette.dark ? 0.34 : 0.16))
                        .ignoresSafeArea()
                        .onTapGesture(perform: dismissSearch)
                        .accessibilityHidden(true)
                        .transition(.opacity)
                    searchPanel(availableHeight: geometry.size.height)
                        .transition(reduceMotion ? .opacity : AnyTransition(WorkspaceSearchExpansion(source: origin, center: center)))
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background { WorkspaceSearchAnchor { searchAnchors.viewport = $0 } }
        .allowsHitTesting(workspace.showingSearch)
        .accessibilityHidden(!workspace.showingSearch)
        .animation(reduceMotion ? .easeOut(duration: 0.12) : .smooth(duration: 0.34, extraBounce: 0.03),
                   value: workspace.showingSearch)
    }

    private func searchPanel(availableHeight: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: 20)
        let history = workspace.searchHistory.prefix(5)
        return VStack(alignment: .leading, spacing: 10) {
            Text("搜索 NodeSeek").font(.system(size: 17, weight: .semibold))
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
                WorkspaceSearchField(text: $workspace.searchText, onSubmit: workspace.search,
                                     onCancel: dismissSearch, onFocusChange: { searchAnchors.fieldFocused = $0 })
                    .frame(height: 20)
                if !workspace.searchText.isEmpty {
                    Button { workspace.searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                            .frame(width: 24, height: 28).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help("清除搜索文字").accessibilityLabel("清除搜索文字")
                }
            }
            .padding(.horizontal, 10).frame(height: 36)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8).strokeBorder(searchAnchors.fieldFocused ? palette.accent : palette.line)
                    .allowsHitTesting(false)
            }
            Picker("结果类型", selection: $workspace.searchKind) {
                ForEach(Workspace.SearchKind.allCases) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented).labelsHidden()
            if workspace.searchKind != .people { searchScopePicker }
            if !history.isEmpty {
                HStack {
                    Text("最近搜索").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Button { workspace.clearSearchHistory() } label: {
                        Text("清空记录").font(.caption)
                            .padding(.horizontal, 6).frame(height: 26).contentShape(Rectangle())
                    }
                    .buttonStyle(DeskButtonStyle())
                    .help("删除全部最近搜索记录，不影响当前输入")
                    .accessibilityLabel("清空最近搜索记录")
                }
                ScrollView {
                    VStack(spacing: 3) {
                        ForEach(history) { item in
                            Button { workspace.repeatSearch(item) } label: {
                                HStack {
                                    DeskLabel(item.query, systemImage: "clock").lineLimit(1)
                                    Spacer()
                                    Text(item.kind == .people ? item.kind.title : Board.searchScopeTitle(item.scope))
                                        .foregroundStyle(.secondary).lineLimit(1)
                                        .frame(maxWidth: 230, alignment: .trailing)
                                }
                                .font(.callout).padding(.horizontal, 6).frame(height: 23).contentShape(Rectangle())
                            }
                            .buttonStyle(DeskButtonStyle())
                        }
                    }
                }
                .frame(height: min(CGFloat(history.count * 26 - 3),
                                   max(24, availableHeight - (workspace.searchKind == .people ? 220 : 340))))
            }
            HStack {
                Text(workspace.searchKind == .people ? "按用户名查找论坛成员。" : "版块筛选只作用于帖子。")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                Button("取消", action: dismissSearch).keyboardShortcut(.cancelAction)
                Button("搜索", action: workspace.search).keyboardShortcut(.defaultAction)
                    .disabled(workspace.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(20).frame(width: 560)
        .background(palette.chrome.opacity(0.48), in: shape)
        .deskGlass(in: shape, solid: palette.chrome)
        .shadow(color: .black.opacity(palette.dark ? 0.35 : 0.18), radius: 20, y: 10)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("搜索或打开帖子")
        .onExitCommand(perform: dismissSearch)
    }

    private var searchScopePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("搜索版块").font(.subheadline.weight(.semibold))
                Spacer()
                Text(workspace.searchScope.isEmpty ? "搜索所有版块" : "已选 \(workspace.searchScope.count) 个版块")
                    .font(.caption).foregroundStyle(.secondary)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 7), count: 5), spacing: 6) {
                searchScopeChip("全部版块", selected: workspace.searchScope.isEmpty) {
                    workspace.searchScope = []
                }
                ForEach(Board.sections) { board in
                    let selected = workspace.searchScope.contains(board.id)
                    searchScopeChip(board.title, selected: selected) {
                        if selected { workspace.searchScope.remove(board.id) }
                        else { workspace.searchScope.insert(board.id) }
                    }
                }
            }
        }
    }

    private func searchScopeChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle").accessibilityHidden(true)
                Text(title).lineLimit(1)
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(selected ? palette.accent : .secondary)
            .padding(.horizontal, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 26)
            .background(selected ? palette.selection : Color.primary.opacity(0.045), in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(DeskButtonStyle())
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func dismissSearch() {
        workspace.showingSearch = false
    }

    private func showNotifications() {
        workspace.showNotifications()
        Task { await forumSession.refreshUnread() }
    }

    private var unreadBadge: some View {
        let count = forumSession.unread.total
        return ZStack {
            if count > 0 {
                Text(count > 99 ? "99+" : String(count))
                    .font(.system(size: 9, weight: .bold)).monospacedDigit()
                    .foregroundStyle(.white)
                    .padding(.horizontal, 4).frame(minWidth: 15, minHeight: 15)
                    .background(palette.unread, in: Capsule())
                    .contentTransition(reduceMotion ? .identity : .numericText(value: Double(count)))
                    .transition(reduceMotion ? .identity : .scale(scale: 0.7).combined(with: .opacity))
            }
        }
        .offset(x: 5, y: -3).allowsHitTesting(false).accessibilityHidden(true)
        .animation(reduceMotion ? nil : DeskMotion.selection, value: count)
    }

    private func toolButton(_ title: String, icon: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label {
                Text(title)
            } icon: {
                DeskIcon(icon, size: 14).font(.system(size: 14, weight: .medium)).frame(width: 27, height: 27)
            }
            .labelStyle(.iconOnly)
        }
            .buttonStyle(DeskButtonStyle(compresses: true))
            .foregroundStyle(.secondary)
            .help(title).accessibilityLabel(title)
    }

}

@MainActor
private final class WorkspaceSearchAnchors: ObservableObject {
    @Published var hovering = false
    @Published var fieldFocused = false
    weak var button: NSView?
    weak var viewport: NSView?

    var buttonFrame: CGRect? {
        guard let button, let viewport, let window = button.window, window === viewport.window,
              !button.bounds.isEmpty else { return nil }
        // Native toolbar items are hosted separately from the SwiftUI window content.
        return viewport.convert(button.convert(button.bounds, to: nil), from: nil)
    }
}

private struct WorkspaceSearchAnchor: NSViewRepresentable {
    let register: (NSView) -> Void

    func makeNSView(context: Context) -> NSView {
        let view = AnchorView()
        register(view)
        return view
    }

    func updateNSView(_ view: NSView, context: Context) {
        register(view)
    }

    private final class AnchorView: NSView {
        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }
}

private struct WorkspaceSearchExpansion: Transition {
    let source: CGRect
    let center: CGPoint

    func body(content: Content, phase: TransitionPhase) -> some View {
        content.visualEffect { effect, geometry in
            effect
                .scaleEffect(x: phase.isIdentity ? 1 : source.width / max(1, geometry.size.width),
                             y: phase.isIdentity ? 1 : source.height / max(1, geometry.size.height))
                .offset(x: phase.isIdentity ? 0 : source.midX - center.x,
                        y: phase.isIdentity ? 0 : source.midY - center.y)
                .opacity(phase.isIdentity ? 1 : 0.25)
        }
    }
}

@MainActor
private final class PaneDragState: ObservableObject {
    @Published var sidebar: CGFloat = 0
    @Published var list: CGFloat = 0
}



@MainActor
private final class SidebarNavigationState: ObservableObject {
    enum Section { case boards, shortcuts, ranking }
    @Published var section: Section? = .ranking
    @Published var compactOpen = false
    let ranking = RankingState()
}

private struct FeedFilter: Hashable {
    let board: Board
    let query: String
    let scope: Set<String>
    let kind: Workspace.SearchKind
}


private struct FeedTaskKey: Hashable {
    let board: Board
    let order: ForumFeedOrder
    let refresh: Int
    let access: Int?
}
