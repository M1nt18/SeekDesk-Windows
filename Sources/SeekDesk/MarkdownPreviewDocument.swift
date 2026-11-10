import Foundation

enum MarkdownPreviewDocument {
    enum LineKind: Equatable { case body, heading(Int), quote }
    enum Block: Equatable {
        case line(String, LineKind), code(String), table([String], [[String]]), divider
        case terminal([[ForumTerminalSpan]]), tabs([Tab])
    }
    struct Tab: Equatable {
        let label: String
        let blocks: [Block]
    }
    enum Inline: Equatable { case text(String), image(URL, label: String, sticker: Bool) }
    struct ImageReference {
        let url: URL
        let destination: NSRange
    }

    private static let fence = try! NSRegularExpression(pattern: #"^[ \t]{0,3}(\x60{3,}|~{3,})"#)
    private static let heading = try! NSRegularExpression(pattern: #"^(#{1,6})[ \t]+"#)
    private static let tableSeparator = try! NSRegularExpression(pattern: #"^:?-{3,}:?$"#)
    private static let divider = try! NSRegularExpression(pattern: #"^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$"#)
    private static let stickerCode = try! NSRegularExpression(pattern: #":((?:ac|yct|xhj|emoji)[0-9]+):"#)

    static func blocks(_ markdown: String) -> [Block] {
        guard !markdown.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return [] }
        let lines = markdown
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n").components(separatedBy: "\n")
        var index = 0
        return blocks(lines, at: &index, depth: 0, until: { _ in false })
    }

    private static func blocks(_ lines: [String], at index: inout Int, depth: Int, until stop: (String) -> Bool) -> [Block] {
        var result: [Block] = []
        while index < lines.count, !stop(lines[index]) {
            let line = lines[index]
            let source = line as NSString
            let whole = NSRange(location: 0, length: source.length)
            if let marker = fence.firstMatch(in: line, range: whole) {
                let opening = source.substring(with: marker.range(at: 1))
                let language = source.substring(from: NSMaxRange(marker.range))
                    .split(whereSeparator: \.isWhitespace).first?.lowercased()
                var body: [String] = []
                index += 1
                while index < lines.count {
                    let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                    if candidate.count >= opening.count && candidate.allSatisfy({ $0 == opening.first }) {
                        index += 1; break
                    }
                    body.append(lines[index]); index += 1
                }
                let code = body.joined(separator: "\n")
                result.append(language == "ansi" ? .terminal(ForumTerminalANSI.lines(code)) : .code(code))
                continue
            }
            if depth < 8, let group = container(line), group.directive == "tabs", group.label.isEmpty,
               let items = tabs(lines, at: &index, width: group.width, depth: depth, until: stop) {
                result.append(.tabs(items)); continue
            }
            if let marker = heading.firstMatch(in: line, range: whole) {
                result.append(.line(source.substring(from: NSMaxRange(marker.range)), .heading(marker.range(at: 1).length)))
            } else if divider.firstMatch(in: line, range: whole) != nil {
                result.append(.divider)
            } else if index + 1 < lines.count, line.contains("|"), lines[index + 1].contains("|"), !stop(lines[index + 1]),
                      let header = tableCells(line), let separator = tableCells(lines[index + 1]),
                      header.count == separator.count, separator.allSatisfy({ matches(tableSeparator, $0) }) {
                index += 2
                var rows: [[String]] = []
                while index < lines.count, lines[index].contains("|"), !stop(lines[index]), container(lines[index]) == nil,
                      let row = tableCells(lines[index]) {
                    rows.append((0..<header.count).map { $0 < row.count ? row[$0] : "" })
                    index += 1
                }
                result.append(.table(header, rows)); continue
            } else if line.hasPrefix(">") {
                result.append(.line(String(line.dropFirst()).trimmingCharacters(in: .whitespaces), .quote))
            } else if line.hasPrefix("- [x] ") || line.hasPrefix("- [X] ") {
                result.append(.line("☑ " + line.dropFirst(6), .body))
            } else if line.hasPrefix("- [ ] ") {
                result.append(.line("☐ " + line.dropFirst(6), .body))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("+ ") {
                result.append(.line("• " + line.dropFirst(2), .body))
            } else {
                result.append(.line(line.isEmpty ? " " : line, .body))
            }
            index += 1
        }
        return result
    }

    private struct Container {
        let width: Int
        let directive: String
        let label: String

        func closes(_ count: Int) -> Bool { width == count && directive.isEmpty }
        func isItem(in group: Int) -> Bool { width < group && directive == "tab-item" }
    }

    private static func container(_ line: String) -> Container? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        let width = trimmed.prefix(while: { $0 == ":" }).count
        guard width >= 3 else { return nil }
        let words = trimmed.dropFirst(width).split(maxSplits: 1, whereSeparator: \.isWhitespace)
        return Container(width: width, directive: words.first?.lowercased() ?? "", label: words.count > 1 ? String(words[1]) : "")
    }

    private static func tabs(_ lines: [String], at index: inout Int, width: Int, depth: Int,
                             until stop: (String) -> Bool) -> [Tab]? {
        var cursor = index + 1
        var items: [Tab] = []
        while cursor < lines.count, !stop(lines[cursor]) {
            let line = lines[cursor]
            if line.trimmingCharacters(in: .whitespaces).isEmpty { cursor += 1; continue }
            if container(line)?.closes(width) == true { cursor += 1; break }
            guard let item = container(line), item.isItem(in: width) else { break }
            cursor += 1
            let body = blocks(lines, at: &cursor, depth: depth + 1) { line in
                if stop(line) { return true }
                guard let marker = container(line) else { return false }
                return marker.closes(width) || marker.closes(item.width) || marker.isItem(in: width)
            }
            if cursor < lines.count, !stop(lines[cursor]), container(lines[cursor])?.closes(item.width) == true { cursor += 1 }
            items.append(Tab(label: item.label.isEmpty ? "分页 \(items.count + 1)" : item.label, blocks: body))
        }
        guard !items.isEmpty else { return nil }
        index = cursor
        return items
    }

    private struct Asset {
        let range: NSRange
        let url: URL
        let label: String
        let destination: NSRange?
        let sticker: Bool
    }

    /// Preview and resizing share a scanner with balanced destinations and
    /// escaped labels. Ranges remain UTF-16 so replacement is lossless.
    private static func assets(_ line: String) -> [Asset] {
        let source = line as NSString
        let units = Array(line.utf16)
        let count = units.count
        func escaped(_ offset: Int) -> Bool {
            var i = offset, slashes = 0
            while i > 0, units[i - 1] == 92 { slashes += 1; i -= 1 }
            return slashes % 2 == 1
        }
        func whitespace(_ value: UInt16) -> Bool { value == 32 || value == 9 || value == 10 || value == 13 }
        func unescape(_ value: String) -> String {
            value.replacingOccurrences(of: ##"\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_\x60{|}~])"##,
                                       with: "$1", options: .regularExpression)
        }
        func image(_ start: Int) -> Asset? {
            var i = start + 2, depth = 1
            let labelStart = i
            while i < count {
                if !escaped(i) {
                    if units[i] == 91 { depth += 1 }
                    if units[i] == 93 { depth -= 1; if depth == 0 { break } }
                }
                i += 1
            }
            guard i + 1 < count, units[i + 1] == 40 else { return nil }
            let label = unescape(source.substring(with: NSRange(location: labelStart, length: i - labelStart)))
            i += 2
            while i < count, whitespace(units[i]) { i += 1 }
            guard i < count else { return nil }
            let angle = units[i] == 60
            if angle { i += 1 }
            let destinationStart = i
            var nesting = 0
            while i < count {
                if !escaped(i) {
                    if angle {
                        if units[i] == 62 { break }
                        if units[i] == 60 || units[i] == 10 { return nil }
                    } else {
                        if whitespace(units[i]) { break }
                        if units[i] == 40 { nesting += 1 }
                        if units[i] == 41 { if nesting == 0 { break }; nesting -= 1 }
                    }
                }
                i += 1
            }
            guard i > destinationStart, nesting == 0 else { return nil }
            let destination = NSRange(location: destinationStart, length: i - destinationStart)
            if angle { guard i < count, units[i] == 62 else { return nil }; i += 1 }
            let separator = i
            while i < count, whitespace(units[i]) { i += 1 }
            if i < count, units[i] != 41 {
                guard i > separator, units[i] == 34 || units[i] == 39 || units[i] == 40 else { return nil }
                let close: UInt16 = units[i] == 40 ? 41 : units[i]
                i += 1
                while i < count, units[i] != close || escaped(i) { i += 1 }
                guard i < count else { return nil }
                i += 1
                while i < count, whitespace(units[i]) { i += 1 }
            }
            guard i < count, units[i] == 41,
                  let url = URL(string: unescape(source.substring(with: destination)), relativeTo: Forum.home)?.absoluteURL,
                  url.scheme == "https", url.host?.isEmpty == false, url.user == nil, url.password == nil else { return nil }
            return Asset(range: NSRange(location: start, length: i + 1 - start), url: url, label: label,
                         destination: destination, sticker: label == "表情")
        }
        var result: [Asset] = []
        var i = 0
        while i < count {
            if units[i] == 96, !escaped(i) {
                var end = i
                while end < count, units[end] == 96 { end += 1 }
                let width = end - i
                var cursor = end
                var closing: Int?
                while cursor < count {
                    if units[cursor] == 96 {
                        var run = cursor
                        while run < count, units[run] == 96 { run += 1 }
                        if run - cursor == width { closing = run; break }
                        cursor = run
                    } else { cursor += 1 }
                }
                i = closing ?? end
                continue
            }
            if units[i] == 33, i + 1 < count, units[i + 1] == 91, !escaped(i), let asset = image(i) {
                result.append(asset); i = NSMaxRange(asset.range); continue
            }
            if units[i] == 58, !escaped(i),
               let match = stickerCode.firstMatch(in: line, options: .anchored, range: NSRange(location: i, length: count - i)),
               let sticker = ForumStickers.byCode[source.substring(with: match.range(at: 1))] {
                result.append(Asset(range: match.range, url: sticker.url, label: sticker.label, destination: nil, sticker: true))
                i = NSMaxRange(match.range); continue
            }
            i += 1
        }
        return result
    }

    static func inline(_ line: String) -> [Inline] {
        let source = line as NSString
        var result: [Inline] = []
        var cursor = 0
        for asset in assets(line) {
            if asset.range.location > cursor {
                let part = source.substring(with: NSRange(location: cursor, length: asset.range.location - cursor))
                if !part.trimmingCharacters(in: .whitespaces).isEmpty { result.append(.text(part)) }
            }
            result.append(.image(asset.url, label: asset.label.isEmpty ? "图片" : asset.label, sticker: asset.sticker))
            cursor = NSMaxRange(asset.range)
        }
        if cursor < source.length {
            let tail = source.substring(from: cursor)
            if result.isEmpty || !tail.trimmingCharacters(in: .whitespaces).isEmpty { result.append(.text(tail)) }
        }
        return result
    }

    static func imageReferences(_ markdown: String, selected: Set<URL>) -> [ImageReference] {
        guard !selected.isEmpty else { return [] }
        let source = markdown as NSString
        var result: [ImageReference] = []
        var offset = 0
        var opening: String?
        while offset < source.length {
            var end = offset
            var contentsEnd = offset
            source.getLineStart(nil, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: offset, length: 0))
            let line = source.substring(with: NSRange(location: offset, length: contentsEnd - offset))
            var block = line[...]
            while let marker = block.firstIndex(where: { !$0.isWhitespace }), block[marker] == ">" {
                block = block[block.index(after: marker)...]
                if block.first == " " { block = block.dropFirst() }
            }
            let rawBlock = String(block)
            let blockRange = NSRange(location: 0, length: rawBlock.utf16.count)
            if let open = opening {
                let candidate = block.trimmingCharacters(in: .whitespaces)
                if candidate.count >= open.count, candidate.allSatisfy({ $0 == open.first }) { opening = nil }
            } else if let marker = fence.firstMatch(in: rawBlock, range: blockRange) {
                opening = (rawBlock as NSString).substring(with: marker.range(at: 1))
            } else if !block.hasPrefix("    "), !block.hasPrefix("\t") {
                for asset in assets(line) {
                    guard let span = asset.destination, !asset.sticker, selected.contains(asset.url) else { continue }
                    result.append(ImageReference(url: asset.url,
                        destination: NSRange(location: offset + span.location, length: span.length)))
                }
            }
            offset = end
        }
        return result
    }

    static func replacingImages(_ markdown: String, references: [ImageReference], with links: [URL: URL]) -> String {
        let result = NSMutableString(string: markdown)
        for reference in references.reversed() {
            guard let url = links[reference.url] else { continue }
            let destination = url.absoluteString
                .replacingOccurrences(of: "(", with: "%28").replacingOccurrences(of: ")", with: "%29")
            result.replaceCharacters(in: reference.destination, with: destination)
        }
        return result as String
    }

    static func stickerImages(_ markdown: String) -> [Inline] {
        guard markdown.contains(":") else { return [] }
        return stickerImages(in: blocks(markdown))
    }

    private static func stickerImages(in blocks: [Block]) -> [Inline] {
        blocks.flatMap { block -> [Inline] in
            switch block {
            case .line(let source, _):
                inline(source).filter { item in
                    if case .image(_, _, true) = item { return true }
                    return false
                }
            case .tabs(let tabs):
                tabs.flatMap { stickerImages(in: $0.blocks) }
            default:
                []
            }
        }
    }

    private static func tableCells(_ line: String) -> [String]? {
        var line = line.trimmingCharacters(in: .whitespaces)
        if line.hasPrefix("|") { line.removeFirst() }
        if line.hasSuffix("|"), !line.hasSuffix("\\|") { line.removeLast() }
        let escaped = line.replacingOccurrences(of: "\\|", with: "\u{001F}")
        let cells = escaped.components(separatedBy: "|").map {
            $0.replacingOccurrences(of: "\u{001F}", with: "|").trimmingCharacters(in: .whitespaces)
        }
        return cells.isEmpty || cells.count > 24 ? nil : cells
    }

    private static func matches(_ regex: NSRegularExpression, _ value: String) -> Bool {
        regex.firstMatch(in: value, range: NSRange(location: 0, length: value.utf16.count)) != nil
    }
}
