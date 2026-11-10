import SwiftUI

struct ForumSpacePane: View {
    let person: ForumUserReference?
    @ObservedObject var session: ForumSession
    let palette: DeskPalette
    let openTopic: (URL) -> Bool
    let openPerson: (ForumUserReference) -> Void
    let openMessage: (ForumUserReference) -> Void
    let returnTitle: String
    let goBack: () -> Void
    @AppStorage(DeskTextSize.listKey) private var listTextSize = DeskTextSize.listDefault
    @StateObject private var state = SpaceState()

    private var member: ForumUserReference? {
        if let person { return person }
        guard session.account == .signedIn, let own = session.ownProfile else { return nil }
        return ForumUserReference(id: own.id, name: own.name, avatar: Forum.avatar(own.id), tags: [])
    }

    private var profile: ForumUserProfile? { member.flatMap { session.profiles[$0.id] } }
    private var own: ForumProfile? { member?.id == session.ownProfile?.id ? session.ownProfile : nil }
    private var readme: String? { (own != nil ? session.ownIntroduction?.readme : nil) ?? profile?.readme }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Button(action: goBack) { Label(returnTitle, systemImage: "chevron.left") }
                Spacer()
                Text(person == nil ? "我的" : "用户空间").font(.headline)
                Spacer()
                if let member { Link("查看原页", destination: Forum.home.appendingPathComponent("space/\(member.id)")) }
                if let member {
                    Button("刷新资料") { state.profileRetry += 1 }
                        .disabled(session.profileLoading.contains(member.id))
                }
                if own != nil {
                    Button("编辑资料") { state.savedIntroduction = false; state.editingIntroduction = true }
                        .disabled(state.editingIntroduction)
                    Button("账号设置") { session.presentation = .profile }
                }
            }
            .padding(.horizontal, 20).frame(height: 48).background(palette.chrome)
            Divider()
            if let member {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header(member)
                        if state.editingIntroduction, let own {
                            ProfileIntroductionEditor(owner: own.id, session: session, palette: palette,
                                cancel: { state.editingIntroduction = false }, saved: {
                                    state.section = .overview
                                    state.editingIntroduction = false
                                    state.savedIntroduction = true
                                })
                        } else {
                            if state.savedIntroduction {
                                DeskLabel("个人资料已保存", systemImage: "checkmark.circle.fill").font(.callout)
                                    .foregroundStyle(palette.publish)
                            }
                            Picker("个人空间栏目", selection: $state.section) {
                                ForEach(Section.allCases.filter { own != nil || !$0.isPrivate }) { section in
                                    Text(section.title).tag(section)
                                }
                            }
                            .pickerStyle(.segmented).labelsHidden()
                            sectionContent
                        }
                    }
                    .frame(maxWidth: 760, alignment: .leading)
                    .padding(.horizontal, 25).padding(.vertical, 21)
                    .frame(maxWidth: .infinity)
                }
                .task(id: ProfileRequest(member: member.id, retry: state.profileRetry)) {
                    state.profileLoading = true
                    await session.loadProfile(member.id, includeReadme: true, force: state.profileRetry > 0)
                    if !Task.isCancelled { state.profileLoading = false }
                }
                .task(id: Request(member: member.id, section: state.section, page: state.page, revision: state.revision, access: session.accessRevision)) {
                    if state.section.isPrivate && own == nil { state.section = .overview; return }
                    await state.load(member: member.id)
                }
                .onChange(of: state.section) { state.page = 1 }
            } else if session.account == .signedOut {
                ContentUnavailableView {
                    Label("登录后查看我的主页", systemImage: "person.crop.circle")
                } actions: {
                    Button("登录 NodeSeek", action: session.signIn).buttonStyle(.borderedProminent)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 12) {
                    ProgressView("正在读取账号资料…").controlSize(.small)
                    Button("重新读取") { Task { await session.refreshUnread() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .task(id: session.accessRevision) { await session.refreshUnread() }
            }
        }
        .background(palette.reader)
    }

    private func header(_ member: ForumUserReference) -> some View {
        HStack(spacing: 14) {
            ForumAvatar(url: member.avatar ?? Forum.avatar(member.id), size: 62, palette: palette)
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(profile?.member_name ?? member.name).font(.system(size: 24, weight: .bold))
                    UserBadges(rank: own?.rank ?? profile?.rank, tags: member.tags + (profile?.tags ?? []), palette: palette)
                }
                Text("#\(member.id)").font(.system(size: 12).monospacedDigit()).foregroundStyle(.secondary)
                if let bio = own?.bio ?? profile?.bio, !bio.isEmpty {
                    Text(bio).font(.system(size: 13)).lineSpacing(3).foregroundStyle(.secondary).textSelection(.enabled)
                }
            }
            Spacer(minLength: 6)
            if own == nil {
                Button("发私信") { openMessage(member) }.buttonStyle(.bordered)
            }
        }
    }

    @ViewBuilder private var sectionContent: some View {
        if state.section == .overview {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 110), spacing: 8)], spacing: 8) {
                metric("主题帖", own?.topics ?? profile?.nPost, section: .discussions)
                metric("评论", own?.replies ?? profile?.nComment, section: .comments)
                metric("粉丝", own?.followers ?? profile?.fans, section: own == nil ? nil : .fans)
                metric("关注", own?.following ?? profile?.follows, section: own == nil ? nil : .follow)
                if let coin = own?.coin { metric("鸡腿", coin) }
            }
            if let joined = own?.joined ?? profile?.created_at_str, !joined.isEmpty {
                Text("加入于 \(joined)").font(.callout).foregroundStyle(.secondary)
            }
            readmeSection
        } else if state.loading {
            ProgressView("正在读取\(state.section.title)…").controlSize(.small).padding(.vertical, 12)
        } else if let error = state.error {
            VStack(alignment: .leading, spacing: 9) {
                Text(error).foregroundStyle(.secondary)
                Button("重试") { state.revision += 1 }
            }
        } else if state.section.isPrivate {
            VStack(alignment: .leading, spacing: 0) {
                if state.members.isEmpty { Text("暂无\(state.section.title)。").foregroundStyle(.secondary) }
                ForEach(state.members, id: \.id) { member in
                    Button { openPerson(member) } label: {
                        HStack(spacing: 9) {
                            ForumAvatar(url: member.avatar, size: 28, palette: palette)
                            Text(member.name).font(.system(size: 14, weight: .medium))
                            Text("#\(member.id)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 7).contentShape(Rectangle())
                    }
                    .buttonStyle(DeskButtonStyle())
                    if member.id != state.members.last?.id { Divider() }
                }
            }
        } else {
            activityList
        }
    }

    private var readmeSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("README").font(.headline).accessibilityAddTraits(.isHeader)
            if let readme {
                if readme.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("还没有填写 README。").font(.callout).foregroundStyle(.secondary)
                } else {
                    ProfileMarkdown(source: readme, palette: palette)
                }
            } else if state.profileLoading {
                ProgressView("正在读取 README…").controlSize(.small)
            } else {
                HStack(spacing: 8) {
                    Text("暂时无法读取 README。").font(.callout).foregroundStyle(.secondary)
                    Button("重试") { state.profileRetry += 1 }
                }
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 8))
    }

    private var activityList: some View {
        VStack(alignment: .leading, spacing: 12) {
            if state.items.isEmpty { Text("这一页暂无\(state.section.title)。").foregroundStyle(.secondary) }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(state.items) { item in
                    Button { _ = openTopic(item.destination(floorsPerPage: state.floorsPerPage)) } label: {
                        HStack(spacing: 14) {
                            if state.section == .discussions {
                                TopicPublicationDate(date: state.publicationDates[item.post_id], loading: state.loadingDates)
                                    .frame(width: 102, alignment: .leading)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.title ?? "帖子 #\(item.post_id)")
                                    .font(.system(size: listTextSize, weight: .medium)).lineSpacing(3)
                                if let floor = item.floor_id, let text = item.text, !text.isEmpty {
                                    Text("#\(floor)  \(text)").font(.system(size: 13)).lineSpacing(3)
                                        .foregroundStyle(.secondary).lineLimit(3)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, 6).padding(.vertical, 6)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DeskButtonStyle())
                    if item.id != state.items.last?.id { Divider() }
                }
            }
            HStack {
                Button("上一页") { state.page -= 1 }.disabled(state.page <= 1)
                Text("第 \(state.page) 页").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Button("下一页") { state.page += 1 }.disabled(state.items.count < 15)
            }
        }
    }

    private func metric(_ label: String, _ value: Int?, section: Section? = nil) -> some View {
        let card = VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.map { $0.formatted() } ?? "—").font(.system(size: 20, weight: .semibold).monospacedDigit())
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: 8))
        return Group {
            if let section { Button { state.section = section } label: { card }.buttonStyle(DeskButtonStyle()) }
            else { card }
        }
    }

    private enum Section: String, CaseIterable, Identifiable {
        case overview, discussions, comments, fans, follow
        var id: Self { self }
        var isPrivate: Bool { self == .fans || self == .follow }
        var title: String {
            switch self {
            case .overview: "概况"
            case .discussions: "主题帖"
            case .comments: "评论"
            case .fans: "粉丝"
            case .follow: "关注"
            }
        }
    }

    private struct Request: Hashable {
        let member: Int
        let section: Section
        let page: Int
        let revision: Int
        let access: Int
    }

    private struct ProfileRequest: Hashable {
        let member: Int
        let retry: Int
    }

    @MainActor private final class SpaceState: ObservableObject {
        @Published var editingIntroduction = false
        @Published var savedIntroduction = false
        @Published var profileLoading = false
        @Published var profileRetry = 0
        @Published var section = Section.overview
        @Published var page = 1
        @Published var revision = 0
        @Published var loading = false
        @Published var error: String?
        @Published var items: [ForumActivity] = []
        @Published var members: [ForumUserReference] = []
        @Published private(set) var publicationDates: [Int: Date] = [:]
        @Published private(set) var loadingDates = false
        var floorsPerPage = 10

        func load(member: Int) async {
            guard let route = ForumDirectory.Route(rawValue: section.rawValue) else { return }
            loading = true
            loadingDates = false
            error = nil
            do {
                if section.isPrivate {
                    let results = try await ForumDirectory.members(route)
                    try Task.checkCancellation()
                    members = results
                } else {
                    let (results, count, site) = try await ForumDirectory.activity(route, member: member, page: page)
                    try Task.checkCancellation()
                    var seen = Set<String>()
                    items = results.filter { $0.post_id > 0 && seen.insert($0.id).inserted }
                    floorsPerPage = count
                    loading = false
                    if route == .discussions {
                        let missing = items.map(\.post_id).filter { publicationDates[$0] == nil }
                        loadingDates = !missing.isEmpty
                        for offset in stride(from: 0, to: missing.count, by: 4) {
                            let dates = await ForumDirectory.publicationDates(for: Array(missing.dropFirst(offset).prefix(4)), using: site)
                            try Task.checkCancellation()
                            publicationDates.merge(dates) { current, _ in current }
                        }
                        loadingDates = false
                    }
                }
                loading = false
            } catch {
                if !Task.isCancelled {
                    self.error = (error as? ForumPageError) == .signInRequired
                        ? "登录后才能读取这项资料。" : "暂时无法读取这项资料。"
                    loading = false
                }
            }
        }
    }
}

private struct TopicPublicationDate: View {
    let date: Date?
    let loading: Bool

    var body: some View {
        if let date {
            let day = Self.day.string(from: date)
            let time = Self.time.string(from: date)
            VStack(alignment: .leading, spacing: 1) {
                Text(day).font(.system(size: 12, weight: .medium))
                Text(time).font(.system(size: 11)).foregroundStyle(.secondary)
            }
            .monospacedDigit()
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("发帖时间 \(day) \(time)")
            .help("发帖时间 \(day) \(time)（本机时区）")
        } else {
            Text(loading ? "读取时间…" : "时间未知").font(.caption).foregroundStyle(.secondary)
        }
    }

    private static let day = formatter("yyyy-MM-dd")
    private static let time = formatter("HH:mm:ss")

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = format
        return formatter
    }
}
