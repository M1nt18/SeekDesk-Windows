import AppKit
import SwiftUI

struct FriendLinksPane: View {
    let palette: DeskPalette
    let returnTitle: String
    let returnToForum: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Button(action: returnToForum) { DeskLabel(returnTitle, systemImage: "chevron.left") }
                    .buttonStyle(.bordered)
                Text("友情链接").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer()
            }
            .padding(.horizontal, 20).padding(.vertical, 13)
            .background(palette.chrome)
            Rectangle().fill(palette.line).frame(height: 1)

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("感谢以下伙伴对本项目的支持，排名不分先后。")
                        .font(.title3.weight(.medium))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 242), spacing: 16)], spacing: 16) {
                        ForEach(Self.partners) { partner in card(partner) }
                    }
                }
                .frame(maxWidth: 990, alignment: .leading)
                .padding(24)
                .frame(maxWidth: .infinity)
            }
        }
        .background(palette.reader)
    }

    private func card(_ partner: Partner) -> some View {
        let shape = RoundedRectangle(cornerRadius: 14)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 13) {
                Group {
                    if let image = partner.image {
                        Image(nsImage: image).resizable().scaledToFit()
                    } else {
                        DeskIcon("link", size: 20).foregroundStyle(palette.accent)
                    }
                }
                .frame(width: 56, height: 56)
                .background(palette.selection, in: RoundedRectangle(cornerRadius: 10))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .accessibilityHidden(true)

                Text(partner.name)
                    .font(.title3.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
            }
            Text(partner.description)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2, reservesSpace: true)

            HStack(spacing: 7) {
                if let website = partner.website {
                    Link(destination: website) { DeskLabel("官网", systemImage: "arrow.up.right") }
                        .accessibilityLabel("\(partner.name) 官网")
                        .help(website.absoluteString)
                }
                Link(destination: partner.telegram) {
                    DeskLabel("Telegram 群组", systemImage: "paperplane")
                }
                .accessibilityLabel("\(partner.name) Telegram 群组")
                .help(partner.telegram.absoluteString)
            }
            .buttonStyle(.bordered)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.list, in: shape)
        .overlay { shape.strokeBorder(palette.line).allowsHitTesting(false) }
        .accessibilityElement(children: .contain)
    }

    private struct Partner: Identifiable {
        let name: String
        let description: String
        let website: URL?
        let telegram: URL
        var id: String { name }

        var image: NSImage? {
            Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Partners")
                .flatMap { NSImage(contentsOf: $0) }
        }
    }

    private static let partners = [
        Partner(name: "Impart", description: "全球自建家宽测速，VPS与IDC、银行卡、电话卡交流与优惠。",
                website: nil, telegram: URL(string: "https://t.me/Impart_Cloud")!),
        Partner(name: "Shlii", description: "高性价比的 VPS、NAT 平台",
                website: URL(string: "https://shlii.io/")!,
                telegram: URL(string: "https://t.me/IncuShliidlb")!),
        Partner(name: "PickMyVPS", description: "自购 400+ 台热门线路 / 落地机探针站",
                website: URL(string: "https://www.pickmyvps.com/")!,
                telegram: URL(string: "https://t.me/PickMyVPS_Group")!),
    ]
}
