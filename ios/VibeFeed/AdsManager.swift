import SwiftUI
import UIKit
import WebKit
import AppTrackingTransparency
import Appodeal

/// Geometry of one sponsored slot as reported by the web feed. Coordinates are
/// CSS px (== WKWebView points) relative to the viewport's top-left, which is
/// exactly the overlay's coordinate space.
struct AdSlot: Sendable {
    let id: String
    let x: CGFloat
    let y: CGFloat
    let w: CGFloat
    let h: CGFloat
}

/// One reusable native MREC (300×250) in the pool. Holds a strong reference to
/// its delegate proxy (the ad view's `delegate` is weak).
@MainActor
final class AdPoolItem {
    let mrec: APDMRECView
    let proxy: MRECDelegateProxy
    var slotId: String?
    // True once this MREC has loaded at least one creative. Appodeal then keeps a
    // creative in the view and refreshes it on its own timer, so visibility keys off
    // THIS (a stable fact) rather than the momentary "is a load in flight" state —
    // otherwise a routine refresh would blank an ad that is already on screen.
    var hasCreative = false
    var loadStarted = false

    init(mrec: APDMRECView, proxy: MRECDelegateProxy) {
        self.mrec = mrec
        self.proxy = proxy
    }
}

/// Owns the Appodeal ad SDK for VibeFeed and drives the inline feed ads.
///
/// Design goals — the app must stay fully usable even if ads never work:
///   • Nothing here runs until the app is active AND the user's ads-consent
///     choice is known (posted by the web app via NotifManager → "vf_consent").
///   • Every SDK call is best-effort; any failure is swallowed and never reaches
///     the UI. With no ad fill, the sponsored card simply collapses away.
///   • Consent maps to iOS reality: "personal" → ask App Tracking Transparency
///     first (IDFA → personalised ads); "limited" → never ask (non-personalised).
///
/// Ads are shown as MREC (300×250) rectangles laid over "Sponsoreret" cards that
/// the web feed draws between posts. The web reports each slot's position; this
/// class positions a small pool of MRECs over the slots nearest the viewport and
/// reveals them when scrolling settles (hidden mid-scroll to avoid lag).
@MainActor
final class AdsManager: NSObject, ObservableObject {
    static let shared = AdsManager()

    // Appodeal app key (iOS app 782028), provided by the owner.
    private let appKey = "c9a03363e7ae756c1a672b2ffbff689c8ea7cf589a12a7d7"

    @Published private(set) var isInitialized = false

    private var started = false
    private var attRequested = false

    // Inline feed ads
    private weak var overlay: UIView?
    private weak var webView: WKWebView?
    private var pool: [AdPoolItem] = []
    private let poolSize = 3
    private var lastSlots: [AdSlot] = []
    private var lastScrolling = false

    private override init() { super.init() }

    // MARK: - Lifecycle entry points

    /// Called from the SwiftUI scene when it becomes active.
    func appDidBecomeActive() {
        start()
    }

    /// Begins SDK setup. No-op until the user's consent choice is known, and only
    /// ever runs once. Safe to call repeatedly.
    func start() {
        guard !started else { return }
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
    func applyConsent(_ value: String) {
        if !started {
            start()
        } else if value == "personal" {
            requestATT(nil)
        }
    }

    // MARK: - App Tracking Transparency

    private func requestATT(_ completion: (() -> Void)?) {
        guard !attRequested else { completion?(); return }
        attRequested = true
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
        Appodeal.initialize(withApiKey: appKey, types: [.MREC])
    }

    // MARK: - Overlay + web view wiring (called from SwiftUI on the main actor)

    func attachOverlay(_ view: UIView) {
        overlay = view
        buildPoolIfPossible()
        applyLayout()
    }

    func setWebView(_ wv: WKWebView?) {
        if let wv = wv { webView = wv }
    }

    // MARK: - MREC pool

    private func buildPoolIfPossible() {
        guard isInitialized, let overlay = overlay, pool.isEmpty else { return }
        let root = Self.topViewController()
        for index in 0..<poolSize {
            // ObjC `-init` is imported as optional (no nullability annotation);
            // it never actually returns nil.
            guard let mrec = APDMRECView() else { continue }
            let proxy = MRECDelegateProxy(index: index)
            mrec.rootViewController = root
            mrec.delegate = proxy
            mrec.alpha = 0
            overlay.addSubview(mrec)
            pool.append(AdPoolItem(mrec: mrec, proxy: proxy))
        }
    }

    // MARK: - Layout updates from the web feed

    func updateLayout(slots: [AdSlot], scrolling: Bool) {
        lastSlots = slots
        lastScrolling = scrolling
        buildPoolIfPossible()
        applyLayout()
    }

    private func applyLayout() {
        guard isInitialized, let overlay = overlay, !pool.isEmpty else { return }
        let root = Self.topViewController()

        // The web reports slot positions continuously (including during scroll), so
        // the MRECs are repositioned to follow the feed and stay visible rather than
        // hiding on every scroll.
        let midY = overlay.bounds.midY
        let chosen = lastSlots
            .sorted { abs(($0.y + $0.h / 2) - midY) < abs(($1.y + $1.h / 2) - midY) }
            .prefix(pool.count)
        let chosenIds = Set(chosen.map { $0.id })

        // Release pool items whose slot is no longer visible.
        for item in pool where item.slotId != nil && !chosenIds.contains(item.slotId!) {
            item.slotId = nil
            item.mrec.alpha = 0
        }

        let size = kAPDAdSize300x250
        for slot in chosen {
            let item = pool.first { $0.slotId == slot.id } ?? pool.first { $0.slotId == nil }
            guard let it = item else { continue }
            it.slotId = slot.id
            it.mrec.rootViewController = root
            let fx = slot.x + (slot.w - size.width) / 2
            let fy = slot.y + (slot.h - size.height) / 2
            it.mrec.frame = CGRect(x: fx, y: fy, width: size.width, height: size.height)
            if !it.loadStarted {
                it.loadStarted = true
                it.mrec.loadAd()
            }
            // Show the ad whenever this MREC has ever loaded a creative — NOT the
            // transient reload state — so a refresh in flight (poolItemExpired)
            // never blanks an ad that is already visible.
            it.mrec.alpha = it.hasCreative ? 1 : 0
            if it.hasCreative { fillWeb(slot.id, true) }
        }
    }

    // MARK: - Delegate callbacks (hopped to the main actor by the proxy)

    func poolItem(_ index: Int, didLoad ok: Bool) {
        guard index >= 0, index < pool.count else { return }
        let it = pool[index]

        if ok {
            it.hasCreative = true
            it.loadStarted = true
            if let sid = it.slotId {
                it.mrec.alpha = 1
                fillWeb(sid, true) // reveal — also un-collapses the card if it was collapsed
            }
            return
        }

        // A load came up empty. If this MREC has shown an ad before, this is just a
        // failed refresh — keep the card and the existing creative on screen
        // (collapsing here is exactly the "ad appeared then vanished" the owner saw)
        // and retry quietly. Only collapse when we have never had an ad to show, so
        // no empty box is left behind.
        it.loadStarted = false
        if !it.hasCreative, let sid = it.slotId {
            it.mrec.alpha = 0
            fillWeb(sid, false)
        }
        let index = index
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self = self, index < self.pool.count else { return }
            let item = self.pool[index]
            if !item.loadStarted {
                item.loadStarted = true
                item.mrec.loadAd()
            }
        }
    }

    /// An ad expired (normal — banners refresh on a timer) or failed to present.
    /// This is NOT a no-fill: keep the sponsored card and load a fresh creative, so
    /// the ad refreshes in place instead of disappearing. The card re-reveals when
    /// the new ad loads (`poolItem(_:didLoad:)`).
    func poolItemExpired(_ index: Int) {
        guard index >= 0, index < pool.count else { return }
        let it = pool[index]
        // Transient: load a fresh creative but leave `hasCreative` and alpha as-is,
        // so the current ad stays visible until the new one arrives. Dropping
        // visibility here (directly, or via applyLayout reading a reset flag) is
        // what made ads flicker away on the refresh timer.
        it.loadStarted = true
        it.mrec.loadAd()
    }

    // MARK: - Native → web

    private func fillWeb(_ id: String, _ filled: Bool) {
        // ids are the numeric slot indices the web assigned — safe to interpolate.
        let js = "window.VibeFeedAds && window.VibeFeedAds.fill(\"\(id)\", \(filled ? "true" : "false"))"
        webView?.evaluateJavaScript(js, completionHandler: nil)
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

// MARK: - Per-MREC delegate proxy
//
// Appodeal delivers banner/MREC callbacks on the main thread, but the protocol
// methods are not main-actor annotated. Each pool MREC gets its own lightweight
// proxy that captures only its integer index (Sendable) and hops to the main
// actor — so no non-Sendable ad object ever crosses an isolation boundary.
final class MRECDelegateProxy: NSObject, APDBannerViewDelegate {
    let index: Int
    init(index: Int) { self.index = index }

    nonisolated func bannerViewDidLoadAd(_ bannerView: APDBannerView, isPrecache precache: Bool) {
        let i = index
        Task { @MainActor in AdsManager.shared.poolItem(i, didLoad: true) }
    }

    nonisolated func bannerView(_ bannerView: APDBannerView, didFailToLoadAdWithError error: Error) {
        let i = index
        Task { @MainActor in AdsManager.shared.poolItem(i, didLoad: false) }
    }

    nonisolated func bannerView(_ bannerView: APDBannerView, didFailToPresentWithError error: Error) {
        let i = index
        Task { @MainActor in AdsManager.shared.poolItemExpired(i) }
    }

    nonisolated func bannerViewExpired(_ bannerView: APDBannerView) {
        let i = index
        Task { @MainActor in AdsManager.shared.poolItemExpired(i) }
    }
}

// MARK: - Appodeal initialisation delegate

extension AdsManager: AppodealInitializationDelegate {
    nonisolated func appodealSDKDidInitialize() {
        Task { @MainActor in
            self.isInitialized = true
            self.buildPoolIfPossible()
            self.applyLayout()
        }
    }
}
