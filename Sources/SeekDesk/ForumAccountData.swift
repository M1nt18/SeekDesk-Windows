import Foundation

struct ForumIdentity: Decodable {
    let signedIn: Bool
    let id: Int?
    let name: String?
    let floorsPerPage: Int?
}

struct ForumProfile: Decodable, Equatable {
    let id: Int
    let name: String
    let rank: Int?
    let joined: String?
    let bio: String?
    let topics: Int?
    let replies: Int?
    let following: Int?
    let followers: Int?
    var coin: Int?
}

struct ForumIntroduction: Decodable, Equatable {
    let bio: String
    var signature: String
    var readme: String
}

struct ForumIntroductionResult: Decodable {
    enum Kind: String, Decodable { case ready, saved, signedOut, verification, conflict, rejected, unavailable, unknown }
    let kind: Kind
    var data: ForumIntroduction? = nil
    var message: String? = nil
}

enum ForumIntroductionScript {
    static let request = #"""
    const finish = (kind, fields = {}) => JSON.stringify({kind, ...fields});
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        !Number.isSafeInteger(owner) || owner <= 0 || !window.__config__) return finish('unavailable');
    if (Number(window.__config__.user?.member_id) !== owner) return finish('signedOut');
    const options = {credentials:'same-origin', cache:'no-store', redirect:'error'};
    const accessIssue = response => response.headers.get('cf-mitigated') === 'challenge' ? 'verification' :
        response.status === 401 ? 'signedOut' : null;
    const accessMessage = value => /未登录|请登录|登录后|unauthoriz|not logged in/i.test(value?.message || '');
    let wrote = false;
    try {
        const read = await fetch('/api/account/getInfo/' + owner + '?readme=1&signature=1', {
            ...options, signal:AbortSignal.timeout(12000)
        });
        const readIssue = accessIssue(read);
        if (readIssue) return finish(readIssue);
        const profile = await read.json().catch(() => null);
        if (accessMessage(profile)) return finish('signedOut');
        const detail = profile?.detail;
        if (!read.ok || profile?.success !== true || Number(detail?.member_id) !== owner || !Object.hasOwn(detail, 'bio')) {
            return finish('unavailable');
        }
        const latest = {bio:detail.bio ?? '', signature:detail.signature_markdown ?? '', readme:detail.readme ?? ''};
        if (!Object.values(latest).every(value => typeof value === 'string')) return finish('unavailable');
        if (draft === null) return finish('ready', {data:latest});

        const fields = ['signature','readme'];
        if (!fields.every(field => typeof draft[field] === 'string' && typeof original?.[field] === 'string')) {
            return finish('unavailable');
        }
        const changed = fields.filter(field => draft[field] !== original[field]);
        if (changed.some(field => latest[field] !== original[field] && latest[field] !== draft[field])) return finish('conflict');
        const updates = changed.filter(field => latest[field] !== draft[field]);
        if (updates.length === 0) return finish('saved', {data:latest});
        if (updates.includes('signature') && draft.signature) {
            if (typeof window.markdownit !== 'function') return finish('unavailable');
            const rendered = new window.markdownit().render(draft.signature);
            if (rendered.includes('<blockquote>') || rendered.includes('<img')) {
                return finish('rejected', {message:'NodeSeek 签名不支持图片或引用。'});
            }
            if ([...draft.signature].some(character => character.length > 1)) {
                return finish('rejected', {message:'NodeSeek 签名不支持扩展表情或字符。'});
            }
        }
        const next = {...latest};
        for (const field of updates) next[field] = draft[field];
        wrote = true;
        const response = await fetch('/api/account/introduction', {
            ...options, method:'POST', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json'},
            body:JSON.stringify(next)
        });
        const issue = accessIssue(response);
        if (issue) return finish(issue);
        const result = await response.json().catch(() => null);
        if (accessMessage(result)) return finish('signedOut');
        if (response.ok && result?.success === true) return finish('saved', {data:next});
        if (result?.success === false || [403,429].includes(response.status)) {
            return finish('rejected', {message:typeof result?.message === 'string' ? result.message : null});
        }
    } catch {}
    return finish(wrote ? 'unknown' : 'unavailable');
    """#
}

enum ForumAttendanceMode: String, CaseIterable, Identifiable {
    case fixed, random
    var id: Self { self }
    var title: String { self == .fixed ? "固定签到" : "运气签到" }
}

struct ForumAttendanceResult: Codable {
    enum Kind: String, Codable { case completed, alreadyCompleted, signedOut, verification, failed }
    let kind: Kind
    var gain: Int? = nil
    var current: Int? = nil

    var done: Bool { kind == .completed || kind == .alreadyCompleted }
    var rewardText: String { gain.map { "本次领取 \($0) 鸡腿" } ?? "已领取本次签到奖励" }

    var title: String {
        switch kind {
        case .completed: gain.map { "今日已签到 · 获得 \($0) 个鸡腿" } ?? "今日签到成功"
        case .alreadyCompleted: "今天已在 NodeSeek 签到"
        case .signedOut: "请登录 NodeSeek 后继续签到"
        case .verification: "签到需要完成 NodeSeek 验证"
        case .failed: "签到暂未成功，稍后重试"
        }
    }
}

enum ForumAttendanceDay {
    private static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 8 * 3600)!
        return calendar
    }()

    static func start(_ date: Date) -> Date { calendar.startOfDay(for: date) }
    static func next(after date: Date) -> Date { start(date).addingTimeInterval(24 * 3600) }
}

enum InboxCategory: String, CaseIterable, Identifiable {
    case mentions, replies, messages
    var id: String { rawValue }
    var title: String {
        switch self { case .mentions: "@我"; case .replies: "回复主题"; case .messages: "私信" }
    }
    var emptyTitle: String {
        switch self { case .mentions: "暂无提到你的通知"; case .replies: "暂无帖子回复通知"; case .messages: "暂无私信" }
    }
}

struct InboxReadTarget: Hashable {
    let category: InboxCategory
    let id: Int
    var stamp = ""
}

struct InboxReadResult: Decodable {
    let kind: String
    let count: Int?
}

struct ForumNotice: Decodable, Identifiable {
    let id: String
    let author: String
    let authorID: Int?
    let title: String
    let date: String
    let unread: Bool
    let postID: Int
    let floor: Int

    func readTarget(_ category: InboxCategory) -> InboxReadTarget? {
        guard category != .messages, let id = Int(id), id > 0 else { return nil }
        return InboxReadTarget(category: category, id: id)
    }

    func destination(floorsPerPage: Int) -> URL {
        let page = floor <= 0 ? 1 : (floor - 1) / max(1, floorsPerPage) + 1
        var location = URLComponents(url: Forum.home.appendingPathComponent("post-\(postID)-\(page)"), resolvingAgainstBaseURL: false)!
        location.fragment = String(floor)
        return location.url!
    }

    func reply(in thread: ForumThread) -> ForumFloor? {
        let target = floor == 0 ? thread.root : thread.replies.first { $0.id == String(floor) }
        guard let target else { return nil }
        if let authorID, let actual = target.authorID, authorID != actual { return nil }
        return target
    }
}

struct ForumConversation: Decodable, Identifiable, Equatable {
    let id: Int
    let name: String
    let preview: String
    let date: String
    let unread: Bool

    var readTarget: InboxReadTarget { InboxReadTarget(category: .messages, id: id, stamp: date) }
}

struct ForumConversationContact: Codable, Identifiable, Equatable {
    let id: Int
    let name: String

    var conversation: ForumConversation {
        ForumConversation(id: id, name: name.isEmpty ? "用户 #\(id)" : name, preview: "打开查看对话", date: "", unread: false)
    }
}

struct ForumMessage: Decodable, Identifiable {
    let id: String
    let text: String
    let date: String
    let mine: Bool
    let markdown: Bool
    let peerName: String?
}

enum ForumAccountScript {
    static let attendance = #"""
    const result = (kind, gain = null, current = null) => JSON.stringify({kind, gain, current});
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        typeof randomMode !== 'boolean') return result('failed');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch('/api/attendance?random=' + String(randomMode), {
            method:'POST', credentials:'same-origin', cache:'no-store', redirect:'error',
            headers:{'Content-Type':'application/json'}, body:'{}', signal:controller.signal
        });
        if (response.headers.get('cf-mitigated') === 'challenge') return result('verification');
        const data = await response.json().catch(() => null);
        const message = typeof data?.message === 'string' ? data.message : '';
        if (response.status === 401 || /未登录|登录后|请登录|not logged in|unauthoriz/i.test(message)) return result('signedOut');
        const number = value => value != null && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
        if (response.ok && data?.success === true) {
            const reward = message.match(/(?:获得|领取|奖励)\s*[：:]?\s*(\d+)\s*(?:个|枚)?\s*鸡腿/)?.[1];
            return result('completed', number(data.gain) ?? number(reward), number(data.current));
        }
        if (/已签到|已签过|已经签到|已经签过|已完成签到|重复签到|already.{0,24}(checked|signed)/i.test(message)) {
            return result('alreadyCompleted', null, number(data?.current));
        }
        return result('failed');
    } catch { return result('failed'); } finally { clearTimeout(timeout); }
    """#

    static let identity = #"""
    const config = window.__config__;
    if (!config || !document.querySelector('#nsk-head')) return null;
    const user = config.user;
    const id = Number(user?.member_id);
    const count = Number(config.commmentPerPage);
    return JSON.stringify({signedIn:Boolean(user), id:Number.isSafeInteger(id) && id > 0 ? id : null,
        name:typeof user?.member_name === 'string' ? user.member_name : null,
        floorsPerPage:Number.isSafeInteger(count) && count > 0 ? count : null});
    """#

    static let read = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) {
        return JSON.stringify({kind:'network'});
    }
    const base = '/api/notification';
    const routes = { profile:`/api/account/getInfo/${selfID}`, mentions:`${base}/at-me/list`,
        replies:`${base}/reply-to-me/list`, messages:`${base}/message/list`, conversation:`${base}/message/with/${peerID}` };
    const integer = value => value != null && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
    const string = value => typeof value === 'string' ? value : '';
    const flag = value => value === true || value === 1 || value === '1';
    if (!Object.hasOwn(routes, route)) return JSON.stringify({kind:'network'});
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
        const response = await fetch(routes[route], {method:'GET', credentials:'same-origin',
            cache:'no-store', redirect:'error', signal:controller.signal});
        if (response.headers.get('cf-mitigated') === 'challenge') return JSON.stringify({kind:'verification'});
        if (response.status === 401) return JSON.stringify({kind:'signedOut'});
        const value = await response.json().catch(() => null);
        if (!response.ok || !value?.success) {
            return JSON.stringify({kind:/未登录|登录后|请登录|not logged in|unauthoriz/i.test(value?.message || '') ? 'signedOut' : 'network'});
        }
        let data;
        switch (route) {
        case 'profile': {
            const u = value.detail;
            if (!u || integer(u.member_id) !== selfID || typeof u.member_name !== 'string') return JSON.stringify({kind:'network'});
            data = {id:selfID, name:u.member_name, rank:integer(u.rank), joined:string(u.created_at_str || u.created_at),
                bio:string(u.bio), topics:integer(u.nPost), replies:integer(u.nComment),
                following:integer(u.follows), followers:integer(u.fans), coin:integer(u.coin)};
            break;
        }
        case 'mentions': case 'replies':
            if (!Array.isArray(value.data)) return JSON.stringify({kind:'network'});
            data = value.data.flatMap((item, index) => {
                const postID = integer(item.post_id), floor = integer(item.floor_id);
                if (postID === null || postID <= 0 || floor === null || floor < 0) return [];
                return [{id:String(item.id ?? `${postID}-${floor}-${index}`), author:string(item.commenter_name),
                    authorID:integer(item.commenter_id), title:string(item.title), date:string(item.created_at),
                    unread:!flag(item.viewed), postID, floor}];
            });
            break;
        case 'messages': {
            if (!Array.isArray(value.msgArray)) return JSON.stringify({kind:'network'});
            const peers = new Map();
            for (const item of value.msgArray) {
                const sender = integer(item.sender_id), receiver = integer(item.receiver_id);
                if (sender !== selfID && receiver !== selfID) continue;
                const mine = sender === selfID;
                const id = mine ? receiver : sender;
                if (id === null || id <= 0 || id === selfID) continue;
                const row = {id, name:string(mine ? item.receiver_name : item.sender_name), preview:string(item.content),
                    date:string(item.created_at), unread:!mine && !flag(item.viewed)};
                const previous = peers.get(id);
                const unread = row.unread || Boolean(previous?.unread);
                if (!previous || row.date > previous.date) peers.set(id, {...row, unread});
                else previous.unread = unread;
            }
            data = [...peers.values()].sort((a,b)=>b.date.localeCompare(a.date));
            break;
        }
        case 'conversation':
            if (!Array.isArray(value.msgArray)) return JSON.stringify({kind:'network'});
            data = value.msgArray.flatMap((item, index) => {
                const sender = integer(item.sender_id), receiver = integer(item.receiver_id);
                if (!((sender === selfID && receiver === peerID) || (sender === peerID && receiver === selfID))) return [];
                return [{id:String(item.id ?? index), text:string(item.content), date:string(item.created_at),
                    mine:sender === selfID, markdown:flag(item.is_markdown),
                    peerName:string(sender === selfID ? item.receiver_name : item.sender_name)}];
            });
            break;
        }
        return JSON.stringify({kind:'ok', data});
    } catch { return JSON.stringify({kind:'network'}); } finally { clearTimeout(timeout); }
    """#

    static let unread = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch('/api/notification/unread-count', {
        credentials:'same-origin', cache:'no-store', redirect:'error', signal:controller.signal
    }).finally(() => clearTimeout(timeout));
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success || !data.unreadCount) return null;
    const count = key => Math.min(99999, Math.max(0, Math.floor(Number(data.unreadCount[key]) || 0)));
    return JSON.stringify({mentions:count('atMe'), replies:count('reply'), messages:count('message')});
    """#

    static let markRead = #"""
    const finish = (kind, count = null) => JSON.stringify({kind, count});
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        !Number.isSafeInteger(itemID) || itemID <= 0 || !Number.isSafeInteger(selfID) || selfID <= 0) return finish('unavailable');
    const paths = {
        mentions: ['/api/notification/at-me/markViewed', 'atMe'],
        replies: ['/api/notification/reply-to-me/markViewed', 'replys'],
        messages: ['/api/notification/message/markViewed', 'messages']
    };
    if (!Object.hasOwn(paths, route)) return finish('unavailable');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    const options = {credentials:'same-origin', redirect:'error', cache:'no-store', signal:controller.signal};
    try {
        let ids = [itemID];
        if (route === 'messages') {
            const response = await fetch('/api/notification/message/with/' + itemID, options);
            if (response.status === 401) return finish('signedOut');
            const data = await response.json().catch(() => null);
            if (!response.ok || data?.success !== true || !Array.isArray(data.msgArray)) return finish('failed');
            ids = [...new Set(data.msgArray.filter(row =>
                Number(row.sender_id) === itemID && Number(row.receiver_id) === selfID &&
                (row.viewed === 0 || row.viewed === '0' || row.viewed === false))
                .map(row => Number(row.id)).filter(id => Number.isSafeInteger(id) && id > 0))];
            if (!ids.length) return finish('read', 0);
        }
        const [path, field] = paths[route];
        const response = await fetch(path, {...options, method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({[field]:ids})});
        if (response.status === 401) return finish('signedOut');
        const data = await response.json().catch(() => null);
        return response.ok && data?.success === true ? finish('read', ids.length) : finish('failed');
    } catch { return finish('failed'); } finally { clearTimeout(timer); }
    """#

    static let userProfile = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        !Number.isSafeInteger(member) || member < 1) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch('/api/account/getInfo/' + member + (includeReadme ? '?readme=1' : ''), {
        credentials:'same-origin', redirect:'error', signal:controller.signal
    }).finally(() => clearTimeout(timeout));
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success || Number(data.detail?.member_id) !== member) return null;
    return JSON.stringify(data.detail);
    """#

    static let sendMessage = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        !Number.isSafeInteger(peerID) || peerID <= 0 || typeof content !== 'string' || !content.trim()) {
        return JSON.stringify({kind:'unavailable'});
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch('/api/notification/message/send', {
            method:'POST', credentials:'same-origin', redirect:'error', signal:controller.signal,
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({receiverUid:peerID, content, markdown})
        });
        if (response.headers.get('cf-mitigated') === 'challenge') return JSON.stringify({kind:'verification'});
        if (response.status === 401) return JSON.stringify({kind:'signedOut'});
        const result = await response.json().catch(() => null);
        if (response.ok && result?.success === true) return JSON.stringify({kind:'sent'});
        if (typeof result?.message === 'string') return JSON.stringify({kind:'rejected', message:result.message});
        return JSON.stringify({kind:'unknown'});
    } catch {
        return JSON.stringify({kind:'unknown'});
    } finally { clearTimeout(timer); }
    """#

}

struct ForumUserReference: Hashable {
    let id: Int
    let name: String
    let avatar: URL?
    let tags: [String]
}

struct ForumUserProfile: Decodable {
    struct Role: Decodable {
        let display_text: String?
    }

    let member_id: Int
    let member_name: String
    let rank: Int?
    let bio: String?
    var readme: String?
    var signature_markdown: String?
    let created_at_str: String?
    let nPost: Int?
    let nComment: Int?
    let follows: Int?
    let fans: Int?
    let roles: [Role]?
    var tags: [String] { roles?.compactMap(\.display_text).filter { !$0.isEmpty } ?? [] }
}

struct ForumUnreadCounts: Decodable, Equatable {
    var mentions = 0
    var replies = 0
    var messages = 0
    var total: Int { mentions + replies + messages }

    func count(_ category: InboxCategory) -> Int {
        switch category { case .mentions: mentions; case .replies: replies; case .messages: messages }
    }

    mutating func markRead(_ category: InboxCategory, count: Int) {
        let count = max(0, count)
        switch category {
        case .mentions: mentions = max(0, mentions - count)
        case .replies: replies = max(0, replies - count)
        case .messages: messages = max(0, messages - count)
        }
    }
}
