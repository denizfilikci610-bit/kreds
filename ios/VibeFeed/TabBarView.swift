import SwiftUI

/// State for the native tab bar, driven by the web app over the JS bridge
/// (NotifManager handles the `type:"tab"` message and updates this).
final class TabBarModel: ObservableObject {
    static let shared = TabBarModel()
    @Published var active: String = "feed"   // feed | search | chat | akt | profil
    @Published var dot: Bool = false          // notification dot on the bell
    @Published var compact: Bool = false      // scrolled down → shrink
    @Published var visible: Bool = true       // hidden while a sheet/lightbox/profile is on top
    /// Native → web. Set by ContentView to evaluate `window.vfTab(name)` on the web view.
    var onTap: ((String) -> Void)?

    func apply(_ dict: [String: Any]) {
        if let a = dict["active"] as? String { active = a }
        if let d = dict["dot"] as? Bool { dot = d }
        if let c = dict["compact"] as? Bool { compact = c }
        if let v = dict["visible"] as? Bool { visible = v }
    }
}

private struct TabItem: Identifiable {
    let id: String       // matches the web's view name; "compose" is the create action
    let symbol: String
    let isView: Bool     // false for compose (never shows the active highlight)
}

/// Real iOS 26 Liquid Glass on the pill; falls back to a native material blur on iOS 17–25.
private struct GlassPill: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: Capsule())
        } else {
            content
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.primary.opacity(0.10)))
                .shadow(color: .black.opacity(0.16), radius: 12, y: 6)
        }
    }
}

struct NativeTabBar: View {
    @ObservedObject private var model = TabBarModel.shared
    @Namespace private var ns

    // "compose" er flyttet ud til de flydende knapper (NativeComposeButtons).
    // Midterpladsen er nu BESKEDER (kreds-chat, Messenger-agtig) → 5 faner.
    private let items: [TabItem] = [
        .init(id: "feed",    symbol: "house.fill",              isView: true),
        .init(id: "search",  symbol: "magnifyingglass",        isView: true),
        .init(id: "chat",    symbol: "message.fill",           isView: true),
        .init(id: "akt",     symbol: "bell.fill",              isView: true),
        .init(id: "profil",  symbol: "person.crop.circle.fill", isView: true),
    ]

    var body: some View {
        HStack(spacing: 0) {
            ForEach(items) { item in
                Button {
                    if item.isView { model.active = item.id }   // optimistisk highlight
                    model.onTap?(item.id)
                } label: {
                    ZStack {
                        if item.isView && model.active == item.id {
                            Capsule()
                                .fill(Color.primary.opacity(0.14))
                                .matchedGeometryEffect(id: "tabhl", in: ns)
                                .frame(height: 40)
                                .padding(.horizontal, 5)
                        }
                        Image(systemName: item.symbol)
                            .font(.system(size: 21, weight: .semibold))
                            .foregroundStyle(Color.primary)
                            .overlay(alignment: .topTrailing) {
                                if item.id == "akt" && model.dot {
                                    Circle().fill(Color.red)
                                        .frame(width: 8, height: 8)
                                        .offset(x: 6, y: -3)
                                }
                            }
                    }
                    .frame(maxWidth: .infinity, minHeight: 58)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 6)
        .frame(height: 58)
        .modifier(GlassPill())
        .padding(.horizontal, 16)
        // Scroll ned (compact) → bjælken glider helt væk; scroll op → den kommer tilbage.
        .offset(y: (model.compact ? 130 : 0))
        .opacity((model.visible && !model.compact) ? 1 : 0)
        .allowsHitTesting(model.visible && !model.compact)
        .animation(.spring(response: 0.4, dampingFraction: 0.72), value: model.active)
        .animation(.spring(response: 0.34, dampingFraction: 0.86), value: model.compact)
        .animation(.easeInOut(duration: 0.2), value: model.visible)
    }
}

/// To flydende opret-knapper (minde + tanke), nederst til højre. Altid synlige mens vi er
/// på feed-fanen (de gemmer sig IKKE ved scroll som bjælken), men skjules når et ark/overlay
/// ligger ovenpå (model.visible). Trykker direkte til web uden om vælgeren via window.vfTab.
struct NativeComposeButtons: View {
    @ObservedObject private var model = TabBarModel.shared
    private let accent = Color(red: 0xE0 / 255, green: 0x40 / 255, blue: 0x2F / 255)

    private var shown: Bool { model.visible && model.active == "feed" }

    var body: some View {
        VStack(spacing: 14) {
            composeButton(symbol: "photo.fill", action: "compose-memory") // minde — øverst
            composeButton(symbol: "plus",       action: "compose-thought") // tanke — nederst (nemmest at nå)
        }
        // Scroll ned (bjælken forsvinder) → knapperne glider med ned i den frigjorte plads.
        // Scroll op (bjælken fremme) → de rykker op og hugger sig tæt til bjælken igen.
        // Fed, let bouncende spring på bevægelsen.
        .offset(y: model.compact ? 44 : 0)
        .opacity(shown ? 1 : 0)
        .allowsHitTesting(shown)
        .animation(.spring(response: 0.42, dampingFraction: 0.58), value: model.compact)
        .animation(.easeInOut(duration: 0.2), value: shown)
    }

    private func composeButton(symbol: String, action: String) -> some View {
        Button {
            model.onTap?(action)
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 56, height: 56)
                .background(accent, in: Circle())
                .shadow(color: .black.opacity(0.22), radius: 10, y: 4)
        }
        .buttonStyle(.plain)
    }
}
