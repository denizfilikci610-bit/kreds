import Foundation
import WebKit
import BackgroundTasks
import UserNotifications

/// Bridges the web app's login to native background notifications.
///
/// The web app posts {type:"creds", secret, userId} after login (the secret is
/// a per-device token issued by the backend, only able to read notification
/// summaries). While the app is in the background, iOS periodically runs our
/// BGAppRefresh task, which polls the notif-poll edge function and shows any
/// new events as local notifications.
final class NotifManager: NSObject, WKScriptMessageHandler {
    static let shared = NotifManager()
    static let taskId = "dk.vibefeed.app.refresh"

    private let pollURL = URL(string: "https://iduotqxkohuezxkveawc.supabase.co/functions/v1/notif-poll")!
    private let secretKey = "vf_device_secret"
    private let lastCheckKey = "vf_last_check"
    private let langKey = "vf_lang"

    private var secret: String? {
        UserDefaults.standard.string(forKey: secretKey)
    }

    // MARK: - Messages from the web app

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "vibefeed",
              let dict = message.body as? [String: Any],
              let type = dict["type"] as? String else { return }

        switch type {
        case "creds":
            if let s = dict["secret"] as? String, !s.isEmpty {
                UserDefaults.standard.set(s, forKey: secretKey)
                UserDefaults.standard.set(isoNow(), forKey: lastCheckKey)
                if let lang = dict["lang"] as? String {
                    UserDefaults.standard.set(lang == "en" ? "en" : "da", forKey: langKey)
                }
                requestPermission()
                scheduleRefresh()
            }
        case "consent":
            // "personal" (personalized ads allowed) or "limited" (non-personalized
            // only). Persisted for the ad SDK; AdsManager is notified so it can
            // start ads on first choice (or request ATT on an upgrade at runtime).
            if let value = dict["value"] as? String {
                let normalized = value == "personal" ? "personal" : "limited"
                UserDefaults.standard.set(normalized, forKey: "vf_consent")
                Task { @MainActor in AdsManager.shared.applyConsent(normalized) }
            }
        case "logout":
            UserDefaults.standard.removeObject(forKey: secretKey)
            UserDefaults.standard.removeObject(forKey: lastCheckKey)
        default:
            break
        }
    }

    // MARK: - Permissions & scheduling

    func requestPermission() {
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound]) { _, _ in }
    }

    func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.taskId, using: nil) { [weak self] task in
            guard let refresh = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }
            self?.handleRefresh(task: refresh)
        }
    }

    func scheduleRefresh() {
        guard secret != nil else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.taskId)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    // MARK: - Background poll

    private func handleRefresh(task: BGAppRefreshTask) {
        scheduleRefresh() // always queue the next run

        guard let secret = secret else {
            task.setTaskCompleted(success: true)
            return
        }
        let since = UserDefaults.standard.string(forKey: lastCheckKey)
            ?? isoString(Date(timeIntervalSinceNow: -24 * 3600))

        var request = URLRequest(url: pollURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "secret": secret,
            "since": since,
            "lang": UserDefaults.standard.string(forKey: langKey) ?? "da",
        ])
        request.timeoutInterval = 20

        let dataTask = URLSession.shared.dataTask(with: request) { [weak self] data, _, _ in
            defer { task.setTaskCompleted(success: true) }
            guard let self, let data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let events = json["events"] as? [[String: Any]] else { return }

            for event in events.prefix(5) {
                guard let text = event["text"] as? String else { continue }
                let content = UNMutableNotificationContent()
                content.title = "VibeFeed"
                content.body = text
                content.sound = .default
                let req = UNNotificationRequest(identifier: UUID().uuidString,
                                                content: content, trigger: nil)
                UNUserNotificationCenter.current().add(req)
            }
            if let now = json["now"] as? String {
                UserDefaults.standard.set(now, forKey: self.lastCheckKey)
            }
        }
        task.expirationHandler = { dataTask.cancel() }
        dataTask.resume()
    }

    // MARK: - Helpers

    private func isoNow() -> String { isoString(Date()) }

    private func isoString(_ date: Date) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime]
        return fmt.string(from: date)
    }
}
