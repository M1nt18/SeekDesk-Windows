import SwiftUI

struct TopicListRowLabel: View {
    let title: String
    let author: String
    let time: String?
    let category: String
    let avatarURL: URL?
    let titleSize: Double
    let palette: DeskPalette
    var selected = false
    var readingRank: Int? = nil
    var featured = false
    var blocked = false

    var body: some View {
        let size = CGFloat(titleSize)
        let metadataSize = max(11, (size * 0.78).rounded())
        HStack(alignment: .top, spacing: 9) {
            ForumAvatar(url: avatarURL, size: max(29, size + 15), palette: palette).padding(.top, 1)
            VStack(alignment: .leading, spacing: max(5, size * 0.35)) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(title)
                        .font(.system(size: size, weight: .semibold))
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                    if featured || readingRank != nil {
                        TopicTitleBadges(featured: featured, readingRank: readingRank, palette: palette, size: metadataSize)
                    }
                }
                HStack(spacing: 5) {
                    if !author.isEmpty { Text(author).lineLimit(1) }
                    if blocked { Text("已屏蔽").fontWeight(.medium).fixedSize() }
                    if let time {
                        if !author.isEmpty { Text("·") }
                        Text(time).lineLimit(1)
                    }
                    Spacer(minLength: 2)
                    if !category.isEmpty {
                        CategoryBadge(category: category, emphasized: selected, palette: palette,
                                      fontSize: max(10, (size * 0.67).rounded()))
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
                .font(.system(size: metadataSize))
                .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 11)
        .padding(.vertical, max(9, size * 0.55))
        .frame(minHeight: 56)
    }
}


struct TopicTitleBadges: View {
    let featured: Bool
    let readingRank: Int?
    let palette: DeskPalette
    var size: CGFloat = 12

    var body: some View {
        HStack(spacing: 6) {
            if featured {
                FeaturedDiamondIcon(size: size + 3, color: palette.featured)
                    .accessibilityLabel("精品帖").help("NodeSeek 精品帖")
            }
            if let readingRank {
                let description = readingRank == 255 ? "私有帖子" : "阅读需要 Lv\(readingRank)"
                DeskLabel(readingRank == 255 ? "私有" : String(readingRank), systemImage: "lock", size: size)
                    .font(.system(size: size, weight: .semibold)).monospacedDigit()
                    .foregroundStyle(palette.readingRestriction)
                    .padding(.horizontal, 4).padding(.vertical, 1)
                    .background(palette.readingRestriction.opacity(0.12), in: RoundedRectangle(cornerRadius: 4))
                    .accessibilityLabel(description).help(description)
            }
        }
        .fixedSize()
    }
}

struct FeaturedDiamondIcon: View {
    let size: CGFloat
    let color: Color

    var body: some View {
        DeskIcon("diamond", size: size)
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .alignmentGuide(.firstTextBaseline) { $0.height * 0.76 }
    }
}
