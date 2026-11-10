import Foundation
import WebKit

struct ForumActivity: Decodable, Identifiable {
    let post_id: Int
    let title: String?
    let floor_id: Int?
    let text: String?

    var id: String { "\(post_id)-\(floor_id ?? 0)" }

    func destination(floorsPerPage: Int) -> URL {
        let floor = floor_id ?? 0
        let page = floor > 0 ? (floor - 1) / max(1, floorsPerPage) + 1 : 1
        let url = Forum.home.appendingPathComponent("post-\(post_id)-\(page)")
        guard floor > 0, var location = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return url }
        location.fragment = String(floor)
        return location.url ?? url
    }
}

@MainActor
enum ForumDirectory {
    enum Route: String { case discussions, comments, fans, follow }

    private struct Member: Decodable {
        let member_id: Int
        let member_name: String
    }

    private struct Payload: Decodable {
        let memberList: [Member]?
        let discussions: [ForumActivity]?
        let comments: [ForumActivity]?
    }

    static func people(_ term: String) async throws -> [ForumUserReference] {
        guard !term.isEmpty, term.count <= 240 else { return [] }
        let site = ForumWebPage(dataStore: .default())
        try await site.read(Forum.home)
        if site.challenged { throw ForumPageError.verification }
        if try await site.signedIn() == false { throw ForumPageError.signInRequired }
        let value = try await site.webView.callAsyncJavaScript(readPeople, arguments: ["term": term], in: nil, contentWorld: .page)
        try Task.checkCancellation()
        guard let json = value as? String else { throw ForumPageError.changed }
        if json == "signedOut" { throw ForumPageError.signInRequired }
        return references(try JSONDecoder().decode([Member].self, from: Data(json.utf8)))
    }

    static func members(_ route: Route) async throws -> [ForumUserReference] {
        let (payload, _) = try await request(route)
        return references(payload.memberList ?? [])
    }

    private static func references(_ members: [Member]) -> [ForumUserReference] {
        var seen = Set<Int>()
        return members.compactMap { member in
            guard member.member_id > 0, !member.member_name.isEmpty, seen.insert(member.member_id).inserted else { return nil }
            return ForumUserReference(id: member.member_id, name: member.member_name,
                                      avatar: Forum.avatar(member.member_id), tags: [])
        }
    }

    static func activity(_ route: Route, member: Int, page: Int) async throws -> (items: [ForumActivity], floorsPerPage: Int, site: ForumWebPage) {
        let (payload, site) = try await request(route, member: member, page: page)
        let count = route == .comments ? (try? await site.identity())?.floorsPerPage ?? 10 : 10
        return ((route == .comments ? payload.comments : payload.discussions) ?? [], count, site)
    }

    static func publicationDates(for ids: [Int], using site: ForumWebPage) async -> [Int: Date] {
        let value = try? await site.webView.callAsyncJavaScript(readPublicationDates,
            arguments: ["ids": ids], in: nil, contentWorld: .defaultClient)
        guard let json = value as? String,
              let timestamps = try? JSONDecoder().decode([Int: Double].self, from: Data(json.utf8)) else { return [:] }
        return timestamps.mapValues { Date(timeIntervalSince1970: $0 / 1_000) }
    }

    private static func request(_ route: Route, member: Int = 0, page: Int = 1) async throws -> (Payload, ForumWebPage) {
        let site = ForumWebPage(dataStore: .default())
        try await site.read(Forum.home)
        if site.challenged { throw ForumPageError.verification }
        let value = try await site.webView.callAsyncJavaScript(read,
            arguments: ["route": route.rawValue, "member": member, "page": page],
            in: nil, contentWorld: .defaultClient)
        try Task.checkCancellation()
        guard let json = value as? String else { throw ForumPageError.changed }
        if json == "signedOut" { throw ForumPageError.signInRequired }
        return (try JSONDecoder().decode(Payload.self, from: Data(json.utf8)), site)
    }

    private static let readPeople = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) return null;
    const response = await fetch('/api/account/find/' + encodeURIComponent(term), {
        credentials:'same-origin', signal:AbortSignal.timeout(12000)
    });
    if (new URL(response.url).origin !== location.origin) return null;
    const data = await response.json().catch(() => null);
    if (response.status === 401 || /未登录|请登录|not logged in/i.test(data?.message || '')) return 'signedOut';
    // The official endpoint may return HTTP 500 with a 404 in its JSON for a missing username.
    if (/USER NOT FOUND|未找到.{0,12}用户|没有.{0,12}用户/i.test(data?.message || '')) return '[]';
    if (!response.ok || data?.success !== true || !Array.isArray(data.memberList)) return null;
    return JSON.stringify(data.memberList.map(row => ({member_id:Number(row?.member_id), member_name:row?.member_name}))
        .filter(row => Number.isSafeInteger(row.member_id) && row.member_id > 0 && typeof row.member_name === 'string'));
    """#

    private static let readPublicationDates = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) return null;
    const dates = await Promise.all(ids.map(async id => {
        if (!Number.isSafeInteger(id) || id <= 0) return null;
        const path = '/post-' + id + '-1';
        try {
            const response = await fetch(path, {credentials:'same-origin', redirect:'error', signal:AbortSignal.timeout(8000)});
            if (!response.ok || new URL(response.url).pathname !== path) return null;
            // Parse the markup without loading images or executing the post's scripts.
            const page = document.createElement('template');
            page.innerHTML = await response.text();
            const time = page.content.querySelector('.nsk-post-wrapper .content-item[id="0"] > .nsk-content-meta-info .date-created time[datetime]');
            const timestamp = Date.parse(time?.getAttribute('datetime'));
            return Number.isFinite(timestamp) ? [id, timestamp] : null;
        } catch { return null; }
    }));
    return JSON.stringify(Object.fromEntries(dates.filter(Boolean)));
    """#

    private static let read = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) return null;
    let path;
    switch (route) {
        case 'fans': case 'follow': path = '/api/fans/' + route; break;
        case 'discussions': case 'comments':
            if (!Number.isSafeInteger(member) || member <= 0 || !Number.isSafeInteger(page) || page <= 0) return null;
            path = '/api/content/list-' + route + '?uid=' + member + '&page=' + page;
            break;
        default: return null;
    }
    const response = await fetch(path, {credentials:'same-origin', redirect:'error', signal:AbortSignal.timeout(15000)});
    const data = await response.json().catch(() => null);
    if (response.status === 401 || /登录/.test(data?.message || '')) return 'signedOut';
    if (!response.ok || !data || data.success === false) return null;
    return JSON.stringify(data);
    """#
}
