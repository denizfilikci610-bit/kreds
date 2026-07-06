import SwiftUI

@main
struct VibeFeedApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
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

            WebView(model: model)
                .ignoresSafeArea()

            if model.failed {
                VStack(spacing: 14) {
                    Text("VibeFeed.")
                        .font(.custom("Georgia-Bold", size: 40))
                    Text("Kunne ikke oprette forbindelse.\nTjek din internetforbindelse.")
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                    Button("Prøv igen") {
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
