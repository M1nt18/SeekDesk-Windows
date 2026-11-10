import SwiftUI
import WebKit

@MainActor
private final class DiscussionPublisher: ObservableObject {
    enum Phase { case loading, ready, signedOut, verification, unavailable }

    @Published var phase: Phase = .loading
    @Published var categories: [DiscussionOptions.Category] = []
    @Published var maxRank = 0
    @Published var sending = false
    @Published var message: String?
    @Published var showFeeConfirmation = false
    @Published var reload = 0
    private var page: ForumWebPage?

    func load(_ session: ForumSession, draft: NewDiscussionDraft) async {
        phase = .loading
        page = nil
        message = nil
        let access = session.accessRevision
        let loader = ForumWebPage(dataStore: session.dataStore)
        do {
            try await loader.read(DiscussionScript.page)
            try Task.checkCancellation()
            guard access == session.accessRevision else { return }
            if loader.challenged { phase = .verification; return }
            if loader.webView.url?.path == Forum.signIn.path {
                session.observeAccount(false); phase = .signedOut; return
            }
            let value = try await loader.webView.callAsyncJavaScript(DiscussionScript.options, arguments: [:], in: nil, contentWorld: .page)
            try Task.checkCancellation()
            guard access == session.accessRevision else { return }
            let data = try Self.decode(DiscussionOptions.self, value)
            if data.kind == "signedOut" {
                session.observeAccount(false); phase = .signedOut; return
            }
            guard data.kind == "ready", let available = data.categories, !available.isEmpty else {
                phase = .unavailable; return
            }
            guard let identity = try await loader.identity(), identity.signedIn else { throw ForumPageError.signInRequired }
            guard access == session.accessRevision else { return }
            session.observeIdentity(identity)
            guard session.newDiscussion === draft else { return }
            categories = available
            maxRank = max(0, min(30, data.maxRank ?? 0))
            if !available.contains(where: { $0.id == draft.category }) { draft.category = "" }
            if draft.rank != 255 && draft.rank > maxRank { draft.rank = 0 }
            page = loader
            session.observeAccount(true)
            phase = .ready
        } catch is CancellationError {
        } catch {
            guard !Task.isCancelled, access == session.accessRevision else { return }
            phase = loader.challenged || (error as? ForumPageError) == .verification ? .verification : .unavailable
        }
    }

    func publish(_ draft: NewDiscussionDraft, session: ForumSession, accepted: @escaping (URL?) -> Void) {
        let title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard phase == .ready, session.canCompose, !sending, let page, !title.isEmpty,
              !draft.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              categories.contains(where: { $0.id == draft.category }) else { return }
        let original = draft.content
        let category = draft.category
        let rank = draft.rank
        let token = session.authorization
        sending = true
        message = nil
        Task {
            defer { if token == session.authorization { sending = false } }
            let content: String
            do { content = try await draft.imageSizing.prepare(original) }
            catch {
                guard session.authorizes(token) else { return }
                message = (error as? NodeImageError ?? .connection).localizedDescription + " 草稿已保留。"
                return
            }
            guard session.authorizes(token) else { return }
            let arguments: [String: Any] = ["title":title, "content":content, "category":category, "rank":rank]
            let response: DiscussionResponse?
            do {
                let value = try await page.webView.callAsyncJavaScript(DiscussionScript.publish, arguments: arguments,
                    in: nil, contentWorld: .page)
                response = try Self.decode(DiscussionResponse.self, value)
            } catch { response = nil }
            guard session.authorizes(token) else { return }
            switch response?.kind {
            case "accepted":
                if draft.snapshot == ForumDraftSnapshot.Discussion(title: title, content: original, category: category, rank: rank) {
                    draft.clear()
                }
                accepted(response?.topicURL)
            case "signedOut":
                session.observeAccount(false)
                phase = .signedOut
            case "verification": phase = .verification
            case "unavailable": phase = .unavailable
            case "rejected":
                let reason = response?.message?.trimmingCharacters(in: .whitespacesAndNewlines)
                message = reason.flatMap { $0.isEmpty ? nil : $0 } ?? "NodeSeek 未接受本次发布。草稿已保留。"
            default:
                message = "没有收到发布结果。请先检查帖子是否已经出现，再决定是否重发。草稿已保留。"
            }
        }
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ value: Any?) throws -> T {
        guard let json = value as? String else { throw ForumPageError.changed }
        return try JSONDecoder().decode(type, from: Data(json.utf8))
    }
}

struct NewDiscussionView: View {
    @ObservedObject var session: ForumSession
    @ObservedObject var draft: NewDiscussionDraft
    let palette: DeskPalette
    let onPublished: (URL?) -> Void
    @StateObject private var publisher = DiscussionPublisher()
    @StateObject private var editor = MarkdownEditorState(initialMode: .split)

    private var canPublish: Bool {
        session.canCompose && publisher.phase == .ready && !publisher.sending && !editor.uploading && !draft.category.isEmpty &&
        !draft.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
        !draft.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Button { session.presentation = nil } label: {
                    DeskLabel("返回论坛", systemImage: "chevron.left").font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 9).frame(height: 32)
                }
                .buttonStyle(DeskButtonStyle())
                .disabled(publisher.sending)
                .keyboardShortcut(.cancelAction)
                Rectangle().fill(palette.line).frame(width: 1, height: 22)
                Text("发布新主题").font(.system(size: 17, weight: .semibold)).accessibilityAddTraits(.isHeader)
                Spacer()
                Text("NodeSeek").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            }
            .padding(.leading, 83).padding(.trailing, 20).frame(height: 58)
            .background(palette.chrome)
            Divider()
            VStack(alignment: .leading, spacing: 10) {
                TextField("请输入帖子标题", text: $draft.title)
                    .font(.system(size: 21, weight: .semibold)).textFieldStyle(.plain)
                    .padding(.horizontal, 13).frame(height: 47)
                    .background(palette.reader, in: RoundedRectangle(cornerRadius: 8))
                    .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(palette.line).allowsHitTesting(false) }
                    .disabled(publisher.sending)
                HStack(spacing: 16) {
                    Picker("版块", selection: $draft.category) {
                        Text("选择版块").tag("")
                        ForEach(publisher.categories) { Text($0.title).tag($0.id) }
                    }.fixedSize()
                    Picker("阅读限制", selection: $draft.rank) {
                        Text("公开").tag(0)
                        if publisher.maxRank > 0 {
                            ForEach(1...publisher.maxRank, id: \.self) { Text("Lv\($0)").tag($0) }
                        }
                        Text("私有").tag(255)
                    }.fixedSize()
                    Spacer()
                }
                .controlSize(.regular).disabled(publisher.phase != .ready || publisher.sending)
            }
            .padding(.horizontal, 20).padding(.top, 13).padding(.bottom, 11)
            GeometryReader { geometry in
                let wrapTools = geometry.size.width < 930
                let editorChrome: CGFloat = (wrapTools ? 140 : 106) + (editor.uploading || editor.imageMessage != nil ? 28 : 0)
                let available = max(60, geometry.size.height - editorChrome)
                MarkdownComposer(text: $draft.content, palette: palette, disabled: publisher.sending,
                    editor: editor, imageSizing: draft.imageSizing, height: available, maxHeight: available, resizeFromBottom: true, allowsSplit: true,
                    wrapTools: wrapTools, placeholder: "写下你的帖子正文…", fieldLabel: "帖子正文")
            }
            .padding(.horizontal, 20).padding(.bottom, 10)
            Divider()
            HStack(spacing: 10) {
                status
                Spacer(minLength: 12)
                if !draft.content.isEmpty {
                    Text("\(draft.content.count) 字符").font(.caption.monospacedDigit()).foregroundStyle(.secondary)
                }
                if publisher.sending { ProgressView().controlSize(.small) }
                Button {
                    if draft.category == "inside" { publisher.showFeeConfirmation = true }
                    else { publish() }
                } label: {
                    DeskLabel("发布帖子", systemImage: "paperplane")
                }.buttonStyle(.borderedProminent).controlSize(.large).disabled(!canPublish)
            }
            .padding(.horizontal, 20).padding(.vertical, 10).background(palette.chrome)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.list)
        .task(id: "\(publisher.reload)|\(session.accessRevision)") { await publisher.load(session, draft: draft) }
        .confirmationDialog("发内版需消耗 5 鸡腿", isPresented: $publisher.showFeeConfirmation, titleVisibility: .visible) {
            Button("消耗 5 鸡腿并发布", action: publish)
            Button("取消", role: .cancel) {}
        }
    }

    @ViewBuilder private var status: some View {
        switch publisher.phase {
        case .loading: Text("正在读取可用版块…").font(.caption).foregroundStyle(.secondary)
        case .ready:
            if let message = publisher.message {
                DeskLabel(message, systemImage: "info.circle").font(.caption).foregroundStyle(.secondary).textSelection(.enabled)
            } else {
                Text(publisher.sending ? "正在发布…" : "请遵守版规，并确认版块和阅读权限。").font(.caption).foregroundStyle(.secondary)
            }
        case .signedOut: Button("登录 NodeSeek", action: session.signIn)
        case .verification: Button("验证 NodeSeek") { session.verify(DiscussionScript.page) }
        case .unavailable:
            Text("暂时无法读取发帖权限").font(.caption).foregroundStyle(.secondary)
            Button("重试") { publisher.reload += 1 }
        }
    }

    private func publish() {
        guard canPublish else { return }
        publisher.publish(draft, session: session, accepted: onPublished)
    }
}
