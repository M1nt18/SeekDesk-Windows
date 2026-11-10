import AppKit
import SwiftUI

struct TopicReader: View {
    let topic: Topic
    let palette: DeskPalette
    @ObservedObject var session: ForumSession
    let openTopic: (URL) -> Bool
    let isCurrent: () -> Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(ReplySendKey.preference) private var replySendKey = ReplySendKey.commandReturn
    @AppStorage(DeskTextSize.authorScaleKey) private var authorScale = DeskTextSize.authorScaleDefault
    @EnvironmentObject private var extensions: DeskExtensions
    @StateObject private var reader: ForumReaderState
    @StateObject private var controls: ReaderControls
    @StateObject private var copy = CopyFeedback()
    @StateObject private var editor = MarkdownEditorState()
    @StateObject private var editEditor = MarkdownEditorState()
    @StateObject private var inlineEdit: ForumInlineEdit
    @Namespace private var titleFlight

    init(topic: Topic, palette: DeskPalette, session: ForumSession, restoreReadingPosition: Bool,
         openTopic: @escaping (URL) -> Bool, isCurrent: @escaping () -> Bool) {
        self.topic = topic
        self.palette = palette
        self.session = session
        self.openTopic = openTopic
        self.isCurrent = isCurrent
        _reader = StateObject(wrappedValue: ForumReaderState(topic: topic, session: session))
        _controls = StateObject(wrappedValue: ReaderControls(returnAnchor: restoreReadingPosition ? session.anchor(at: topic.url) : nil))
        _inlineEdit = StateObject(wrappedValue: session.pendingEdit(at: topic.url) ?? ForumInlineEdit())
    }

    private var sending: Bool { session.sending.contains(topic.id) }
    private var receipt: ForumSession.Receipt? { session.receipts[topic.id] }
    private var editing: ForumInlineEdit.Target? {
        guard session.account == .signedIn, let target = inlineEdit.target, target.owner == session.ownProfile?.id else { return nil }
        return target
    }
    private var draft: Binding<String> {
        let token = session.authorization
        return Binding(get: { session.authorizes(token) ? session.drafts[topic.id, default: ""] : "" },
                       set: { if session.authorizes(token) { session.edit($0, for: topic.id) } })
    }
    private var rule: some View { Rectangle().fill(palette.line).frame(height: 1) }
    private var motion: Animation? { reduceMotion ? nil : DeskMotion.reader }
    private var waitingForThread: Bool {
        if case .loading = reader.phase { return true }
        return false
    }
    private var openingAnimation: Animation? {
        guard !reduceMotion, case .ready = reader.phase else { return nil }
        return .smooth(duration: 0.32, extraBounce: 0)
    }

    var body: some View {
        GeometryReader { geometry in
            let compactAuthorHeader = geometry.size.width - 52 < 345 * CGFloat(authorScale / 100)
            readerBody(availableHeight: geometry.size.height, compactAuthorHeader: compactAuthorHeader)
        }
    }

    private func readerBody(availableHeight: CGFloat, compactAuthorHeader: Bool) -> some View {
        VStack(spacing: 0) {
            GeometryReader { readingGeometry in
            ZStack {
                if waitingForThread {
                    loadingTitle
                } else {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 19) {
                                header.id("thread-title")
                                threadContent(compactAuthorHeader: compactAuthorHeader)
                            }
                            .scrollTargetLayout()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 26).padding(.top, 22).padding(.bottom, 32)
                            .frame(maxWidth: .infinity)
                        }
                        .scrollPosition(id: Binding(get: { controls.readingAnchor }, set: { anchor in
                            controls.readingAnchor = anchor
                            if let anchor { session.rememberAnchor(anchor, at: topic.url) }
                        }), anchor: .top)
                        .task(id: scrollTarget) {
                            guard let target = scrollTarget else { return }
                            let returnAnchor = controls.returnAnchor
                            let destination = returnAnchor ?? (topic.url.fragment == nil ? session.anchor(at: topic.url) ?? target : target)
                            guard destination != "thread-title" else {
                                controls.returnAnchor = nil
                                return
                            }
                            // A lazy floor may not have a layout yet when the thread first appears.
                            if returnAnchor != nil || topic.url.fragment != nil { try? await Task.sleep(for: .milliseconds(100)) }
                            guard !Task.isCancelled else { return }
                            controls.returnAnchor = nil
                            proxy.scrollTo(destination, anchor: .top)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background { ReaderBackdrop(palette: palette) }
            .animation(openingAnimation, value: waitingForThread)
            .environment(\.forumReportViewport, readingGeometry.size)
            }
            if case .ready(let thread) = reader.phase { compose(thread, availableHeight: availableHeight) }
            else if sending || receipt != nil { replyStatus }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .environment(\.openURL, OpenURLAction { url in
            if openTopic(url) { return .handled }
            guard ["https", "http"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return .discarded }
            return .systemAction
        })
        .task(id: LoadKey(url: Forum.pageURL(topic.url), access: session.accessRevision, refresh: controls.refresh)) {
            await reader.load(topic, session: session)
        }
        .onChange(of: receipt, initial: true) { _, newReceipt in
            guard let newReceipt, newReceipt.accepted, isCurrent(), session.consumeReplyNavigation(topic.id) else { return }
            editor.finish()
            if let destination = newReceipt.destination, destination != topic.url {
                _ = openTopic(destination)
                if Forum.pageURL(destination) != Forum.pageURL(topic.url) { return }
            }
            controls.refresh += 1
        }
        .onChange(of: inlineEdit.target) { previous, current in
            if previous != nil, current == nil, session.cachedThread(at: topic.url) == nil { controls.refresh += 1 }
        }
        .alert(controls.reactionConfirmation?.title ?? "确认互动", isPresented: Binding(
            get: { controls.reactionConfirmation != nil },
            set: { if !$0 { controls.reactionConfirmation = nil } }
        ), presenting: controls.reactionConfirmation) { confirmation in
            Button("取消", role: .cancel) {}.keyboardShortcut(.defaultAction)
            if confirmation.target.kind == .dislike {
                Button("确认点踩", role: .destructive) { confirmReaction(confirmation) }
            } else {
                Button("确认送出") { confirmReaction(confirmation) }
            }
        } message: { confirmation in
            Text(confirmation.message)
        }
    }

    @ViewBuilder private func threadContent(compactAuthorHeader: Bool) -> some View {
        switch reader.phase {
        case .loading: EmptyView()
        case .failed(let issue):
            loadFailure(issue)
        case .ready(let thread):
            if reader.refreshIssue != nil {
                DeskLabel("刷新失败，仍显示当前正文", systemImage: "wifi.exclamationmark")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let root = thread.root { displayedFloor(root, isRoot: true, compact: compactAuthorHeader).id("floor-0") }
            discussionHeader(thread).id("thread-discussion")
            let replies = visibleReplies(thread)
            if replies.isEmpty {
                Text(extensions.active(.authorOnly) && controls.authorOnly ? "这一页没有可显示的楼主回复。" : "这一页没有可显示的回复。")
                    .font(.callout).foregroundStyle(.secondary).padding(.vertical, 8)
            }
            ForEach(replies, id: \.readerID) { item in displayedFloor(item, isRoot: false, compact: compactAuthorHeader) }
            if !thread.pages.isEmpty { pagination(thread) }
        }
    }

    private var loadingTitle: some View {
        VStack(spacing: 17) {
            threadTitle(topic.label, loading: true)
            HStack(spacing: 8) {
                if !reduceMotion { ProgressView().controlSize(.small).tint(palette.accent).accessibilityHidden(true) }
                Text("正在加载正文…").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            }
            .transition(.opacity)
        }
        .frame(maxWidth: 630)
        .padding(.horizontal, 30)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
    }

    private func threadTitle(_ title: String, loading: Bool = false) -> some View {
        Text(title)
            .font(.system(size: 28, weight: .bold)).tracking(-0.35)
            .multilineTextAlignment(loading ? .center : .leading)
            .lineLimit(loading ? 4 : nil)
            .fixedSize(horizontal: false, vertical: true)
            .matchedGeometryEffect(id: "thread-title", in: titleFlight, properties: .position)
            .accessibilityAddTraits(.isHeader)
    }

    private var scrollTarget: String? {
        guard case .ready(let thread) = reader.phase else { return nil }
        if let fragment = topic.url.fragment {
            let number = fragment.hasPrefix("comment-") ? String(fragment.dropFirst(8)) : fragment
            if (number == "0" && thread.root != nil) || thread.replies.contains(where: { $0.id == number }) { return "floor-\(number)" }
        }
        return thread.page == 1 ? "thread-title" : "thread-discussion"
    }

    private var header: some View {
        let thread: ForumThread? = {
            if case .ready(let thread) = reader.phase { return thread }
            return nil
        }()
        let category = thread?.category.isEmpty == false ? thread?.category : topic.preview?.category
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                if let category, !category.isEmpty { CategoryBadge(category: category, emphasized: true, palette: palette) }
                if let post = topic.preview, post.featured == true || post.readingRank != nil {
                    TopicTitleBadges(featured: post.featured == true, readingRank: post.readingRank, palette: palette)
                }
                if let restriction = thread?.replyRestriction {
                    DeskLabel(restriction, systemImage: "lock", size: 12).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button { copy.write(topic.url) } label: {
                    DeskLabel(copy.didCopy ? "已复制" : "复制链接", systemImage: copy.didCopy ? "checkmark" : "link")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(copy.didCopy ? palette.accent : Color.secondary)
                        .contentTransition(.opacity).frame(width: 86, height: 27)
                }
                .buttonStyle(DeskButtonStyle(compresses: true))
                .animation(motion, value: copy.didCopy)
                Button { controls.refresh += 1 } label: {
                    DeskRefreshLabel(title: "刷新帖子", loading: reader.isLoading)
                }
                .buttonStyle(DeskButtonStyle(compresses: true))
                .disabled(reader.isLoading || sending).foregroundStyle(.secondary)
                .help("刷新帖子").accessibilityLabel("刷新帖子")
            }
            threadTitle(thread?.title ?? topic.label).textSelection(.enabled)
        }
    }

    private func loadFailure(_ issue: ForumPageError) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            DeskLabel("暂时无法打开原帖", systemImage: "doc.badge.ellipsis").font(.headline)
            Text(issue.localizedDescription).font(.callout).foregroundStyle(.secondary)
            HStack(spacing: 12) {
                if case .verification = issue { Button("打开验证窗口") { session.verify(topic.url) }.buttonStyle(.borderedProminent) }
                if case .signInRequired = issue { Button("登录 NodeSeek", action: session.signIn).buttonStyle(.borderedProminent) }
                Button("重试") { controls.refresh += 1 }
                Button { NSWorkspace.shared.open(topic.url) } label: {
                    DeskLabel("在浏览器查看原帖", systemImage: "arrow.up.right.square")
                }
            }
            if let summary = topic.preview?.summary, !summary.isEmpty {
                rule.padding(.top, 10)
                Text("RSS 摘要").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(summary).font(.system(size: 14)).lineSpacing(5).textSelection(.enabled)
            }
        }
        .padding(15).frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.list, in: RoundedRectangle(cornerRadius: 9))
    }

    private func visibleReplies(_ thread: ForumThread) -> [ForumFloor] {
        let onlyAuthor = extensions.active(.authorOnly) && controls.authorOnly
        guard onlyAuthor else { return thread.replies }
        return thread.replies.filter { $0.isAuthor || (thread.root != nil && $0.author == thread.root?.author) }
    }

    private func discussionHeader(_ thread: ForumThread) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            rule
            HStack {
                Text("楼层回复").font(.headline).accessibilityAddTraits(.isHeader)
                Spacer()
                if extensions.active(.authorOnly) {
                    Toggle("只看楼主", isOn: $controls.authorOnly).toggleStyle(.switch).controlSize(.small)
                }
                if !thread.pages.isEmpty { Text("第 \(thread.page) 页").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }
            }
            if !thread.pages.isEmpty { pagination(thread) }
        }
        .padding(.top, 5)
    }

    @ViewBuilder private func displayedFloor(_ item: ForumFloor, isRoot: Bool, compact: Bool) -> some View {
        if extensions.blocks(item.authorID, name: item.author) {
            BlockedFloor(author: item.author, number: item.id, isRoot: isRoot, palette: palette, unblock: {
                withAnimation(motion) { extensions.unblock(item.authorID, name: item.author) }
            }) { floor(item, isRoot: isRoot, compact: compact) }
        } else { floor(item, isRoot: isRoot, compact: compact) }
    }

    private func floor(_ item: ForumFloor, isRoot: Bool, compact: Bool) -> some View {
        let profile = item.authorID.flatMap { session.profiles[$0] }
        let ownsFloor = session.account == .signedIn && item.authorID != nil && item.authorID == session.ownProfile?.id
        let tags = (item.tags ?? []) + (profile?.tags ?? []) + (isRoot || item.isAuthor ? ["楼主"] : [])
        let scale = CGFloat(authorScale / 100)
        let openProfile: (() -> Void)? = item.authorID.map { id in
            { session.presentation = .user(ForumUserReference(id: id, name: item.author, avatar: item.avatar, tags: tags)) }
        }
        return VStack(alignment: .leading, spacing: isRoot ? 14 : 10) {
            FloorAuthorHeader(author: item.author, avatarURL: item.avatar, rank: profile?.rank, tags: tags,
                              date: item.date.isEmpty ? item.dateLabel : item.date, number: item.id,
                              isRoot: isRoot, scale: scale, palette: palette, openProfile: openProfile, compact: compact) {
                floorAuthorActions(item, scale: scale)
            }
            if item.blocks.isEmpty {
                Text("原站未显示这层的正文。").font(.callout).foregroundStyle(.secondary)
            }
            VStack(alignment: .leading, spacing: 9) {
                ForumBlocksView(blocks: item.blocks, palette: palette).equatable()
            }
            .textSelection(.enabled)
            let ownSignature = ownsFloor ? session.ownIntroduction?.signature : nil
            if let signature = ownSignature ?? item.signature ?? profile?.signature_markdown ?? profile?.bio, !signature.isEmpty {
                VStack(alignment: .leading, spacing: 5) {
                    Capsule().fill(palette.line.opacity(0.68))
                        .frame(width: 48, height: 1)
                        .accessibilityHidden(true)
                    FloorSignature(signature, tint: palette.accent)
                }
                .padding(.top, 4)
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                floorReactions(item)
                if ownsFloor {
                    Button { startEditing(item) } label: {
                        DeskLabel("编辑", systemImage: "pencil", size: 12).font(.caption.weight(.medium))
                    }
                    .buttonStyle(DeskButtonStyle())
                    .disabled(sending || editing != nil || reader.page == nil)
                    .accessibilityLabel(isRoot ? "编辑主题" : "编辑第 \(item.id) 楼")
                }
                if case .ready(let thread) = reader.phase, thread.replyRestriction == nil {
                    floorAction(item, quote: false)
                    floorAction(item, quote: true)
                }
            }
            if let notice = controls.reactionNotice, notice.target.floor.description == item.id {
                HStack(spacing: 6) {
                    DeskIcon("exclamationmark.circle", size: 12)
                    Text(notice.message).fixedSize(horizontal: false, vertical: true)
                    if notice.verify { Button("打开验证窗口") { session.verify(topic.url) } }
                    Button { controls.reactionNotice = nil } label: { DeskIcon("xmark", size: 11) }
                        .buttonStyle(.borderless).accessibilityLabel("关闭互动提示")
                }
                .font(.caption).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
            }
            if !isRoot { rule.padding(.top, 4) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: item.authorID) {
            if let id = item.authorID, let page = reader.page { await session.loadProfile(id, using: page) }
        }
    }

    @ViewBuilder private func floorAuthorActions(_ item: ForumFloor, scale: CGFloat) -> some View {
        if !item.author.isEmpty {
            if extensions.active(.rulings) {
                Button { session.presentation = .rulings(item.author) } label: {
                    DeskLabel("管理记录查询", systemImage: "doc.text.magnifyingglass", size: 12 * scale)
                        .font(.system(size: 11 * scale, weight: .medium))
                        .padding(.horizontal, 6 * scale).padding(.vertical, 3 * scale)
                        .background(palette.surface, in: RoundedRectangle(cornerRadius: 4 * scale))
                }
                .buttonStyle(DeskButtonStyle()).foregroundStyle(.secondary)
            }
            if extensions.active(.block) && !extensions.blocks(item.authorID, name: item.author) {
                Menu {
                    Button("屏蔽此用户") { extensions.requestBlock(item.authorID, name: item.author) }
                } label: { DeskIcon("ellipsis", size: 10 * scale, nativeMenu: true).font(.system(size: 10 * scale)) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
                .accessibilityLabel("作者操作")
            }
        }
    }

    @ViewBuilder private func floorReactions(_ item: ForumFloor) -> some View {
        if let postID = Int(topic.id), let floor = Int(item.id) {
            ForEach(ForumReactionKind.allCases) { kind in
                let target = ForumReactionTarget(postID: postID, floor: floor, kind: kind)
                let base = item.reaction(kind)
                let mark = session.reactionMarks[target]
                if let count = base.selected ? base.count ?? mark?.count : mark?.count ?? base.count {
                    let selected = base.selected || mark != nil
                    FloorReactionButton(kind: kind, floor: floor, count: count, selected: selected,
                        pending: session.reactionPending == target,
                        disabled: selected || session.reactionPending != nil || reader.page == nil ||
                            (session.account == .signedIn && session.ownProfile == nil),
                        pulse: controls.reactionPulses[target], palette: palette) { startReaction(target) }
                }
            }
        }
    }

    private func startReaction(_ target: ForumReactionTarget) {
        guard session.account == .signedIn else { session.signIn(); return }
        guard let owner = session.ownProfile?.id else { return }
        controls.reactionNotice = nil
        if target.kind == .dislike {
            controls.reactionConfirmation = .init(target: target, owner: owner, approval: .paid)
        } else {
            runReaction(target, owner: owner, approval: target.kind == .chicken ? .quote : .direct)
        }
    }

    private func confirmReaction(_ confirmation: ReactionConfirmation) {
        controls.reactionConfirmation = nil
        runReaction(confirmation.target, owner: confirmation.owner, approval: confirmation.approval)
    }

    private func runReaction(_ target: ForumReactionTarget, owner: Int, approval: ForumReactionApproval) {
        guard let page = reader.page else { return }
        Task {
            guard let result = await session.react(target, approval: approval, owner: owner, on: page), isCurrent() else { return }
            switch result.kind {
            case .accepted:
                controls.reactionPulses[target] = UUID()
                if result.count == nil { controls.refresh += 1 }
            case .already: break
            case .confirmFree, .confirmPaid:
                controls.reactionConfirmation = .init(target: target, owner: owner,
                    approval: result.kind == .confirmFree ? .free : .paid)
            case .signedOut:
                controls.reactionNotice = .init(target: target, message: "登录已失效，请重新登录后操作。")
            case .verification:
                controls.reactionNotice = .init(target: target, message: "请先完成 NodeSeek 站点验证。", verify: true)
            case .unavailable:
                controls.reactionNotice = .init(target: target, message: "暂时无法操作该楼层，请刷新帖子后重试。")
            case .rejected:
                controls.reactionNotice = .init(target: target, message: result.message ?? "NodeSeek 未接受这次操作，请稍后重试。")
            case .unknown:
                controls.reactionNotice = .init(target: target, message: "未收到操作结果，请先刷新帖子确认状态。")
            }
        }
    }

    private func floorAction(_ item: ForumFloor, quote: Bool) -> some View {
        let title = quote ? "引用" : "回复"
        return Button {
            guard session.account == .signedIn else { session.signIn(); return }
            if let text = ForumFloorDraft.insertion(for: item, in: topic.url, quoting: quote, after: draft.wrappedValue) {
                editor.append(text, to: draft)
            }
        } label: {
            DeskLabel(title, systemImage: quote ? "quote.opening" : "arrowshape.turn.up.left", size: 12)
                .font(.system(size: 11, weight: .medium)).foregroundStyle(palette.accent)
                .padding(.horizontal, 7).frame(height: 24)
        }
        .buttonStyle(DeskButtonStyle())
        .disabled(sending || editing != nil)
        .accessibilityLabel("\(title)第 \(item.id) 楼")
    }

    private func pagination(_ thread: ForumThread) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 5) {
                if let previous = thread.pages.first(where: { $0.number == thread.page - 1 }) {
                    pageButton(previous, title: "上一页", current: thread.page)
                }
                ForEach((thread.pages.filter { $0.number != thread.page } + [ForumPageLink(number: thread.page, url: topic.url)])
                    .sorted { $0.number < $1.number }) { page in
                    pageButton(page, title: String(page.number), current: thread.page)
                }
                if let next = thread.pages.first(where: { $0.number == thread.page + 1 }) {
                    pageButton(next, title: "下一页", current: thread.page)
                }
            }
        }
        .scrollIndicators(.never)
    }

    private func pageButton(_ page: ForumPageLink, title: String, current: Int) -> some View {
        Button { if page.number != current { _ = openTopic(page.url) } } label: {
            Text(title).font(.caption.monospacedDigit().weight(page.number == current ? .semibold : .medium))
                .padding(.horizontal, 8).frame(minWidth: 27, minHeight: 25)
                .background(page.number == current ? palette.selection : palette.surface, in: RoundedRectangle(cornerRadius: 5))
                .foregroundStyle(page.number == current ? palette.accent : Color.secondary)
        }
        .buttonStyle(DeskButtonStyle(compresses: true)).disabled(sending)
        .accessibilityLabel(title == String(page.number) ? "第 \(page.number) 页" : title).accessibilityAddTraits(page.number == current ? .isSelected : [])
    }

    private func compose(_ thread: ForumThread, availableHeight: CGFloat) -> some View {
        VStack(spacing: 0) {
            rule
            VStack(alignment: .leading, spacing: 8) {
                if sending || receipt != nil { statusContent }
                if let editing {
                    editComposer(editing, availableHeight: availableHeight)
                } else if let restriction = thread.replyRestriction {
                    DeskLabel("这篇帖子\(restriction)，无法回复。", systemImage: "lock")
                        .font(.callout).foregroundStyle(.secondary)
                } else if session.account != .signedIn {
                    HStack {
                        DeskLabel("登录后参与讨论", systemImage: "person.crop.circle").font(.callout).foregroundStyle(.secondary)
                        Spacer()
                        Button("登录 NodeSeek", action: session.signIn).buttonStyle(.borderedProminent)
                    }
                } else if !session.canCompose {
                    Text("正在确认账号…").font(.callout).foregroundStyle(.secondary)
                } else {
                    MarkdownComposer(text: draft, palette: palette, disabled: sending, editor: editor,
                        imageSizing: session.imageSizing(for: .reply(topic.id)),
                        height: 108, maxHeight: min(520, max(108, availableHeight * 0.57)),
                        onKeyDown: { event in
                            guard replySendKey.matches(event) else { return false }
                            if !event.isARepeat { sendReply() }
                            return true
                        })
                    HStack {
                        Text("Markdown").font(.caption).foregroundStyle(.secondary)
                        Spacer()
                        Button(action: sendReply) { DeskLabel("发送回复", systemImage: "paperplane") }
                        .buttonStyle(.borderedProminent)
                        .tint(palette.publish)
                        .help(replySendKey == .buttonOnly ? "发送回复" : "发送回复 · \(replySendKey.title)")
                        .disabled(!canSendReply)
                    }
                }
            }
            .frame(maxWidth: .infinity).padding(.horizontal, 24).padding(.vertical, 10)
            .frame(maxWidth: .infinity)
        }
        .background(palette.chrome)
    }

    private var canSendReply: Bool {
        session.canCompose && editing == nil && !sending && !editor.uploading && reader.page != nil && receipt?.verify != true &&
            !draft.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func sendReply() {
        guard canSendReply, let page = reader.page else { return }
        session.send(topic: topic, on: page)
    }

    private func startEditing(_ item: ForumFloor) {
        guard let topicID = Int(topic.id), let floor = Int(item.id), let owner = session.ownProfile?.id,
              item.authorID == owner, editing == nil, let page = reader.page else { return }
        inlineEdit.begin(.init(topicID: topicID, floor: floor, owner: owner))
        editEditor.mode = .edit
        editEditor.imageMessage = nil
        session.rememberEdit(inlineEdit, at: topic.url)
        Task { await inlineEdit.load(on: page) }
    }

    private func editComposer(_ target: ForumInlineEdit.Target, availableHeight: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                DeskLabel(target.label, systemImage: "pencil.line").font(.callout.weight(.semibold))
                Spacer()
                if inlineEdit.loading || inlineEdit.saving { ProgressView().controlSize(.small) }
                Button("取消编辑") {
                    editEditor.finish()
                    session.rememberEdit(nil, at: topic.url)
                    inlineEdit.clear()
                }
                .disabled(inlineEdit.saving || editEditor.uploading)
            }
            if inlineEdit.ready {
                if target.floor == 0 {
                    TextField("主题标题", text: $inlineEdit.title).textFieldStyle(.roundedBorder)
                        .disabled(inlineEdit.saving)
                }
                MarkdownComposer(text: $inlineEdit.content, palette: palette, disabled: inlineEdit.saving,
                    editor: editEditor, imageSizing: inlineEdit.sizing, height: 170,
                    maxHeight: min(520, max(110, availableHeight * 0.53)), allowsSplit: true, wrapTools: true,
                    placeholder: "编辑 Markdown 正文…", fieldLabel: "编辑正文",
                    onFormat: { inlineEdit.objectWillChange.send() })
            }
            if let message = inlineEdit.message {
                Text(message).font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                if inlineEdit.needsVerification {
                    Button("打开验证窗口") {
                        session.verify(topic.url)
                        inlineEdit.continueAfterVerification()
                    }
                } else if !inlineEdit.ready && !inlineEdit.loading {
                    Button("重试读取") { if let page = reader.page { Task { await inlineEdit.load(on: page) } } }
                }
                Spacer()
                if inlineEdit.ready {
                    Button { saveEdit(target) } label: { DeskLabel("保存修改", systemImage: "checkmark") }
                        .buttonStyle(.borderedProminent).tint(palette.publish)
                        .disabled(!inlineEdit.canSave || editEditor.uploading || reader.page == nil)
                }
            }
        }
    }

    private func saveEdit(_ target: ForumInlineEdit.Target) {
        guard inlineEdit.canSave, !editEditor.uploading, let page = reader.page else { return }
        let access = session.accessRevision
        Task {
            guard await inlineEdit.save(on: page, authorized: {
                session.accessRevision == access && session.account == .signedIn && session.ownProfile?.id == target.owner
            }), session.accessRevision == access, session.memberID == target.owner else { return }
            if target.floor == 0 { session.rememberTitle(inlineEdit.title.trimmingCharacters(in: .whitespacesAndNewlines), for: topic.id) }
            session.invalidateThread(topic.id)
            session.rememberEdit(nil, at: topic.url)
            editEditor.finish()
            inlineEdit.clear()
        }
    }

    private var replyStatus: some View {
        VStack(spacing: 0) { rule; statusContent.padding(10).frame(maxWidth: .infinity) }
            .background(palette.chrome)
    }

    @ViewBuilder private var statusContent: some View {
        if sending {
            HStack(spacing: 7) {
                ProgressView().controlSize(.small)
                Text("正在发送回复…").font(.caption).foregroundStyle(.secondary)
            }
        } else if let receipt {
            HStack(spacing: 7) {
                DeskIcon(receipt.accepted ? "checkmark.circle.fill" : "exclamationmark.circle")
                    .foregroundStyle(receipt.accepted ? palette.accent : Color.secondary)
                Text(receipt.message).font(.caption).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                if receipt.verify { Button("打开验证窗口") { session.verify(topic.url); session.clearReceipt(topic.id) } }
                else if let destination = receipt.destination, destination != topic.url {
                    Button("查看新回复") { _ = openTopic(destination) }
                }
                Button { session.clearReceipt(topic.id) } label: { DeskIcon("xmark", size: 12).font(.caption) }
                    .accessibilityLabel("关闭发送提示")
                    .buttonStyle(.borderless).help("关闭发送状态").accessibilityLabel("关闭发送状态")
            }
        }
    }

    private struct LoadKey: Equatable { let url: URL; let access: Int; let refresh: Int }
}

private struct BlockedFloor<Content: View>: View {
    let author: String
    let number: String
    let isRoot: Bool
    let palette: DeskPalette
    let unblock: () -> Void
    @ViewBuilder let content: () -> Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var disclosure = DisclosureState()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 9) {
                DeskIcon("person.crop.circle.badge.minus", size: 14).accessibilityHidden(true)
                Text(author).fontWeight(.medium).lineLimit(1)
                Text("已屏蔽").foregroundStyle(.secondary).fixedSize()
                Spacer(minLength: 5)
                Text("#\(number)").monospacedDigit().foregroundStyle(.secondary)
                Button(disclosure.expanded ? "收起" : "展开") {
                    withAnimation(reduceMotion ? nil : DeskMotion.reader) { disclosure.expanded.toggle() }
                }
                .accessibilityLabel(disclosureAction)
                Button("解除屏蔽", action: unblock)
                    .accessibilityLabel("解除对 \(author) 的屏蔽")
            }
            .font(.callout).controlSize(.small)
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: 7))
            if disclosure.expanded { content().transition(.opacity) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var disclosureAction: String {
        let action = disclosure.expanded ? "收起" : "展开"
        return action + (isRoot ? "主题正文" : "第 \(number) 楼")
    }

    @MainActor private final class DisclosureState: ObservableObject { @Published var expanded = false }
}

private struct FloorSignature: View {
    let text: AttributedString
    let tint: Color

    init(_ source: String, tint: Color) {
        self.text = ForumMarkdownLink.format(source)
        self.tint = tint
    }

    var body: some View {
        Text(text).font(.system(size: 13)).lineSpacing(3)
            .foregroundStyle(.primary.opacity(0.84)).tint(tint)
            .environment(\.openURL, OpenURLAction { ForumMarkdownLink.canOpen($0) ? .systemAction : .discarded })
    }
}

@MainActor private final class ReaderControls: ObservableObject {
    @Published var refresh = 0
    @Published var authorOnly = false
    @Published var reactionConfirmation: ReactionConfirmation?
    @Published var reactionNotice: ReactionNotice?
    @Published var reactionPulses: [ForumReactionTarget: UUID] = [:]
    var readingAnchor: String?
    var returnAnchor: String?

    init(returnAnchor: String?) { self.returnAnchor = returnAnchor }
}

private struct ReactionConfirmation {
    let target: ForumReactionTarget
    let owner: Int
    let approval: ForumReactionApproval

    var title: String { "\(target.kind == .dislike ? "点踩" : "送鸡腿给")第 \(target.floor) 楼？" }
    var message: String {
        if target.kind == .dislike { return "这次点踩会消耗你 2 个鸡腿，并扣除对方 1 个。操作提交后不可撤回。" }
        return approval == .free ? "本次使用免费投喂额度，送出后不可撤回。" : "这次投喂会消耗你 1 个鸡腿，送出后不可撤回。"
    }
}

private struct ReactionNotice {
    let target: ForumReactionTarget
    let message: String
    var verify = false
}
