import Foundation

struct ForumThread: Decodable, Equatable {
    let title: String
    let category: String
    let root: ForumFloor?
    let replies: [ForumFloor]
    let pages: [ForumPageLink]
    let page: Int
    let replyRestriction: String?
}

struct ForumFloor: Decodable, Identifiable, Equatable {
    let id: String
    let author: String
    let authorID: Int?
    let isAuthor: Bool
    let avatar: URL?
    let tags: [String]?
    let date: String
    let dateLabel: String
    let blocks: [ForumBlock]
    var signature: String? = nil
    var likes: Int? = nil
    var chicken: Int? = nil
    var dislikes: Int? = nil
    var upvoted: Bool? = nil
    var gaveChicken: Bool? = nil
    var downvoted: Bool? = nil

    var readerID: String { "floor-\(id)" }

    func reaction(_ kind: ForumReactionKind) -> (count: Int?, selected: Bool) {
        switch kind {
        case .upvote: (likes, upvoted == true)
        case .chicken: (chicken, gaveChicken == true)
        case .dislike: (dislikes, downvoted == true)
        }
    }
}

struct ForumPageLink: Decodable, Identifiable, Equatable {
    let number: Int
    let url: URL
    var id: Int { number }
}

struct ForumBlock: Decodable, Equatable {
    let kind: String
    let text: String
    let url: URL?
    let tabs: [ForumBlockTab]?
    let rows: [[String]]?
    let terminal: [[ForumTerminalSpan]]?
}

struct ForumTerminalSpan: Decodable, Equatable {
    let text: String
    let foreground: String?
    let background: String?
    let bold: Bool
}

struct ForumBlockTab: Decodable, Equatable {
    let label: String
    let blocks: [ForumBlock]
}

struct ForumReplyResponse: Decodable {
    let success: Bool
    let redirect: String?
    let redirectHash: String?
    let message: String?

    func destination(from source: URL, floorsPerPage: Int? = nil) -> URL? {
        guard success, let topicID = Forum.topicID(source) else { return nil }
        let target: URL
        if let redirect, !redirect.isEmpty {
            guard let url = URL(string: redirect, relativeTo: source)?.absoluteURL,
                  Forum.topicID(url) == topicID else { return nil }
            target = url
        } else if let floor, let floorsPerPage, floorsPerPage > 0 {
            let page = floor == 0 ? 1 : (floor - 1) / floorsPerPage + 1
            target = Forum.home.appendingPathComponent("post-\(topicID)-\(page)")
        } else { return nil }
        guard var components = URLComponents(url: target, resolvingAgainstBaseURL: false) else { return nil }
        if let redirectHash, !redirectHash.isEmpty {
            let anchor = redirectHash.hasPrefix("#") ? String(redirectHash.dropFirst()) : redirectHash
            guard anchor.range(of: #"^(?:comment-)?[0-9]+$"#, options: .regularExpression) != nil else { return target }
            components.fragment = anchor
        }
        return components.url
    }

    private var floor: Int? {
        guard let redirectHash else { return nil }
        let hash = redirectHash.hasPrefix("#") ? String(redirectHash.dropFirst()) : redirectHash
        let raw = hash.hasPrefix("comment-") ? String(hash.dropFirst("comment-".count)) : hash
        guard let number = Int(raw), number >= 0 else { return nil }
        return number
    }
}

enum ForumPageError: LocalizedError {
    case verification, signInRequired, missing, changed, timedOut, network

    var errorDescription: String? {
        switch self {
        case .verification: "请先在 NodeSeek 窗口中完成站点验证，再回到这里阅读。"
        case .signInRequired: "请登录 NodeSeek 后查看这篇帖子。"
        case .missing: "NodeSeek 没有返回这篇帖子，可能已删除或当前账号无权查看。"
        case .changed: "暂时无法读取这篇帖子的正文。你可以重试，或打开原帖查看。"
        case .timedOut: "加载超时。请检查网络后重试。"
        case .network: "暂时无法连接 NodeSeek。请检查网络后重试。"
        }
    }
}

enum ForumPageScript {
    // NodeSeek's enhancement can replace the original code block with an empty
    // xterm viewport before the terminal has drawn. Keep the original in this
    // WebKit content world so inactive tabs and offscreen rows still have data.
    private static let terminalSource = #"""
    const ansiReport = (text, hint = false) => /[\x1b]\[[0-9;:]*m|\u009b[0-9;:]*m/.test(text) ||
        ((hint || /硬件质量体检报告|IP质量体检报告|HardwareQuality|IpQuality|NodeQuality|融合怪|ecs\.sh/i.test(text)) &&
            (text.match(/\[[0-9;:]{1,24}m/g) || []).length >= 3);
    """#

    static let captureTerminals = terminalSource + #"""
    ;(() => {
        if (!/^\/post-\d+-\d+\/?$/.test(location.pathname)) return;
        const panes = new WeakMap();
        const captured = new WeakSet();
        const collect = (pre, parent) => {
            if (!parent || captured.has(pre)) return;
            const pane = parent.closest('.nsk-magic-tab-body, .post-content');
            if (!pane) return;
            const code = pre.querySelector('code') || pre;
            const text = code.textContent;
            const hint = /ansi|terminal|xterm/i.test(pre.className + ' ' + code.className) ||
                Boolean(pane.matches('.nsk-magic-tab-body') && /基本信息|IP质量/i.test(pane.previousElementSibling?.textContent ?? ''));
            if (!ansiReport(text, hint)) return;
            captured.add(pre);
            const source = panes.get(pane) ?? [];
            source.push({ pre, parent, text });
            panes.set(pane, source);
        };
        const scan = node => {
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.matches('pre')) collect(node, node.parentElement);
            else for (const pre of node.querySelectorAll('pre')) collect(pre, pre.parentElement);
        };
        const observer = new MutationObserver(records => {
            for (const change of records) {
                if (change.target.nodeType !== Node.ELEMENT_NODE) continue;
                if (change.target.matches('pre')) collect(change.target, change.target.parentElement);
                else if (change.target.matches('pre code')) collect(change.target.closest('pre'), change.target.closest('pre').parentElement);
                for (const removed of change.removedNodes) {
                    if (removed.nodeType === Node.ELEMENT_NODE && removed.matches('pre')) collect(removed, change.target);
                }
                for (const added of change.addedNodes) scan(added);
            }
        });
        observer.observe(document, {childList:true, subtree:true});
        document.addEventListener('DOMContentLoaded', () => scan(document.documentElement), {once:true, capture:true});
        globalThis.__seekDeskTerminalSources = panes;
        setTimeout(() => observer.disconnect(), 12000);
    })();
    """#

    static let extract = #"""
    const allowed = new Set(['www.nodeseek.com', 'nodeseek.com']);
    const safeURL = (value, media = false) => {
        if (!value) return null;
        try {
            const url = new URL(value, location.href);
            if (url.username || url.password) return null;
            if (media ? url.protocol !== 'https:' : !['https:', 'http:'].includes(url.protocol)) return null;
            return url.href;
        } catch { return null; }
    };
    const plain = node => (node?.innerText || node?.textContent || '').trim();
    const excluded = node => node.matches('script,style,noscript,template,[hidden],[aria-hidden="true"]') ||
        getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden';
    const main = document.querySelector('#nsk-body-left');
    const root = main?.querySelector('.nsk-post-wrapper .content-item[id="0"]');
    const title = main?.querySelector('h1 .post-title-link');
    const current = /^\/post-(\d+)-(\d+)\/?$/.exec(location.pathname);
    const page = Number(current?.[2]) || 1;
    if (!title || (!root && (page === 1 || !main.querySelector('.comment-container')))) {
        return JSON.stringify({ error: 'missing' });
    }
    const requested = typeof onlyFloor === 'string' && /^\d+$/.test(onlyFloor) ? onlyFloor : '';
    const commentItems = [...main.querySelectorAll('.comments > .content-item[id]')]
        .filter(item => /^\d+$/.test(item.id) && !excluded(item));
    const firstFloor = root || commentItems[0];
    for (let attempt = 0; firstFloor && !firstFloor.querySelector(':scope > .comment-menu [title="点赞"]') && attempt < 8; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    const relevant = requested ? (requested === '0' ? root : commentItems.find(item => item.id === requested)) : main;
    \#(terminalSource)
    const renderedSelector = '.terminal-container, .xterm';
    const terminalRoot = node => node.matches(renderedSelector) && !node.parentElement?.closest(renderedSelector);
    const rootsIn = scope => [...scope.querySelectorAll(renderedSelector)]
        .filter(node => terminalRoot(node) && node.closest('.nsk-magic-tab-body, .post-content') === scope);
    const capturedText = node => {
        const scope = node.closest('.nsk-magic-tab-body, .post-content');
        const all = globalThis.__seekDeskTerminalSources?.get(scope);
        const records = all?.filter(x => !x.pre.isConnected);
        if (!records?.length) return null;
        const related = records.filter(x => x.parent.contains(node));
        if (related.length === 1 && rootsIn(scope).filter(root => related[0].parent.contains(root)).length === 1) return related[0].text;
        const roots = rootsIn(scope);
        if (roots.length !== records.length) return null;
        return records[roots.indexOf(node)]?.text ?? null;
    };
    const drawnRows = node => {
        const rows = node.querySelector('.xterm-rows');
        return rows?.textContent.trim() ? rows : null;
    };
    const incomplete = () => [...(relevant?.querySelectorAll('.post-content :is(.terminal-container, .xterm)') || [])]
        .some(node => terminalRoot(node) && !capturedText(node) && !drawnRows(node));
    // Only wait for a report that is actually present but not painted yet.
    for (let attempt = 0; attempt < 25 && incomplete(); attempt++) {
        await new Promise(resolve => setTimeout(resolve, 80));
    }
    const escape = text => text.replace(/[\\`*_~\[\]<>]/g, '\\$&');
    const collect = (article, output, quote = false, skip = null) => {
        let buffer = '';
        const append = (kind, text, url = null) => output.push({ kind, text, url });
        const flush = (kind = quote ? 'quote' : 'text') => {
            if (buffer.trim()) append(kind, buffer.trim());
            buffer = '';
        };
        const inline = node => {
            if (node.nodeType === Node.TEXT_NODE) return escape(node.textContent.replace(/\s+/g, ' '));
            if (node.nodeType !== Node.ELEMENT_NODE || excluded(node)) return '';
            const tag = node.tagName;
            if (tag === 'BR') return '\n';
            if (tag === 'IMG') {
                flush();
                const url = safeURL(node.getAttribute('data-src') || node.getAttribute('src'), true);
                if (url) append(node.classList.contains('sticker') ? 'sticker' : 'image', node.alt || '帖子图片', url);
                else if (node.alt) append('text', escape(node.alt));
                return '';
            }
            let value = '';
            for (const child of node.childNodes) {
                if (child.nodeType === Node.ELEMENT_NODE && (child.tagName === 'IMG' || child.querySelector('img'))) {
                    buffer += value;
                    value = '';
                }
                value += inline(child);
            }
            if (!value.trim()) return value;
            const trimmed = value.trim();
            let decorated = trimmed;
            if (tag === 'A') {
                const url = safeURL(node.getAttribute('href'));
                if (url) decorated = `[${trimmed}](<${url.replace(/[<>]/g, v => encodeURIComponent(v))}>)`;
            } else if (tag === 'STRONG' || tag === 'B') decorated = `**${trimmed}**`;
            else if (tag === 'EM' || tag === 'I') decorated = `*${trimmed}*`;
            else if (tag === 'S' || tag === 'DEL') decorated = `~~${trimmed}~~`;
            else if (tag === 'CODE' && !trimmed.includes('`')) decorated = '`' + plain(node) + '`';
            return value.replace(trimmed, () => decorated);
        };
        const appendInline = node => {
            const value = inline(node);
            buffer += value;
        };
        const walk = node => {
            if (node.nodeType === Node.TEXT_NODE) { appendInline(node); return; }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (terminalRoot(node)) {
                flush();
                const raw = capturedText(node);
                if (raw) { append('terminal', raw); return; }
                const terminal = drawnRows(node);
                if (!terminal) { append('terminalUnavailable', ''); return; }
                const lines = [...terminal.children].map(row => {
                    const spans = [...row.querySelectorAll(':scope > span')];
                    if (!spans.length) return [{text:row.textContent, bold:false}];
                    return spans.map(span => {
                        const style = getComputedStyle(span);
                        const background = style.backgroundColor;
                        const declared = span.style.color || ([...span.classList].some(name => name.startsWith('xterm-fg-')) ? style.color : null);
                        return {text:span.textContent, foreground:declared,
                            background:background === 'rgba(0, 0, 0, 0)' ? null : background,
                            bold:span.classList.contains('xterm-bold')};
                    });
                });
                if (lines.length) output.push({kind:'terminal', text:'', terminal:lines});
                return;
            }
            if (excluded(node) && !(node.matches('div') && !node.matches('[hidden], [aria-hidden="true"]') &&
                node.querySelector(renderedSelector))) return;
            if (node.matches('.nsk-magic-tabs')) {
                flush();
                const tabs = [];
                for (const label of node.children) {
                    if (!label.matches('.nsk-magic-tab-title')) continue;
                    const pane = label.nextElementSibling;
                    if (!pane?.matches('.nsk-magic-tab-body')) continue;
                    const blocks = [];
                    collect(pane, blocks);
                    tabs.push({label:plain(label), blocks});
                }
                if (tabs.length) output.push({kind:'tabs', text:'', tabs});
                return;
            }
            switch (node.tagName) {
                case 'PRE': {
                    flush();
                    const code = node.querySelector('code') || node;
                    const text = code.textContent.replace(/\n$/, '');
                    const pane = node.closest('.nsk-magic-tab-body');
                    const hint = /ansi|terminal|xterm/i.test(node.className + ' ' + code.className) ||
                        /基本信息|IP质量/i.test(pane?.previousElementSibling?.textContent ?? '');
                    append(ansiReport(text, hint) ? 'terminal' : 'code', text);
                    break;
                }
                case 'BLOCKQUOTE': flush(); collect(node, output, true); break;
                case 'TABLE': {
                    flush();
                    const caption = plain(node.querySelector('caption'));
                    if (caption) append('text', escape(caption));
                    const rows = [...node.rows].map(row => [...row.cells].map(cell => plain(cell)));
                    if (rows.length) output.push({kind:'table', text:'', rows});
                    break;
                }
                case 'HR': flush(); append('rule', ''); break;
                case 'UL': case 'OL': {
                    flush();
                    let counter = Number(node.getAttribute('start')) || 1;
                    for (const item of node.children) {
                        if (item.tagName !== 'LI' || excluded(item)) continue;
                        buffer = node.tagName === 'OL' ? `${counter++}. ` : '• ';
                        for (const child of item.childNodes) walk(child);
                        flush();
                    }
                    break;
                }
                case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
                    flush(); appendInline(node); flush('heading'); break;
                case 'DETAILS': {
                    flush();
                    const summary = node.querySelector(':scope > summary');
                    const blocks = [];
                    collect(node, blocks, quote, summary);
                    output.push({kind:'disclosure', text:plain(summary) || '展开内容', tabs:[{label:'', blocks}]});
                    break;
                }
                case 'P': case 'DIV': case 'SECTION': case 'SUMMARY':
                    flush(); for (const child of node.childNodes) walk(child); flush(); break;
                default: appendInline(node);
            }
        };
        if (article) for (const child of article.childNodes) if (child !== skip) walk(child);
        flush();
    };
    const floor = item => {
        const meta = item.querySelector(':scope > .nsk-content-meta-info');
        const avatar = meta?.querySelector('.avatar-wrapper img');
        const time = meta?.querySelector('time');
        const blocks = [];
        collect(item.querySelector(':scope > .post-content'), blocks);
        const warning = item.querySelector(':scope > .topic-warning');
        if (warning && !excluded(warning) && plain(warning)) blocks.push({kind:'notice', text:plain(warning),url:null});
        const author = meta?.querySelector('.author-name');
        const authorID = Number(author?.getAttribute('href')?.match(/^\/space\/(\d+)$/)?.[1]) || null;
        const tags = [...(meta?.querySelectorAll('.author-info .role-tag:not(.is-poster)') || [])].map(plain).filter(Boolean);
        const avatarURL = safeURL(avatar?.getAttribute('data-src'), true) || safeURL(avatar?.getAttribute('src'), true) ||
            (authorID ? safeURL(`/avatar/${authorID}.png`, true) : null);
        const menu = item.querySelector(':scope > .comment-menu');
        const reaction = title => menu?.querySelector('[title="' + title + '"]');
        const count = title => {
            const value = plain(reaction(title));
            return /^\d+$/.test(value) ? Number(value) : null;
        };
        const signature = [];
        collect(item.querySelector(':scope > .signature, :scope > .user-signature'), signature);
        return { id:item.id, author:plain(author), authorID, tags, isAuthor:item.id === '0' || Boolean(meta?.querySelector('.is-poster')), avatar:avatarURL,
                 date:time?.getAttribute('title') || '', dateLabel:plain(time), blocks,
                 signature:signature.filter(block => block.kind === 'text').map(block => block.text).join('\n') || null,
                 likes:count('点赞'), chicken:count('加鸡腿'), dislikes:count('反对'),
                 upvoted:reaction('点赞')?.classList.contains('clicked') ?? null,
                 gaveChicken:reaction('加鸡腿')?.classList.contains('clicked') ?? null,
                 downvoted:reaction('反对')?.classList.contains('clicked') ?? null };
    };
    const postId = current?.[1];
    const pages = new Map();
    for (const link of main.querySelectorAll('[aria-label="pagination"] a[href], .pagination a[href]')) {
        const url = safeURL(link.getAttribute('href'));
        if (!url) continue;
        const parsed = new URL(url);
        const route = /^\/post-(\d+)-(\d+)\/?$/.exec(parsed.pathname);
        if (!route || route[1] !== postId || parsed.protocol !== 'https:' || !allowed.has(parsed.hostname)) continue;
        const number = Number(route[2]);
        pages.set(number, {number, url});
    }
    const badges = [...title.closest('h1').querySelectorAll('span')].map(plain);
    const restriction = badges.find(text => /^(只读|已锁定|禁止回复)$/.test(text));
    const category = root?.querySelector('.content-category a')?.getAttribute('href')?.split('/').pop() || '';
    return JSON.stringify({title:plain(title) || document.title, category, root:root && (!requested || requested === '0') ? floor(root) : null,
        replies:commentItems.filter(item => !requested || item.id === requested).map(floor),
        pages:[...pages.values()].sort((a,b)=>a.number-b.number),page,replyRestriction:restriction || null});
    """#

    static let reply = #"""
    const route = /^\/post-(\d+)-\d+\/?$/.exec(location.pathname);
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        !route || Number(route[1]) !== postId || !document.querySelector('.nsk-post-wrapper .post-title-link')) {
        return JSON.stringify({ kind:'unavailable' });
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const requestID = Array.from(crypto.getRandomValues(new Uint8Array(16)), value => alphabet[value % alphabet.length]).join('');
    try {
        const result = await fetch('/api/content/new-comment', {
            method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(20000),
            headers: {'Content-Type':'application/json', 'csrf-token':requestID},
            body: JSON.stringify({postId, content, mode:'new-comment'})
        });
        if (result.headers.get('cf-mitigated') === 'challenge') return JSON.stringify({kind:'verification'});
        if (result.status === 401) return JSON.stringify({kind:'signIn'});
        const data = await result.json().catch(() => null);
        if (typeof data?.success === 'boolean') return JSON.stringify({kind:'response', response:{
            success:result.ok && data.success,
            redirect:typeof data.redirect === 'string' ? data.redirect : null,
            redirectHash:typeof data.redirectHash === 'string' || typeof data.redirectHash === 'number' ? String(data.redirectHash) : null,
            message:typeof data.message === 'string' ? data.message : null
        }});
        if (result.status === 403) return JSON.stringify({kind:'forbidden'});
        return JSON.stringify({kind:'unknown'});
    } catch { return JSON.stringify({kind:'unknown'}); }
    """#
}

enum ForumTerminalANSI {
    // Clipboard and exported Markdown can contain either the control byte or its printed form.
    private static let sgr = try! NSRegularExpression(pattern: #"(?:(?:\x1b|\\(?:x1b|u001b|033))?\[|\x{009B})([0-9;:]*)m"#, options: .caseInsensitive)
    private static let colors: [String] = [
        "rgb(31,35,42)", "rgb(224,108,117)", "rgb(152,195,121)", "rgb(229,192,123)",
        "rgb(97,175,239)", "rgb(198,120,221)", "rgb(86,182,194)", "rgb(229,232,237)",
        "rgb(123,133,148)", "rgb(255,126,133)", "rgb(181,229,140)", "rgb(255,219,149)",
        "rgb(129,195,255)", "rgb(223,155,246)", "rgb(114,220,232)", "rgb(251,252,255)"
    ]

    static func lines(_ input: String) -> [[ForumTerminalSpan]] {
        var style = Style()
        return input.split(separator: "\n", omittingEmptySubsequences: false).map { raw in
            let line = String(raw)
            let source = line as NSString
            var cursor = 0
            var output: [ForumTerminalSpan] = []
            for match in sgr.matches(in: line, range: NSRange(location: 0, length: source.length)) {
                if match.range.location > cursor {
                    output.append(style.span(source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))))
                }
                let args = match.range(at: 1)
                let fields = source.substring(with: args).split(separator: ";", omittingEmptySubsequences: false)
                let parameters = fields.flatMap { field -> [Int] in
                    guard field.contains(":") else { return [Int(field) ?? 0] }
                    let parts = field.split(separator: ":", omittingEmptySubsequences: false)
                    if parts.count >= 5, parts[1] == "2" {
                        return Array(parts.prefix(2) + parts.suffix(3)).map { Int($0) ?? 0 }
                    }
                    return parts.map { Int($0) ?? 0 }
                }
                style.apply(parameters.isEmpty ? [0] : parameters)
                cursor = NSMaxRange(match.range)
            }
            if cursor < source.length { output.append(style.span(source.substring(from: cursor))) }
            return output
        }
    }

    private struct Style {
        var foreground: String?
        var background: String?
        var bold = false

        func span(_ text: String) -> ForumTerminalSpan {
            ForumTerminalSpan(text: text, foreground: foreground, background: background, bold: bold)
        }

        mutating func apply(_ parameters: [Int]) {
            var index = 0
            while index < parameters.count {
                let code = parameters[index]
                switch code {
                case 0: self = Style()
                case 1: bold = true
                case 22: bold = false
                case 30...37: foreground = colors[code - 30]
                case 39: foreground = nil
                case 40...47: background = colors[code - 40]
                case 49: background = nil
                case 90...97: foreground = colors[code - 82]
                case 100...107: background = colors[code - 92]
                case 38, 48:
                    if index + 2 < parameters.count && parameters[index + 1] == 5 {
                        let color = Self.indexedColor(parameters[index + 2])
                        if code == 38 { foreground = color } else { background = color }
                        index += 2
                    } else if index + 4 < parameters.count && parameters[index + 1] == 2 {
                        let rgb = parameters[(index + 2)...(index + 4)].map { min(255, max(0, $0)) }
                        let color = "rgb(\(rgb[0]),\(rgb[1]),\(rgb[2]))"
                        if code == 38 { foreground = color } else { background = color }
                        index += 4
                    }
                default: break
                }
                index += 1
            }
        }

        private static func indexedColor(_ index: Int) -> String? {
            if colors.indices.contains(index) { return colors[index] }
            if (16...231).contains(index) {
                let cube = index - 16
                let scale = [0, 95, 135, 175, 215, 255]
                return "rgb(\(scale[cube / 36]),\(scale[(cube / 6) % 6]),\(scale[cube % 6]))"
            }
            if (232...255).contains(index) {
                let value = 8 + (index - 232) * 10
                return "rgb(\(value),\(value),\(value))"
            }
            return nil
        }
    }
}
