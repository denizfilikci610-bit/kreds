import SwiftUI

/// State for the native tab bar, driven by the web app over the JS bridge
/// (NotifManager handles the `type:"tab"` message and updates this).
final class TabBarModel: ObservableObject {
    static let shared = TabBarModel()
    @Published var active: String = "feed"   // feed | search | akt | profil
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

    private let items: [TabItem] = [
        .init(id: "feed",    symbol: "house.fill",              isView: true),
        .init(id: "search",  symbol: "magnifyingglass",        isView: true),
        .init(id: "compose", symbol: "plus.app",               isView: false),
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
        .scaleEffect(model.compact ? 0.86 : 1.0, anchor: .bottom)
        .opacity(model.visible ? 1 : 0)
        .allowsHitTesting(model.visible)
        .animation(.spring(response: 0.4, dampingFraction: 0.72), value: model.active)
        .animation(.spring(response: 0.32, dampingFraction: 0.82), value: model.compact)
        .animation(.easeInOut(duration: 0.2), value: model.visible)
    }
}
