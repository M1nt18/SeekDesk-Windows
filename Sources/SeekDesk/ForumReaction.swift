import Foundation

enum ForumReactionKind: String, CaseIterable, Identifiable {
    case upvote, chicken = "like", dislike

    var id: Self { self }
    var title: String {
        switch self {
        case .upvote: "点赞"
        case .chicken: "送鸡腿"
        case .dislike: "点踩"
        }
    }
}

struct ForumReactionTarget: Hashable {
    let postID: Int
    let floor: Int
    let kind: ForumReactionKind
}

enum ForumReactionApproval: String { case direct, quote, free, paid }

struct ForumReactionResult: Decodable {
    enum Kind: String, Decodable {
        case accepted, already, confirmFree, confirmPaid, signedOut, verification, rejected, unavailable, unknown
    }

    let kind: Kind
    var count: Int? = nil
    var coin: Int? = nil
    var message: String? = nil
}

enum ForumReactionScript {
    static let request = #"""
    const finish = (kind, fields = {}) => JSON.stringify({kind, ...fields});
    const route = /^\/post-(\d+)-\d+\/?$/.exec(location.pathname);
    if (location.protocol !== 'https:' || !['www.nodeseek.com','nodeseek.com'].includes(location.host) ||
        Number(route?.[1]) !== postID) return finish('unavailable');
    const config = window.__config__;
    if (!config) return finish('unavailable');
    if (!config.user) return finish('signedOut');
    const data = config.postData;
    if (Number(config.user.member_id) !== owner || Number(data?.postId) !== postID || !Array.isArray(data?.comments)) {
        return finish('unavailable');
    }
    const item = data.comments.find(row => Number(row.floorIndex) === floor);
    const commentId = Number(item?.commentId);
    if (!Number.isSafeInteger(commentId) || commentId <= 0) return finish('unavailable');
    const fields = {upvote:['upvoted','upvoteCount'], like:['liked','likeCount'], dislike:['disliked','dislikeCount']};
    if (!Object.hasOwn(fields, kind)) return finish('unavailable');
    const [flag, counter] = fields[kind];
    const int = value => value != null && value !== '' && Number.isSafeInteger(Number(value)) ? Number(value) : null;
    if ([true,1,'1'].includes(item[flag])) return finish('already', {count:int(item[counter])});
    if ((kind === 'upvote' && approval !== 'direct') || (kind === 'dislike' && approval !== 'paid') ||
        (kind === 'like' && !['quote','free','paid'].includes(approval))) return finish('unavailable');

    const options = {credentials:'same-origin', redirect:'error', cache:'no-store'};
    const accessIssue = response => response.headers.get('cf-mitigated') === 'challenge' ? 'verification' :
        response.status === 401 ? 'signedOut' : null;
    try {
        if (kind === 'like' && approval !== 'paid') {
            const quota = await fetch('/api/progress/today?scope=freelike', {...options, signal:AbortSignal.timeout(12000)});
            const issue = accessIssue(quota);
            if (issue) return finish(issue);
            const status = await quota.json().catch(() => null);
            const limit = int(status?.maxFreeLike), used = int(status?.freeLikeUsed);
            if (!quota.ok || limit == null || used == null) {
                return finish('rejected', {message:'暂时无法核对免费鸡腿额度，请稍后重试。'});
            }
            const free = limit > used;
            if (approval === 'quote' || !free) return finish(free ? 'confirmFree' : 'confirmPaid');
        }

        const response = await fetch('/api/statistics/' + kind, {
            ...options, method:'POST', signal:AbortSignal.timeout(15000), headers:{'Content-Type':'application/json'},
            body:JSON.stringify({commentId, action:'add'})
        });
        const issue = accessIssue(response);
        if (issue) return finish(issue);
        const result = await response.json().catch(() => null);
        const message = typeof result?.message === 'string' ? result.message : null;
        if (response.ok && result?.success === true) {
            return finish('accepted', {count:int(result.current), coin:int(result.coin)});
        }
        if (result?.success === false || [403,429].includes(response.status)) return finish('rejected', {message});
    } catch {}
    return finish(approval === 'quote' ? 'rejected' : 'unknown');
    """#
}
