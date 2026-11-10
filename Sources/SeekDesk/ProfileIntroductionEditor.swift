import SwiftUI

struct ProfileIntroductionEditor: View {
    let owner: Int
    @ObservedObject var session: ForumSession
    let palette: DeskPalette
    let cancel: () -> Void
    let saved: () -> Void
    @StateObject private var state = EditState()

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 10) {
                Text("编辑个人资料").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
                Spacer()
                if state.original != nil {
                    Picker("资料编辑模式", selection: $state.preview) {
                        Text("编辑").tag(false)
                        Text("预览").tag(true)
                    }
                    .pickerStyle(.segmented).labelsHidden().fixedSize()
                }
                Button("取消", action: cancel).disabled(state.saving)
            }

            if state.loading {
                ProgressView("正在读取个人资料…").controlSize(.small)
            } else if state.original != nil {
                field("个人签名", note: "显示在帖子和评论下方。支持 Markdown 链接。", text: $state.draft.signature, height: 92)
                field("README", note: "显示在个人主页概况中。支持 Markdown。", text: $state.draft.readme, height: 180)
            }
            if let issue = state.issue {
                Text(issue.message ?? description(issue.kind)).font(.callout).foregroundStyle(.secondary)
                if issue.kind == .verification { Button("打开验证窗口") { session.verify(Forum.home.appendingPathComponent("setting")) } }
                if state.original == nil { Button("重试读取") { state.retry += 1 } }
            }
            if state.original != nil {
                HStack(spacing: 8) {
                    Spacer()
                    if state.saving { ProgressView().controlSize(.small).accessibilityLabel("正在保存") }
                    Button("保存资料", action: save)
                        .buttonStyle(.borderedProminent).tint(palette.publish)
                        .disabled(state.saving || state.draft == state.original)
                }
            }
        }
        .padding(16).background(palette.surface, in: RoundedRectangle(cornerRadius: 10))
        .task(id: state.retry) {
            state.loading = true
            state.issue = nil
            let result = await session.introduction(for: owner)
            guard !Task.isCancelled else { return }
            state.loading = false
            if result.kind == .ready, let data = result.data {
                state.original = data
                state.draft = data
            } else { state.issue = result }
        }
    }

    private func field(_ title: String, note: String, text: Binding<String>, height: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.headline)
            Text(note).font(.caption).foregroundStyle(.secondary)
            Group {
                if state.preview {
                    if text.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("暂无内容").font(.callout).foregroundStyle(.secondary)
                    } else {
                        ProfileMarkdown(source: text.wrappedValue, palette: palette, opensLinks: false)
                    }
                } else {
                    TextEditor(text: text)
                        .font(.system(size: 13, design: .monospaced)).scrollContentBackground(.hidden)
                        .frame(height: height).accessibilityLabel(title).disabled(state.saving)
                }
            }
            .padding(8).frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.reader, in: RoundedRectangle(cornerRadius: 7))
            .overlay { RoundedRectangle(cornerRadius: 7).strokeBorder(palette.line).allowsHitTesting(false) }
        }
    }

    private func save() {
        guard !state.saving, let original = state.original, state.draft != original else { return }
        state.saving = true
        state.issue = nil
        let changes = state.draft
        Task {
            let result = await session.introduction(for: owner, draft: changes, original: original)
            state.saving = false
            if result.kind == .saved { saved() }
            else { state.issue = result }
        }
    }

    private func description(_ kind: ForumIntroductionResult.Kind) -> String {
        switch kind {
        case .signedOut: "登录已失效。请重新登录后再操作。"
        case .verification: "请先完成 NodeSeek 站点验证。"
        case .conflict: "你正在编辑的内容已在别处更新。当前输入已保留，可以先复制，再重新打开编辑器查看最新版本。"
        case .unknown: "未收到保存结果。可以重新打开编辑器核对，当前输入已保留。"
        case .rejected: "NodeSeek 拒绝了这次更新，当前输入已保留。"
        default: "暂时无法读取个人资料，请稍后重试。"
        }
    }

    @MainActor private final class EditState: ObservableObject {
        @Published var original: ForumIntroduction?
        @Published var draft = ForumIntroduction(bio: "", signature: "", readme: "")
        @Published var loading = true
        @Published var saving = false
        @Published var preview = false
        @Published var retry = 0
        @Published var issue: ForumIntroductionResult?
    }
}

struct ProfileMarkdown: View {
    let source: String
    let palette: DeskPalette
    var opensLinks = true

    var body: some View {
        MarkdownPreviewBlocks(blocks: MarkdownPreviewDocument.blocks(source), palette: palette, showsImageControls: false)
            .equatable()
            .environment(\.openURL, OpenURLAction { opensLinks && ForumMarkdownLink.canOpen($0) ? .systemAction : .discarded })
    }
}
