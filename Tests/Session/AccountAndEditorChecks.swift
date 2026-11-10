import Foundation
import JavaScriptCore

func checkProfileIntroduction() {
    let context = JSContext()!
    context.exceptionHandler = { _, error in fatalError("Profile introduction script: \(error?.toString() ?? "unknown error")") }
    context.evaluateScript(#"""
    var result, sent = [], fail = false;
    var location = {protocol:'https:', host:'www.nodeseek.com'};
    var detail = {member_id:7, bio:'已有简介', signature_markdown:'原签名', readme:'原说明'};
    var original = {signature:'原签名', readme:'原说明'};
    var window = {__config__:{user:{member_id:7}}, markdownit:function() { this.render = text => text; }};
    var AbortSignal = {timeout:_ => ({})};
    var fetch = async (url, options) => {
        sent.push({url, options});
        if (options.method === 'POST' && fail) throw new Error('timeout');
        return {ok:true, status:200, headers:{get:()=>null}, json:async()=>({success:true, detail})};
    };
    """#)
    context.evaluateScript("var request = async (owner, draft, original) => {\n\(ForumIntroductionScript.request)\n};")
    func run(_ action: String, setup: String = "") {
        context.evaluateScript("sent = []; \(setup); \(action).then(raw => result = JSON.parse(raw));")
    }
    func check(_ expression: String) { precondition(context.evaluateScript(expression).toBool(), expression) }
    run("request(7, null, null)")
    check("result.kind === 'ready' && result.data.signature === '原签名' && result.data.readme === '原说明' && sent.length === 1")
    check("sent[0].url === '/api/account/getInfo/7?readme=1&signature=1' && !sent[0].options.method")
    run("request(8, original, original)")
    check("result.kind === 'signedOut' && sent.length === 0")
    run("request(7, {...original, readme:'# 新说明'}, original)", setup: "detail.bio = '新简介'; detail.signature_markdown = '外部签名'")
    check("result.kind === 'saved' && sent.length === 2 && sent[1].url === '/api/account/introduction'")
    check("sent[1].options.method === 'POST' && result.data.bio === '新简介' && result.data.signature === '外部签名' && result.data.readme === '# 新说明'")
    check("JSON.parse(sent[1].options.body).bio === '新简介' && JSON.parse(sent[1].options.body).signature === '外部签名'")
    run("request(7, {...original, signature:'想改的签名'}, original)")
    check("result.kind === 'conflict' && sent.length === 1")
    run("request(7, {...original, readme:'已经保存'}, original)", setup: "detail.readme = '已经保存'")
    check("result.kind === 'saved' && sent.length === 1")
    run("request(7, {...original, signature:'<img src=x>'}, original)", setup: "detail.signature_markdown = '原签名'")
    check("result.kind === 'rejected' && sent.length === 1")
    run("request(7, {...original, signature:'新增签名'}, original)", setup: "fail = true")
    check("result.kind === 'unknown' && sent.length === 2")
    print("Passed profile README and signature reads, ownership, preservation, conflict and save checks.")
}

func checkAccountAndEditor() {
    let context = JSContext()!
    context.exceptionHandler = { _, error in fatalError("Account script: \(error?.toString() ?? "unknown error")") }
    context.evaluateScript(#"""
    var result, hit;
    var location = {protocol:'https:',host:'www.nodeseek.com'};
    var document = {querySelector: () => ({})};
    var window = {__config__:{user:{member_id:7,member_name:'tester'},commmentPerPage:10}};
    var AbortController = class { constructor(){ this.signal = {}; } abort() {} };
    var setTimeout = () => 1, clearTimeout = () => {};
    var fetch = async (url, options) => {
        hit = {url, options};
        let response;
        if (url === '/api/account/getInfo/7') response = {success:true,detail:{member_id:7,member_name:'tester',rank:2,nPost:3}};
        if (url === '/api/notification/at-me/list' || url === '/api/notification/reply-to-me/list') {
            response = {success:true,data:[{id:1,commenter_id:3,commenter_name:'member',post_id:101,floor_id:11,title:'topic',viewed:0}]};
        }
        if (url === '/api/notification/message/list') response = {success:true,msgArray:[
            {sender_id:7, receiver_id:11, receiver_name:'peer', content:'older', created_at:'2025-01-01T00:00:00Z'},
            {sender_id:11, receiver_id:7, sender_name:'peer', content:'newer', viewed:'0', created_at:'2025-01-02T00:00:00Z'},
            {sender_id:9, receiver_id:8, content:'unexpected'}
        ]};
        if (url === '/api/notification/message/with/11') response = {success:true,msgArray:[
            {id:1,sender_id:7,receiver_id:11,content:'**bold**',is_markdown:1},
            {id:2,sender_id:11,receiver_id:7,content:'plain',is_markdown:0},
            {id:3,sender_id:10,receiver_id:7,content:'different peer'}
        ]};
        return {status:response?200:401,ok:!!response,headers:{get:()=>null},json:async()=>response};
    };
    """#)
    context.evaluateScript("var identity = () => {\(ForumAccountScript.identity)};")
    let identity = try! JSONDecoder().decode(ForumIdentity.self, from: Data(context.evaluateScript("identity()").toString().utf8))
    precondition(identity.signedIn && identity.id == 7 && identity.floorsPerPage == 10)
    context.evaluateScript("var read = async (route, selfID, peerID) => {\(ForumAccountScript.read)};")
    func run(_ route: String, peer: Int = 0, selfID: Int = 7) {
        context.evaluateScript("read('\(route)',\(selfID),\(peer)).then(value => result = JSON.parse(value));")
        precondition(context.evaluateScript("hit.options.method === 'GET' && hit.options.credentials === 'same-origin'").toBool())
    }
    run("profile")
    precondition(context.evaluateScript("result.data.id === 7 && result.data.topics === 3").toBool())
    for route in ["mentions", "replies"] {
        run(route)
        let bytes = Data(context.evaluateScript("JSON.stringify(result.data)").toString().utf8)
        let notice = try! JSONDecoder().decode([ForumNotice].self, from: bytes)[0]
        precondition(notice.unread && notice.destination(floorsPerPage: 10).absoluteString == "https://www.nodeseek.com/post-101-2#11")
    }
    run("messages")
    precondition(context.evaluateScript("result.data.length === 1 && result.data[0].id === 11 && result.data[0].unread && result.data[0].preview === 'newer'").toBool())
    run("conversation", peer: 11)
    precondition(context.evaluateScript("result.data.length === 2 && result.data[0].mine && result.data[0].markdown && !result.data[1].mine").toBool())
    run("profile", selfID: 8)
    precondition(context.evaluateScript("result.kind === 'signedOut'").toBool())
    context.evaluateScript("var attend = async (randomMode) => {\(ForumAccountScript.attendance)};")
    context.evaluateScript(#"""
    var attendanceReply = {success:true, gain:5, current:"110"};
    fetch = async (url, options) => {
        hit = {url, options};
        return {status:200,ok:true,headers:{get:()=>null},json:async()=>attendanceReply};
    };
    attend(false).then(value => result = JSON.parse(value));
    """#)
    precondition(context.evaluateScript("""
        hit.url === '/api/attendance?random=false' && hit.options.method === 'POST' &&
        hit.options.credentials === 'same-origin' && result.kind === 'completed' && result.gain === 5 && result.current === 110
        """).toBool())
    context.evaluateScript("""
        attendanceReply = {success:false, message:'请勿重复签到'};
        attend(true).then(value => result = JSON.parse(value));
        """)
    precondition(context.evaluateScript("hit.url === '/api/attendance?random=true' && result.kind === 'alreadyCompleted'").toBool())
    context.evaluateScript("""
        attendanceReply = {success:true, message:'签到成功，获得 8 个鸡腿', current:118};
        attend(true).then(value => result = JSON.parse(value));
        """)
    precondition(context.evaluateScript("result.kind === 'completed' && result.gain === 8").toBool())
    let utc = ISO8601DateFormatter()
    let beforeMidnight = utc.date(from: "2026-11-09T15:59:59Z")!
    let midnight = utc.date(from: "2026-11-09T16:00:00Z")!
    precondition(ForumAttendanceDay.next(after: beforeMidnight) == midnight)
    precondition(ForumAttendanceDay.start(midnight) == midnight)
    let anchored = URL(string: "https://www.nodeseek.com/post-101-2#11")!
    precondition(Forum.pageURL(anchored).absoluteString == "https://www.nodeseek.com/post-101-2")

    let sample = "前🎉后"
    let bold = MarkdownCommand.bold.edit(source: sample, selection: NSRange(location: 1, length: 2))!
    let boldText = (sample as NSString).replacingCharacters(in: bold.replaced, with: bold.text) as NSString
    precondition(boldText as String == "前**🎉**后" && boldText.substring(with: bold.selected) == "🎉")
    let lines = "甲\n乙\n丙"
    let list = MarkdownCommand.numbers.edit(source: lines, selection: NSRange(location: 0, length: 3))!
    precondition((lines as NSString).replacingCharacters(in: list.replaced, with: list.text) == "1. 甲\n2. 乙\n丙")
    let link = MarkdownCommand.link.edit(source: "链接", selection: NSRange(location: 0, length: 2))!
    precondition(link.text == "[链接](https://)" && (link.text as NSString).substring(with: link.selected) == "https://")
    let code = MarkdownCommand.code.edit(source: "`a`\nend", selection: NSRange(location: 0, length: 7))!
    precondition(code.text == "```\n`a`\nend\n```" && (code.text as NSString).substring(with: code.selected) == "`a`\nend")
    context.evaluateScript("var send = async (peerID, content, markdown) => {\(ForumAccountScript.sendMessage)};")
    context.evaluateScript("""
    fetch = async (url, options) => {
        hit = {url, options};
        return {status:200,ok:true,headers:{get:()=>null},json:async()=>({success:true})};
    };
    send(11, '**test**', true).then(value => result = JSON.parse(value));
    """)
    precondition(context.evaluateScript("""
    result.kind === 'sent' && hit.url === '/api/notification/message/send' && hit.options.method === 'POST' &&
    hit.options.credentials === 'same-origin' && JSON.parse(hit.options.body).receiverUid === 11 &&
    JSON.parse(hit.options.body).markdown === true && JSON.parse(hit.options.body).content === '**test**'
    """).toBool())
    context.evaluateScript("location.host = 'other.example'; hit = null; send(11, 'x', false).then(value => result = JSON.parse(value));")
    precondition(context.evaluateScript("result.kind === 'unavailable' && hit === null").toBool())

    context.evaluateScript("var unread = async () => {\(ForumAccountScript.unread)};")
    context.evaluateScript("""
    location.host = 'www.nodeseek.com';
    fetch = async () => ({ok:true,json:async()=>({success:true, unreadCount:{atMe:0, reply:2, message:1}})});
    unread().then(value => result = value);
    """)
    let unread = try! JSONDecoder().decode(ForumUnreadCounts.self, from: Data(context.evaluateScript("result").toString().utf8))
    precondition(unread.total == 3 && unread.count(.replies) == 2 && unread.count(.mentions) == 0)

    context.evaluateScript("var mark = async (route, itemID, selfID) => {\(ForumAccountScript.markRead)};")
    context.evaluateScript("""
    var markCalls = [];
    fetch = async (url, options) => {
        markCalls.push({url, method:options.method || 'GET', body:options.body ? JSON.parse(options.body) : null, credentials:options.credentials});
        if (url.endsWith('/with/11')) {
            return {ok:true,json:async()=>({success:true,msgArray:[
                {id:101,sender_id:11,receiver_id:7,viewed:0},
                {id:102,sender_id:11,receiver_id:7,viewed:'0'},
                {id:102,sender_id:11,receiver_id:7,viewed:false},
                {id:103,sender_id:11,receiver_id:7,viewed:1},
                {id:104,sender_id:7,receiver_id:11,viewed:0},
                {id:105,sender_id:99,receiver_id:7,viewed:0}
            ]})};
        }
        return {ok:true,json:async()=>({success:true})};
    };
    mark('replies', 19, 7).then(value => result = JSON.parse(value));
    """)
    precondition(context.evaluateScript("""
    result.kind === 'read' && result.count === 1 && markCalls.length === 1 &&
    markCalls[0].url === '/api/notification/reply-to-me/markViewed' &&
    markCalls[0].method === 'POST' && markCalls[0].credentials === 'same-origin' &&
    JSON.stringify(markCalls[0].body) === '{"replys":[19]}'
    """).toBool())
    context.evaluateScript("markCalls = []; mark('mentions', 22, 7).then(value => result = JSON.parse(value));")
    precondition(context.evaluateScript("result.kind === 'read' && markCalls[0].url === '/api/notification/at-me/markViewed' && JSON.stringify(markCalls[0].body) === '{\"atMe\":[22]}'").toBool())
    context.evaluateScript("markCalls = []; mark('messages', 11, 7).then(value => result = JSON.parse(value));")
    precondition(context.evaluateScript("""
    result.kind === 'read' && result.count === 2 && markCalls.length === 2 &&
    markCalls[0].method === 'GET' && markCalls[1].url === '/api/notification/message/markViewed' &&
    JSON.stringify(markCalls[1].body) === '{"messages":[101,102]}'
    """).toBool())
    context.evaluateScript("markCalls = []; mark('all', 19, 7).then(value => result = JSON.parse(value));")
    precondition(context.evaluateScript("result.kind === 'unavailable' && markCalls.length === 0").toBool())
    context.evaluateScript("fetch = async () => ({ok:true,json:async()=>({success:false})}); mark('replies', 19, 7).then(value => result = JSON.parse(value));")
    precondition(context.evaluateScript("result.kind === 'failed' && result.count === null").toBool())
    var updatedUnread = unread
    updatedUnread.markRead(.replies, count: 1)
    precondition(updatedUnread.total == 2 && updatedUnread.replies == 1 && updatedUnread.messages == 1)
    updatedUnread.markRead(.messages, count: 4)
    precondition(updatedUnread.total == 1 && updatedUnread.messages == 0)

    let report = ForumTerminalANSI.lines("\u{1B}[1m硬件[0m [32m正常\n续行[0m")
    precondition(report.count == 2 && report[0][0].text == "硬件" && report[0][0].bold)
    precondition(report[0].last?.foreground == report[1][0].foreground)
    precondition(report[1][0].text == "续行" && report[1][0].foreground != nil)
    let rawReport = ForumTerminalANSI.lines("[36m硬件\u{009B}0m\n\u{1B}[38:2::72:180:234m网络")
    precondition(rawReport[0].count == 1 && rawReport[0][0].text == "硬件")
    precondition(rawReport[1].first?.foreground == "rgb(72,180,234)")

    let floor = ForumFloor(id: "19", author: "User", authorID: 8, isAuthor: false, avatar: nil, tags: nil,
        date: "", dateLabel: "", blocks: [.init(kind: "text", text: "第一行\n第二行", url: nil, tabs: nil, rows: nil, terminal: nil)])
    let page = URL(string: "https://www.nodeseek.com/post-101-2#12")!
    let quoted = ForumFloorDraft.insertion(for: floor, in: page, quoting: true, after: "已有草稿")!
    precondition("已有草稿" + quoted == "已有草稿\n\n> @User [#19](https://www.nodeseek.com/post-101-2#19)\n>\n> 第一行\n> 第二行\n\n")
    let reply = ForumFloorDraft.insertion(for: floor, in: page, quoting: false, after: "")!
    precondition(reply == "@User [#19](https://www.nodeseek.com/post-101-2#19)\n\n")
    let thread = ForumThread(title: "", category: "", root: nil, replies: [floor], pages: [], page: 2, replyRestriction: nil)
    let notice = ForumNotice(id: "test", author: "User", authorID: 8, title: "", date: "", unread: true, postID: 101, floor: 19)
    precondition(notice.reply(in: thread) == floor)
    precondition(notice.destination(floorsPerPage: 20).lastPathComponent == "post-101-1")
    let otherAuthor = ForumNotice(id: "other", author: "Other", authorID: 12, title: "", date: "", unread: true, postID: 101, floor: 19)
    precondition(otherAuthor.reply(in: thread) == nil)

    let picture = NodeImageUpload.Picture(data: Data([0x89, 0x50, 0x4E, 0x47]), name: "clipboard.png", mime: "image/png")
    let (request, body) = NodeImageUpload.multipart(picture, key: "fixture-key", boundary: "fixture")
    precondition(request.url?.host == "api.nodeimage.com" && request.httpMethod == "POST")
    precondition(request.value(forHTTPHeaderField: "X-API-Key") == "fixture-key")
    precondition(body.range(of: Data("name=\"image\"; filename=\"clipboard.png\"".utf8)) != nil)
    let validImage = try! NodeImageUpload.link(from: Data(#"{"success":true,"links":{"direct":"https://nodeimage.com/i/mock.png"}}"#.utf8))
    precondition(validImage.path == "/i/mock.png")
    let invalidImage = try? NodeImageUpload.link(from: Data(#"{"success":true,"links":{"direct":"javascript:alert(1)"}}"#.utf8))
    precondition(invalidImage == nil)
    precondition(ForumSearch.matches(ForumSearch.terms("绿云，vmisS"), in: ["绿云 VMISS 转让"]))
    precondition(ForumSearch.matches(ForumSearch.terms("vmsis"), in: ["VMISS 回程"]))
    precondition(!ForumSearch.matches(ForumSearch.terms("vmsis 日本"), in: ["VMISS 美国"]))
    print("Passed account reads, simulated private-message send and NodeImage, fuzzy search and Markdown checks.")
}
