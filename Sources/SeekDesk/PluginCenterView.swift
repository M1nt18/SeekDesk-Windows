import SwiftUI
import UserNotifications

struct PluginCenterView: View {
    let palette: DeskPalette
    let returnTitle: String
    let returnToForum: () -> Void
    let showHot: () -> Void
    let openTopic: (URL) -> Bool
    @ObservedObject var session: ForumSession
    @ObservedObject var attendance: AttendanceState
    @EnvironmentObject private var extensions: DeskExtensions
    @StateObject private var selection = Selection()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 13) {
                if selection.item != nil {
                    Button { selection.item = nil } label: {
                        DeskLabel("返回扩展中心", systemImage: "chevron.left")
                    }.buttonStyle(.bordered)
                }
                Text(selection.item?.title ?? "扩展中心")
                    .font(.system(size: 23, weight: .bold)).accessibilityAddTraits(.isHeader)
                Spacer()
                Button(action: returnToForum) { DeskLabel(returnTitle, systemImage: "chevron.left") }
                    .buttonStyle(.bordered)
            }
            .padding(.horizontal, 20).padding(.vertical, 13).background(palette.chrome)
            Rectangle().fill(palette.line).frame(height: 1)
            if let item = selection.item {
                detail(item)
            } else {
                catalog
            }
        }
        .background(palette.reader)
    }

    private var catalog: some View {
        let installed = DeskExtension.allCases.filter { extensions.installed.contains($0) }
        let available = DeskExtension.allCases.filter { !extensions.installed.contains($0) }
        return VStack(spacing: 0) {
            HStack {
                Picker("扩展分类", selection: $selection.catalog) {
                    Text("已安装 \(installed.count)").tag(Catalog.installed)
                    Text("全部扩展 \(DeskExtension.allCases.count)").tag(Catalog.all)
                }
                .pickerStyle(.segmented).labelsHidden().frame(width: 235)
                Spacer()
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            if selection.catalog == .installed && installed.isEmpty {
                ContentUnavailableView {
                    DeskLabel("还没有已安装的扩展", systemImage: "puzzlepiece.extension", size: 32)
                } actions: {
                    Button("浏览全部扩展") { selection.catalog = .all }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 19) {
                        if selection.catalog == .all && !available.isEmpty {
                            catalogSection("未安装", items: available)
                        }
                        if !installed.isEmpty {
                            catalogSection("已安装", items: installed)
                        }
                    }
                    .frame(maxWidth: 1000, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 20).padding(.top, 3).padding(.bottom, 22)
                }
            }
        }
    }

    private func catalogSection(_ title: String, items: [DeskExtension]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 208, maximum: 258), spacing: 12)], spacing: 12) {
                ForEach(items) { item in card(item) }
            }
        }
    }

    private func card(_ item: DeskExtension) -> some View {
        let installed = extensions.installed.contains(item)
        let active = extensions.active(item)
        let status = installed ? (active ? "已启用" : "已停用") : "未安装"
        let ink = active ? palette.categoryInk("review") : Color.secondary
        return Button { selection.item = item } label: {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    icon(item)
                    Spacer()
                    DeskLabel(status, systemImage: active ? "checkmark.circle.fill" : installed ? "pause.circle" : "arrow.down.circle")
                        .font(.caption2.weight(.semibold)).foregroundStyle(ink)
                        .padding(.horizontal, 6).padding(.vertical, 3)
                        .background(active ? ink.opacity(0.12) : palette.surface, in: Capsule())
                }
                Text(item.title).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                Text(cardSubtitle(item))
                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading).frame(height: 126)
            .background(installed ? palette.list : palette.reader, in: RoundedRectangle(cornerRadius: 9))
            .overlay {
                RoundedRectangle(cornerRadius: 9)
                    .strokeBorder(installed ? palette.line : palette.line.opacity(0.85),
                                  style: StrokeStyle(lineWidth: 1, dash: installed ? [] : [4, 3]))
                    .allowsHitTesting(false)
            }
        }
        .buttonStyle(DeskButtonStyle())
        .accessibilityLabel(item.title)
        .accessibilityValue(installed ? "已安装，\(status)" : status)
    }

    private func cardSubtitle(_ item: DeskExtension) -> String {
        switch item {
        case .hot: "原作者 · @小号"
        case .rulings: "原项目 @slugger · 时区修正 @sss1231"
        default: item.description
        }
    }

    private func detail(_ item: DeskExtension) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    icon(item)
                    VStack(alignment: .leading, spacing: 5) {
                        Text(item.title).font(.title2.weight(.semibold))
                        Text(item.description).font(.callout).foregroundStyle(.secondary)
                    }
                    Spacer()
                    if extensions.installed.contains(item) {
                        Toggle("启用", isOn: Binding(get: { extensions.active(item) }, set: { extensions.setEnabled(item, $0) }))
                            .toggleStyle(.switch)
                    } else {
                        Button("安装扩展") { extensions.install(item) }.buttonStyle(.borderedProminent)
                    }
                }
                if item == .hot {
                    Link("原作者 @小号", destination: URL(string: "https://www.nodeseek.com/space/10539")!)
                        .font(.callout)
                }
                if item == .rulings {
                    VStack(alignment: .leading, spacing: 7) {
                        Link("原脚本 · @slugger（sluggerbox）", destination: URL(string: "https://greasyfork.org/scripts/567915")!)
                        Link("NS Seek 后端 · @slugger", destination: URL(string: "https://github.com/theslugger/ns-seek")!)
                        Link("北京时间修正 · @sss1231", destination: URL(string: "https://www.nodeseek.com/post-870735-1")!)
                    }
                    .font(.callout)
                }
                if extensions.installed.contains(item) {
                    Divider()
                    controls(item)
                    if item == .hot && extensions.active(item) {
                        Button("打开热榜", action: showHot).buttonStyle(.borderedProminent)
                    }
                    Divider()
                    Button("移除扩展", role: .destructive) { extensions.remove(item) }
                }
            }
            .padding(18).frame(maxWidth: 700, alignment: .leading)
            .background(palette.list, in: RoundedRectangle(cornerRadius: 9))
            .padding(20).frame(maxWidth: .infinity)
        }
        .onAppear {
            if item == .keywords { extensions.acknowledgeHits() }
        }
    }

    private func icon(_ item: DeskExtension) -> some View {
        DeskIcon(item.icon, size: 17).font(.system(size: 17, weight: .medium)).foregroundStyle(palette.accent)
            .frame(width: 36, height: 36).background(palette.selection, in: RoundedRectangle(cornerRadius: 8))
    }

    @ViewBuilder private func controls(_ item: DeskExtension) -> some View {
        switch item {
        case .attendance:
            VStack(alignment: .leading, spacing: 12) {
                Picker("签到方式", selection: $extensions.attendanceMode) {
                    ForEach(ForumAttendanceMode.allCases) { mode in Text(mode.title).tag(mode) }
                }
                .pickerStyle(.segmented)
                Toggle("每天 00:00 自动签到", isOn: $extensions.autoAttendance).toggleStyle(.switch)
                    .disabled(!extensions.active(.attendance))
                Text("按北京时间签到。电脑休眠或应用退出时，恢复运行后会补签当天。")
                    .font(.caption).foregroundStyle(.secondary)
                if extensions.active(.attendance) && extensions.autoAttendance {
                    if let profile = session.ownProfile {
                        DeskLabel(attendance.status(for: profile.id), systemImage: "calendar")
                            .font(.callout).foregroundStyle(palette.accent)
                        if attendance.needsVerification(for: profile.id) {
                            Button("打开 NodeSeek 验证") { session.verify(Forum.home) }
                        }
                    } else if session.account == .signedOut {
                        Button("登录 NodeSeek", action: session.signIn)
                    } else {
                        Text("正在确认 NodeSeek 登录状态…").font(.callout).foregroundStyle(.secondary)
                    }
                }
            }
        case .hot:
            Link("原热榜项目", destination: URL(string: "https://greasyfork.org/scripts/560065")!).font(.caption)
        case .office:
            HStack {
                TextField("工作表标题", text: $extensions.officeTitle).textFieldStyle(.roundedBorder)
                TextField("按钮名称", text: $extensions.officeButton).textFieldStyle(.roundedBorder)
                Picker("⌘⇧ 快捷键", selection: $extensions.officeKey) {
                    ForEach(["7", "8", "9", "0"], id: \.self) { Text($0).tag($0) }
                }
                Button("切换办公视图") { extensions.officePresented = true }.disabled(!extensions.active(.office))
            }
        case .value:
            VStack(alignment: .leading, spacing: 9) {
                Text("启用后，打开任意帖子即可在顶部点「估价」。")
                    .font(.callout).foregroundStyle(.secondary)
                RemainingValueButton(palette: palette, title: "试算")
                    .disabled(!extensions.active(.value))
            }
        case .block:
            if extensions.blocked.isEmpty {
                Text("在帖主或楼层作者旁打开菜单，即可屏蔽。已屏蔽的楼层可以临时展开或解除屏蔽。")
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                ForEach(extensions.blocked) { entry in
                    HStack {
                        Text(entry.name).lineLimit(1)
                        Spacer()
                        Button("解除屏蔽") { extensions.unblock(entry) }
                    }
                }
            }
        case .authorOnly:
            Text("启用后，帖子楼层标题旁会出现「只看楼主」开关。").font(.callout).foregroundStyle(.secondary)
        case .rulings:
            Text("在帖子作者旁点「管理记录查询」。NS Seek 社区服务仅接收被查询的公开用户名，结果中的时间按北京时间显示。")
                .font(.callout).foregroundStyle(.secondary)
        case .keywords:
            VStack(alignment: .leading, spacing: 9) {
                TextField("关键词规则，例如 日本+VPS，测评", text: $selection.watchInput).textFieldStyle(.roundedBorder)
                    .accessibilityLabel("关键词规则")
                    .onSubmit(saveWatchSettings)
                Text("逗号分隔的规则满足任意一组即可。用 + 连接的词必须出现在同一篇帖子的标题或 RSS 摘要里，顺序不限。")
                    .font(.caption).foregroundStyle(.secondary)
                Text("例如「日本+VPS，测评」会提醒同时含有「日本」和「VPS」的帖子，也会提醒含有「测评」的帖子。最多 25 组。")
                    .font(.caption).foregroundStyle(.secondary)
                TextField("备注（可选）", text: $selection.watchNoteInput).textFieldStyle(.roundedBorder)
                    .onSubmit(saveWatchSettings)
                HStack {
                    Text(watchStatus).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button("保存监控设置", action: saveWatchSettings)
                }
                Toggle("发送 macOS 通知", isOn: Binding(get: { extensions.watchSystemNotifications },
                                                        set: extensions.setWatchSystemNotifications))
                    .toggleStyle(.switch)
                    .disabled(!extensions.active(.keywords))
                if extensions.watchSystemNotifications && extensions.watchNotificationAccess == .denied {
                    Text("请在系统设置的「通知」中允许 SeekDesk 发送通知。")
                        .font(.caption).foregroundStyle(.secondary)
                } else {
                    Text("SeekDesk 运行时每 10 秒在后台检查 RSS，命中会显示应用内提示。开启此选项后，也会发送 macOS 通知。")
                        .font(.caption).foregroundStyle(.secondary)
                }
                ForEach(extensions.hits) { hit in
                    Button { _ = openTopic(hit.post.url) } label: {
                        DeskLabel(hit.post.title, systemImage: "arrow.up.right").lineLimit(2)
                    }.buttonStyle(.plain)
                }
            }
            .onAppear {
                selection.watchInput = extensions.watchWords
                selection.watchNoteInput = extensions.watchNote
            }
            .task { await extensions.refreshWatchNotificationAccess() }
            .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                Task { await extensions.refreshWatchNotificationAccess() }
            }
        }
    }

    private func saveWatchSettings() {
        extensions.watchNote = selection.watchNoteInput
        extensions.watchWords = selection.watchInput
    }

    private var watchStatus: String {
        if !extensions.active(.keywords) { return "监控已关闭" }
        if extensions.watchFailed { return "RSS 暂时无法连接，稍后自动重试" }
        if extensions.watchTerms.isEmpty { return "添加关键词后开始监控" }
        if let time = extensions.lastCheck { return "最近检查 \(time.formatted(date: .omitted, time: .standard))" }
        return "正在检查新帖…"
    }

    private enum Catalog { case installed, all }

    @MainActor private final class Selection: ObservableObject {
        @Published var item: DeskExtension?
        @Published var catalog = Catalog.installed
        @Published var watchInput = ""
        @Published var watchNoteInput = ""
    }
}
