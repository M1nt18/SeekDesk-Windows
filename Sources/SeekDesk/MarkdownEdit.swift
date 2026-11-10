import Foundation

enum ForumFloorDraft {
    static func insertion(for floor: ForumFloor, in page: URL, quoting: Bool, after draft: String) -> String? {
        guard let number = Int(floor.id), number >= 0, Forum.topicID(page) != nil,
              var link = URLComponents(url: page, resolvingAgainstBaseURL: false) else { return nil }
        link.fragment = String(number)
        guard let url = link.url else { return nil }
        let name = floor.author.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces)
        let heading = (name.isEmpty ? "" : "@\(name) ") + "[#\(number)](\(url.absoluteString))"
        let gap = draft.isEmpty || draft.hasSuffix("\n\n") ? "" : draft.hasSuffix("\n") ? "\n" : "\n\n"
        if !quoting { return gap + heading + "\n\n" }
        let original = excerpt(floor.blocks).trimmingCharacters(in: .whitespacesAndNewlines)
        let prefix = "> " + heading
        guard !original.isEmpty else { return gap + prefix + "\n\n" }
        let limited = String(original.prefix(1600))
        let lines = limited.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline)
            .map { "> " + $0 }
        return gap + prefix + "\n>\n" + lines.joined(separator: "\n") + (original.count > 1600 ? "…" : "") + "\n\n"
    }

    private static func excerpt(_ blocks: [ForumBlock]) -> String {
        blocks.prefix(20).compactMap { block -> String? in
            switch block.kind {
            case "text", "heading", "quote", "code": block.text
            case "image": "[图片]"
            case "terminal", "terminalUnavailable": "[测评终端]"
            case "tabs": block.tabs?.first.map { excerpt($0.blocks) }
            default: nil
            }
        }.joined(separator: "\n")
    }
}

enum MarkdownCommand: String, CaseIterable {
    case bold, italic, strike, heading, quote, bullets, numbers, code, link, image, codeBlock, table, divider

    struct Edit {
        let replaced: NSRange
        let text: String
        let selected: NSRange
    }

    func edit(source: String, selection: NSRange) -> Edit? {
        let source = source as NSString
        guard selection.location != NSNotFound, selection.location >= 0, selection.length >= 0,
              selection.location <= source.length, selection.length <= source.length - selection.location else { return nil }
        let selected = source.substring(with: selection)
        func wrap(_ start: String, _ end: String, placeholder: String) -> Edit {
            let contents = selected.isEmpty ? placeholder : selected
            return Edit(replaced: selection, text: start + contents + end,
                selected: NSRange(location: selection.location + start.utf16.count, length: contents.utf16.count))
        }
        switch self {
        case .bold: return wrap("**", "**", placeholder: "加粗文字")
        case .italic: return wrap("*", "*", placeholder: "斜体文字")
        case .strike: return wrap("~~", "~~", placeholder: "划线文字")
        case .link, .image:
            let label = (selected.isEmpty ? (self == .link ? "链接文字" : "图片说明") : selected)
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "[", with: "\\[")
                .replacingOccurrences(of: "]", with: "\\]")
                .replacingOccurrences(of: "\n", with: " ")
            let start = "\(self == .image ? "!" : "")[\(label)]("
            let placeholder = "https://"
            return Edit(replaced: selection, text: start + placeholder + ")",
                selected: NSRange(location: selection.location + start.utf16.count, length: placeholder.utf16.count))
        case .divider:
            return wrap("", "\n\n---\n\n", placeholder: "")
        case .table:
            return wrap("\n\n| ", " | 标题 2 |\n| --- | --- |\n| 内容 1 | 内容 2 |\n\n", placeholder: "标题 1")
        case .code, .codeBlock:
            let longest = selected.split(whereSeparator: { $0 != "`" }).map(\.count).max() ?? 0
            if self == .codeBlock || selected.contains(where: \.isNewline) {
                let fence = String(repeating: "`", count: max(3, longest + 1))
                let hasStart = selection.location == 0 || source.substring(with: NSRange(location: selection.location - 1, length: 1)) == "\n"
                let hasEnd = NSMaxRange(selection) == source.length || source.substring(with: NSRange(location: NSMaxRange(selection), length: 1)) == "\n"
                return wrap((hasStart ? "" : "\n") + fence + "\n", "\n" + fence + (hasEnd ? "" : "\n"), placeholder: "代码")
            }
            let fence = String(repeating: "`", count: longest + 1)
            return selected.first == "`" || selected.last == "`"
                ? wrap(fence + " ", " " + fence, placeholder: "代码")
                : wrap(fence, fence, placeholder: "代码")
        case .heading, .quote, .bullets, .numbers:
            let lines = source.lineRange(for: selection)
            let lineText = source.substring(with: lines)
            var components = lineText.components(separatedBy: "\n")
            let finalNewline = components.count > 1 && components.last == ""
            if finalNewline { components.removeLast() }
            if components == [""] {
                let placeholder = self == .quote ? "引用文字" : self == .heading ? "标题" : "列表项"
                return wrap(prefix(0), "", placeholder: placeholder)
            }
            let replacement = components.enumerated().map { prefix($0.offset) + $0.element }.joined(separator: "\n")
            return Edit(replaced: lines, text: replacement + (finalNewline ? "\n" : ""),
                selected: NSRange(location: lines.location, length: replacement.utf16.count))
        }
    }

    private func prefix(_ index: Int) -> String {
        switch self {
        case .heading: "## "
        case .quote: "> "
        case .numbers: "\(index + 1). "
        default: "- "
        }
    }
}
