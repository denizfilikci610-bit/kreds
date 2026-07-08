import SwiftUI
import UIKit
import UserNotifications

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
}

@main
struct VibeFeedApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    init() {
        NotifManager.shared.register()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                // Ads only start once the app is active and consent is known.
                AdsManager.shared.appDidBecomeActive()
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
            Color(UIColor { trait in
                trait.userInterfaceStyle == .dark ? .black : .white
            })
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
                    let danish = (UserDefaults.standard.string(forKey: "vf_lang") ?? "da") != "en"
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
                    .background(Color(UIColor.systemBackground))
                }

                InlineAdsOverlay()
            }
            .ignoresSafeArea()

            // Native Liquid Glass tab bar, floating over the web view. It mirrors the web's
            // tab state (active/dot/compact/visible) and routes taps back via window.vfTab.
            VStack {
                Spacer()
                NativeTabBar()
                    .padding(.bottom, -6)
            }
            .ignoresSafeArea(.keyboard, edges: .bottom)
        }
        .onAppear {
            TabBarModel.shared.onTap = { name in
                model.webView?.evaluateJavaScript("window.vfTab && window.vfTab('\(name)')", completionHandler: nil)
            }
        }
    }
}
