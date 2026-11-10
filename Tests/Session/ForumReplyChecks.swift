import Foundation
import JavaScriptCore

func checkForumReplies() {
    let url = URL(string: "https://www.nodeseek.com/post-101-1")!
    let decoder = JSONDecoder()
    func decode(_ value: String) -> ForumReplyResponse { try! decoder.decode(ForumReplyResponse.self, from: Data(value.utf8)) }
    precondition(decode(##"{"success":true,"redirect":"/post-101-3","redirectHash":"#42"}"##).destination(from: url)?.absoluteString
                 == "https://www.nodeseek.com/post-101-3#42")
    precondition(decode(#"{"success":true,"redirect":"https://www.nodeseek.com.example.org/post-101-3"}"#).destination(from: url) == nil)
    precondition(decode(#"{"success":true,"redirect":"/post-104-3"}"#).destination(from: url) == nil)
    precondition(decode(#"{"success":false,"redirect":"/post-101-3"}"#).destination(from: url) == nil)
    precondition(decode(##"{"success":true,"redirectHash":"#comment-20"}"##).destination(from: url, floorsPerPage: 10)?.absoluteString
                 == "https://www.nodeseek.com/post-101-2#comment-20")

    // Run the actual bridge with an in-memory response, without connecting to the forum.
    let context = JSContext()!
    context.exceptionHandler = { _, error in fatalError("Reply script: \(error?.toString() ?? "unknown error")") }
    context.evaluateScript(#"""
    var result = null, sent = null, scenario = 'accepted';
    var location = {protocol:'https:', host:'www.nodeseek.com', pathname:'/post-101-1'};
    var document = {querySelector: () => ({})};
    var crypto = {getRandomValues: values => values.fill(8)};
    var AbortSignal = {timeout: _ => ({})};
    var fetch = async (url, options) => {
        sent = {url, options};
        if (scenario === 'timeout') throw new Error('timeout');
        return {
            status: scenario === 'expired' ? 401 : 200,
            ok: scenario === 'accepted' || scenario === 'rejected',
            headers: {get: field => scenario === 'challenge' && field === 'cf-mitigated' ? 'challenge' : null},
            json: async () => scenario === 'accepted' ? {success:true, redirect:'/post-101-3', redirectHash:42} : {success:false, message:'只读'}
        };
    };
    """#)
    context.evaluateScript("var submit = async (postId, content) => {\n\(ForumPageScript.reply)\n};")
    context.evaluateScript(#"submit(101, '回复 \"原文\"\n`a`').then(value => result = JSON.parse(value));"#)
    precondition(context.evaluateScript(#"result.kind === 'response' && result.response.success && result.response.redirectHash === '42'"#).toBool())
    precondition(context.evaluateScript(#"""
    sent.url === '/api/content/new-comment' && sent.options.method === 'POST' && sent.options.credentials === 'same-origin' &&
    /^[a-zA-Z0-9]{16}$/.test(sent.options.headers['csrf-token']) && JSON.parse(sent.options.body).content === '回复 \"原文\"\n`a`' &&
    JSON.parse(sent.options.body).postId === 101 && JSON.parse(sent.options.body).mode === 'new-comment'
    """#).toBool())
    for (scenario, assertion) in [("rejected", "result.kind === 'response' && result.response.message === '只读'"),
                                  ("expired", "result.kind === 'signIn'"), ("challenge", "result.kind === 'verification'"),
                                  ("timeout", "result.kind === 'unknown'")] {
        context.evaluateScript("scenario = '\(scenario)'; submit(101, 'draft').then(value => result = JSON.parse(value));")
        precondition(context.evaluateScript(assertion).toBool())
    }
    context.evaluateScript("sent = null; submit(104, 'draft').then(value => result = JSON.parse(value));")
    precondition(context.evaluateScript("sent === null && result.kind === 'unavailable'").toBool())
    print("Passed NodeSeek reply request, success, rejection, verification, expiry, timeout and destination checks.")
}

func checkForumReactions() {
    let context = JSContext()!
    context.exceptionHandler = { _, error in fatalError("Reaction script: \(error?.toString() ?? "unknown error")") }
    context.evaluateScript(#"""
    var sent = [], result = null, quota = 1, scenario = 'accepted';
    var location = {protocol:'https:', host:'www.nodeseek.com', pathname:'/post-101-2'};
    var row = {floorIndex:12, commentId:314, upvoteCount:2, likeCount:1, dislikeCount:0};
    var window = {__config__:{user:{member_id:7},postData:{postId:101,comments:[row]}}};
    var AbortSignal = {timeout: _ => ({})};
    var fetch = async (url, options) => {
        sent.push({url, options});
        if (scenario === 'timeout') throw new Error('timeout');
        return {
            status: scenario === 'expired' ? 401 : 200,
            ok: true,
            headers: {get: field => scenario === 'challenge' && field === 'cf-mitigated' ? 'challenge' : null},
            json: async () => options.method !== 'POST' ? {maxFreeLike:1, freeLikeUsed:1-quota} :
                scenario === 'rejected' ? {success:false, message:'额度不足'} : {success:true, current:'3', coin:24}
        };
    };
    """#)
    context.evaluateScript("var react = async (postID, floor, kind, approval, owner) => {\n\(ForumReactionScript.request)\n};")
    func simulate(_ kind: String, _ approval: String, setup: String = "", floor: Int = 12, owner: Int = 7) {
        context.evaluateScript("sent = []; \(setup); react(101, \(floor), '\(kind)', '\(approval)', \(owner)).then(raw => result = JSON.parse(raw));")
    }
    func check(_ expression: String) { precondition(context.evaluateScript(expression).toBool(), expression) }

    simulate("dislike", "direct")
    check("result.kind === 'unavailable' && sent.length === 0")
    simulate("dislike", "paid")
    check("result.kind === 'accepted' && sent.length === 1 && sent[0].url === '/api/statistics/dislike'")
    check("sent[0].options.method === 'POST' && JSON.parse(sent[0].options.body).commentId === 314 && JSON.parse(sent[0].options.body).action === 'add'")
    simulate("upvote", "direct")
    check("result.kind === 'accepted' && result.count === 3 && result.coin === 24 && sent[0].url === '/api/statistics/upvote'")
    simulate("upvote", "direct", setup: "row.upvoted = true")
    check("result.kind === 'already' && result.count === 2 && sent.length === 0")
    simulate("upvote", "direct", setup: "row.upvoted = false", floor: 9)
    check("result.kind === 'unavailable' && sent.length === 0")
    simulate("upvote", "direct", owner: 8)
    check("result.kind === 'unavailable' && sent.length === 0")
    simulate("like", "quote")
    check("result.kind === 'confirmFree' && sent.length === 1 && sent[0].url === '/api/progress/today?scope=freelike' && sent[0].options.method !== 'POST'")
    simulate("like", "free")
    check("result.kind === 'accepted' && sent.length === 2 && sent[1].url === '/api/statistics/like'")
    simulate("like", "free", setup: "quota = 0")
    check("result.kind === 'confirmPaid' && sent.length === 1 && sent[0].options.method !== 'POST'")
    simulate("like", "paid")
    check("result.kind === 'accepted' && sent.length === 1 && sent[0].url === '/api/statistics/like'")
    for (scenario, expected) in [("expired", "signedOut"), ("challenge", "verification"), ("rejected", "rejected"), ("timeout", "unknown")] {
        simulate("upvote", "direct", setup: "scenario = '\(scenario)'")
        check("result.kind === '\(expected)' && sent.length === 1")
    }
    print("Passed floor reaction payload, duplicate and account checks, confirmation, free quota changes, and server failures.")
}
