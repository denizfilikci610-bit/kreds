import SwiftUI
import UIKit
import WebKit
import AppTrackingTransparency
import Appodeal
import GoogleMobileAds

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
    // DEBUG only: a guaranteed-fill Google test MREC used to visibly prove the ad
    // pipeline while the live waterfall has no inventory yet. nil in Release.
    var testBanner: BannerView?

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

    /// DEN FÆLLES KILL-SWITCH, native side. Står på false ved hver app-start og
    /// bliver kun true hvis web'en melder adsLive:true (js/ads.js → ADS_LIVE →
    /// pushAdsLive). Så længe den er false initialiseres Appodeal ALDRIG, og
    /// sporings-dialogen (ATT) vises ALDRIG — heller ikke for brugere der har et
    /// gammelt vf_consent liggende fra dengang samtykke-skærmen fandtes.
    /// Bevidst IKKE gemt i UserDefaults: hver start begynder slukket.
    private var adsLive = false

    // Inline feed ads
    private weak var overlay: UIView?
    private weak var webView: WKWebView?
    private var pool: [AdPoolItem] = []
    private let poolSize = 3
    private var lastSlots: [AdSlot] = []
    private var lastScrolling = false
    // The feed scroll offset at which the MRECs were last authoritatively placed.
    // While scrolling we glide them by (scrollY - baseScrollY) instead of re-laying
    // out, so they track the feed smoothly; each layout message re-bases this.
    private var baseScrollY: CGFloat = 0

    // In DEBUG we lay Google's guaranteed test MREC over the slots so the feed
    // visibly renders an ad even before the live waterfall has any inventory.
    // Compiled OUT of Release (App Store) builds — real users only ever see live ads.
    #if DEBUG
    private let useTestAds = true
    #else
    private let useTestAds = false
    #endif

    private override init() { super.init() }

    // MARK: - Lifecycle entry points

    /// Called from the SwiftUI scene when it becomes active.
    func appDidBecomeActive() {
        start()
    }

    /// Web → native: reklamernes hovedkontakt (js/ads.js ADS_LIVE). Meldes ved hver
    /// boot af web-appen. true her er en FORUDSÆTNING for at noget som helst starter.
    func setAdsLive(_ live: Bool) {
        guard live != adsLive else { return }
        adsLive = live
        if live { start() } // web'en kan tænde uden app-opdatering
    }

    /// Begins SDK setup. No-op until ads are switched on AND the user's consent
    /// choice is known, and only ever runs once. Safe to call repeatedly.
    func start() {
        guard adsLive else { return } // kill-switch: intet SDK, ingen ATT-dialog
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
        guard adsLive else { return } // slukket = valget er ligegyldigt, og ATT må aldrig komme
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
        Appodeal.setRewardedVideoDelegate(self)
        Appodeal.initialize(withApiKey: appKey, types: [.MREC, .rewardedVideo])

        #if DEBUG
        if useTestAds { loadGoogleRewarded() } // DEBUG: preload a real Google test rewarded
        #endif
    }

    // MARK: - Rewarded video (earns +20 like-capacity; web asks, native shows)

    #if DEBUG
    private var googleRewarded: RewardedAd?
    private func loadGoogleRewarded() {
        MobileAds.shared.start(completionHandler: nil)
        RewardedAd.load(with: "ca-app-pub-3940256099942544/1712485313", // Google's public rewarded test unit
                        request: Request()) { [weak self] ad, _ in
            MainActor.assumeIsolated { self?.googleRewarded = ad } // GAD calls back on the main thread
        }
    }
    #endif

    /// Called from the web (via the bridge) when the user chooses to watch a video.
    /// Shows a rewarded video; on full watch we tell the web the reward was earned so
    /// it can grant +20 like-capacity. If none is available, we report that too.
    func showRewarded() {
        guard adsLive else { rewardWeb(false); return } // kill-switch
        guard let root = Self.topViewController() else { rewardWeb(false); return }
        #if DEBUG
        if let ad = googleRewarded {
            googleRewarded = nil
            ad.present(from: root) { [weak self] in self?.rewardWeb(true) }
            loadGoogleRewarded() // preload the next
        } else {
            rewardWeb(false)     // not ready yet
            loadGoogleRewarded()
        }
        #else
        if Appodeal.canShow(.rewardedVideo, forPlacement: "default") {
            Appodeal.showAd(.rewardedVideo, rootViewController: root)
        } else {
            rewardWeb(false)     // no fill
        }
        #endif
    }

    private func rewardWeb(_ earned: Bool) {
        let js = "window.VibeFeedAds && window.VibeFeedAds.rewardEarned(\(earned ? "true" : "false"))"
        webView?.evaluateJavaScript(js, completionHandler: nil)
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
        if useTestAds { MobileAds.shared.start(completionHandler: nil) }
        for index in 0..<poolSize {
            // ObjC `-init` is imported as optional (no nullability annotation);
            // it never actually returns nil.
            guard let mrec = APDMRECView() else { continue }
            let proxy = MRECDelegateProxy(index: index)
            mrec.rootViewController = root
            mrec.alpha = 0
            overlay.addSubview(mrec)
            let item = AdPoolItem(mrec: mrec, proxy: proxy)

            if useTestAds {
                // Lay a guaranteed Google test MREC over the slot; leave the live
                // Appodeal MREC inert (no delegate, never loaded) so its no-fill can't
                // collapse the card out from under the test ad.
                let banner = BannerView(adSize: AdSizeMediumRectangle)
                banner.adUnitID = "ca-app-pub-3940256099942544/2934735716" // Google's public test unit
                banner.rootViewController = root
                banner.alpha = 0
                overlay.addSubview(banner)
                banner.load(Request())
                item.testBanner = banner
            } else {
                mrec.delegate = proxy
            }
            pool.append(item)
        }
    }

    // MARK: - Layout updates from the web feed

    func updateLayout(slots: [AdSlot], scrolling: Bool, scrollY: CGFloat) {
        lastSlots = slots
        lastScrolling = scrolling
        baseScrollY = scrollY
        buildPoolIfPossible()
        applyLayout()
    }

    /// Cheap per-frame scroll update while the feed scrolls: glide the already-placed
    /// ads with the feed by offsetting them from the position they were last
    /// authoritatively laid out at (baseScrollY). No re-layout, no alpha changes —
    /// pure transform, so the ad tracks the scroll smoothly instead of stepping
    /// behind the heavier layout messages. Reconciled to exact frames on settle.
    func updateScroll(scrollY: CGFloat) {
        let t = CGAffineTransform(translationX: 0, y: -(scrollY - baseScrollY))
        for it in pool where it.slotId != nil {
            it.mrec.transform = t
            it.testBanner?.transform = t
        }
    }

    private func applyLayout() {
        guard isInitialized, let overlay = overlay, !pool.isEmpty else { return }
        let root = Self.topViewController()

        // The web reports slot positions continuously (including during scroll), so
        // the MRECs follow the feed and stay visible rather than hiding on scroll.

        // Release a pool item only when ITS slot has genuinely left the feed — not
        // merely because it drifted away from the viewport centre. Blanking a live
        // ad on transient scroll churn is another way ads "disappear", so we hold on
        // to an assigned slot as long as the web still reports it (sticky).
        let visibleIds = Set(lastSlots.map { $0.id })
        for item in pool where item.slotId != nil && !visibleIds.contains(item.slotId!) {
            item.slotId = nil
            item.mrec.alpha = 0
            item.mrec.transform = .identity
            item.testBanner?.alpha = 0
            item.testBanner?.transform = .identity
        }

        // Give any free MREC the nearest still-unserved slot (nearest the viewport
        // centre first). Already-assigned items keep their slot.
        let midY = overlay.bounds.midY
        let assignedIds = Set(pool.compactMap { $0.slotId })
        var freeSlots = lastSlots
            .filter { !assignedIds.contains($0.id) }
            .sorted { abs(($0.y + $0.h / 2) - midY) < abs(($1.y + $1.h / 2) - midY) }
            .makeIterator()
        for item in pool where item.slotId == nil {
            guard let slot = freeSlots.next() else { break }
            item.slotId = slot.id
        }

        // Position + reveal every assigned MREC over its slot.
        let size = kAPDAdSize300x250
        for it in pool {
            guard let sid = it.slotId,
                  let slot = lastSlots.first(where: { $0.id == sid }) else { continue }
            let fx = slot.x + (slot.w - size.width) / 2
            let fy = slot.y + (slot.h - size.height) / 2
            let frame = CGRect(x: fx, y: fy, width: size.width, height: size.height)

            // DEBUG: a guaranteed test ad always fills, so just place and show it.
            if let banner = it.testBanner {
                // Reset any scroll transform BEFORE setting the authoritative frame
                // (UIKit frame is undefined under a non-identity transform).
                banner.transform = .identity
                banner.frame = frame
                banner.rootViewController = root
                banner.alpha = 1
                it.mrec.alpha = 0
                fillWeb(sid, true)
                continue
            }

            // Reset any scroll transform before setting the authoritative frame.
            it.mrec.transform = .identity
            it.mrec.rootViewController = root
            it.mrec.frame = frame
            if !it.loadStarted {
                it.loadStarted = true
                it.mrec.loadAd()
            }
            // Show the ad whenever this MREC has ever loaded a creative — NOT the
            // transient reload state — so a refresh in flight (poolItemExpired)
            // never blanks an ad that is already visible.
            it.mrec.alpha = it.hasCreative ? 1 : 0
            if it.hasCreative { fillWeb(sid, true) }
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
        #if DEBUG
        print("VF-ADS[\(index)] ✅ loaded (precache: \(precache))")
        #endif
        let i = index
        Task { @MainActor in AdsManager.shared.poolItem(i, didLoad: true) }
    }

    nonisolated func bannerView(_ bannerView: APDBannerView, didFailToLoadAdWithError error: Error) {
        // This is the NO-FILL path: the mediation waterfall returned nothing. If you
        // see this repeatedly, the fix is on the Appodeal/AdMob side (empty waterfall
        // / no MREC line-items), not in the app.
        #if DEBUG
        print("VF-ADS[\(index)] ⛔️ NO-FILL: \(error.localizedDescription)")
        #endif
        let i = index
        Task { @MainActor in AdsManager.shared.poolItem(i, didLoad: false) }
    }

    nonisolated func bannerView(_ bannerView: APDBannerView, didFailToPresentWithError error: Error) {
        #if DEBUG
        print("VF-ADS[\(index)] ⚠️ present failed: \(error.localizedDescription)")
        #endif
        let i = index
        Task { @MainActor in AdsManager.shared.poolItemExpired(i) }
    }

    nonisolated func bannerViewExpired(_ bannerView: APDBannerView) {
        #if DEBUG
        print("VF-ADS[\(index)] ♻️ expired (SDK will refresh)")
        #endif
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

// MARK: - Appodeal rewarded video delegate (production)
//
// Fires on the main thread; hop to the main actor to reach @MainActor state. The
// reward callback (rewardedVideoDidFinish) means the user watched to completion →
// tell the web to grant +20 like-capacity. Present/expiry failures → not earned.

extension AdsManager: AppodealRewardedVideoDelegate {
    nonisolated func rewardedVideoDidFinish(_ rewardAmount: Float, name: String?) {
        Task { @MainActor in AdsManager.shared.rewardWeb(true) }
    }
    nonisolated func rewardedVideoDidFailToPresentWithError(_ error: Error) {
        // Only fires for an actual show attempt → report "not earned".
        Task { @MainActor in AdsManager.shared.rewardWeb(false) }
    }
    // Note: no rewardedVideoDidFailToLoadAd handler on purpose — that's a background
    // load failure, not tied to a user tapping "watch", so it must not tell the web.
}
