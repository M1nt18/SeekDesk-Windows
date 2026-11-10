import AppKit
import ImageIO
import SwiftUI
import UniformTypeIdentifiers

@MainActor
final class StickerLibrary: ObservableObject {
    struct Group: Codable, Identifiable {
        let id: UUID
        var name: String
        var images: [String]
    }

    static let shared = StickerLibrary()
    @Published private(set) var groups: [Group] = []
    private let directory = URL.applicationSupportDirectory.appendingPathComponent("SeekDesk/Stickers", isDirectory: true)
    private var index: URL { directory.appendingPathComponent("groups.json") }

    private init() {
        if let data = try? Data(contentsOf: index),
           let stored = try? JSONDecoder().decode([Group].self, from: data) {
            groups = stored
        }
    }

    func create(_ name: String) throws -> UUID {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 40 else { throw LibraryError.name }
        guard !groups.contains(where: { $0.name.caseInsensitiveCompare(name) == .orderedSame }) else { throw LibraryError.duplicate }
        let group = Group(id: UUID(), name: name, images: [])
        try store(groups + [group])
        return group.id
    }

    func items(_ group: Group) -> [ForumSticker] {
        group.images.enumerated().map { index, file in
            ForumSticker(id: file, label: "\(group.name) \(index + 1)", url: directory.appendingPathComponent(file), insertion: nil)
        }
    }

    func add(_ urls: [URL], to group: UUID) throws {
        guard let index = groups.firstIndex(where: { $0.id == group }) else { return }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var added: [URL] = []
        var skipped = 0
        do {
            for url in urls {
                let values = try? url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey, .contentTypeKey])
                guard values?.isRegularFile == true, let size = values?.fileSize, (1...(15 * 1024 * 1024)).contains(size),
                      let type = values?.contentType, type.conforms(to: .image), let ext = type.preferredFilenameExtension,
                      let source = CGImageSourceCreateWithURL(url as CFURL, nil), CGImageSourceGetCount(source) > 0 else {
                    skipped += 1
                    continue
                }
                let target = directory.appendingPathComponent(UUID().uuidString + "." + ext)
                try FileManager.default.copyItem(at: url, to: target)
                added.append(target)
            }
            var next = groups
            next[index].images.append(contentsOf: added.map(\.lastPathComponent))
            try store(next)
        } catch {
            for url in added { try? FileManager.default.removeItem(at: url) }
            throw error
        }
        if skipped > 0 { throw LibraryError.skipped(skipped) }
    }

    func remove(_ sticker: ForumSticker, in group: UUID) throws {
        guard let index = groups.firstIndex(where: { $0.id == group }),
              groups[index].images.contains(sticker.id) else { return }
        var next = groups
        next[index].images.removeAll { $0 == sticker.id }
        try store(next)
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(sticker.id))
    }

    private func store(_ next: [Group]) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(next).write(to: index, options: .atomic)
        groups = next
    }

    enum LibraryError: LocalizedError {
        case name, duplicate, skipped(Int)
        var errorDescription: String? {
            switch self {
            case .name: "分组名需要 1 到 40 个字符。"
            case .duplicate: "已经有同名分组。"
            case .skipped(let count): "已跳过 \(count) 张无法读取或大于 15 MB 的图片。"
            }
        }
    }
}

@MainActor
struct StickerPicker: View {
    let palette: DeskPalette
    let insert: (ForumSticker) -> Void
    @ObservedObject private var library = StickerLibrary.shared
    @StateObject private var state = Selection()

    private final class Selection: ObservableObject {
        @Published var group = "ac"
        @Published var newName = ""
        @Published var naming = false
        @Published var error: String?
    }

    private var custom: StickerLibrary.Group? { library.groups.first { $0.id.uuidString == state.group } }
    private var items: [ForumSticker] {
        if let custom { return library.items(custom) }
        return ForumStickers.officialPacks.first { $0.id == state.group }?.items ?? []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack {
                DeskLabel("表情包", systemImage: "face.smiling").font(.headline)
                Spacer()
                Button {
                    state.naming.toggle()
                    state.error = nil
                } label: {
                    DeskLabel("新建分组", systemImage: "folder.badge.plus")
                }
                .buttonStyle(.borderless)
            }
            ScrollView {
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 6) {
                        ForEach(ForumStickers.officialPacks) { groupButton($0.title, id: $0.id) }
                    }
                    if !library.groups.isEmpty {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 108), spacing: 6)], alignment: .leading, spacing: 6) {
                            ForEach(library.groups) { groupButton($0.name, id: $0.id.uuidString) }
                        }
                    }
                }
                .padding(.trailing, 2)
            }
            .frame(height: 30 + min(3, CGFloat((library.groups.count + 3) / 4)) * 36)
            .accessibilityLabel("表情分组")
            if state.naming {
                HStack {
                    TextField("分组名称", text: $state.newName).onSubmit(create)
                    Button("创建", action: create)
                }
            }
            if let custom {
                HStack {
                    Button("导入图片…") { importImages(into: custom.id) }
                    Spacer()
                    Text("使用自定义表情需配置 NodeImage 密钥").font(.caption).foregroundStyle(.secondary)
                }
            }
            if let error = state.error { Text(error).font(.caption).foregroundStyle(.secondary) }
            if items.isEmpty {
                Text("此分组还没有表情。").foregroundStyle(.secondary).font(.caption)
                    .frame(maxWidth: .infinity, minHeight: 64)
            } else {
                ScrollView {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 5), count: 6), spacing: 5) {
                        ForEach(items) { item in
                            Button { insert(item) } label: {
                                StickerThumbnail(url: item.url)
                                    .frame(width: 68, height: 68).padding(4)
                                    .background(palette.list, in: RoundedRectangle(cornerRadius: 8))
                            }
                            .buttonStyle(DeskButtonStyle(compresses: true)).help(item.label).accessibilityLabel(item.label)
                            .contextMenu {
                                if let custom {
                                    Button("从分组移除", role: .destructive) {
                                        do { try library.remove(item, in: custom.id) }
                                        catch { state.error = error.localizedDescription }
                                    }
                                }
                            }
                        }
                    }
                    .padding(.vertical, 2)
                }
                .id(state.group)
                .frame(height: min(322, CGFloat((items.count + 5) / 6) * 81 + 4))
            }
            if custom == nil {
                Text("NodeSeek 官方表情").font(.caption2).foregroundStyle(.secondary)
            }
        }
        .padding(14).frame(width: 512)
        .onChange(of: state.group) { state.error = nil }
    }

    private func groupButton(_ title: String, id: String) -> some View {
        let selected = state.group == id
        return Button { state.group = id } label: {
            Text(title).font(.system(size: 12, weight: selected ? .semibold : .medium)).lineLimit(1)
                .padding(.horizontal, 10).frame(height: 29)
                .foregroundStyle(selected ? palette.accent : .primary)
                .background(selected ? palette.selection : palette.list, in: RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(DeskButtonStyle())
        .help(title).accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func create() {
        do {
            state.group = try library.create(state.newName).uuidString
            state.newName = ""; state.naming = false; state.error = nil
        } catch { state.error = error.localizedDescription }
    }

    private func importImages(into group: UUID) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = true
        panel.prompt = "导入"
        panel.begin { response in
            guard response == .OK else { return }
            do { try library.add(panel.urls, to: group); state.error = nil }
            catch { state.error = error.localizedDescription }
        }
    }
}

private struct StickerThumbnail: View {
    let url: URL
    @StateObject private var local = LocalImage()
    var body: some View {
        Group {
            if url.isFileURL {
                if let image = local.image { Image(decorative: image, scale: 1).resizable().scaledToFit() }
                else { DeskIcon("photo").foregroundStyle(.secondary) }
            } else {
                ForumImageView(url: url, label: "", sticker: true, thumbnail: true)
            }
        }
        .task(id: url) {
            guard url.isFileURL, let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return }
            local.image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 88
            ] as CFDictionary)
        }
        .accessibilityHidden(true)
    }

    private final class LocalImage: ObservableObject { @Published var image: CGImage? }
}
