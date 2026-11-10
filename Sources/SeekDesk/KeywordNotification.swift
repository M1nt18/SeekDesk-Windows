import Foundation
import UserNotifications

enum KeywordNotification {
    static let identifierPrefix = "seekdesk.keyword."
    static let topicKey = "topicURL"

    static func request(for hits: [DeskExtensions.Hit]) -> UNNotificationRequest? {
        guard let first = hits.first, Forum.topicID(first.post.url) != nil else { return nil }
        let content = UNMutableNotificationContent()
        content.title = hits.count == 1 ? "SeekDesk · 关键词命中" : "SeekDesk · \(hits.count) 篇帖子命中"
        content.subtitle = first.words.joined(separator: "、")
        content.body = first.post.title
        content.sound = .default
        content.threadIdentifier = identifierPrefix
        content.userInfo = [topicKey: first.post.url.absoluteString]
        return UNNotificationRequest(identifier: identifierPrefix + first.id, content: content, trigger: nil)
    }
}
