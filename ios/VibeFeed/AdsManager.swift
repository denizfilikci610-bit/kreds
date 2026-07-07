import SwiftUI
import UIKit
import AppTrackingTransparency
import Appodeal

/// Owns the Appodeal ad SDK for VibeFeed.
///
/// Design goals — the app must stay fully usable even if ads never work:
///   • Nothing here is called until the app is active AND the user's ads-consent
///     choice is known (posted by the web app via NotifManager → "vf_consent").
///   • Every SDK call is best-effort; a failure to initialise, load or show an
///     ad is swallowed and never propagates to the UI.
///   • Consent maps to iOS reality: "personal" → ask App Tracking Transparency
///     first (IDFA → personalised ads); "limited" → never ask, so no IDFA is
///     available and networks fall back to non-personalised/contextual ads.
///
/// The banner is a native `APDBannerView` displayed BELOW the web view (see
/// ContentView), so it can never cover the app's own tab bar inside the page.
/// Interstitials are paced very conservatively — this is a friends-and-family
/// community, not a game.
@MainActor
final class AdsManager: NSObject, ObservableObject {
    static let shared = AdsManager()

    // Appodeal app key (iOS app 782028), provided by the owner.
    private let appKey = "c9a03363e7ae756c1a672b2ffbff689c8ea7cf589a12a7d7"
    private let placement = "default"

    /// Drives the visibility of the bottom banner strip. The strip is fully
    /// collapsed (height 0) until a real ad has loaded, so the app looks normal
    /// when there is no ad fill.
    @Published private(set) var isBannerReady = false
    @Published private(set) var isInitialized = false

    /// Standard 320×50 banner. Created as soon as a root view controller exists
    /// (driven by `ensureBanner()` from the SwiftUI container, which keeps it
    /// mounted in the hierarchy), and only asked to load once the SDK is ready.
    private var bannerView: APDBannerView?
    private var bannerLoadStarted = false

    let bannerHeight: CGFloat = kAPDAdSize320x50.height // 50pt

    private var started = false
    private var attRequested = false
    private var hasBecomeActiveOnce = false
    private let launchDate = Date()
    private var lastInterstitialDate: Date?

    // Pacing rules (kept deliberately gentle).
    private let interstitialWarmup: TimeInterval = 120  // no ads in first 2 min
    private let interstitialMinGap: TimeInterval = 180  // at most one per 3 min

    private override init() { super.init() }

    // MARK: - Lifecycle entry points

    /// Called from the SwiftUI scene when it becomes active. First activation
    /// only attempts initialisation; later activations (returning from the
    /// background) may also show a paced interstitial.
    func appDidBecomeActive() {
        let returningToForeground = hasBecomeActiveOnce
        hasBecomeActiveOnce = true

        start()

        if returningToForeground {
            maybeShowInterstitial()
        }
    }

    /// Begins SDK setup. No-op until the user's consent choice is known, and
    /// only ever runs once. Safe to call repeatedly.
    func start() {
        guard !started else { return }
        // If the user has not yet made an ads-consent choice, do nothing — we
        // will be called again from `applyConsent(_:)` once the web app posts it.
        guard let consent = UserDefaults.standard.string(forKey: "vf_consent") else { return }
        started = true

        if consent == "personal" {
            requestATT { [weak self] in self?.initializeAppodeal() }
        } else {
            // "limited": skip ATT entirely → no IDFA → non-personalised ads.
            initializeAppodeal()
        }
    }

    /// Called by NotifManager when the web app reports a consent choice/change.
    /// `value` has already been persisted to "vf_consent" by the caller.
    func applyConsent(_ value: String) {
        if !started {
            // First time we learn the choice — kick off initialisation.
            start()
        } else if value == "personal" {
            // User upgraded to personalised after we had already initialised.
            // We can still ask for ATT if it was never requested; a downgrade to
            // "limited" simply takes effect on the next launch (the SDK cannot be
            // re-initialised in place).
            requestATT(nil)
        }
    }

    // MARK: - App Tracking Transparency

    private func requestATT(_ completion: (() -> Void)?) {
        guard !attRequested else { completion?(); return }
        attRequested = true

        // ATT can only be presented once the app is active; the scene is active
        // by the time we get here. The completion always runs on the main actor.
        ATTrackingManager.requestTrackingAuthorization { _ in
            Task { @MainActor in completion?() }
        }
    }

    // MARK: - Appodeal initialisation

    private func initializeAppodeal() {
        #if DEBUG
        Appodeal.setLogLevel(.verbose)
        Appodeal.setTestingEnabled(true)
        #else
        Appodeal.setLogLevel(.off)
        #endif

        Appodeal.setInitializationDelegate(self)
        Appodeal.setInterstitialDelegate(self)

        // We drive the banner's first load manually.
        Appodeal.setAutocache(false, types: .banner)

        let types: AppodealAdType = [.banner, .interstitial]
        Appodeal.initialize(withApiKey: appKey, types: types)

        _ = ensureBanner()
    }

    /// Returns the shared banner view, creating it once a root view controller
    /// exists and kicking off its first load once the SDK has initialised. Both
    /// steps are idempotent, so it is safe to call from the SwiftUI container on
    /// every layout pass and from the init delegate.
    func ensureBanner() -> APDBannerView? {
        if bannerView == nil, let root = Self.topViewController() {
            let banner = APDBannerView(size: kAPDAdSize320x50, rootViewController: root)
            banner.delegate = self
            bannerView = banner
        }
        if isInitialized, !bannerLoadStarted, let banner = bannerView {
            bannerLoadStarted = true
            banner.loadAd()
        }
        return bannerView
    }

    // MARK: - Interstitial

    private func maybeShowInterstitial() {
        guard isInitialized else { return }
        let now = Date()
        guard now.timeIntervalSince(launchDate) >= interstitialWarmup else { return }
        if let last = lastInterstitialDate, now.timeIntervalSince(last) < interstitialMinGap { return }
        guard Appodeal.canShow(.interstitial, forPlacement: placement),
              let root = Self.topViewController() else { return }

        lastInterstitialDate = now
        Appodeal.showAd(.interstitial, forPlacement: placement, rootViewController: root)
    }

    // MARK: - Banner view for SwiftUI

    /// Localised "Ad" label shown above the banner (da: "Reklame").
    var adLabelText: String {
        let danish = (UserDefaults.standard.string(forKey: "vf_lang") ?? "da") != "en"
        return danish ? "Reklame" : "Ad"
    }

    // MARK: - Helpers

    static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
            ?? scene?.windows.first?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
}

// MARK: - Appodeal delegates
//
// Appodeal delivers these on the main thread in practice, but the callbacks are
// declared `nonisolated` and hop onto the main actor explicitly so the
// @Published mutations are always race-free (and Swift 6 clean). None capture
// the non-Sendable ad objects.

extension AdsManager: AppodealInitializationDelegate {
    nonisolated func appodealSDKDidInitialize() {
        Task { @MainActor in
            self.isInitialized = true
            // Kick off the first banner load now that the SDK is ready (the
            // banner was already mounted in the hierarchy by the SwiftUI strip).
            _ = self.ensureBanner()
        }
    }
}

extension AdsManager: APDBannerViewDelegate {
    nonisolated func bannerViewDidLoadAd(_ bannerView: APDBannerView, isPrecache precache: Bool) {
        Task { @MainActor in self.isBannerReady = true }
    }

    nonisolated func bannerView(_ bannerView: APDBannerView, didFailToLoadAdWithError error: Error) {
        Task { @MainActor in self.isBannerReady = false }
    }

    nonisolated func bannerView(_ bannerView: APDBannerView, didFailToPresentWithError error: Error) {
        Task { @MainActor in self.isBannerReady = false }
    }

    nonisolated func bannerViewExpired(_ bannerView: APDBannerView) {
        Task { @MainActor in self.isBannerReady = false }
    }
}

extension AdsManager: AppodealInterstitialDelegate {
    // Required for observability; nothing here is load-bearing for the UI.
    nonisolated func interstitialDidFailToLoadAd() {}
    nonisolated func interstitialDidFailToPresent() {}
}
