import AppKit
import SwiftUI

struct ForumBlocksView: View, Equatable {
    let blocks: [ForumBlock]
    let palette: DeskPalette
    var reportKind: ForumReportKind? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach(blocks.indices, id: \.self) { index in
                block(blocks[index])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder private func block(_ block: ForumBlock) -> some View {
        switch block.kind {
        case "image", "sticker":
            if let url = block.url {
                ForumImageView(url: url, label: block.text, sticker: block.kind == "sticker",
                               report: reportKind != nil, reportKind: reportKind ?? .tq)
            }
        case "tabs":
            if let tabs = block.tabs {
                let kind = reportKind ?? ForumReportKind.classify(labels: tabs.map(\.label), hasTerminal: tabs.contains { item in
                    item.blocks.contains { $0.kind == "terminal" || $0.kind == "terminalUnavailable" }
                })
                ForumTabPanel(labels: tabs.map(\.label), palette: palette, fitsReport: kind != nil) { index in
                    ForumBlocksView(blocks: tabs[index].blocks, palette: palette, reportKind: kind).equatable()
                }
            }
        case "disclosure":
            if let item = block.tabs?.first {
                DisclosureGroup(block.text) {
                    ForumBlocksView(blocks: item.blocks, palette: palette, reportKind: reportKind).padding(.top, 8)
                }
            }
        case "table":
            if let rows = block.rows { table(rows) }
        case "terminal":
            ForumTerminalView(lines: block.terminal ?? ForumTerminalANSI.lines(block.text), palette: palette)
        case "terminalUnavailable":
            DeskLabel("测评终端暂未加载。可刷新帖子，或打开下方的报告链接。", systemImage: "terminal")
                .font(.callout).foregroundStyle(.secondary)
                .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                .background(palette.surface, in: RoundedRectangle(cornerRadius: 6))
        case "code":
            ScrollView(.horizontal) {
                Text(block.text).font(.system(size: 12, design: .monospaced))
                    .fixedSize(horizontal: true, vertical: false).padding(10)
            }
            .background(palette.surface, in: RoundedRectangle(cornerRadius: 6))
        case "rule": Rectangle().fill(palette.line).frame(height: 1)
        case "quote":
            richText(block.text).foregroundStyle(.secondary).padding(.leading, 10)
                .overlay(alignment: .leading) { Rectangle().fill(palette.accent.opacity(0.45)).frame(width: 2) }
        case "notice": Text(block.text).font(.callout).foregroundStyle(.secondary)
        case "heading":
            richText(block.text, heading: true).accessibilityAddTraits(.isHeader)
        default: richText(block.text)
        }
    }

    private func table(_ rows: [[String]]) -> some View {
        ScrollView(.horizontal) {
            Grid(alignment: .leading, horizontalSpacing: 1, verticalSpacing: 1) {
                ForEach(rows.indices, id: \.self) { index in
                    GridRow {
                        ForEach(rows[index].indices, id: \.self) { column in
                            Text(rows[index][column])
                                .font(.system(size: 12, weight: index == 0 ? .semibold : .regular))
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(minWidth: 62, maxWidth: 240, alignment: .leading)
                                .padding(8)
                                .background(index == 0 ? palette.surface : palette.list)
                        }
                    }
                }
            }
            .fixedSize(horizontal: true, vertical: false)
            .padding(1).background(palette.line)
        }
        .clipShape(RoundedRectangle(cornerRadius: 5))
    }

    private func richText(_ value: String, heading: Bool = false) -> some View {
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        return Text((try? AttributedString(markdown: value, options: options)) ?? AttributedString(value))
            .font(.system(size: palette.readingSize + (heading ? 3 : 0), weight: heading ? .semibold : .regular))
            .lineSpacing(5).fixedSize(horizontal: false, vertical: true)
    }
}

struct ForumTabPanel<Content: View>: View {
    let labels: [String]
    let palette: DeskPalette
    var fitsReport = false
    @ViewBuilder let content: (Int) -> Content
    @StateObject private var state = Selection()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let selectedIndex = labels.indices.contains(state.index) ? state.index : 0
        Group {
            if fitsReport {
                ReportTabsLayout(headerWidth: headerWidth) {
                    tabHeader(selectedIndex)
                    if !labels.isEmpty {
                        content(selectedIndex).id(selectedIndex).modifier(DeskArrival()).padding(9)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    tabHeader(selectedIndex)
                    if !labels.isEmpty {
                        content(selectedIndex).id(selectedIndex).modifier(DeskArrival()).padding(9)
                    }
                }
            }
        }
        .background(palette.list, in: RoundedRectangle(cornerRadius: 7))
        .clipShape(RoundedRectangle(cornerRadius: 7))
        .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(palette.line).allowsHitTesting(false) }
    }

    private var headerWidth: CGFloat {
        let font = NSFont.systemFont(ofSize: NSFont.smallSystemFontSize, weight: .medium)
        return labels.reduce(CGFloat(12 + max(0, labels.count - 1) * 4)) { width, label in
            width + (label as NSString).size(withAttributes: [.font: font]).width + 18
        }
    }

    private func tabHeader(_ selectedIndex: Int) -> some View {
        VStack(spacing: 0) {
            ScrollView(.horizontal) {
                HStack(spacing: 4) {
                    ForEach(labels.indices, id: \.self) { index in
                        let selected = selectedIndex == index
                        Button {
                            state.index = index
                        } label: {
                            Text(labels[index]).font(.caption.weight(selected ? .semibold : .medium))
                                .foregroundStyle(selected ? palette.accent : Color.secondary)
                                .padding(.horizontal, 9).frame(height: 27)
                                .background(selected ? palette.selection : .clear, in: RoundedRectangle(cornerRadius: 5))
                                .animation(reduceMotion ? nil : DeskMotion.selection, value: selected)
                        }
                        .buttonStyle(DeskButtonStyle())
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }.padding(6)
            }
            .background(palette.chrome)
            Rectangle().fill(palette.line).frame(height: 1)
        }
    }

    @MainActor private final class Selection: ObservableObject { @Published var index = 0 }
}

private struct ReportTabsLayout: Layout {
    let headerWidth: CGFloat

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        guard subviews.count == 2 else { return CGSize(width: min(proposal.width ?? headerWidth, headerWidth), height: 40) }
        let ideal = subviews[1].sizeThatFits(.unspecified)
        let width = min(proposal.width ?? 900, max(headerWidth, ideal.width))
        let content = subviews[1].sizeThatFits(ProposedViewSize(width: width, height: nil))
        return CGSize(width: width, height: 40 + content.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard let header = subviews.first else { return }
        header.place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: 40))
        if subviews.count == 2 {
            subviews[1].place(at: CGPoint(x: bounds.minX, y: bounds.minY + 40),
                              proposal: ProposedViewSize(width: bounds.width, height: max(0, bounds.height - 40)))
        }
    }
}
