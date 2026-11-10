import SwiftUI
import WebKit

@MainActor
final class ForumInlineEdit: ObservableObject {
    struct Target: Equatable {
        let id = UUID()
        let topicID: Int
        let floor: Int
        let owner: Int

        var label: String { floor == 0 ? "编辑主题" : "编辑第 \(floor) 楼" }
        var arguments: [String: Int] { ["topicID": topicID, "floor": floor, "owner": owner] }
    }

    private struct Original: Decodable {
        let markdown: String
        let title: String?
    }

    @Published private(set) var target: Target?
    @Published private var original: Original?
    @Published private(set) var loading = false
    @Published private(set) var saving = false
    @Published private(set) var message: String?
    @Published private(set) var needsVerification = false
    @Published var title = ""
    @Published var content = ""
    let sizing = DraftImageSizing()

    var ready: Bool { original != nil }
    var canSave: Bool {
        guard let target, let original, !saving, !needsVerification,
              !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              target.floor != 0 || !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return false }
        return content != original.markdown || title != (original.title ?? "") || !sizing.sizes.isEmpty
    }

    func begin(_ target: Target) {
        guard !saving else { return }
        clear()
        self.target = target
    }

    func clear() {
        target = nil
        original = nil
        loading = false
        message = nil
        needsVerification = false
        title = ""
        content = ""
        sizing.reset()
    }

    func load(on page: ForumWebPage) async {
        guard let target, !loading, !ready else { return }
        loading = true
        message = nil
        let result = try? await page.webView.callAsyncJavaScript(Self.read,
            arguments: target.arguments, in: nil, contentWorld: .page)
        guard self.target == target else { return }
        loading = false
        guard let json = result as? String,
              let original = try? JSONDecoder().decode(Original.self, from: Data(json.utf8)) else {
            message = "暂时无法读取这一楼的原始 Markdown，请刷新帖子后重试。"
            return
        }
        title = original.title ?? ""
        content = original.markdown
        self.original = original
    }

    func save(on page: ForumWebPage, authorized: () -> Bool) async -> Bool {
        guard let target, canSave else { return false }
        saving = true
        message = nil
        defer { if self.target == target { saving = false } }
        let prepared: String
        do { prepared = try await sizing.prepare(content) }
        catch {
            guard authorized(), self.target == target else { return false }
            message = (error as? NodeImageError ?? .connection).localizedDescription + " 修改已保留。"
            return false
        }
        guard authorized(), self.target == target else {
            return false
        }
        var arguments: [String: Any] = target.arguments
        arguments["title"] = title.trimmingCharacters(in: .whitespacesAndNewlines)
        arguments["content"] = prepared
        let value = try? await page.webView.callAsyncJavaScript(Self.write,
            arguments: arguments, in: nil, contentWorld: .page)
        guard authorized(), self.target == target else { return false }
        guard let raw = value as? String, let response = try? JSONDecoder().decode(Response.self, from: Data(raw.utf8)) else {
            message = "未收到保存结果。请刷新确认修改是否已生效，再决定是否重试。"
            return false
        }
        switch response.kind {
        case "saved": return true
        case "verification":
            needsVerification = true
            message = "请先完成 NodeSeek 站点验证，修改已保留。"
        case "signedOut": message = "登录已失效，请重新登录。修改已保留。"
        case "rejected": message = response.message ?? "NodeSeek 拒绝了这次修改，草稿已保留。"
        case "unavailable": message = "原帖或编辑权限已变更，请刷新帖子后重试。修改已保留。"
        default: message = "未收到保存结果。请刷新确认修改是否已生效，再决定是否重试。"
        }
        return false
    }

    func continueAfterVerification() { needsVerification = false }

    private struct Response: Decodable { let kind: String; let message: String? }

    private static let context = #"""
    const path = /^\/post-(\d+)-\d+\/?$/.exec(location.pathname);
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        Number(path?.[1]) !== topicID) return null;
    const config = window.__config__;
    const data = config?.postData;
    const item = Array.isArray(data?.comments) && data.comments.find(comment => Number(comment.floorIndex) === floor);
    const owned = Number(config?.user?.member_id) === owner && Number(data?.postId) === topicID && item?.poster?.isMe;
    """#

    private static let read = context + "\n" + #"""
    if (!owned || typeof item.markdown !== 'string') return null;
    if (floor === 0 && typeof data.title !== 'string') return null;
    return JSON.stringify({markdown:item.markdown, title:floor === 0 ? data.title : null});
    """#

    private static let write = context + "\n" + #"""
    if (!config?.user) return JSON.stringify({kind:'signedOut'});
    if (!owned) return JSON.stringify({kind:'unavailable'});
    const mode = floor === 0 ? 'edit-discussion' : 'edit-comment';
    const body = {mode, content};
    if (floor === 0) {
        const rank = Number(data.rank);
        if (!title || data.rank == null || !Number.isSafeInteger(rank) || rank < 0) return JSON.stringify({kind:'unavailable'});
        Object.assign(body, {postId:topicID, title, rank});
    } else {
        const commentId = Number(item.commentId);
        if (!Number.isSafeInteger(commentId) || commentId <= 0) return JSON.stringify({kind:'unavailable'});
        body.commentId = commentId;
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => alphabet[n % alphabet.length]).join('');
    try {
        const response = await fetch('/api/content/' + mode, {
            method:'POST', credentials:'same-origin', redirect:'error', signal:AbortSignal.timeout(20000),
            headers:{'Content-Type':'application/json','csrf-token':token}, body:JSON.stringify(body)
        });
        if (response.headers.get('cf-mitigated') === 'challenge') return JSON.stringify({kind:'verification'});
        if (response.status === 401) return JSON.stringify({kind:'signedOut'});
        const result = await response.json().catch(() => null);
        if (response.ok && result?.success === true) return JSON.stringify({kind:'saved'});
        if (result?.success === false || [403,429].includes(response.status)) {
            return JSON.stringify({kind:'rejected',message:typeof result?.message === 'string' ? result.message : null});
        }
    } catch {}
    return JSON.stringify({kind:'unknown'});
    """#
}
