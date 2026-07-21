import SwiftUI
import UIKit
import UserNotifications
import AVFAudio

/// Receives the APNs device token and shows pushes while the app is open.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication,
                     didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotifManager.shared.setPushToken(hex)
    }

    func application(_ application: UIApplication,
                     didFailToRegisterForRemoteNotificationsWithError error: Error) {
        // Best-effort — the app works fine without push.
    }

    // Show incoming pushes even when the app is in the foreground.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound, .badge])
    }

    // Tap on a notification (APNs push or poll-generated local) → open the content it is
    // about. For APNs the custom keys {kind,pid,fid} sit directly in userInfo (next to
    // "aps"); local notifications mirror them. On a cold start the app was launched BY
    // the tap, so NotifManager keeps the payload pending until the web app can take it.
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        NotifManager.shared.handleNotificationTap(response.notification.request.content.userInfo)
        completionHandler()
    }
}

@main
struct VibeFeedApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    init() {
        NotifManager.shared.register()
        // Video sound in the media viewer must play even when the ringer switch is on
        // silent (Instagram/X behavior). .playback overrides the switch; the session is
        // only ACTIVATED by WebKit when media actually plays, so other apps' audio is
        // untouched until then.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // No-op indtil web'en har meldt adsLive:true (kill-switch i js/ads.js);
                // først derefter tæller samtykke, SDK-init og ATT overhovedet.
                AdsManager.shared.appDidBecomeActive()
                // Åbning = notifikationer "set": nulstil app-ikonets badge (lokalt + server)
                NotifManager.shared.appDidBecomeActive()
            case .background:
                NotifManager.shared.scheduleRefresh()
            default:
                break
            }
        }
    }
}

struct ContentView: View {
    @StateObject private var model = WebViewModel()

    var body: some View {
        ZStack {
            // Match the app's background so the notch/home areas blend in
            vfBackground
                .ignoresSafeArea()

            // The web view fills the ENTIRE screen (edge-to-edge). iOS reports the real
            // safe-area insets to the page via env(safe-area-inset-*), and the web owns
            // the safe areas (backgrounds run to the edges, content is padded away from
            // the notch/home indicator). The native ad overlay sits directly ON TOP of it
            // in the same full-screen coordinate space, so it can position MRECs over the
            // feed's sponsored slots; every non-ad touch passes through to the web view.
            ZStack {
                WebView(model: model)

                if model.failed {
                    let danish = (UserDefaults.standard.string(forKey: "vf_lang") ?? "da") == "da" // øvrige 31 sprog → engelsk fejltekst
                    VStack(spacing: 14) {
                        Text("VibeFeed.")
                            .font(.custom("Georgia-Bold", size: 40))
                        Text(danish
                            ? "Kunne ikke oprette forbindelse.\nTjek din internetforbindelse."
                            : "Could not connect.\nCheck your internet connection.")
                            .multilineTextAlignment(.center)
                            .foregroundColor(.secondary)
                        Button(danish ? "Prøv igen" : "Try again") {
                            model.retry()
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Color(red: 0xE0 / 255, green: 0x40 / 255, blue: 0x2F / 255))
                    }
                    .padding(30)
                    .background(vfBackground)
                }

                InlineAdsOverlay()
            }
            .ignoresSafeArea()

            // Native Liquid Glass kreds selector, floating at the top (feed tab only).
            VStack {
                NativeKredsBar()
                Spacer()
            }
            .ignoresSafeArea(.keyboard, edges: .bottom)

            // Native Liquid Glass tab bar, floating over the web view. It mirrors the web's
            // tab state (active/dot/compact/visible) and routes taps back via window.vfTab.
            VStack {
                Spacer()
                NativeTabBar()
                    .padding(.bottom, -6)
            }
            .ignoresSafeArea(.keyboard, edges: .bottom)

            // Native flydende opret-knapper (minde + tanke), nederst til højre, over bjælken.
            VStack {
                Spacer()
                HStack {
                    Spacer()
                    NativeComposeButtons()
                        .padding(.trailing, 18)
                        .padding(.bottom, 60)   // tæt på bjælken når den er fremme (glider ned ved scroll)
                }
            }
            .ignoresSafeArea(.keyboard, edges: .bottom)
        }
        // Native full-screen post detail page for thoughts (post + comment thread, swipe-back),
        // web-driven. Applied FIRST so the glass action cards below present on top of it.
        .modifier(PostPageHost())
        // Native full-screen friends/kredse list page (Instagram-style), web-driven.
        .modifier(ListPageHost())
        // Real iOS 26 Liquid Glass action sheets (report / post menu / unfriend),
        // presented on top of everything and driven by the web over the JS bridge.
        .modifier(SheetHost())
        // Real iOS 26 Liquid Glass bottom sheets (new circle / members / edit profile), web-driven.
        .modifier(FsheetHost())
        .modifier(MemberSheetHost())
        .modifier(EsheetHost())
        // Native Instagram-style in-app photo/video gallery composer for memories.
        .modifier(PhotoLibHost())
        // Native Instagram-style comment bottom sheet for memory posts, web-driven.
        .modifier(CommentsSheetHost())
        // Universal links (vibefeed.dk/?token_hash=… fra auth-mails) åbner APPEN — linket
        // sendes ind i webviewet, hvor SPA'ens landing veksler tokenet og viser bekræft-/
        // nulstillingsskærmen. Kold start håndteres af pendingDeepLink i WebViewModel.
        // iOS leverer ad TO kanaler afhængigt af situationen (kold/varm, Mail/andre apps):
        // browsing-web-useractivity OG openURL — lyt på begge (dobbelt levering er harmløs:
        // samme URL loades blot igen).
        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
            if let url = activity.webpageURL { model.openDeepLink(url) }
        }
        .onOpenURL { url in
            model.openDeepLink(url)
        }
        .onAppear {
            TabBarModel.shared.onTap = { name in
                model.webView?.evaluateJavaScript("window.vfTab && window.vfTab('\(name)')", completionHandler: nil)
            }
            KredsBarModel.shared.onTap = { id in
                model.webView?.evaluateJavaScript("window.vfKreds && window.vfKreds('\(id)')", completionHandler: nil)
            }
            SheetModel.shared.onAction = { action in
                model.webView?.evaluateJavaScript("window.vfSheet && window.vfSheet('\(action)')", completionHandler: nil)
            }
            // The bottom sheets send a JSON object literal (actions carry payload).
            FsheetModel.shared.onAction = { json in
                model.webView?.evaluateJavaScript("window.vfFsheet && window.vfFsheet(\(json))", completionHandler: nil)
            }
            MemberSheetModel.shared.onAction = { json in
                model.webView?.evaluateJavaScript("window.vfMember && window.vfMember(\(json))", completionHandler: nil)
            }
            EsheetModel.shared.onAction = { json in
                model.webView?.evaluateJavaScript("window.vfEsheet && window.vfEsheet(\(json))", completionHandler: nil)
            }
            // Picked photo (base64 data URL — no quotes/backslashes) is staged in the web for Save.
            EsheetModel.shared.onAvatar = { dataURL in
                model.webView?.evaluateJavaScript("window.vfAvatar && window.vfAvatar('\(dataURL)')", completionHandler: nil)
            }
            // Picked profile banner — same staging pattern, committed on Save.
            EsheetModel.shared.onBanner = { dataURL in
                model.webView?.evaluateJavaScript("window.vfBanner && window.vfBanner('\(dataURL)')", completionHandler: nil)
            }
            // Native memory gallery: the web returns a Storage upload URL, native uploads the media
            // directly (bypassing CSP/scheme limits), then the web creates the post.
            PhotoLibModel.shared.onShare = { json in
                model.webView?.evaluateJavaScript("window.vfMemory && window.vfMemory(\(json))", completionHandler: nil)
            }
            PhotoLibModel.shared.onUploaded = {
                model.webView?.evaluateJavaScript("window.vfMemoryUploaded && window.vfMemoryUploaded()", completionHandler: nil)
            }
            PhotoLibModel.shared.onUploadFailed = {
                model.webView?.evaluateJavaScript("window.vfMemoryUploadFailed && window.vfMemoryUploadFailed()", completionHandler: nil)
            }
            PhotoLibModel.shared.onCancel = {
                model.webView?.evaluateJavaScript("window.vfMemoryCancel && window.vfMemoryCancel()", completionHandler: nil)
            }
            PhotoLibModel.shared.onFallback = {
                model.webView?.evaluateJavaScript("window.vfMemoryFallback && window.vfMemoryFallback()", completionHandler: nil)
            }
            // The comment sheet sends a JSON object literal (send/like/reply/delete/dismiss carry payload).
            CommentsModel.shared.onAction = { json in
                model.webView?.evaluateJavaScript("window.vfComments && window.vfComments(\(json))", completionHandler: nil)
            }
            // The post detail page sends a JSON object literal (send/like/vote/share/menu/… carry payload).
            PostPageModel.shared.onAction = { json in
                model.webView?.evaluateJavaScript("window.vfPostPage && window.vfPostPage(\(json))", completionHandler: nil)
            }
            // The friends/kredse list page sends a JSON object literal (profile/kreds/dismiss).
            ListPageModel.shared.onAction = { json in
                model.webView?.evaluateJavaScript("window.vfListPage && window.vfListPage(\(json))", completionHandler: nil)
            }
            // Notification tap → hand the payload to the web app. Reports whether the web
            // was ready (vfOpenNotif defined); NotifManager retries on a cold start until it is.
            NotifManager.shared.onNotifTap = { json, done in
                guard let web = model.webView else { done(false); return }
                web.evaluateJavaScript("window.vfOpenNotif ? (window.vfOpenNotif(\(json)), true) : false") { result, _ in
                    done((result as? Bool) == true)
                }
            }
        }
    }
}
