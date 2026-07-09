import Foundation
import UIKit
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
    private let registerPushURL = URL(string: "https://iduotqxkohuezxkveawc.supabase.co/functions/v1/register-push")!
    private let secretKey = "vf_device_secret"
    private let lastCheckKey = "vf_last_check"
    private let langKey = "vf_lang"
    private let pushTokenKey = "vf_push_token"

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
                sendPushRegistration() // if a push token already arrived, register it now
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
        case "tab":
            // The web mirrors its tab state so the native Liquid Glass bar stays in sync
            // (active tab, notification dot, scroll-compact, and hidden while an overlay is up).
            Task { @MainActor in TabBarModel.shared.apply(dict) }
        case "kreds":
            // The web mirrors its kreds selector (list + active + unread + compact + visible)
            // so the native Liquid Glass kreds bar stays in sync.
            Task { @MainActor in KredsBarModel.shared.apply(dict) }
        case "sheet":
            // The web asks native to show a real iOS 26 Liquid Glass action sheet
            // (report / post menu / unfriend). We render whatever buttons the web sends
            // and call back window.vfSheet(action) with the chosen button. The web owns
            // all flow logic (incl. any follow-up confirmation sheet).
            Task { @MainActor in SheetModel.shared.apply(dict) }
        case "fsheet":
            // The "Ny kreds" (new circle) bottom sheet — real Liquid Glass, web-driven.
            Task { @MainActor in FsheetModel.shared.apply(dict) }
        case "msheet":
            // The "Kredsens medlemmer" (members) bottom sheet — real Liquid Glass, web-driven.
            Task { @MainActor in MemberSheetModel.shared.apply(dict) }
        case "esheet":
            // The "Rediger profil" (edit profile) bottom sheet — real Liquid Glass, web-driven.
            Task { @MainActor in EsheetModel.shared.apply(dict) }
        case "photolib":
            // The native Instagram-style in-app photo/video gallery composer for memories.
            Task { @MainActor in PhotoLibModel.shared.apply(dict) }
        case "comments":
            // The native Instagram-style comment bottom sheet for memory posts — real Liquid Glass,
            // web-driven. Native renders the thread + emoji bar + input; the web runs all the logic.
            Task { @MainActor in CommentsModel.shared.apply(dict) }
        case "logout":
            UserDefaults.standard.removeObject(forKey: secretKey)
            UserDefaults.standard.removeObject(forKey: lastCheckKey)
        case "rewarded":
            // The user chose to watch a rewarded video to earn +20 like-capacity.
            // Native shows it; on full watch it calls back window.VibeFeedAds.rewardEarned.
            if (dict["action"] as? String) == "show" {
                Task { @MainActor in AdsManager.shared.showRewarded() }
            }
        case "ads":
            // The web feed reports the on-screen positions of its sponsored slots
            // so the native MRECs can be laid over them. Slot values are plain
            // numbers/strings (Sendable), so we can hop to the ad actor cleanly.
            let action = dict["action"] as? String

            // Lightweight per-frame scroll update: just the feed's scroll offset, so
            // native can glide the already-placed ads with the feed at full frame rate.
            if action == "scroll" {
                let scrollY = ((dict["scrollY"] as? NSNumber)?.doubleValue) ?? 0
                Task { @MainActor in AdsManager.shared.updateScroll(scrollY: CGFloat(scrollY)) }
                break
            }

            guard action == "layout" else { break }
            let scrolling = (dict["scrolling"] as? Bool) ?? false
            let scrollY = ((dict["scrollY"] as? NSNumber)?.doubleValue) ?? 0
            let raw = (dict["slots"] as? [[String: Any]]) ?? []
            let slots: [AdSlot] = raw.compactMap { s in
                guard let id = s["id"] as? String,
                      let x = (s["x"] as? NSNumber)?.doubleValue,
                      let y = (s["y"] as? NSNumber)?.doubleValue,
                      let w = (s["w"] as? NSNumber)?.doubleValue,
                      let h = (s["h"] as? NSNumber)?.doubleValue else { return nil }
                return AdSlot(id: id, x: CGFloat(x), y: CGFloat(y), w: CGFloat(w), h: CGFloat(h))
            }
            Task { @MainActor in
                AdsManager.shared.updateLayout(slots: slots, scrolling: scrolling, scrollY: CGFloat(scrollY))
            }
        default:
            break
        }
    }

    // MARK: - Tap-to-open (deep link from a tapped notification)

    /// Wired by ContentView: evaluates window.vfOpenNotif(json) in the web view and reports
    /// whether the web was ready to take it (false → retry).
    var onNotifTap: ((String, @escaping (Bool) -> Void) -> Void)?
    private var pendingTapJSON: String?
    private var tapDeliveryRunning = false
    private var tapAttemptsLeft = 0

    /// Called by the app delegate when the user taps a notification. On a cold start the
    /// app was launched BY the tap — the web view hasn't loaded the page yet — so the
    /// payload stays pending and delivery retries until window.vfOpenNotif exists (the web
    /// side then waits for its own boot before navigating).
    func handleNotificationTap(_ userInfo: [AnyHashable: Any]) {
        // Forward every scalar custom key generically (kind/pid/fid/cid + fremtidige),
        // so new payload fields never require an app rebuild. "aps" is Apple's own dict.
        var payload: [String: Any] = [:]
        for (k, v) in userInfo {
            guard let key = k as? String, key != "aps" else { continue }
            if v is String || v is NSNumber { payload[key] = v }
        }
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async {
            self.pendingTapJSON = json // en nyere payload afløser en evt. uleveret ældre...
            self.tapAttemptsLeft = 60  // ...og får sit EGET friske retry-budget (arver ikke den gamles)
            if !self.tapDeliveryRunning {
                self.tapDeliveryRunning = true
                self.deliverPendingTap()
            }
        }
    }

    /// Main-thread single-flight delivery loop (0.5 s × 60 ≈ 30 s pr. payload — rigeligt til en kold start).
    private func deliverPendingTap() {
        guard let json = pendingTapJSON else { tapDeliveryRunning = false; return }
        let retry: () -> Void = {
            if self.tapAttemptsLeft > 0 {
                self.tapAttemptsLeft -= 1
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.deliverPendingTap() }
            } else {
                self.pendingTapJSON = nil
                self.tapDeliveryRunning = false
            }
        }
        guard let deliver = onNotifTap else { retry(); return }
        deliver(json) { delivered in
            if delivered {
                if self.pendingTapJSON == json { self.pendingTapJSON = nil }
                self.deliverPendingTap() // leverer en evt. nyere payload, ellers stopper loopet
            } else {
                retry()
            }
        }
    }

    // MARK: - Permissions & scheduling

    func requestPermission() {
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
                if granted {
                    DispatchQueue.main.async { UIApplication.shared.registerForRemoteNotifications() }
                }
            }
    }

    // MARK: - Push notifications (APNs)

    /// Called by the app delegate when APNs hands us a device token.
    func setPushToken(_ hex: String) {
        UserDefaults.standard.set(hex, forKey: pushTokenKey)
        sendPushRegistration()
    }

    /// Send {device secret, APNs token} to the backend so it can push to this device.
    /// No-op until BOTH the login secret and the APNs token are known.
    private func sendPushRegistration() {
        guard let secret = secret,
              let token = UserDefaults.standard.string(forKey: pushTokenKey), !token.isEmpty else { return }
        var request = URLRequest(url: registerPushURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "secret": secret,
            "token": token,
            "lang": UserDefaults.standard.string(forKey: langKey) ?? "da",
        ])
        request.timeoutInterval = 20
        URLSession.shared.dataTask(with: request).resume()
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
                // Deep-link payload (mirrors the APNs custom keys) so a tap can open the
                // content. Nil-safe: older notif-poll versions send no kind/pid/fid/cid.
                var userInfo: [AnyHashable: Any] = [:]
                for key in ["kind", "pid", "fid", "cid"] {
                    if let v = event[key], v is String || v is NSNumber { userInfo[key] = v }
                }
                content.userInfo = userInfo
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
