import SwiftUI
import UIKit

/// A transparent layer that sits ABOVE the web feed and hosts the native MREC
/// ad views (managed by `AdsManager`). Only the ad rectangles are interactive —
/// every other touch passes straight through to the web view underneath, so the
/// feed scrolls and taps exactly as before.
final class PassthroughAdView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        // `self` means the touch landed on empty overlay → let it fall through to
        // the web view. A subview means it hit an ad → keep it.
        return hit === self ? nil : hit
    }
}

/// Bridges the passthrough overlay into SwiftUI and hands it to `AdsManager`,
/// which positions the MRECs over the feed's sponsored slots.
struct InlineAdsOverlay: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = PassthroughAdView()
        view.backgroundColor = .clear
        AdsManager.shared.attachOverlay(view)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        // Keep the reference current across layout passes (idempotent).
        AdsManager.shared.attachOverlay(uiView)
    }
}
