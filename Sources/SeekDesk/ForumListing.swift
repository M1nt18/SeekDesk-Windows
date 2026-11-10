import Foundation
import WebKit

@MainActor
enum ForumListing {
    static func fetch(_ url: URL) async throws -> ForumListingPage {
        let page = ForumWebPage(dataStore: .default())
        try await page.read(url)
        if page.challenged { throw ForumPageError.verification }
        if page.webView.url?.path == Forum.signIn.path || page.status == 401 { throw ForumPageError.signInRequired }
        guard let actual = page.webView.url, Forum.contains(actual), (actual.path == url.path || (url.path.hasPrefix("/search") && actual.path.hasPrefix("/search"))) else {
            throw ForumPageError.network
        }
        let result = try await page.webView.callAsyncJavaScript(extract, arguments: [:], in: nil, contentWorld: .defaultClient)
        guard let json = result as? String else { throw ForumPageError.changed }
        let payload = try JSONDecoder().decode(Payload.self, from: Data(json.utf8))
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions.insert(.withFractionalSeconds)
        let standard = ISO8601DateFormatter()
        var seen = Set<String>()
        let posts: [FeedPost] = payload.rows.compactMap { row in
            guard let id = Forum.topicID(row.url), !row.title.isEmpty, seen.insert(id).inserted else { return nil }
            let avatar = row.avatar.flatMap { Forum.contains($0) && $0.path.hasPrefix("/avatar/") ? $0 : nil }
            return FeedPost(id: id, url: row.url, title: row.title, author: row.author, category: row.category,
                published: fractional.date(from: row.date) ?? standard.date(from: row.date), summary: "", authorID: row.authorID,
                readingRank: row.readingRank, featured: row.featured, listedAvatarURL: avatar)
        }
        guard payload.rows.isEmpty || !posts.isEmpty else { throw ForumPageError.changed }
        return ForumListingPage(posts: posts, next: payload.next)
    }

    private struct Payload: Decodable {
        struct Row: Decodable {
            let url: URL
            let title: String
            let author: String
            let authorID: Int?
            let avatar: URL?
            let category: String
            let date: String
            let readingRank: Int?
            let featured: Bool
        }
        let rows: [Row]
        let next: URL?
    }

    private static let extract = #"""
    const main = document.querySelector('#nsk-body-left') || document.querySelector('#nsk-frame');
    if (!main) return null;
    const isSearch = /^\/search(?:\/|$)/.test(location.pathname);
    const isAward = /^\/award(?:\/|$)/.test(location.pathname);
    const lists = [...main.querySelectorAll(':scope > ul.post-list')];
    if (!lists.length && (isAward || isSearch)) lists.push(...main.querySelectorAll('ul.post-list'));
    if (!lists.length && !isSearch) return null;
    const text = element => element?.textContent.trim() ?? '';
    let results = (isAward && lists.length ? lists : [lists[0] || main])
        .flatMap(list => [...list.querySelectorAll('.post-list-item, .search-result-item')]);
    if (isSearch && !results.length) {
        results = [...main.querySelectorAll('.post-title, h2, h3')].map(title => title.closest('li') || title.parentElement);
    }
    const rows = results.flatMap(row => {
        const link = row.querySelector('.post-title a[href^="/post-"], a[href^="/post-"]');
        if (!link) return [];
        const category = row.querySelector('.post-category, a[href^="/categories/"]')?.getAttribute('href')?.split('/').pop() ?? '';
        const author = row.querySelector('.info-author a') || row.querySelector('a[href^="/space/"]');
        const authorID = Number(author?.getAttribute('href')?.match(/^\/space\/(\d+)$/)?.[1]) || null;
        const photo = row.querySelector('img.avatar-normal') || author?.querySelector('img');
        const avatar = photo?.getAttribute('data-src') || photo?.getAttribute('src');
        const title = link.closest('.post-title, h2, h3') || row.querySelector('.post-title');
        const lock = title?.querySelector('use[href="#lock"]')?.closest('span');
        const restriction = text(lock);
        const level = Number(/^[1-9]\d{0,2}$/.test(restriction) ? restriction : 0);
        const readingRank = restriction === '私有' ? 255 : (level > 0 && level <= 255 ? level : null);
        const featured = Boolean(title?.querySelector('a[href="/award"] use[href="#diamonds"]'));
        return [{url:link.href, title:text(link), author:text(author) || photo?.alt || '', authorID,
            avatar: avatar && /^\/avatar\//.test(avatar) ? new URL(avatar, location.origin).href : null,
            category, date:row.querySelector('time[datetime]')?.getAttribute('datetime') ?? '', readingRank, featured}];
    });
    let next = main.querySelector('[aria-label="pagination"] a[rel="next"], a.pager-next[href], .pagination a[rel="next"]');
    if (!next && isAward) {
        const current = Number(location.pathname.match(/\/page-(\d+)$/)?.[1] ?? 1);
        const nextPath = '/award/page-' + (current + 1);
        next = [...main.querySelectorAll('.pagination a[href]')].find(link => link.pathname === nextPath);
    }
    return JSON.stringify({rows, next:next?.href ?? null});
    """#
}
