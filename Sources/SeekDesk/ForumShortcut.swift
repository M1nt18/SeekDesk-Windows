import SwiftUI
import WebKit

struct ForumShortcutPane: View {
    let shortcut: ForumShortcut
    @ObservedObject var session: ForumSession
    let palette: DeskPalette
    let openTopic: (URL) -> Bool
    @StateObject private var state = PageState()

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                DeskLabel(shortcut.title, systemImage: shortcut.icon)
                    .font(.system(size: 20, weight: .semibold)).accessibilityAddTraits(.isHeader)
                Spacer()
                Text("NodeSeek 官方页面").font(.caption).foregroundStyle(.secondary)
                Link(destination: shortcut.url) {
                    DeskIcon("arrow.up.right.square").frame(width: 30, height: 28)
                }
                .buttonStyle(DeskButtonStyle())
                .accessibilityLabel("在浏览器打开\(shortcut.title)")
                .help("在浏览器打开")
            }
            .padding(.horizontal, 18).frame(height: 53)
            .background(palette.chrome)
            Rectangle().fill(palette.line).frame(height: 1)
            ZStack {
                ShortcutWebView(shortcut: shortcut, session: session, state: state, openTopic: openTopic)
                    .opacity(state.phase == .ready ? 1 : 0)
                    .accessibilityHidden(state.phase != .ready)
                switch state.phase {
                case .loading:
                    ProgressView("正在读取\(shortcut.title)…").controlSize(.small)
                case .failed:
                    ContentUnavailableView {
                        DeskLabel("暂时无法打开\(shortcut.title)", systemImage: "wifi.exclamationmark", size: 32)
                    } actions: {
                        Button("重试") { state.revision += 1 }
                    }
                case .ready: EmptyView()
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(palette.reader)
        }
    }

    @MainActor final class PageState: ObservableObject {
        enum Phase { case loading, ready, failed }
        @Published var phase: Phase = .loading
        @Published var revision = 0
    }
}

private struct ShortcutWebView: NSViewRepresentable {
    let shortcut: ForumShortcut
    let session: ForumSession
    let state: ForumShortcutPane.PageState
    let openTopic: (URL) -> Bool

    @MainActor final class Coordinator {
        let page: ForumWebPage
        var loadedRevision: Int?
        var load: Task<Void, Never>?

        init(_ page: ForumWebPage) { self.page = page }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(ForumWebPage(dataStore: session.dataStore))
    }

    func makeNSView(context: Context) -> WKWebView {
        context.coordinator.page.didSettle = {}
        return context.coordinator.page.webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        let coordinator = context.coordinator
        coordinator.page.openTopic = openTopic
        guard coordinator.loadedRevision != state.revision else { return }
        coordinator.loadedRevision = state.revision
        coordinator.load = Task {
            state.phase = .loading
            do {
                try await coordinator.page.read(shortcut.url)
                try Task.checkCancellation()
                state.phase = coordinator.page.challenged || (coordinator.page.status ?? 200) < 400 ? .ready : .failed
            } catch is CancellationError {
            } catch {
                if !Task.isCancelled { state.phase = coordinator.page.challenged ? .ready : .failed }
            }
        }
    }

    static func dismantleNSView(_ webView: WKWebView, coordinator: Coordinator) {
        coordinator.load?.cancel()
        coordinator.page.openTopic = nil
        webView.stopLoading()
    }
}
