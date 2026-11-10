import SwiftUI

struct RulingsView: View {
    let name: String
    @ObservedObject var session: ForumSession
    let palette: DeskPalette
    let openTopic: (URL) -> Bool
    @StateObject private var records = Records()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("管理记录").font(.title3.weight(.semibold))
                    Text(name).font(.callout).foregroundStyle(.secondary)
                }
                Spacer()
                Button("关闭") { session.presentation = nil }.keyboardShortcut(.cancelAction)
            }
            Divider()
            switch records.phase {
            case .loading:
                ProgressView("正在查询…").frame(maxWidth: .infinity, maxHeight: .infinity)
            case .failed(let message):
                ContentUnavailableView {
                    DeskLabel("无法查询管理记录", systemImage: "doc.text.magnifyingglass", size: 32)
                } description: {
                    Text(message)
                } actions: {
                    Button("重试") { records.retry += 1 }
                }
            case .ready(let rows) where rows.isEmpty:
                ContentUnavailableView {
                    DeskLabel("NS Seek 暂无此用户的记录", systemImage: "checkmark.shield", size: 32)
                }
            case .ready(let rows):
                List(rows) { row in record(row) }.listStyle(.plain)
                if rows.count == RulingClient.limit {
                    Text("显示最近 \(RulingClient.limit) 条记录").font(.caption).foregroundStyle(.secondary)
                }
            }
            HStack {
                Text("数据来源")
                Link("NS Seek 社区查询服务", destination: URL(string: "https://github.com/theslugger/ns-seek")!)
                Spacer()
                Text("北京时间")
            }
            .font(.caption).foregroundStyle(.secondary)
        }
        .padding(18).frame(width: 580, height: 440)
        .background(palette.reader)
        .task(id: records.retry) { await records.load(name) }
    }

    private func record(_ row: RulingRecord) -> some View {
        let (title, icon, color): (String, String, Color) = switch row.kind {
        case .punish: ("处罚", "exclamationmark.shield", palette.unread)
        case .reward: ("奖励", "gift.fill", palette.categoryInk("review"))
        case .management: ("管理", "shield.fill", palette.accent)
        }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                DeskLabel(title, systemImage: icon).font(.callout.weight(.semibold)).foregroundStyle(color)
                Text("#\(row.id.formatted(.number.grouping(.never)))").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                Spacer()
                if let url = row.postURL {
                    Button { if openTopic(url) { session.presentation = nil } } label: {
                        DeskLabel("打开原帖", systemImage: "arrow.up.right")
                    }
                    .buttonStyle(.borderless)
                }
            }
            if let reason = row.reason, !reason.isEmpty {
                Text(reason).font(.callout).textSelection(.enabled)
            }
            if let actions = row.beijingActions, !actions.isEmpty {
                Text(actions).font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            }
        }
        .padding(.vertical, 6)
    }

    @MainActor private final class Records: ObservableObject {
        enum Phase { case loading, ready([RulingRecord]), failed(String) }
        @Published var phase: Phase = .loading
        @Published var retry = 0

        func load(_ name: String) async {
            phase = .loading
            do {
                let rows = try await RulingClient.shared.lookup(name)
                if !Task.isCancelled { phase = .ready(rows) }
            } catch {
                guard !Task.isCancelled else { return }
                let message = (error as? RulingClient.LookupError)?.errorDescription
                phase = .failed(message ?? "NS Seek 查询服务暂时无法连接。")
            }
        }
    }
}
