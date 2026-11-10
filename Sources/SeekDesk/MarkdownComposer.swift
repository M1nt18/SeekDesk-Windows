import AppKit
import SwiftUI
import UniformTypeIdentifiers

enum ReplySendKey: String, CaseIterable, Identifiable {
    static let preference = "workspace.replySendKey"
    case commandReturn, returnKey, buttonOnly

    var id: Self { self }
    var title: String {
        switch self {
        case .commandReturn: "⌘ Return"
        case .returnKey: "Return"
        case .buttonOnly: "仅按钮"
        }
    }

    func matches(_ event: NSEvent) -> Bool {
        guard self != .buttonOnly, event.keyCode == 36 || event.keyCode == 76 else { return false }
        let modifiers = event.modifierFlags.intersection([.command, .shift, .control, .option])
        return modifiers == (self == .commandReturn ? .command : [])
    }
}

struct MarkdownComposer: View {
    @Binding var text: String
    let palette: DeskPalette
    let disabled: Bool
    @ObservedObject var editor: MarkdownEditorState
    let imageSizing: DraftImageSizing
    let height: CGFloat
    var maxHeight: CGFloat = 420
    var resizeFromBottom = false
    var allowsSplit = false
    var wrapTools = false
    var placeholder = "写下你的回复…"
    var fieldLabel = "回复正文"
    var onFormat: () -> Void = {}
    var onKeyDown: ((NSEvent) -> Bool)? = nil
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let minHeight: CGFloat = 60
    private var range: ClosedRange<CGFloat> { minHeight...max(minHeight, maxHeight) }
    private var baseHeight: CGFloat { clamp(editor.height ?? (editor.expanded ? range.upperBound : height)) }
    private var locked: Bool { disabled || editor.preview }

    var body: some View {
        VStack(spacing: 0) {
            if !resizeFromBottom { resizeGrip }
            toolbar
            rule
            HStack(spacing: 0) {
                if !editor.preview {
                    VStack(spacing: 0) {
                        if allowsSplit { columnLabel("正文", icon: "pencil.line", trailing: "Markdown") }
                        input
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                if editor.mode != .edit {
                    if editor.mode == .split { Rectangle().fill(palette.line).frame(width: 1) }
                    VStack(alignment: .leading, spacing: 0) {
                        if allowsSplit { columnLabel("实时预览", icon: "eye") }
                        MarkdownPreview(text: text, palette: palette, imageSizing: imageSizing, onResize: onFormat)
                            .disabled(disabled)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .background(allowsSplit ? palette.surface.opacity(0.22) : .clear)
                }
            }
            .frame(height: clamp(baseHeight + editor.heightDrag))
            if resizeFromBottom { resizeGrip }
            if editor.uploading || editor.imageMessage != nil {
                HStack(spacing: 6) {
                    if editor.uploading { ProgressView().controlSize(.small) }
                    Text(editor.uploading ? "正在上传到 NodeImage…" : editor.imageMessage ?? "")
                        .font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    if !editor.uploading {
                        Button { editor.imageMessage = nil } label: { DeskIcon("xmark") }
                            .buttonStyle(.plain).accessibilityLabel("关闭上传提示")
                    }
                }
                .padding(.horizontal, 8).padding(.vertical, 5).background(palette.list)
            }
        }
        .background(palette.reader, in: RoundedRectangle(cornerRadius: 8))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8).strokeBorder(editor.focused && !editor.preview ? palette.accent : palette.line)
                .allowsHitTesting(false).animation(reduceMotion ? nil : DeskMotion.feedback, value: editor.focused)
        }
        .sheet(isPresented: $editor.showingImageSettings) {
            NodeImageSettingsView { editor.showingImageSettings = false }
        }
        .confirmationDialog("清空当前编辑内容？", isPresented: $editor.confirmClear) {
            Button("清空", role: .destructive) { editor.clear() }
            Button("取消", role: .cancel) {}
        }
    }

    private var rule: some View { Rectangle().fill(palette.line).frame(height: 1) }

    private var toolbar: some View {
        Group {
            if allowsSplit { writingToolbar }
            else {
                ViewThatFits(in: .horizontal) {
                    toolbarRow(compact: false)
                    toolbarRow(compact: true)
                }
            }
        }
        .foregroundStyle(.secondary)
        .background(palette.list)
        .onChange(of: editor.mode) { if editor.preview { editor.releaseFocus() } }
    }

    private let formatting: [MarkdownCommand] = [.heading, .bold, .italic, .strike, .code, .quote]
    private let structure: [MarkdownCommand] = [.bullets, .numbers, .codeBlock, .table, .divider, .link, .image]

    private var writingToolbar: some View {
        VStack(spacing: 0) {
            HStack(spacing: 7) {
                imageMenu(labelled: true)
                stickers(labelled: true)
                toolbarDivider
                tool("撤销", icon: "arrow.uturn.backward") { editor.undo() }.disabled(locked)
                tool("重做", icon: "arrow.uturn.forward") { editor.redo() }.disabled(locked)
                tool("清空内容", icon: "trash") { editor.confirmClear = true }.disabled(locked || text.isEmpty)
                Spacer(minLength: 6)
                Picker("编辑器视图", selection: $editor.mode) {
                    Text("仅编辑").tag(MarkdownEditorState.Mode.edit)
                    Text("对照").tag(MarkdownEditorState.Mode.split)
                    Text("仅预览").tag(MarkdownEditorState.Mode.preview)
                }
                .labelsHidden().pickerStyle(.segmented).controlSize(.regular).fixedSize()
            }
            .padding(.horizontal, 10).frame(height: 42)
            rule
            if wrapTools {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: 3) { commandButtons(formatting, labelled: true) }
                    HStack(spacing: 3) { commandButtons(structure, labelled: true) }
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.vertical, 2)
            } else {
                HStack(spacing: 3) {
                    commandButtons(formatting, labelled: true)
                    toolbarDivider
                    commandButtons(structure, labelled: true)
                    Spacer(minLength: 0)
                }.padding(.horizontal, 10).padding(.vertical, 2)
            }
        }
    }

    private func columnLabel(_ label: String, icon: String, trailing: String? = nil) -> some View {
        HStack(spacing: 5) {
            DeskLabel(label, systemImage: icon, size: 12).font(.caption.weight(.semibold)).foregroundStyle(.primary)
            Spacer()
            if let trailing { Text(trailing).font(.caption2.monospaced()).foregroundStyle(.secondary) }
        }
        .padding(.horizontal, 12).frame(height: 29)
        .overlay(alignment: .bottom) { rule }
    }

    private var toolbarDivider: some View { Rectangle().fill(palette.line).frame(width: 1, height: 18).padding(.horizontal, 3) }

    private func commandButtons(_ commands: [MarkdownCommand], labelled: Bool) -> some View {
        ForEach(commands, id: \.self) { command in
            tool(command.title, icon: command.icon, labelled: labelled) { apply(command) }.disabled(locked)
        }
    }

    private func toolbarRow(compact: Bool) -> some View {
        HStack(spacing: 2) {
            if compact {
                Menu {
                    ForEach(MarkdownCommand.allCases, id: \.self) { command in
                        Button { apply(command) } label: { DeskLabel(command.title, systemImage: command.icon, nativeMenu: true) }
                    }
                    Divider()
                    Button("撤销") { editor.undo() }
                    Button("重做") { editor.redo() }
                    Button("清空…") { editor.confirmClear = true }.disabled(text.isEmpty)
                } label: { DeskIcon("textformat", nativeMenu: true) }
                .menuStyle(.borderlessButton).fixedSize().disabled(locked).accessibilityLabel("Markdown 格式")
                tool("加粗", icon: "bold") { apply(.bold) }.disabled(locked)
                tool("引用", icon: "text.quote") { apply(.quote) }.disabled(locked)
                tool("插入链接", icon: "link") { apply(.link) }.disabled(locked)
            } else {
                commandButtons(MarkdownCommand.allCases, labelled: false)
                Menu {
                    Button("撤销") { editor.undo() }
                    Button("重做") { editor.redo() }
                    Button("清空…") { editor.confirmClear = true }.disabled(text.isEmpty)
                } label: { DeskIcon("ellipsis.circle", nativeMenu: true) }
                .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().disabled(locked)
                .accessibilityLabel("撤销、重做或清空")
            }
            imageMenu(labelled: false)
            stickers(labelled: false)
            Spacer(minLength: 6)
            tool(editor.preview ? "继续编辑" : "预览", icon: editor.preview ? "pencil" : "eye") { editor.togglePreview() }
                .accessibilityAddTraits(editor.preview ? .isSelected : []).disabled(disabled)
            tool(editor.expanded ? "恢复编辑区高度" : "展开编辑区",
                 icon: editor.expanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") {
                withAnimation(reduceMotion ? nil : DeskMotion.pane) {
                    editor.expanded.toggle()
                    editor.height = nil
                }
            }
        }
        .padding(.horizontal, 6).padding(.vertical, 3)
    }

    private func imageMenu(labelled: Bool) -> some View {
        Menu {
            Button("选择 Mac 上的图片…") { chooseImage() }
            Button("图床密钥设置…") { editor.showingImageSettings = true }
        } label: {
            if labelled { DeskLabel("上传图片", systemImage: "photo.badge.arrow.down", size: 13, nativeMenu: true).font(.system(size: 12, weight: .medium)) }
            else { DeskIcon("photo.badge.arrow.down", size: 13, nativeMenu: true).font(.system(size: 13, weight: .medium)) }
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize()
        .accessibilityLabel("上传图片").help("NodeImage 上传图片，也可粘贴图片")
        .disabled(locked || editor.uploading)
    }

    private func stickers(labelled: Bool) -> some View {
        tool("表情包", icon: "face.smiling", labelled: labelled) { editor.showingStickers.toggle() }
            .disabled(locked || editor.uploading)
            .popover(isPresented: $editor.showingStickers, arrowEdge: .bottom) {
                StickerPicker(palette: palette) { item in
                    if let insertion = item.insertion {
                        editor.insert(insertion, into: $text)
                        onFormat()
                    } else {
                        do { upload(try NodeImageUpload.Picture.file(item.url), label: "表情") }
                        catch { editor.imageMessage = error.localizedDescription }
                    }
                    editor.showingStickers = false
                    if item.insertion != nil { Task { @MainActor in editor.restoreFocus() } }
                }
            }
    }

    private func tool(_ label: String, icon: String, labelled: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                DeskIcon(icon, size: 13)
                if labelled { Text(label).font(.system(size: 11, weight: .medium)) }
            }
            .font(.system(size: 12, weight: .medium))
            .frame(minWidth: labelled ? 0 : 25)
            .padding(.horizontal, labelled ? 6 : 0).frame(height: labelled ? 28 : 25)
            .fixedSize()
        }
        .buttonStyle(DeskButtonStyle(compresses: true))
        .help(label).accessibilityLabel(label)
    }

    private var input: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topLeading) {
                MarkdownTextInput(text: $text, enabled: !disabled, editor: editor, fieldLabel: fieldLabel,
                                  onKeyDown: onKeyDown) { upload($0) }
                if text.isEmpty {
                    Text(placeholder).font(.system(size: 13)).foregroundStyle(.secondary)
                        .padding(.horizontal, 10).padding(.vertical, 8).allowsHitTesting(false).accessibilityHidden(true)
                }
            }
            if editor.mode == .edit { MarkdownDraftStickers(text: text, palette: palette) }
        }
    }

    private var resizeGrip: some View {
        ZStack {
            palette.list
            Capsule().fill(palette.accent.opacity(editor.heightDrag == 0 ? 0.26 : 0.72)).frame(width: 30, height: 2)
                .allowsHitTesting(false)
            DeskResizeHandle(vertical: true, change: { delta in
                if editor.dragStart == nil { editor.dragStart = baseHeight }
                editor.heightDrag = (resizeFromBottom ? -1 : 1) * delta
            }, finish: { delta in
                let start = editor.dragStart ?? baseHeight
                editor.height = clamp(start + (resizeFromBottom ? -1 : 1) * delta)
                editor.dragStart = nil
                editor.heightDrag = 0
            }, reset: {
                editor.height = nil
                editor.expanded = false
                editor.dragStart = nil
                editor.heightDrag = 0
            })
            .accessibilityHidden(true)
        }
        .frame(height: 11)
        .help("拖动调整编辑框高度，双击恢复")
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("编辑框高度")
        .accessibilityValue("\(Int(clamp(baseHeight + editor.heightDrag))) 点")
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: editor.height = clamp(baseHeight + 24)
            case .decrement: editor.height = clamp(baseHeight - 24)
            @unknown default: break
            }
        }
    }

    private func clamp(_ value: CGFloat) -> CGFloat { min(range.upperBound, max(range.lowerBound, value)) }
    private func apply(_ command: MarkdownCommand) {
        editor.apply(command)
        onFormat()
    }

    private func chooseImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.prompt = "上传"
        panel.begin { response in
            guard response == .OK, let url = panel.url else { return }
            do { upload(try NodeImageUpload.Picture.file(url)) }
            catch { editor.imageMessage = NodeImageError.invalidFile.localizedDescription }
        }
    }

    private func upload(_ picture: NodeImageUpload.Picture, label: String = "图片") {
        guard !disabled, !editor.uploading, !editor.preview else { return }
        do {
            guard let key = try NodeImageKey.read(), !key.isEmpty else {
                editor.showingImageSettings = true
                return
            }
            let draft = $text
            let original = draft.wrappedValue
            let selection = editor.textView?.selectedRange()
            editor.uploading = true
            editor.imageMessage = nil
            Task {
                defer { editor.uploading = false }
                do {
                    let url = try await NodeImageUpload.upload(picture, key: key)
                    let markdown = "![\(label)](<\(url.absoluteString)>)"
                    let insertion = draft.wrappedValue == original ? selection : editor.textView?.selectedRange()
                    let range = insertion.map { NSRange(location: NSMaxRange($0), length: 0) }
                    editor.insert(markdown, into: draft, selection: range)
                    onFormat()
                    editor.imageMessage = "\(label)已插入。"
                } catch {
                    editor.imageMessage = (error as? NodeImageError)?.localizedDescription ?? NodeImageError.connection.localizedDescription
                }
            }
        } catch { editor.imageMessage = error.localizedDescription }
    }

}

@MainActor
final class MarkdownEditorState: ObservableObject {
    enum Mode: Hashable { case edit, split, preview }
    @Published var mode: Mode
    var preview: Bool { mode == .preview }
    @Published var expanded = false
    @Published var height: CGFloat?
    @Published var heightDrag: CGFloat = 0
    var dragStart: CGFloat?
    @Published var showingStickers = false
    @Published var confirmClear = false
    @Published var focused = false
    @Published var showingImageSettings = false
    @Published var uploading = false
    @Published var imageMessage: String?
    weak var textView: NSTextView?

    init(initialMode: Mode = .edit) { mode = initialMode }

    func insert(_ value: String, into draft: Binding<String>, selection: NSRange? = nil) {
        let original = draft.wrappedValue
        let source = original as NSString
        let end = NSRange(location: source.length, length: 0)
        let view: NSTextView? = if !preview, let textView, textView.window != nil, textView.isEditable,
                                  !textView.hasMarkedText(), textView.string == original { textView } else { nil }
        let proposed = selection ?? view?.selectedRange() ?? end
        let validRange = proposed.location >= 0 && proposed.location <= source.length &&
            proposed.length >= 0 && proposed.length <= source.length - proposed.location
        let range = validRange ? proposed : end
        if let view {
            view.breakUndoCoalescing()
            view.insertText(value, replacementRange: range)
            if view.string != original {
                if draft.wrappedValue != view.string { draft.wrappedValue = view.string }
                return
            }
        }
        draft.wrappedValue = source.replacingCharacters(in: range, with: value)
    }

    func restoreFocus() {
        guard !preview, let view = textView, view.isEditable else { return }
        view.window?.makeFirstResponder(view)
        view.scrollRangeToVisible(view.selectedRange())
    }

    func undo() { textView?.undoManager?.undo() }
    func redo() { textView?.undoManager?.redo() }
    func clear() {
        guard let view = textView, view.isEditable else { return }
        view.breakUndoCoalescing()
        view.insertText("", replacementRange: NSRange(location: 0, length: (view.string as NSString).length))
    }

    func apply(_ command: MarkdownCommand) {
        guard !preview, let textView, textView.isEditable,
              let edit = command.edit(source: textView.string, selection: textView.selectedRange()) else { return }
        textView.window?.makeFirstResponder(textView)
        textView.insertText(edit.text, replacementRange: edit.replaced)
        if NSMaxRange(edit.selected) <= (textView.string as NSString).length {
            textView.setSelectedRange(edit.selected)
            textView.scrollRangeToVisible(edit.selected)
        }
    }

    func togglePreview() {
        mode = preview ? .edit : .preview
        if preview { releaseFocus() }
    }

    func append(_ content: String, to draft: Binding<String>) {
        if preview { mode = .edit }
        if let textView, textView.isEditable, !textView.hasMarkedText(), textView.string == draft.wrappedValue {
            let end = NSRange(location: (textView.string as NSString).length, length: 0)
            textView.breakUndoCoalescing()
            textView.insertText(content, replacementRange: end)
        } else {
            draft.wrappedValue += content
        }
        Task { @MainActor [weak self] in
            guard let self, !self.preview, let view = self.textView, view.isEditable else { return }
            view.window?.makeFirstResponder(view)
            let end = NSRange(location: (view.string as NSString).length, length: 0)
            view.setSelectedRange(end)
            view.scrollRangeToVisible(end)
        }
    }

    func finish() {
        if preview { mode = .edit }
        releaseFocus()
    }

    func releaseFocus() {
        if let textView, textView.window?.firstResponder === textView { textView.window?.makeFirstResponder(nil) }
    }
}

private struct MarkdownTextInput: NSViewRepresentable {
    @Binding var text: String
    let enabled: Bool
    let editor: MarkdownEditorState
    let fieldLabel: String
    let onKeyDown: ((NSEvent) -> Bool)?
    let onImage: (NodeImageUpload.Picture) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.hasVerticalScroller = true
        let view = ReplyTextView(frame: scroll.contentView.bounds)
        view.minSize = .zero
        view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.textContainer?.widthTracksTextView = true
        scroll.documentView = view
        view.delegate = context.coordinator
        view.isRichText = false
        view.importsGraphics = false
        view.allowsUndo = true
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticLinkDetectionEnabled = false
        view.font = .systemFont(ofSize: 13)
        view.textContainerInset = NSSize(width: 6, height: 7)
        view.drawsBackground = false
        view.setAccessibilityLabel(fieldLabel)
        view.string = text
        scroll.drawsBackground = false
        scroll.borderType = .noBorder
        scroll.autohidesScrollers = true
        editor.textView = view
        return scroll
    }

    func updateNSView(_ view: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let input = view.documentView as? NSTextView else { return }
        if input.string != text, !input.hasMarkedText() { input.string = text }
        input.setAccessibilityLabel(fieldLabel)
        input.isEditable = enabled
    }

    @MainActor final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MarkdownTextInput
        init(_ parent: MarkdownTextInput) { self.parent = parent }
        func textDidBeginEditing(_ notification: Notification) { parent.editor.focused = true }
        func textDidEndEditing(_ notification: Notification) { parent.editor.focused = false }
        func textDidChange(_ notification: Notification) {
            if let view = notification.object as? NSTextView, !view.hasMarkedText() { parent.text = view.string }
        }
    }
}

private final class ReplyTextView: NSTextView {
    override func keyDown(with event: NSEvent) {
        if isEditable, !hasMarkedText(),
           let coordinator = delegate as? MarkdownTextInput.Coordinator,
           coordinator.parent.onKeyDown?(event) == true { return }
        super.keyDown(with: event)
    }

    override func paste(_ sender: Any?) {
        let pasteboard = NSPasteboard.general
        if isEditable, let delegate = delegate as? MarkdownTextInput.Coordinator,
           pasteboard.string(forType: .string)?.isEmpty != false,
           let data = pasteboard.data(forType: .png) ?? pasteboard.data(forType: .tiff).flatMap({
               NSBitmapImageRep(data: $0)?.representation(using: .png, properties: [:])
           }) {
            delegate.parent.onImage(NodeImageUpload.Picture(data: data, name: "clipboard.png", mime: "image/png"))
            return
        }
        super.paste(sender)
    }

    override func becomeFirstResponder() -> Bool {
        let didFocus = super.becomeFirstResponder()
        if didFocus, let delegate = delegate as? MarkdownTextInput.Coordinator {
            Task { @MainActor in delegate.parent.editor.focused = true }
        }
        return didFocus
    }

    override func resignFirstResponder() -> Bool {
        let didResign = super.resignFirstResponder()
        if didResign, let delegate = delegate as? MarkdownTextInput.Coordinator {
            Task { @MainActor in delegate.parent.editor.focused = false }
        }
        return didResign
    }
}

private extension MarkdownCommand {
    var icon: String {
        switch self {
        case .bold: "bold"; case .italic: "italic"; case .strike: "strikethrough"; case .quote: "text.quote"
        case .bullets: "list.bullet"; case .numbers: "list.number"
        case .code: "chevron.left.chevron.right"
        case .codeBlock: "curlybraces.square"
        case .heading: "textformat.size"; case .table: "tablecells"; case .divider: "minus"
        case .link: "link"; case .image: "photo"
        }
    }
    var title: String {
        switch self {
        case .bold: "加粗"; case .italic: "斜体"; case .strike: "删除线"; case .quote: "引用"
        case .bullets: "无序列表"; case .numbers: "有序列表"; case .code: "行内代码"
        case .codeBlock: "代码块"; case .heading: "标题"; case .table: "表格"; case .divider: "分割线"
        case .link: "链接"; case .image: "图片链接"
        }
    }
}
