import AppKit
import SwiftUI

struct PreferencesPane: View {
    enum Category: String, CaseIterable, Identifiable {
        case general, reading, appearance, about
        var id: String { rawValue }
        var title: String {
            switch self { case .general: "通用"; case .reading: "阅读"; case .appearance: "外观"; case .about: "关于" }
        }
        var icon: String {
            switch self { case .general: "gearshape"; case .reading: "text.book.closed"; case .appearance: "paintbrush"; case .about: "info.circle" }
        }
    }

    @ObservedObject var updates: Updates
    let palette: DeskPalette
    let returnTitle: String
    let returnToForum: () -> Void
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage(DeskLogo.preference) private var selectedLogo = DeskLogo.cobalt
    @AppStorage("workspace.mistBackdrop") private var readerGradient = true
    @AppStorage("workspace.autoLoadOlder") private var autoLoad = false
    @AppStorage("workspace.autoRefresh") private var autoRefresh = true
    @AppStorage(ReplySendKey.preference) private var replySendKey = ReplySendKey.commandReturn
    @AppStorage(DeskTextSize.bodyKey) private var bodyTextSize = DeskTextSize.bodyDefault
    @AppStorage(DeskTextSize.authorScaleKey) private var authorScale = DeskTextSize.authorScaleDefault
    @AppStorage(DeskTextSize.listKey) private var listTextSize = DeskTextSize.listDefault
    @AppStorage(DeskTextSize.boardKey) private var boardTextSize = DeskTextSize.boardDefault
    @AppStorage(DeskTextSize.rankingKey) private var rankingTextSize = DeskTextSize.rankingDefault
    @AppStorage(ForumReportKind.nq.preference) private var nqReportScale = ForumReportKind.nq.standard
    @AppStorage(ForumReportKind.tq.preference) private var tqReportScale = ForumReportKind.tq.standard
    @AppStorage("workspace.topicColumnWidth") private var listWidth = 340.0
    @AppStorage("workspace.sidebarWidth") private var sidebarWidth = DeskSidebarSizing.standard
    @StateObject private var selection = Selection()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 7) {
                Button(action: returnToForum) { DeskLabel(returnTitle, systemImage: "chevron.left") }
                    .buttonStyle(.bordered).padding(.bottom, 6)
                Text("设置").font(.system(size: 22, weight: .bold)).padding(.bottom, 10)
                ForEach(Category.allCases) { category in
                    Button { selection.category = category } label: {
                        DeskLabel(category.title, systemImage: category.icon)
                            .font(.system(size: 13, weight: selection.category == category ? .semibold : .medium))
                            .padding(.horizontal, 9).frame(maxWidth: .infinity, alignment: .leading).frame(height: 32)
                            .background(selection.category == category ? palette.selection : .clear, in: RoundedRectangle(cornerRadius: 7))
                            .animation(reduceMotion ? nil : DeskMotion.selection, value: selection.category == category)
                    }
                    .buttonStyle(DeskButtonStyle())
                    .accessibilityAddTraits(selection.category == category ? .isSelected : [])
                }
                Spacer()
            }
            .padding(15).frame(width: 155).background(palette.list)
            Rectangle().fill(palette.line).frame(width: 1)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(selection.category.title).font(.system(size: 24, weight: .semibold)).accessibilityAddTraits(.isHeader)
                    panel
                }
                .id(selection.category)
                .modifier(DeskArrival())
                .frame(maxWidth: 690, alignment: .leading).padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .background(palette.reader)
    }

    @ViewBuilder private var panel: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch selection.category {
            case .general:
                Picker("发送帖子回复", selection: $replySendKey) {
                    ForEach(ReplySendKey.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                Text(replySendKey == .returnKey ? "按 Shift + Return 换行。" : "按 Return 换行。")
                    .font(.caption).foregroundStyle(.secondary)
                Toggle("自动刷新首页", isOn: $autoRefresh)
                    .help("浏览首页时每分钟检查一次。")
                if let updater = updates.controller?.updater {
                    Toggle("自动检查应用更新", isOn: Binding(
                        get: { updater.automaticallyChecksForUpdates },
                        set: { updater.automaticallyChecksForUpdates = $0 }))
                    Button("检查更新…", action: updates.check).disabled(!updates.canCheck)
                } else {
                    LabeledContent("应用更新") {
                        Link("前往 GitHub 检查更新", destination: AppInformation.releases)
                    }
                }
            case .reading:
                textSizeControl("帖子列表字号", size: $listTextSize, range: DeskTextSize.listRange,
                                standard: DeskTextSize.listDefault) {
                    TopicListRowLabel(title: "分享一次晚高峰的三网线路实测", author: "示例用户", time: "刚刚",
                                      category: "review", avatarURL: nil, titleSize: listTextSize, palette: palette)
                }
                Divider()
                readerSizeControls
                Divider()
                sizeSlider("NQ 报告宽度", size: $nqReportScale, range: ForumReportKind.nq.range,
                           standard: ForumReportKind.nq.standard, step: 5, unit: "%")
                Text("默认 100%，保持阅读宽度，长报告按原比例向下展开。")
                    .font(.caption).foregroundStyle(.secondary)
                sizeSlider("TQ 报告缩放", size: $tqReportScale, range: ForumReportKind.tq.range,
                           standard: ForumReportKind.tq.standard, step: 5, unit: "%")
                Text("默认 100%。NQ 和 TQ 的缩放分别记忆，也可直接使用报告上方的按钮调整。")
                    .font(.caption).foregroundStyle(.secondary)
                Divider()
                textSizeControl("侧栏热榜字号", size: $rankingTextSize, range: DeskTextSize.sidebarRange,
                                standard: DeskTextSize.rankingDefault) {
                    SidebarRankLabel(position: 1, title: "分享一次晚高峰的三网线路实测", size: rankingTextSize, palette: palette)
                }
                Divider()
                textSizeControl("论坛版块字号", size: $boardTextSize, range: DeskTextSize.sidebarRange,
                                standard: DeskTextSize.boardDefault) {
                    DeskLabel("技术交流", systemImage: "chevron.left.forwardslash.chevron.right")
                        .font(.system(size: boardTextSize, weight: .medium))
                        .padding(.horizontal, 11)
                        .frame(maxWidth: .infinity, minHeight: max(34, boardTextSize + 17), alignment: .leading)
                }
                Divider()
                Toggle("滚动到底部时自动加载更早的帖子", isOn: $autoLoad)
                Text("关闭时，可以用列表底部的按钮手动加载。")
                    .font(.caption).foregroundStyle(.secondary)
                Button("恢复默认帖子栏宽度") { listWidth = 340 }
            case .appearance:
                Picker("外观模式", selection: $appearance) {
                    Text("跟随系统").tag("system")
                    Text("白天").tag("light")
                    Text("黑夜").tag("dark")
                }
                .pickerStyle(.segmented)
                Divider()
                logoPicker
                Divider()
                Toggle("阅读区顶部渐变", isOn: $readerGradient)
                    .help("帖子顶部使用与外观模式相配的淡渐变。")
                HStack(spacing: 10) {
                    Text("侧栏宽度")
                    Slider(value: $sidebarWidth, in: Double(DeskSidebarSizing.range.lowerBound)...Double(DeskSidebarSizing.range.upperBound), step: 4)
                        .accessibilityLabel("侧栏宽度")
                    Text("\(Int(sidebarWidth)) 点").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                    Button("恢复默认") { sidebarWidth = DeskSidebarSizing.standard }
                }
            case .about:
                about
            }
        }
        .toggleStyle(.switch)
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.list, in: RoundedRectangle(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).strokeBorder(palette.line).allowsHitTesting(false) }
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 18) {
                if let icon = selectedLogo.dockImage ?? NSImage(named: NSImage.applicationIconName) {
                    Image(nsImage: icon).resizable().scaledToFit()
                        .frame(width: 76, height: 76).accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text("SeekDesk").font(.system(size: 26, weight: .bold))
                    Text(AppInformation.versionDescription).font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                    Text("在 Mac 上，舒服地逛 NodeSeek。").font(.callout).foregroundStyle(.secondary)
                }
            }
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                LabeledContent("开发者", value: "@cshaizhihao")
                LabeledContent("开源许可") {
                    Link("GNU GPL v3.0", destination: AppInformation.license)
                }
                LabeledContent("支持平台", value: "macOS 14 及以上 · Apple Silicon")
            }
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { projectLinks }
                VStack(alignment: .leading, spacing: 10) { projectLinks }
            }
            .buttonStyle(.bordered)
            Divider()
            VStack(alignment: .leading, spacing: 9) {
                Text("第三方客户端声明").font(.headline).accessibilityAddTraits(.isHeader)
                Text(.init(AppInformation.disclaimer))
                    .font(.callout).lineSpacing(5).fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Text("致谢").font(.headline).accessibilityAddTraits(.isHeader)
                Text("感谢 NodeSeek 社区、Sparkle、NodeImage，以及热榜和 NS Seek 等社区项目。友情链接可从主侧栏查看。")
                    .font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                Link("第三方许可与项目致谢", destination: AppInformation.acknowledgements).font(.callout)
            }
        }
        .tint(palette.accent)
    }

    @ViewBuilder private var projectLinks: some View {
        Link(destination: AppInformation.website) { DeskLabel("官方网站", systemImage: "globe") }
        Link(destination: AppInformation.repository) { DeskLabel("GitHub", systemImage: "chevron.left.forwardslash.chevron.right") }
        Link(destination: AppInformation.issues) { DeskLabel("问题反馈", systemImage: "bubble.left") }
    }

    private var logoPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("顶栏 Logo 与 Dock 图标").font(.headline).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                ForEach(DeskLogo.allCases, id: \.self) { logo in
                    let selected = logo == selectedLogo
                    let shape = RoundedRectangle(cornerRadius: 9)
                    Button {
                        selectedLogo = logo
                    } label: {
                        VStack(spacing: 3) {
                            DeskWordmark(logo: logo, dark: palette.dark, height: 34)
                                .accessibilityHidden(true)
                            HStack(spacing: 5) {
                                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(selected ? palette.accent : Color.secondary)
                                Text(logo.title)
                            }
                            .font(.callout.weight(.medium))
                        }
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity)
                        .background(selected ? palette.selection : palette.reader, in: shape)
                        .overlay { shape.strokeBorder(selected ? palette.accent : palette.line).allowsHitTesting(false) }
                        .contentShape(shape)
                    }
                    .buttonStyle(DeskButtonStyle())
                    .accessibilityLabel(logo.title)
                    .accessibilityAddTraits(selected ? .isSelected : [])
                }
            }
            .frame(maxWidth: 550)
        }
    }

    private var readerSizeControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            sizeSlider("帖子正文字号", size: $bodyTextSize, range: DeskTextSize.bodyRange, standard: DeskTextSize.bodyDefault)
            sizeSlider("帖子作者栏缩放", size: $authorScale, range: DeskTextSize.authorScaleRange,
                       standard: DeskTextSize.authorScaleDefault, step: 5, unit: "%")
            sizePreview {
                VStack(alignment: .leading, spacing: 12) {
                    FloorAuthorHeader(author: "示例用户", avatarURL: nil, rank: 6, tags: ["楼主", "管理"],
                                      date: "2026-07-21 21:03:36", number: "0", isRoot: true,
                                      scale: CGFloat(authorScale / 100), palette: palette, openProfile: nil) {
                        EmptyView()
                    }
                    ForumBlocksView(blocks: [
                        ForumBlock(kind: "text", text: "这是晚高峰的实测记录。电信和联通的延迟比较稳定，移动偶尔出现波动。", url: nil, tabs: nil, rows: nil, terminal: nil)
                    ], palette: DeskPalette(dark: palette.dark, readingSize: bodyTextSize))
                }
                .padding(.horizontal, 11).padding(.vertical, 10)
            }
        }
    }

    private func textSizeControl<Preview: View>(_ title: String, size: Binding<Double>, range: ClosedRange<Double>,
                                               standard: Double, @ViewBuilder preview: () -> Preview) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sizeSlider(title, size: size, range: range, standard: standard)
            sizePreview(preview)
        }
    }

    private func sizeSlider(_ title: String, size: Binding<Double>, range: ClosedRange<Double>,
                            standard: Double, step: Double = 1, unit: String = " 点") -> some View {
        let value = "\(Int(size.wrappedValue))\(unit)"
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Text(title).font(.system(size: 13, weight: .semibold))
                Spacer()
                Text(value).font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                Button("恢复默认") { size.wrappedValue = standard }
                    .buttonStyle(.borderless)
                    .foregroundStyle(palette.accent)
                    .accessibilityLabel("恢复默认\(title)")
            }
            Slider(value: size, in: range, step: step)
                .accessibilityLabel(title)
                .accessibilityValue(value)
        }
    }

    private func sizePreview<Preview: View>(@ViewBuilder _ preview: () -> Preview) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("预览").font(.caption).foregroundStyle(.secondary)
            preview()
                .background(palette.reader, in: RoundedRectangle(cornerRadius: 7))
                .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(palette.line).allowsHitTesting(false) }
        }
    }

    @MainActor private final class Selection: ObservableObject { @Published var category = Category.general }
}

