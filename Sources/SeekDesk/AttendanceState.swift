import Foundation
import Combine

@MainActor
final class AttendanceState: ObservableObject {
    struct Reward {
        let member: Int
        let result: ForumAttendanceResult
    }

    private struct Record: Codable {
        let day: Date
        let result: ForumAttendanceResult
    }

    private let defaults: UserDefaults
    @Published private var records: [Int: Record] = [:]
    @Published private var pendingMember: Int?
    @Published private(set) var reward: Reward?

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func status(for member: Int) -> String {
        if pendingMember == member { return "正在签到…" }
        return record(for: member, on: ForumAttendanceDay.start(Date()))?.result.title ?? "等待签到"
    }

    func needsVerification(for member: Int) -> Bool {
        record(for: member, on: ForumAttendanceDay.start(Date()))?.result.kind == .verification
    }

    func run(member: Int, session: ForumSession, extensions: DeskExtensions) async {
        while !Task.isCancelled && authorized(member, session, extensions) {
            let now = Date()
            let day = ForumAttendanceDay.start(now)
            let nextMidnight = ForumAttendanceDay.next(after: now)
            var nextAttempt = nextMidnight
            if record(for: member, on: day)?.result.done != true {
                if pendingMember != nil {
                    nextAttempt = min(nextMidnight, now.addingTimeInterval(3))
                } else {
                    pendingMember = member
                    let mode = extensions.attendanceMode
                    let result = await session.attend(member: member, mode: mode) {
                        self.authorized(member, session, extensions) && mode == extensions.attendanceMode &&
                            day == ForumAttendanceDay.start(Date())
                    }
                    pendingMember = nil
                    if let result {
                        let record = Record(day: day, result: result)
                        records[member] = record
                        if result.done, let data = try? JSONEncoder().encode(record) {
                            defaults.set(data, forKey: recordKey(member))
                        }
                        if result.kind == .completed, session.ownProfile?.id == member {
                            reward = Reward(member: member, result: result)
                        }
                    }
                    switch result?.kind {
                    case .completed, .alreadyCompleted: break
                    case .verification: nextAttempt = min(nextMidnight, Date().addingTimeInterval(1800))
                    case .signedOut, .failed: nextAttempt = min(nextMidnight, Date().addingTimeInterval(600))
                    case nil: nextAttempt = min(nextMidnight, Date().addingTimeInterval(3))
                    }
                }
            }
            do { try await Task.sleep(for: .seconds(max(0.2, nextAttempt.timeIntervalSinceNow))) } catch { return }
        }
    }

    func dismissReward() { reward = nil }

    private func authorized(_ member: Int, _ session: ForumSession, _ extensions: DeskExtensions) -> Bool {
        extensions.active(.attendance) && extensions.autoAttendance &&
            session.account == .signedIn && session.ownProfile?.id == member
    }

    private func recordKey(_ member: Int) -> String { "extensions.attendance.result.\(member)" }

    private func record(for member: Int, on day: Date) -> Record? {
        if let record = records[member], record.day == day { return record }
        guard let data = defaults.data(forKey: recordKey(member)),
              let record = try? JSONDecoder().decode(Record.self, from: data),
              record.day == day else { return nil }
        return record
    }
}
