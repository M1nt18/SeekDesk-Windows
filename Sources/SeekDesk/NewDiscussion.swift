import Foundation

struct DiscussionOptions: Decodable {
    struct Category: Decodable, Identifiable {
        let id: String
        let title: String
    }
    let kind: String
    let categories: [Category]?
    let maxRank: Int?
}

struct DiscussionResponse: Decodable {
    let kind: String
    let redirect: String?
    let message: String?

    var topicURL: URL? {
        guard kind == "accepted", let redirect, let url = URL(string: redirect, relativeTo: Forum.home)?.absoluteURL,
              Forum.topicID(url) != nil else { return nil }
        return Forum.pageURL(url)
    }
}

enum DiscussionScript {
    static let page = Forum.home.appendingPathComponent("new-discussion")

    static let options = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host)) {
        return JSON.stringify({kind:'unavailable'});
    }
    if (location.pathname === '/signIn.html') return JSON.stringify({kind:'signedOut'});
    if (location.pathname !== '/new-discussion' || !document.querySelector('#editor')) {
        if (window.__config__ && !window.__config__.user) return JSON.stringify({kind:'signedOut'});
        return JSON.stringify({kind:'unavailable'});
    }
    const config = window.__config__;
    if (!config) return JSON.stringify({kind:'unavailable'});
    if (!config.user) return JSON.stringify({kind:'signedOut'});
    let select = document.querySelector('select#category');
    for (let i = 0; !select && i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 120));
        select = document.querySelector('select#category');
    }
    const categories = [...(select?.options || [])].filter(option => !option.disabled && /^[a-z][a-z0-9-]{0,63}$/.test(option.value))
        .map(option => ({id:option.value, title:option.textContent.trim()}));
    return JSON.stringify({kind:categories.length ? 'ready' : 'unavailable', categories, maxRank:Number(config.user.rank) || 0});
    """#

    static let publish = #"""
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        location.pathname !== '/new-discussion' || !document.querySelector('#editor')) {
        return JSON.stringify({kind:'unavailable'});
    }
    if (!window.__config__?.user) return JSON.stringify({kind:'signedOut'});
    const categoryOption = [...(document.querySelector('select#category')?.options || [])]
        .find(option => option.value === category && !option.disabled);
    if (!categoryOption || !Number.isInteger(rank) || rank < 0 ||
        (rank !== 255 && rank > Number(window.__config__.user.rank || 0))) {
        return JSON.stringify({kind:'rejected',message:'请重新选择可发帖的版块和阅读权限。'});
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), n => alphabet[n % alphabet.length]).join('');
    try {
        const result = await fetch('/api/content/new-discussion', {
            method:'POST', credentials:'same-origin', redirect:'error', signal:AbortSignal.timeout(22000),
            headers:{'Content-Type':'application/json','csrf-token':token},
            body:JSON.stringify({mode:'new-discussion',title,content,category,rank})
        });
        if (result.headers.get('cf-mitigated') === 'challenge') return JSON.stringify({kind:'verification'});
        if (result.status === 401) return JSON.stringify({kind:'signedOut'});
        const body = await result.json().catch(() => null);
        if (result.ok && body?.success === true) {
            return JSON.stringify({kind:'accepted',redirect:typeof body.redirect === 'string' ? body.redirect : null});
        }
        if (body?.success === false || result.status === 403 || result.status === 429) {
            return JSON.stringify({kind:'rejected',message:typeof body?.message === 'string' ? body.message : null});
        }
        return JSON.stringify({kind:'unknown'});
    } catch {
        return JSON.stringify({kind:'unknown'});
    }
    """#
}
