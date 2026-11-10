import SwiftUI

struct ForumUserCard: View {
    let person: ForumUserReference
    @ObservedObject var session: ForumSession
    let palette: DeskPalette
    let openSpace: () -> Void
    let openMessage: () -> Void

    @StateObject private var controls = Controls()

    private var profile: ForumUserProfile? { session.profiles[person.id] }

    var body: some View {
        VStack(alignment: .leading, spacing: 17) {
            HStack(spacing: 11) {
                ForumAvatar(url: person.avatar ?? Forum.avatar(person.id), size: 56, palette: palette)
                VStack(alignment: .leading, spacing: 5) {
                    Text(profile?.member_name ?? person.name).font(.system(size: 21, weight: .semibold))
                    Text("#\(person.id)").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    UserBadges(rank: profile?.rank, tags: person.tags + (profile?.tags ?? []), palette: palette)
                }
                Spacer()
                Button("关闭") { session.presentation = nil }.keyboardShortcut(.cancelAction)
            }
            if let profile {
                HStack(spacing: 9) {
                    metric("主题", profile.nPost)
                    metric("回复", profile.nComment)
                    metric("粉丝", profile.fans)
                }
                if let joined = profile.created_at_str, !joined.isEmpty {
                    Text("加入于 \(joined)").font(.callout).foregroundStyle(.secondary)
                }
                if let bio = profile.bio, !bio.isEmpty {
                    Text(bio).font(.callout).textSelection(.enabled).lineLimit(6)
                }
            } else if !session.profileFailures.contains(person.id) {
                Text("正在读取个人资料…").font(.callout).foregroundStyle(.secondary)
            }
            if session.profileFailures.contains(person.id) {
                HStack {
                    Text(profile == nil ? "暂时无法读取个人资料" : "刷新失败，正在显示先前资料")
                        .font(.callout).foregroundStyle(.secondary)
                    Button("重试") { controls.retry += 1 }.buttonStyle(.borderless)
                }
            }
            HStack {
                Button("刷新资料") { controls.retry += 1 }.disabled(session.profileLoading.contains(person.id))
                Spacer()
            }
            HStack {
                Button("查看个人主页", action: openSpace)
                Spacer()
                Button(action: openMessage) { DeskLabel("发私信", systemImage: "bubble.left") }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(20).frame(width: 480).background(palette.reader)
        .task(id: "\(person.id)|\(controls.retry)") { await session.loadProfile(person.id, force: controls.retry > 0) }
    }

    private final class Controls: ObservableObject { @Published var retry = 0 }

    private func metric(_ label: String, _ value: Int?) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.caption).foregroundStyle(.secondary)
            Text(value.map(String.init) ?? "—").font(.system(size: 17, weight: .semibold, design: .monospaced))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(9).background(palette.surface, in: RoundedRectangle(cornerRadius: 6))
    }
}

struct UserBadges: View {
    let rank: Int?
    let tags: [String]
    let palette: DeskPalette
    var scale: CGFloat = 1

    var body: some View {
        HStack(spacing: 4 * scale) {
            if let rank { badge("Lv \(rank)", ink: palette.accent) }
            ForEach(Array(Set(tags)).sorted().prefix(4), id: \.self) { tag in
                badge(tag, ink: palette.categoryInk(tag == "楼主" ? "review" : "trade"))
            }
        }
    }

    private func badge(_ text: String, ink: Color) -> some View {
        Text(text).font(.system(size: 10 * scale, weight: .semibold)).foregroundStyle(ink).lineLimit(1)
            .padding(.horizontal, 6 * scale).padding(.vertical, 2 * scale)
            .background(ink.opacity(0.12), in: Capsule())
    }
}
