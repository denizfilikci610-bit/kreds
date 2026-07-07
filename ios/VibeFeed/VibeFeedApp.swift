import SwiftUI

@main
struct VibeFeedApp: App {
    @Environment(\.scenePhase) private var scenePhase

    init() {
        NotifManager.shared.register()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .background {
                NotifManager.shared.scheduleRefresh()
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

            // The webview lives INSIDE the safe area (iOS supplies the insets
            // natively per device); the background above fills the notch and
            // home-indicator strips in the matching color.
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
        }
    }
}
