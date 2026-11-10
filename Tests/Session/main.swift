import Foundation

let a = URL(string: "https://www.nodeseek.com/post-101-1")!
let b = URL(string: "https://www.nodeseek.com/post-102-1")!
let aPage = URL(string: "https://www.nodeseek.com/post-101-3")!
let floor = URL(string: "https://www.nodeseek.com/post-101-5#comment-20")!
let outsider = URL(string: "https://www.nodeseek.com.evil.example/post-101-1")!
var session = ReadingSession()

session.open(a, title: "A", background: false)
session.update("101") { $0.url = aPage; $0.scroll = 640; $0.draft = "A draft" }
session.open(b, title: "B", background: true)
precondition(session.selection == "101")
session.select("102")
session.update("102") { $0.draft = "B draft" }
session.open(a, title: "", background: false)
precondition(session.topics.count == 2)
precondition(session.selectedTopic?.url == aPage && session.selectedTopic?.scroll == 640)
precondition(session.selectedTopic?.draft == "A draft")
session.close("101")
precondition(session.selectedTopic?.draft == "B draft")
session.open(a, title: "A", background: false)
session.open(floor, title: "", background: false)
precondition(session.selectedTopic?.url == floor && session.selectedTopic?.scroll == 0)
session.open(outsider, title: "", background: false)
precondition(session.topics.count == 2)
precondition(session.move("101", to: "102"))
precondition(session.topics.map(\.id) == ["101", "102"] && session.selection == "101")
let restored = try JSONDecoder().decode(ReadingSession.self, from: JSONEncoder().encode(session))
precondition(restored.topics == session.topics && restored.selection == session.selection)
precondition(URLComponents(url: Forum.search("线路 & PVE"), resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "线路 & PVE")
precondition(Forum.memberID(from: " 37891 ") == 37891)
precondition(Forum.memberID(from: "https://www.nodeseek.com/space/37891#/discussions/1") == 37891)
precondition(Forum.memberID(from: "https://www.nodeseek.com.evil.example/space/37891") == nil)
print("Passed topic identity, background open, draft restore, recent tab, floor link and persistence checks.")

let feed = """
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel><category>daily</category>
    <item><title><![CDATA[测试 & PVE]]></title><description>小主机 &amp; 服务器</description>
      <link>https://www.nodeseek.com/post-101-1</link><category>tech</category>
      <dc:creator><![CDATA[racknote]]></dc:creator><pubDate>Mon, 09 Nov 2026 09:30:28 GMT</pubDate>
    </item>
    <item><title>重复条目</title><link>https://www.nodeseek.com/post-101-2</link></item>
    <item><title>站外条目</title><link>https://example.com/post-102-1</link></item>
  </channel>
</rss>
"""
let posts = try ForumFeed.parse(Data(feed.utf8))
precondition(posts.count == 1)
let post = posts[0]
precondition(post.id == "101" && post.title == "测试 & PVE" && post.summary == "小主机 & 服务器")
precondition(post.author == "racknote" && post.category == "tech" && post.published != nil)
precondition((try? ForumFeed.parse(Data("<html>Forbidden</html>".utf8))) == nil)

let oldSession = """
{"topics":[{"id":"101","url":"https://www.nodeseek.com/post-101-1","title":"旧标签","scroll":0,"draft":""}],"selection":"101","recent":["101"]}
"""
var migrated = try JSONDecoder().decode(ReadingSession.self, from: Data(oldSession.utf8))
precondition(migrated.selectedTopic?.label == "旧标签" && migrated.selectedTopic?.preview == nil)
migrated.update(post.id) { $0.preview = post }
let savedPreview = try JSONDecoder().decode(ReadingSession.self, from: JSONEncoder().encode(migrated))
precondition(savedPreview.selectedTopic?.preview == post)
print("Passed RSS parsing, invalid responses and existing tab migration checks.")

await checkWorkspace()
checkBlockConfirmation()
await checkKeywordWatch()
checkForumReplies()
checkForumReactions()
checkAccountAndEditor()
checkProfileIntroduction()
let ruling = try JSONDecoder().decode(RulingRecord.self, from: Data(#"""
{"record_id":123,"reason_text":"原因","actions_text":"管理 2/25/2026, 11:30:00 PM","action_category":"punish","action_points_delta":-10,"post_url":"https://www.nodeseek.com/post-101-1#0"}
"""#.utf8))
precondition(ruling.kind == .punish && ruling.beijingActions == "管理 2026-02-26 07:30:00（北京时间）")
precondition(ruling.postURL?.fragment == "0")
let rulingAddress = RulingClient.request(for: "示例+test").flatMap { $0.url }
precondition(rulingAddress?.absoluteString.contains("%2Btest") == true)
let rulingQuery = rulingAddress.flatMap {
    URLComponents(url: $0, resolvingAgainstBaseURL: false)?.queryItems
}
precondition(rulingQuery == [URLQueryItem(name: "username", value: "示例+test"), URLQueryItem(name: "limit", value: "200")])
print("Passed NS Seek record decoding, Beijing time rollover and query data checks.")
try checkRemainingValue()

try checkDiscussion()
checkReportSizing()
