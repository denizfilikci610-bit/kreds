import SwiftUI
import UIKit
import WebKit

/// Geometry of one sponsored slot as reported by the web feed. Kept so the web
/// bridge still compiles against the same message shape.
struct AdSlot: Sendable {
    let id: String
    let x: CGFloat
    let y: CGFloat
    let w: CGFloat
    let h: CGFloat
}

/// Ads and tracking were REMOVED from the App Store build (2026-07-24) to resolve
/// an App Review App Tracking Transparency finding. VibeFeed ships with no ads,
/// no ad SDK and no tracking, so nothing here may reference AppTrackingTransparency,
/// Appodeal or GoogleMobileAds. This is a no-op stub that keeps the same public
/// interface the web bridge and the app scene call, so they all compile unchanged.
///
/// To reintroduce ads in a future version: restore the Appodeal / ATT
/// implementation here, re-add the pods to the Podfile, re-add the
/// NSUserTrackingUsageDescription usage string in Info.plist, declare tracking in
/// App Privacy, and show the ATT prompt before any tracking data is collected.
@MainActor
final class AdsManager {
    static let shared = AdsManager()
    private init() {}

    private weak var webView: WKWebView?

    // Lifecycle / bridge entry points — all no-ops now that there is no ad SDK.
    func appDidBecomeActive() {}
    func setAdsLive(_ live: Bool) {}
    func applyConsent(_ value: String) {}
    func attachOverlay(_ view: UIView) {}
    func updateLayout(slots: [AdSlot], scrolling: Bool, scrollY: CGFloat) {}
    func updateScroll(scrollY: CGFloat) {}

    func setWebView(_ wv: WKWebView?) {
        if let wv = wv { webView = wv }
    }

    /// The web may still request a rewarded video from the legacy like-quota flow.
    /// With no ad SDK there is none, so report "not earned" immediately and let the
    /// web resolve its callback gracefully.
    func showRewarded() {
        let js = "window.VibeFeedAds && window.VibeFeedAds.rewardEarned(false)"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }
}
