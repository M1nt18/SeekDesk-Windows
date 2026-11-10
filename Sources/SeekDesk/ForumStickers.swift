import Foundation

struct ForumSticker: Identifiable, Equatable {
    let id: String
    let label: String
    let url: URL
    let insertion: String?
}

enum ForumStickers {
    struct Pack: Identifiable {
        let id: String
        let title: String
        let items: [ForumSticker]
    }

    private static func official(_ group: String, title: String, files: [String], video: Bool = false) -> Pack {
        Pack(id: group, title: title, items: files.map { file in
            let name = file.split(separator: ".").first.map(String.init) ?? file
            let code = group + name
            let url = Forum.home.appendingPathComponent("static/image/sticker/\(group)/\(video ? file + ".png" : file)")
            return ForumSticker(id: code, label: "\(title) \(name)", url: url, insertion: " :\(code): ")
        })
    }

    static let officialPacks: [Pack] = [
        official("ac", title: "AC 娘", files: (1...54).map { String(format: "%02d.png", $0) }
            + (1001...1040).map { "\($0).png" } + (2001...2055).map { "\($0).png" }),
        official("yct", title: "洋葱头", files: (1...22).map { String(format: "%03d.gif", $0) }),
        official("xhj", title: "小黄鸡", files: (1...32).map { number in
            let png = [1, 2, 3, 5, 6, 7, 11, 22, 24, 25, 31, 32].contains(number)
            return String(format: "%03d", number) + (png ? ".png" : ".gif")
        }),
        official("emoji", title: "Fluent", files: (0...48).map { String(format: "%02d", $0) }, video: true)
    ]

    static let byCode = Dictionary(uniqueKeysWithValues: officialPacks.flatMap(\.items).map { ($0.id, $0) })
}
