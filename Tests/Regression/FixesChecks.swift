import AppKit
import ImageIO
import JavaScriptCore
import UniformTypeIdentifiers
import WebKit

@main struct FixesChecks {
    @MainActor static func main() async throws {
        try await accounts()
        try await profiles()
        try markdownAndReports()
        try images()
        unread()
        print("Passed all F01–F09 regression checks without forum requests or user data changes.")
    }

    @MainActor static func accounts() async throws {
        let suite = "SeekDesk.regression.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        func profile(_ id: Int) -> ForumProfile {
            .init(id: id, name: "Account \(id)", rank: 2, joined: nil, bio: nil, topics: nil,
                  replies: nil, following: nil, followers: nil, coin: nil)
        }
        func login(_ session: ForumSession, _ id: Int) {
            session.observeAccount(true)
            session.updateOwnProfile(profile(id))
        }
        let session = ForumSession(defaults: defaults, dataStore: .nonPersistent())
        login(session, 7)
        let image = URL(string: "https://example.com/report.png")!
        session.edit("A reply", for: "101")
        session.messageDrafts[11] = "A private message"
        session.newDiscussion.title = "A title"
        session.newDiscussion.content = "A discussion"
        session.imageSizing(for: .reply("101")).set(0.5, previewWidth: 640, for: image)
        session.newDiscussion.imageSizing.set(0.75, previewWidth: 500, for: image)
        let oldDiscussion = session.newDiscussion
        let oldToken = session.authorization
        session.observeAccount(false)
        precondition(session.drafts.isEmpty && session.messageDrafts.isEmpty && session.newDiscussion.content.isEmpty)
        precondition(!session.authorizes(oldToken))
        login(session, 8)
        precondition(session.drafts.isEmpty && session.messageDrafts.isEmpty && session.newDiscussion.content.isEmpty)
        oldDiscussion.content = "delayed editor result"
        session.edit("B reply", for: "101")
        session.observeAccount(false)
        login(session, 7)
        precondition(session.drafts["101"] == "A reply" && session.messageDrafts[11] == "A private message")
        precondition(session.newDiscussion.content == "A discussion" && session.newDiscussion.title == "A title")
        precondition(session.imageSizing(for: .reply("101")).sizes[image]?.ratio == 0.5)
        precondition(session.newDiscussion.imageSizing.sizes[image]?.ratio == 0.75)
        let restored = ForumSession(defaults: defaults, dataStore: .nonPersistent())
        precondition(restored.drafts.isEmpty && restored.newDiscussion.content.isEmpty)
        login(restored, 7)
        precondition(restored.drafts["101"] == "A reply" && restored.messageDrafts[11] == "A private message")
        precondition(restored.newDiscussion.content == "A discussion")
        restored.edit("", for: "101")
        let restoredAgain = ForumSession(defaults: defaults, dataStore: .nonPersistent())
        login(restoredAgain, 7)
        precondition(restoredAgain.drafts["101"] == nil)
        print("Passed F01/F04 owner-scoped reply, DM, discussion, image settings, relogin and restart persistence.")

        let url = URL(string: "https://www.nodeseek.com/post-101-1")!
        let topic = Topic(id: "101", url: url, title: "Restricted")
        let thread = ForumThread(title: "A restricted thread", category: "inside", root: nil, replies: [],
                                 pages: [], page: 1, replyRestriction: nil)
        session.cacheThread(thread, at: url)
        let reader = ForumReaderState(topic: topic, session: session)
        await reader.load(topic, session: session, fetch: { _, _ in throw ForumPageError.network })
        guard case .ready = reader.phase else { preconditionFailure("Same-account offline content should remain") }
        session.observeAccount(false)
        guard case .loading = reader.phase else { preconditionFailure("Logout must synchronously clear visible content") }
        login(session, 8)
        await reader.load(topic, session: session, fetch: { _, _ in throw ForumPageError.network })
        guard case .failed = reader.phase else { preconditionFailure("B must never fall back to A's content") }
        var authorized = true
        let row = FeedPost(id: "201", url: url, title: "A restricted title", author: "A", category: "inside", published: nil, summary: "")
        let workspace = Workspace(defaults: defaults, fetchFeed: { [] }, fetchPage: { _ in
            guard authorized else { throw ForumPageError.signInRequired }
            return ForumListingPage(posts: [row], next: nil)
        })
        workspace.choose(.inside)
        await workspace.refresh()
        precondition(workspace.filteredPosts.count == 1)
        authorized = false
        await workspace.refresh()
        precondition(workspace.filteredPosts.isEmpty)
        var listingContinuation: CheckedContinuation<ForumListingPage, Never>?
        let delayedList = Workspace(defaults: defaults, fetchFeed: { [] }, fetchPage: { _ in
            await withCheckedContinuation { listingContinuation = $0 }
        })
        delayedList.choose(.inside)
        let listTask = Task { await delayedList.refresh() }
        while listingContinuation == nil { await Task.yield() }
        delayedList.invalidateForumAccess()
        listingContinuation?.resume(returning: .init(posts: [row], next: nil))
        await listTask.value
        precondition(delayedList.filteredPosts.isEmpty)
        print("Passed F02 synchronous reader invalidation, same-account offline use and stale/restricted listings.")

        for response in [#"{"kind":"signIn"}"#, #"{"kind":"verification"}"#,
                         #"{"kind":"response","response":{"success":true,"redirect":"/post-101-1"}}"#] {
            var continuation: CheckedContinuation<String?, Never>?
            var completed = false
            let transport = ForumSession.Requests(reply: { _, _, _ in
                let result = await withCheckedContinuation { continuation = $0 }
                completed = true
                return result
            }, profile: { _, _, _ in nil })
            let pending = ForumSession(defaults: defaults, dataStore: .nonPersistent(), requests: transport)
            login(pending, 7)
            pending.edit("pending A reply", for: "101")
            let sendTask = pending.send(topic: topic, on: ForumWebPage(dataStore: pending.dataStore))
            while continuation == nil { await Task.yield() }
            pending.finishAccess(true)
            login(pending, 8)
            pending.edit("B current draft", for: "101")
            continuation?.resume(returning: response)
            await sendTask?.value
            precondition(completed)
            precondition(pending.account == .signedIn && pending.memberID == 8 && pending.ownProfile?.id == 8)
            precondition(pending.drafts["101"] == "B current draft" && pending.receipts.isEmpty)
        }
        print("Passed F03 delayed old-account reply success, sign-in failure and verification responses.")
    }

    @MainActor static func profiles() async throws {
        let suite = "SeekDesk.profile-regression.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        var count = 0
        var value: String?
        var now = Date()
        let requests = ForumSession.Requests(reply: { _, _, _ in nil }, profile: { _, _, _ in count += 1; return value })
        let session = ForumSession(defaults: defaults, dataStore: .nonPersistent(), requests: requests, profileNow: { now })
        let page = ForumWebPage(dataStore: session.dataStore)
        await session.loadProfile(42, using: page)
        precondition(session.profileFailures.contains(42) && !session.profileLoading.contains(42))
        value = #"{"member_id":42,"member_name":"fixture","bio":"old","readme":"old"}"#
        await session.loadProfile(42, using: page, includeReadme: true, force: true)
        precondition(session.profiles[42]?.bio == "old" && session.profileFailures.isEmpty)
        let loaded = count
        value = #"{"member_id":42,"member_name":"fixture","bio":"new","readme":"new"}"#
        await session.loadProfile(42, using: page, includeReadme: true)
        precondition(count == loaded)
        now = now.addingTimeInterval(181)
        await session.loadProfile(42, using: page, includeReadme: true)
        precondition(count == loaded + 1 && session.profiles[42]?.bio == "new")
        value = nil
        await session.loadProfile(42, using: page, force: true)
        precondition(session.profileFailures.contains(42) && session.profiles[42]?.bio == "new")
        print("Passed F09 cache expiry, force refresh, failure state, retry and stale-data retention.")
    }

    static func markdownAndReports() throws {
        let url = URL(string: "https://example.com/image(1).png")!
        for source in [#"![report](https://example.com/image(1).png)"#,
                       #"![a\]b](https://example.com/image(1).png)"#,
                       #"![nested [label]](<https://example.com/image(1).png> 'title')"#] {
            let inline = MarkdownPreviewDocument.inline(source)
            guard case .image(let parsed, _, false) = inline.first, inline.count == 1 else { preconditionFailure(source) }
            precondition(parsed == url)
            let references = MarkdownPreviewDocument.imageReferences(source, selected: [url])
            precondition(references.count == 1)
            let replacement = URL(string: "https://example.com/new.png")!
            precondition(MarkdownPreviewDocument.replacingImages(source, references: references, with: [url: replacement]).contains(replacement.absoluteString))
        }
        let selection = "a]b"
        let edit = MarkdownCommand.image.edit(source: selection, selection: NSRange(location: 0, length: selection.utf16.count))!
        let generated = edit.text.replacingOccurrences(of: "https://", with: "https://example.com/image.png")
        guard case .image(_, let label, _) = MarkdownPreviewDocument.inline(generated).first else { preconditionFailure(generated) }
        precondition(label == selection)
        let tick = String(UnicodeScalar(96))
        let example = "![report](https://example.com/image(1).png)"
        precondition(MarkdownPreviewDocument.imageReferences(tick + example + tick, selected: [url]).isEmpty)
        precondition(MarkdownPreviewDocument.imageReferences("~~~\n" + example + "\n~~~", selected: [url]).isEmpty)
        for count in [249, 250, 251, 300, 1500] {
            let input = (1...count).map { "report line \($0)" }.joined(separator: "\n")
            let lines = ForumTerminalANSI.lines(input)
            precondition(lines.count == count)
            precondition(lines.map { $0.map(\.text).joined() }.joined(separator: "\n") == input)
        }
        let longLine = String(repeating: "x", count: 250_001)
        precondition(ForumTerminalANSI.lines(longLine)[0].map(\.text).joined() == longLine)
        print("Passed F07/F08 escaped/nested Markdown images, editor roundtrip, code exclusions and complete long reports.")
    }

    static func images() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
        defer { try? FileManager.default.removeItem(at: file) }
        let width = 1000, height = 20000
        let data = Data(repeating: 180, count: width * height)
        let bitmap = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
            space: CGColorSpaceCreateDeviceGray(), bitmapInfo: [], provider: CGDataProvider(data: data as CFData)!,
            decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
        let output = CGImageDestinationCreateWithURL(file as CFURL, UTType.png.identifier as CFString, 1, nil)!
        CGImageDestinationAddImage(output, bitmap, nil)
        precondition(CGImageDestinationFinalize(output))
        let decoded = try ForumImageRequest.decode(file)
        precondition(decoded.image.width == width && decoded.image.height == height)
        precondition(decoded.originalSize == CGSize(width: width, height: height))
        let original = try ForumImageRequest.decode(file, kind: .original)
        precondition(original.image.width == width && original.image.height == height)
        let resized = try NodeImageUpload.resizedPicture(file: file, scale: .init(ratio: 0.5, previewWidth: 1000))
        let source = CGImageSourceCreateWithData(resized.data as CFData, nil)!
        let info = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as! [String: Any]
        precondition(info[kCGImagePropertyPixelWidth as String] as? Int == 500)
        precondition(info[kCGImagePropertyPixelHeight as String] as? Int == 10000)
        print("Passed F06 readable long-image decoding, original dimensions and proportional upload resizing.")
    }

    static func unread() {
        let context = JSContext()!
        context.exceptionHandler = { _, error in fatalError(error?.toString() ?? "JS failure") }
        context.evaluateScript(#"""
        var result, rows = [];
        var location = {protocol:'https:',host:'www.nodeseek.com'};
        var AbortController = class { constructor(){ this.signal = {}; } abort() {} };
        var setTimeout = () => 1, clearTimeout = () => {};
        var fetch = async () => ({status:200,ok:true,headers:{get:()=>null},json:async()=>({success:true,msgArray:rows})});
        """#)
        context.evaluateScript("var read = async (route, selfID, peerID) => {\(ForumAccountScript.read)};")
        for latest in ["{sender_id:7,receiver_id:11,created_at:'2026-11-10T02:00:00Z'}",
                       "{sender_id:11,receiver_id:7,viewed:1,created_at:'2026-11-10T02:00:00Z'}"] {
            for reverse in [false, true] {
                context.evaluateScript("rows=[{sender_id:11,receiver_id:7,viewed:0,created_at:'2026-11-10T01:00:00Z'},\(latest)]; \(reverse ? "rows.reverse();" : "") read('messages',7,0).then(v=>result=JSON.parse(v));")
                precondition(context.evaluateScript("result.data[0].unread && result.data[0].date === '2026-11-10T02:00:00Z'").toBool())
            }
        }
        print("Passed F05 unread aggregation independent of latest message and server ordering.")
    }
}
