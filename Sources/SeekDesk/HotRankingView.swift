import SwiftUI

enum RankingPeriod: String, CaseIterable, Identifiable {
    case realtime = "hot", daily, weekly
    var id: String { rawValue }
    var label: String {
        switch self { case .realtime: "实时"; case .daily: "日榜"; case .weekly: "周榜" }
    }
    var interval: TimeInterval {
        switch self { case .realtime: 60; case .daily: 300; case .weekly: 3600 }
    }
    var cadence: Duration { .seconds(interval) }
    var url: URL { URL(string: "https://api.bimg.eu.org/\(rawValue).json")! }
}

struct RankingSnapshot: Decodable {
    struct Entry: Decodable, Identifiable {
        struct Post: Decodable {
            let id: Int
            let title: String
            let author: String
            let author_id: Int?
            let category: String?
            let views: Int?
            let comments: Int?
        }

        let post: Post
        let score: Double
        var id: Int { post.id }
        var url: URL { Forum.home.appendingPathComponent("post-\(post.id)-1") }
    }

    let updatedAt: Date
    let posts: [Entry]
    private enum CodingKeys: String, CodingKey { case updatedAt = "updated_at", posts }

    static func fetch(_ period: RankingPeriod) async throws -> Self {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieStorage = nil
        config.urlCredentialStorage = nil
        config.timeoutIntervalForResource = 12
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }
        var request = URLRequest(url: period.url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              http.url?.scheme == "https", http.url?.host == period.url.host else { throw URLError(.badServerResponse) }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .secondsSince1970
        return try decoder.decode(Self.self, from: data)
    }
}

@MainActor
final class RankingState: ObservableObject {
    @Published var period: RankingPeriod = .realtime
    @Published private(set) var snapshots: [RankingPeriod: RankingSnapshot] = [:]
    @Published private(set) var failed: Set<RankingPeriod> = []
    @Published private(set) var loading: Set<RankingPeriod> = []
    private var fetchedAt: [RankingPeriod: Date] = [:]
    private var requests: [RankingPeriod: Task<Void, Never>] = [:]

    func refresh(_ period: RankingPeriod, ifDue: Bool = false) async {
        if ifDue, let fetched = fetchedAt[period], Date().timeIntervalSince(fetched) < period.interval { return }
        if let request = requests[period] { await request.value; return }
        guard !Task.isCancelled else { return }
        loading.insert(period)
        let request = Task { [weak self] in
            let result = try? await RankingSnapshot.fetch(period)
            guard let self else { return }
            if let result {
                snapshots[period] = result
                fetchedAt[period] = Date()
                failed.remove(period)
            } else { failed.insert(period) }
            loading.remove(period)
            requests.removeValue(forKey: period)
        }
        requests[period] = request
        await request.value
    }

    func watch(_ period: RankingPeriod) async {
        await refresh(period, ifDue: true)
        while !Task.isCancelled {
            do { try await Task.sleep(for: period.cadence) } catch { return }
            await refresh(period, ifDue: true)
        }
    }

    func rows(through lastPosition: Int? = nil, filter: (RankingSnapshot.Entry) -> Bool) -> [RankingRow] {
        guard let snapshot = snapshots[period] else { return [] }
        var seen = Set<Int>()
        return snapshot.posts.prefix(lastPosition ?? snapshot.posts.count).enumerated().compactMap { rank, item in
            guard seen.insert(item.id).inserted, filter(item) else { return nil }
            return RankingRow(position: rank + 1, item: item)
        }
    }
}

struct RankingRow: Identifiable {
    let position: Int
    let item: RankingSnapshot.Entry
    var id: Int { item.id }
}

struct SidebarHotRanking: View {
    let palette: DeskPalette
    @ObservedObject var state: RankingState
    let availableHeight: CGFloat
    let showAll: () -> Void
    let openTopic: (URL) -> Bool
    @EnvironmentObject private var extensions: DeskExtensions
    @AppStorage(DeskTextSize.rankingKey) private var textSize = DeskTextSize.rankingDefault
    private let limit = 10

    private var rows: [RankingRow] {
        state.rows(through: limit) { !extensions.blocks($0.post.author_id, name: $0.post.author) }
    }

    var body: some View {
        let ranked = rows
        let contentHeight = Double(limit) * (SidebarRankLabel.rowHeight(textSize) + 1) + 72
        VStack(spacing: 0) {
            HStack(spacing: 4) {
                RankingPeriodSelector(period: $state.period, palette: palette, compact: true)
                Button(action: showAll) {
                    DeskIcon("arrow.up.right", size: 10).font(.system(size: 10, weight: .semibold)).frame(width: 23, height: 23)
                }
                .buttonStyle(DeskButtonStyle()).foregroundStyle(palette.accent)
                .accessibilityLabel("在主区打开热榜").help("在主区打开热榜")
            }
            .padding(.horizontal, 7).padding(.vertical, 6)
            if !ranked.isEmpty {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(ranked) { row in
                            Button { _ = openTopic(row.item.url) } label: {
                                SidebarRankLabel(position: row.position, title: row.item.post.title, size: textSize, palette: palette)
                            }
                            .buttonStyle(DeskButtonStyle())
                            .accessibilityLabel("热榜第 \(row.position) 名，\(row.item.post.title)")
                            if row.id != ranked.last?.id {
                                Rectangle().fill(palette.line.opacity(0.7)).frame(height: 1)
                                    .padding(.leading, RankNumber.width(compact: true) + 15)
                            }
                        }
                    }
                    .padding(.horizontal, 4)
                }
                .id(state.period)
                .accessibilityLabel("\(state.period.label)侧栏前 \(ranked.count) 篇")
            } else {
                VStack(spacing: 9) {
                    if state.failed.contains(state.period) {
                        Text("热榜暂不可用").font(.caption).foregroundStyle(.secondary)
                        Button("重试") { Task { await state.refresh(state.period) } }
                            .buttonStyle(.borderless).font(.caption)
                    } else if state.snapshots[state.period] != nil {
                        Text("这一榜暂无可显示帖子").font(.caption).foregroundStyle(.secondary)
                    } else {
                        ProgressView().controlSize(.small)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            HStack {
                if let snapshot = state.snapshots[state.period] {
                    Text(snapshot.updatedAt.formatted(date: .omitted, time: .shortened))
                        .monospacedDigit()
                        .accessibilityLabel("更新时间 \(snapshot.updatedAt.formatted(date: .omitted, time: .shortened))")
                }
                Spacer()
                if state.snapshots[state.period] != nil {
                    Text(ranked.count == limit ? "前 \(limit) 名" : "\(ranked.count) 篇")
                }
            }
            .font(.caption2).foregroundStyle(.secondary)
            .padding(.horizontal, 10).frame(height: 29)
        }
        .frame(height: min(availableHeight, contentHeight))
        .clipped()
        .background(palette.reader.opacity(0.82), in: RoundedRectangle(cornerRadius: 10))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(palette.line).allowsHitTesting(false) }
    }
}

struct SidebarRankLabel: View {
    let position: Int
    let title: String
    let size: Double
    let palette: DeskPalette

    static func rowHeight(_ size: Double) -> Double { max(43, size * 2.6 + 10) }

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            RankNumber(position: position, palette: palette, compact: true)
            Text(title).font(.system(size: size, weight: position == 1 ? .semibold : .medium))
                .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 8).frame(minHeight: Self.rowHeight(size))
        .contentShape(Rectangle())
    }
}

struct RankingPolling: View {
    @ObservedObject var state: RankingState
    let active: Bool

    var body: some View {
        Color.clear.allowsHitTesting(false).accessibilityHidden(true)
            .task(id: PollKey(period: state.period, active: active)) {
                if active { await state.watch(state.period) }
            }
    }

    private struct PollKey: Equatable { let period: RankingPeriod; let active: Bool }
}

struct HotRankingView: View {
    let palette: DeskPalette
    let openTopic: (URL) -> Bool
    @ObservedObject var state: RankingState
    @EnvironmentObject private var extensions: DeskExtensions

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 13) {
                HStack(spacing: 11) {
                    RankingEmblem(palette: palette, size: 38)
                    Text("NodeSeek 热榜").font(.system(size: 22, weight: .bold)).accessibilityAddTraits(.isHeader)
                    Spacer()
                    Button {
                        Task { await state.refresh(state.period) }
                    } label: { DeskRefreshLabel(title: "刷新热榜", loading: state.loading.contains(state.period)) }
                    .buttonStyle(DeskButtonStyle())
                    .disabled(state.loading.contains(state.period))
                }
                HStack(spacing: 6) {
                    RankingPeriodSelector(period: $state.period, palette: palette, compact: false).frame(width: 210)
                    Spacer()
                    if let snapshot = state.snapshots[state.period] {
                        Text("榜单更新于 \(snapshot.updatedAt.formatted(date: .omitted, time: .shortened))")
                            .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(20).background(palette.chrome)
            Rectangle().fill(palette.line).frame(height: 1)
            if state.failed.contains(state.period), state.snapshots[state.period] != nil {
                Text("刷新失败，显示上一次榜单").font(.caption).foregroundStyle(.secondary).padding(8)
            }
            rankings.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(palette.reader)
    }

    @ViewBuilder private var rankings: some View {
        if state.snapshots[state.period] != nil {
            let rows = state.rows { !extensions.blocks($0.post.author_id, name: $0.post.author) }
            if rows.isEmpty {
                ContentUnavailableView {
                    DeskLabel("当前榜单暂无帖子", systemImage: "flame", size: 32)
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(rows) { row in
                            fullRow(row)
                            if row.position != 1 {
                                Rectangle().fill(palette.line).frame(height: 1)
                                    .padding(.leading, RankNumber.width(compact: false) + 21)
                            }
                        }
                    }
                    .frame(maxWidth: 810).padding(.horizontal, 18).padding(.vertical, 12)
                    .frame(maxWidth: .infinity)
                }
            }
        } else if state.failed.contains(state.period) {
            ContentUnavailableView {
                DeskLabel("热榜暂时无法连接", systemImage: "wifi.exclamationmark", size: 32)
            } actions: {
                Button("重试") { Task { await state.refresh(state.period) } }
            }
        } else {
            ProgressView("正在读取热榜…").controlSize(.small)
        }
    }

    private func fullRow(_ row: RankingRow) -> some View {
        let post = row.item.post
        return Button { _ = openTopic(row.item.url) } label: {
            HStack(alignment: .center, spacing: 11) {
                RankNumber(position: row.position, palette: palette, compact: false)
                VStack(alignment: .leading, spacing: 6) {
                    Text(post.title).font(.system(size: row.position == 1 ? 17 : 14, weight: .semibold)).lineLimit(2)
                    HStack(spacing: 9) {
                        if let category = post.category, !category.isEmpty {
                            CategoryBadge(category: category, emphasized: false, palette: palette)
                        }
                        Text(post.author).lineLimit(1)
                        if let views = post.views { DeskLabel("\(views)", systemImage: "eye") }
                        if let comments = post.comments { DeskLabel("\(comments)", systemImage: "bubble") }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 4)
                DeskIcon("chevron.right", size: 12).font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 10).padding(.vertical, row.position == 1 ? 14 : 10)
            .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
            .background(row.position == 1 ? palette.selection.opacity(0.60) : .clear, in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(DeskButtonStyle())
    }
}

private struct RankingPeriodSelector: View {
    @Binding var period: RankingPeriod
    let palette: DeskPalette
    let compact: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let height: CGFloat = compact ? 24 : 27
        let gap: CGFloat = 2
        let periods = RankingPeriod.allCases
        let selectedIndex = periods.firstIndex(of: period) ?? 0
        HStack(spacing: 2) {
            ForEach(periods) { item in
                let selected = item == period
                Button { period = item } label: {
                    Text(item.label).font(.system(size: compact ? 11 : 12, weight: .medium))
                        .foregroundStyle(selected ? palette.accent : .secondary)
                        .frame(maxWidth: .infinity).frame(height: height)
                }
                .buttonStyle(DeskButtonStyle())
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .background {
            GeometryReader { geometry in
                let width = max(0, (geometry.size.width - gap * CGFloat(periods.count - 1)) / CGFloat(periods.count))
                RoundedRectangle(cornerRadius: 5).fill(palette.selection)
                    .frame(width: width, height: height)
                    .offset(x: CGFloat(selectedIndex) * (width + gap))
            }
            .allowsHitTesting(false).accessibilityHidden(true)
        }
        .animation(reduceMotion ? nil : DeskMotion.selection, value: selectedIndex)
        .padding(2).background(palette.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 7))
    }
}

private struct RankingEmblem: View {
    let palette: DeskPalette
    let size: CGFloat
    var body: some View {
        DeskIcon("flame.fill", size: size * 0.47).font(.system(size: size * 0.47, weight: .medium))
            .foregroundStyle(palette.categoryInk("trade")).frame(width: size, height: size)
            .background(palette.categoryInk("trade").opacity(0.14), in: RoundedRectangle(cornerRadius: 7))
            .accessibilityHidden(true)
    }
}

private struct RankNumber: View {
    let position: Int
    let palette: DeskPalette
    let compact: Bool

    static func width(compact: Bool) -> CGFloat { compact ? 40 : 50 }

    var body: some View {
        let highlighted = (1...3).contains(position)
        let ink = palette.rankingInk(position)
        HStack(spacing: compact ? 2 : 3) {
            if highlighted {
                Text("🔥").font(.system(size: compact ? 12 : 16)).accessibilityHidden(true)
            }
            Text(position < 10 ? "0\(position)" : "\(position)")
                .font(.system(size: compact ? 11 : 13, weight: highlighted ? .bold : .semibold, design: .monospaced))
                .foregroundStyle(ink)
        }
        .fixedSize()
        .frame(width: Self.width(compact: compact), height: compact ? 22 : 28)
        .background(highlighted ? ink.opacity(palette.dark ? 0.16 : 0.10) : .clear,
                    in: RoundedRectangle(cornerRadius: 6))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("第 \(position) 名")
    }
}
