import Foundation
import ImageIO
import JavaScriptCore
import UniformTypeIdentifiers

func checkDiscussion() throws {
    let mock = JSContext()!
    let testScript = #"""
    var writes = [];
    var answer;
    var location = {protocol:'https:',host:'www.nodeseek.com',pathname:'/new-discussion'};
    var window = {__config__:{user:{rank:4}}};
    var document = {querySelector: selector => selector === '#editor' ? {} : {options:[
        {value:'',disabled:false,textContent:'选择版块'},
        {value:'tech',disabled:false,textContent:' 技术 '},
        {value:'inside',disabled:true,textContent:'内版'}
    ]}};
    var crypto = {getRandomValues:array=>array.fill(7)};
    var AbortSignal = {timeout: milliseconds=>milliseconds};
    var mockReply = {status:200, ok:true, challenge:false, payload:{success:true,redirect:'/post-485-1'}};
    var fetch = async (url, request) => {
        writes.push({url, request});
        return {status:mockReply.status,ok:mockReply.ok,
            headers:{get:()=>mockReply.challenge ? 'challenge' : null},json:async()=>mockReply.payload};
    };
    """#
    mock.evaluateScript(testScript)
    func evaluate(_ source: String, params: String = "", input: String = "") -> Data {
        mock.evaluateScript("answer = undefined; (async function(\(params)){\n\(source)\n})(\(input)).then(value => answer = value)")
        guard let raw = mock.objectForKeyedSubscript("answer")?.toString(), raw != "undefined" else {
            preconditionFailure(mock.exception?.toString() ?? "No JS response")
        }
        return Data(raw.utf8)
    }
    let options = try JSONDecoder().decode(DiscussionOptions.self, from: evaluate(DiscussionScript.options))
    precondition(options.kind == "ready" && options.categories?.map(\.id) == ["tech"] && options.maxRank == 4)
    func response(_ category: String = "tech", _ rank: Int = 4) throws -> DiscussionResponse {
        try JSONDecoder().decode(DiscussionResponse.self,
            from: evaluate(DiscussionScript.publish, params: "title,content,category,rank", input: "'标题','**正文**','\(category)',\(rank)"))
    }
    let result = try response()
    precondition(result.topicURL == Forum.home.appendingPathComponent("post-485-1"))
    precondition(mock.evaluateScript("""
    writes.length === 1 && writes[0].url === '/api/content/new-discussion' &&
    writes[0].request.method === 'POST' && writes[0].request.credentials === 'same-origin' &&
    writes[0].request.headers['csrf-token'].length === 16 &&
    writes[0].request.body === JSON.stringify({mode:'new-discussion',title:'标题',content:'**正文**',category:'tech',rank:4})
    """)!.toBool())
    let invalidCategory = try response("inside")
    let invalidRank = try response("tech", 5)
    precondition(invalidCategory.kind == "rejected" && invalidRank.kind == "rejected")
    mock.evaluateScript("window.__config__.user = null")
    let signedOut = try response()
    precondition(signedOut.kind == "signedOut" && mock.evaluateScript("writes.length")!.toInt32() == 1)
    mock.evaluateScript("window.__config__.user = {rank:4}; mockReply.challenge = true")
    let verification = try response()
    precondition(verification.kind == "verification")
    mock.evaluateScript("mockReply.challenge = false; mockReply.payload = null")
    let unknown = try response()
    precondition(unknown.kind == "unknown")
    precondition(DiscussionResponse(kind: "accepted", redirect: "https://evil.example/post-485-1", message: nil).topicURL == nil)

    let blocks = MarkdownPreviewDocument.blocks("""
    ## 标题
    | 版块 | 回帖 |
    | --- | --- |
    | 技术 | 1 |
    ~~~md
    ![不读取](https://images.example/code.png)
    ~~~
    ---
    > 引用
    """)
    precondition(blocks == [.line("标题", .heading(2)), .table(["版块", "回帖"], [["技术", "1"]]),
        .code("![不读取](https://images.example/code.png)"), .divider, .line("引用", .quote)])
    let report = """
    :::: tabs
    ::: tab-item 💻 基本信息
    ```ansi
    [36m地区[0m: \u{1B}[1;32m香港\u{1B}[0m
    \\u001b[35m测评\\x1B[0m
    ::::
    ```
    :::
    ::: tab-item 🌐 网络 | 延迟
    | 线路 | 延迟 |
    | --- | --- |
    | 电信 | 35 ms |
    :::
    :::: 
    ```txt
    [36m保留原文[0m
    ```
    """
    let reportBlocks = MarkdownPreviewDocument.blocks(report.replacingOccurrences(of: "\n", with: "\r\n"))
    guard reportBlocks.count == 2, case .tabs(let tabs) = reportBlocks[0], tabs.count == 2,
          case .terminal(let lines) = tabs[0].blocks.first else { preconditionFailure("Missing Markdown report tabs or terminal") }
    precondition(tabs[0].label == "💻 基本信息" && tabs[1].label == "🌐 网络 | 延迟")
    precondition(lines.map { $0.map(\.text).joined() } == ["地区: 香港", "测评", "::::"])
    precondition(lines[0].first?.foreground != nil && lines[0].last?.bold == true && lines[1].first?.foreground != nil)
    precondition(tabs[1].blocks == [.table(["线路", "延迟"], [["电信", "35 ms"]])])
    precondition(reportBlocks[1] == .code("[36m保留原文[0m"))
    precondition(MarkdownPreviewDocument.blocks(":::: tabs\n::: tab-item 网络\n> 正在编辑") ==
        [.tabs([.init(label: "网络", blocks: [.line("正在编辑", .quote)])])])
    let elements = MarkdownPreviewDocument.inline(#"**图：** ![封面](<https://images.example/name(1).png>) :yct001:"#)
    let sticker = Forum.home.appendingPathComponent("static/image/sticker/yct/001.gif")
    precondition(elements == [.text("**图：** "), .image(URL(string: "https://images.example/name(1).png")!, label: "封面", sticker: false),
        .image(sticker, label: "洋葱头 001", sticker: true)])
    let literal = "⛔ `:yct001:` ![本机](file:///tmp/draft.png)"
    precondition(MarkdownPreviewDocument.inline(literal) == [.text(literal)])
    precondition(ForumStickers.byCode["emoji00"]?.url.absoluteString.hasSuffix("/emoji/00.png") == true)
    let stickerDraft = "` :ac01: `\n```\n:yct002:\n```\n:yct001:\n![表情](https://images.example/custom.png)"
    precondition(MarkdownPreviewDocument.stickerImages(stickerDraft) == [
        .image(sticker, label: "洋葱头 001", sticker: true),
        .image(URL(string: "https://images.example/custom.png")!, label: "表情", sticker: true)
    ])
    try checkPublishedImageSize()
    print("Passed NodeSeek create discussion, Markdown report tabs and ANSI preview, images and sticker mappings.")
}

private func checkPublishedImageSize() throws {
    let source = URL(string: "https://images.example/original.png")!
    let resized = URL(string: "https://cdn.nodeimage.com/i/resized.png")!
    let draft = [
        "测试😀 ![图片](<\(source)> \"说明\")",
        "> ![图片](\(source))",
        "原链接 \(source)",
        "`![示例](\(source))`",
        "~~~",
        "![示例](\(source))",
        "~~~",
        "![表情](\(source))"
    ]
    let markdown = draft.joined(separator: "\r\n")
    let references = MarkdownPreviewDocument.imageReferences(markdown, selected: [source])
    precondition(references.count == 2)
    let expected = (draft.prefix(2).map { $0.replacingOccurrences(of: source.absoluteString, with: resized.absoluteString) }
        + draft.dropFirst(2)).joined(separator: "\r\n")
    precondition(MarkdownPreviewDocument.replacingImages(markdown, references: references, with: [source: resized]) == expected)

    let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".png")
    defer { try? FileManager.default.removeItem(at: file) }
    let canvas = CGContext(data: nil, width: 1200, height: 600, bitsPerComponent: 8, bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    let output = CGImageDestinationCreateWithURL(file as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(output, canvas.makeImage()!, nil)
    precondition(CGImageDestinationFinalize(output))
    let picture = try NodeImageUpload.resizedPicture(file: file, scale: .init(ratio: 0.5, previewWidth: 800))
    let image = CGImageSourceCreateWithData(picture.data as CFData, nil).flatMap { CGImageSourceCreateImageAtIndex($0, 0, nil) }
    precondition(picture.mime == "image/png" && image?.width == 400 && image?.height == 200)
}
