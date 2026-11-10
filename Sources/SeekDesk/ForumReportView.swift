import SwiftUI

private struct ForumReportViewportKey: EnvironmentKey {
    static let defaultValue = CGSize(width: 900, height: 800)
}

extension EnvironmentValues {
    var forumReportViewport: CGSize {
        get { self[ForumReportViewportKey.self] }
        set { self[ForumReportViewportKey.self] = newValue }
    }
}

/// Computes the report and its frame together, with no nested vertical scrolling.
struct ForumReportPanel<Header: View, Content: View>: View {
    let naturalSize: CGSize
    let minimumWidth: CGFloat
    let kind: ForumReportKind
    @ViewBuilder var header: () -> Header
    @ViewBuilder var content: (CGFloat) -> Content
    @AppStorage private var percentage: Double
    @Environment(\.forumReportViewport) private var viewport

    init(naturalSize: CGSize, minimumWidth: CGFloat, kind: ForumReportKind,
         @ViewBuilder header: @escaping () -> Header, @ViewBuilder content: @escaping (CGFloat) -> Content) {
        self.naturalSize = naturalSize
        self.minimumWidth = minimumWidth
        self.kind = kind
        self.header = header
        self.content = content
        _percentage = AppStorage(wrappedValue: kind.standard, kind.preference)
    }

    var body: some View {
        ReportPanelLayout(naturalSize: naturalSize, maximumHeight: ForumReportSizing.height(in: viewport),
                          minimumWidth: minimumWidth, percentage: percentage, kind: kind) {
            header().frame(height: 35)
            GeometryReader { geometry in
                let factor = geometry.size.height / max(1, naturalSize.height)
                let width = naturalSize.width * factor
                if width > geometry.size.width + 1 {
                    ScrollView(.horizontal) { report(scale: factor, width: width, height: geometry.size.height) }
                } else {
                    report(scale: factor, width: width, height: geometry.size.height)
                }
            }
        }
    }

    private func report(scale: CGFloat, width: CGFloat, height: CGFloat) -> some View {
        content(scale).frame(width: width, height: height, alignment: .topLeading)
    }
}

private struct ReportPanelLayout: Layout {
    let naturalSize: CGSize
    let maximumHeight: CGFloat
    let minimumWidth: CGFloat
    let percentage: Double
    let kind: ForumReportKind

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let available = max(1, proposal.width ?? 900)
        let report = ForumReportSizing.renderedSize(naturalSize, width: available, height: maximumHeight, percentage: percentage, kind: kind)
        return CGSize(width: min(available, max(minimumWidth, report.width)), height: report.height + 35)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        guard subviews.count == 2 else { return }
        subviews[0].place(at: bounds.origin, proposal: ProposedViewSize(width: bounds.width, height: 35))
        subviews[1].place(at: CGPoint(x: bounds.minX, y: bounds.minY + 35),
                          proposal: ProposedViewSize(width: bounds.width, height: max(0, bounds.height - 35)))
    }
}

struct ForumReportScaleControls: View {
    let kind: ForumReportKind
    @AppStorage private var percentage: Double
    private var scale: Double { kind.scale(percentage) }

    init(kind: ForumReportKind) {
        self.kind = kind
        _percentage = AppStorage(wrappedValue: kind.standard, kind.preference)
    }

    var body: some View {
        HStack(spacing: 5) {
            Button { percentage = max(kind.range.lowerBound, scale - 10) } label: {
                DeskIcon("minus.magnifyingglass", size: 12)
            }
            .disabled(scale <= kind.range.lowerBound)
            .help("缩小测评报告").accessibilityLabel("缩小测评报告")
            Menu {
                Button(kind.resetTitle) { percentage = kind.standard }
                Divider()
                ForEach(kind.menuValues, id: \.self) { value in
                    Button("\(value)%") { percentage = Double(value) }
                }
            } label: {
                Text("\(Int(scale))%").font(.caption.monospacedDigit()).frame(width: 35)
            }
            .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
            .help(kind.help)
            .accessibilityLabel("测评报告缩放").accessibilityValue("\(Int(scale))%")
            Button { percentage = min(kind.range.upperBound, scale + 10) } label: {
                DeskIcon("plus.magnifyingglass", size: 12)
            }
            .disabled(scale >= kind.range.upperBound)
            .help("放大测评报告").accessibilityLabel("放大测评报告")
        }
        .buttonStyle(.borderless)
    }
}
