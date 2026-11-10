import SwiftUI

struct FloorAuthorHeader<Actions: View>: View {
    let author: String
    let avatarURL: URL?
    let rank: Int?
    let tags: [String]
    let date: String
    let number: String
    let isRoot: Bool
    let scale: CGFloat
    let palette: DeskPalette
    let openProfile: (() -> Void)?
    var compact = false
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        HStack(spacing: 9 * scale) {
            if let openProfile {
                Button(action: openProfile) { avatar }
                    .buttonStyle(DeskButtonStyle(compresses: true))
                    .accessibilityLabel("查看 \(author) 的个人资料")
                    .help("查看个人资料")
            } else { avatar }
            VStack(alignment: .leading, spacing: 2 * scale) {
                if compact {
                    name
                    if rank != nil || !tags.isEmpty { badges }
                } else {
                    HStack(spacing: 6 * scale) {
                        name
                        badges
                        actions()
                    }
                }
                if !date.isEmpty { Text(date).font(.system(size: 11 * scale)).foregroundStyle(.secondary) }
                if compact { HStack(spacing: 6 * scale) { actions() } }
            }
            Spacer(minLength: 6)
            Text("#\(number)").font(.system(size: 11 * scale).monospacedDigit()).foregroundStyle(.secondary).fixedSize()
        }
    }

    private var avatar: some View { ForumAvatar(url: avatarURL, size: (isRoot ? 35 : 28) * scale, palette: palette) }
    private var badges: some View { UserBadges(rank: rank, tags: tags, palette: palette, scale: scale) }
    private var name: some View {
        Text(author.isEmpty ? "NodeSeek 用户" : author).font(.system(size: 13 * scale, weight: .semibold)).lineLimit(1)
    }
}
