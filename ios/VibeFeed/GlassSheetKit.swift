import SwiftUI

/// Shared building blocks for the native Liquid Glass bottom sheets (#fsheet "Ny kreds" and
/// #msheet "Kredsens medlemmer"). Same web-driven pattern as the report card (SheetView.swift):
/// the web pushes a data snapshot, native renders real glass, native reports taps back, the web
/// owns all logic/RPCs/i18n. Browser + older builds keep the CSS sheets (capability-flag gated).

let vfRed = Color(red: 0xE0 / 255, green: 0x40 / 255, blue: 0x2F / 255)

/// Appens baggrund. SKAL matche webbens --bg (css/app.css): off-white i lys, #161616 i mørk.
/// Bruges alle steder native ellers ville vise systemBackground (rent hvid/sort).
let vfBackground = Color(UIColor { trait in
    trait.userInterfaceStyle == .dark
        ? UIColor(red: 0x16 / 255, green: 0x16 / 255, blue: 0x16 / 255, alpha: 1)
        : UIColor(red: 0xFA / 255, green: 0xF9 / 255, blue: 0xF6 / 255, alpha: 1)
})

/// Parse a web hex color ("#RRGGBB" / "#RGB") to a SwiftUI Color.
func vfColor(_ hex: String) -> Color {
    var s = hex.trimmingCharacters(in: .whitespaces)
    if s.hasPrefix("#") { s.removeFirst() }
    s = s.uppercased()
    if s.count == 3 { s = s.map { "\($0)\($0)" }.joined() }
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return Color.gray }
    return Color(red: Double((v >> 16) & 0xFF) / 255,
                 green: Double((v >> 8) & 0xFF) / 255,
                 blue: Double(v & 0xFF) / 255)
}

/// Real iOS 26 Liquid Glass on any shape; `.ultraThinMaterial` fallback on iOS 17–25. Clips the
/// glass's downward shadow (the dark-line lesson from the kreds chips).
struct GlassBG<S: Shape>: ViewModifier {
    let shape: S
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: shape).clipShape(shape)
        } else {
            content
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.stroke(Color.primary.opacity(0.10), lineWidth: 1))
                .clipShape(shape)
        }
    }
}
extension View {
    func glassBG<S: Shape>(_ shape: S) -> some View { modifier(GlassBG(shape: shape)) }
}

/// Avatar matching the web `avaHTML`: a real photo when available, else the gradient-initials
/// chip (web `grad(h)` = linear-gradient(140deg, g[0], g[1]) + `ini(h)`), pushed as [hex, hex].
struct GlassAvatar: View {
    let url: String
    let initials: String
    let gradient: [String]
    var size: CGFloat = 44

    var body: some View {
        Group {
            if !url.isEmpty, let u = URL(string: url) {
                AsyncImage(url: u) { img in img.resizable().scaledToFill() } placeholder: { chip }
            } else {
                chip
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var chip: some View {
        let cols = gradient.count >= 2 ? [vfColor(gradient[0]), vfColor(gradient[1])] : [Color.gray, Color.gray.opacity(0.7)]
        return LinearGradient(colors: cols, startPoint: .top, endPoint: .bottom)
            .overlay(
                Text(initials)
                    .font(.system(size: size * 0.36, weight: .bold))
                    .foregroundStyle(.white)
            )
    }
}

/// A bottom-pinned glass sheet: a real-glass, top-rounded panel with a drag grabber that
/// dismisses on a downward flick. Content is provided by the caller; scrim + presentation live
/// in each sheet's Host modifier.
struct GlassBottomSheet<Content: View>: View {
    var maxHeightFraction: CGFloat = 0.85
    var onDismiss: () -> Void
    var content: Content
    @State private var dragY: CGFloat = 0

    init(maxHeightFraction: CGFloat = 0.85, onDismiss: @escaping () -> Void, @ViewBuilder content: () -> Content) {
        self.maxHeightFraction = maxHeightFraction
        self.onDismiss = onDismiss
        self.content = content()
    }

    private var sheetShape: some Shape {
        UnevenRoundedRectangle(cornerRadii: .init(topLeading: 22, topTrailing: 22), style: .continuous)
    }

    /// The device's bottom safe-area inset (home indicator), so the glass can run all the way to the
    /// physical screen bottom while the content still clears the home indicator.
    private var bottomInset: CGFloat {
        (UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .keyWindow?.safeAreaInsets.bottom) ?? 0
    }

    var body: some View {
        VStack(spacing: 0) {
            Capsule()
                .fill(Color.primary.opacity(0.28))
                .frame(width: 38, height: 5)
                .padding(.top, 8)
                .padding(.bottom, 6)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .gesture(
                    DragGesture()
                        .onChanged { v in dragY = max(0, v.translation.height) }
                        .onEnded { v in
                            if v.translation.height > 110 || v.predictedEndTranslation.height > 240 {
                                onDismiss()
                            }
                            withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { dragY = 0 }
                        }
                )
            content
        }
        .frame(maxWidth: .infinity)
        .frame(maxHeight: UIScreen.main.bounds.height * maxHeightFraction, alignment: .top)
        .padding(.bottom, bottomInset)   // content sits above the home indicator; glass fills below it
        .glassBG(sheetShape)
        .offset(y: dragY)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
        .ignoresSafeArea(edges: .bottom) // glass runs to the physical bottom (no gap under the sheet)
    }
}
