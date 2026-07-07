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

/// One slot in the small pool of native ad cards.
@MainActor
final class AdCardItem {
    var slotId: String?
    var card: NativeAdCardView?       // the on-screen card (added to the overlay)
    var nativeAd: APDNativeAd?        // strong ref keeps a real (non-DEBUG) ad alive
    var height: CGFloat = 0           // measured card height == height reserved in web
    var measuredWidth: CGFloat = 0    // slot width the height was measured at
}

/// Owns the Appodeal ad SDK for VibeFeed and drives the inline feed ads.
///
/// Ads are shown as **native "sponsored posts"** (X/Twitter-style): the advertiser
/// supplies raw parts (icon, headline, body, image, CTA) and the app renders them in
/// its own post-style `NativeAdCardView`, laid over a blank placeholder the web feed
/// reserves between posts. Because a post card is taller/variable-height, native
/// measures the card and tells the web the exact height to reserve (setSlotHeight),
/// so the card can never overflow its slot. The card follows the feed on scroll via
/// the same transform-glide used before.
///
/// Design goals — the app must stay fully usable even if ads never work:
///   • Nothing here runs until the app is active AND the user's ads-consent choice
///     is known (posted by the web app via NotifManager → "vf_consent").
///   • Every SDK call is best-effort; any failure is swallowed. With no fill, the
///     sponsored placeholder simply collapses away.
///   • Consent maps to iOS reality: "personal" → ask App Tracking Transparency first
///     (IDFA → personalised ads); "limited" → never ask (non-personalised).
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
    private var cards: [AdCardItem] = []
    private let poolSize = 3
    private var lastSlots: [AdSlot] = []
    private var lastScrolling = false
    // The feed scroll offset the cards were last authoritatively placed at. While
    // scrolling we glide them by (scrollY - baseScrollY) instead of re-laying out, so
    // they track the feed smoothly; each layout message re-bases this.
    private var baseScrollY: CGFloat = 0

    // Live native-ad queue (production). nil in DEBUG, where we render guaranteed
    // fake cards instead so the feed visibly shows the design without live demand.
    private var queue: APDNativeAdQueue?

    // In DEBUG we render guaranteed fake native cards so the post design is visible
    // on-device even before live native demand exists. Compiled OUT of Release.
    #if DEBUG
    private let useFakeCards = true
    #else
    private let useFakeCards = false
    #endif

    private override init() { super.init() }

    // MARK: - Lifecycle entry points

    func appDidBecomeActive() { start() }

    /// Begins SDK setup. No-op until the user's consent choice is known, and only ever
    /// runs once. Safe to call repeatedly.
    func start() {
        guard !started else { return }
        guard let consent = UserDefaults.standard.string(forKey: "vf_consent") else { return }
        started = true

        if consent == "personal" {
            requestATT { [weak self] in self?.initializeAppodeal() }
        } else {
            initializeAppodeal() // "limited": skip ATT → no IDFA → non-personalised
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
        Appodeal.initialize(withApiKey: appKey, types: [.nativeAd])
    }

    // MARK: - Overlay + web view wiring (main actor)

    func attachOverlay(_ view: UIView) {
        overlay = view
        buildIfPossible()
        applyLayout()
    }

    func setWebView(_ wv: WKWebView?) {
        if let wv = wv { webView = wv }
    }

    // MARK: - Pool + queue setup

    private func buildIfPossible() {
        guard isInitialized, overlay != nil, cards.isEmpty else { return }
        for _ in 0..<poolSize { cards.append(AdCardItem()) }

        if !useFakeCards {
            let settings = APDNativeAdSettings.default()
            settings.adViewClass = NativeAdCardView.self
            settings.type = .noVideo // simpler, tighter-height card at launch (no video)
            let q = APDNativeAdQueue(sdk: nil, settings: settings,
                                     delegate: self, autocache: true)
            q.loadAd()
            queue = q
        }
    }

    // MARK: - Layout updates from the web feed

    func updateLayout(slots: [AdSlot], scrolling: Bool, scrollY: CGFloat) {
        lastSlots = slots
        lastScrolling = scrolling
        baseScrollY = scrollY
        buildIfPossible()
        applyLayout()
    }

    /// Cheap per-frame scroll update: glide the placed cards with the feed by
    /// offsetting them from where they were last laid out (baseScrollY). No re-layout.
    func updateScroll(scrollY: CGFloat) {
        let t = CGAffineTransform(translationX: 0, y: -(scrollY - baseScrollY))
        for it in cards where it.slotId != nil { it.card?.transform = t }
    }

    private func applyLayout() {
        guard isInitialized, let overlay = overlay, !cards.isEmpty else { return }

        // Release a card only when ITS slot has genuinely left the feed (sticky) — not
        // on transient scroll churn.
        let visibleIds = Set(lastSlots.map { $0.id })
        for item in cards where item.slotId != nil && !visibleIds.contains(item.slotId!) {
            release(item)
        }

        // Assign any free card slot to the nearest still-unserved slot.
        let midY = overlay.bounds.midY
        let assignedIds = Set(cards.compactMap { $0.slotId })
        var freeSlots = lastSlots
            .filter { !assignedIds.contains($0.id) }
            .sorted { abs(($0.y + $0.h / 2) - midY) < abs(($1.y + $1.h / 2) - midY) }
            .makeIterator()
        for item in cards where item.slotId == nil {
            guard let slot = freeSlots.next() else { break }
            item.slotId = slot.id
        }

        // Fill + position + reveal.
        for it in cards {
            guard let sid = it.slotId,
                  let slot = lastSlots.first(where: { $0.id == sid }) else { continue }

            // Obtain a card if we don't have one yet.
            if it.card == nil {
                guard let card = makeCard(for: it, index: cards.firstIndex(where: { $0 === it }) ?? 0) else {
                    // No ad available right now → collapse the placeholder, retry later.
                    fillWeb(sid, false)
                    continue
                }
                it.card = card
                card.alpha = 0
                overlay.addSubview(card)
            }

            guard let card = it.card else { continue }

            // (Re)measure the card height for this slot width, and reserve it in web.
            if it.measuredWidth != slot.w {
                card.frame = CGRect(x: 0, y: 0, width: slot.w, height: 10)
                it.height = measuredHeight(card, width: slot.w)
                it.measuredWidth = slot.w
                setSlotHeight(sid, it.height)
                fillWeb(sid, true)
            }

            // Place at the reported slot; reveal only once the web has reserved the
            // height (so it never overflows into the next post).
            card.transform = .identity
            card.frame = CGRect(x: slot.x, y: slot.y, width: slot.w, height: it.height)
            card.alpha = (slot.h >= it.height - 6) ? 1 : 0
        }
    }

    /// Pull a card for this slot: a fake one in DEBUG, else the next queued native ad.
    private func makeCard(for item: AdCardItem, index: Int) -> NativeAdCardView? {
        #if DEBUG
        if useFakeCards { return Self.makeFakeCard(index) }
        #endif
        guard let q = queue, q.currentAdCount > 0,
              let ad = q.getNativeAds(ofCount: 1).first,
              let root = Self.topViewController(),
              let view = ad.getViewFor(root) as? NativeAdCardView else { return nil }
        ad.delegate = self
        view.applyTemplate(hasBody: !ad.descriptionText.isEmpty,
                           hasMedia: ad.mainImage != nil,
                           hasIcon: ad.iconImage != nil)
        item.nativeAd = ad
        return view
    }

    private func release(_ item: AdCardItem) {
        item.card?.removeFromSuperview()
        item.card = nil
        item.nativeAd = nil
        item.slotId = nil
        item.height = 0
        item.measuredWidth = 0
    }

    private func measuredHeight(_ card: NativeAdCardView, width: CGFloat) -> CGFloat {
        let target = CGSize(width: width, height: UIView.layoutFittingCompressedSize.height)
        let size = card.systemLayoutSizeFitting(target,
                                                withHorizontalFittingPriority: .required,
                                                verticalFittingPriority: .fittingSizeLevel)
        return ceil(size.height)
    }

    // MARK: - Native → web

    private func fillWeb(_ id: String, _ filled: Bool) {
        let js = "window.VibeFeedAds && window.VibeFeedAds.fill(\"\(id)\", \(filled ? "true" : "false"))"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Tell the web how tall to make the reserved placeholder so the native card fits
    /// exactly (fixes the "ad floats over its frame" problem — native owns the height).
    private func setSlotHeight(_ id: String, _ h: CGFloat) {
        let js = "window.VibeFeedAds && window.VibeFeedAds.setSlotHeight(\"\(id)\", \(Int(h.rounded())))"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    // MARK: - Native-ad expiry (from the presentation delegate)

    func nativeAdExpired(_ adId: ObjectIdentifier) {
        // Drop the expired card so applyLayout re-fills the slot with a fresh ad.
        guard let item = cards.first(where: { $0.nativeAd.map(ObjectIdentifier.init) == adId }) else { return }
        let slotId = item.slotId
        item.card?.removeFromSuperview()
        item.card = nil
        item.nativeAd = nil
        item.measuredWidth = 0
        if let sid = slotId { fillWeb(sid, false) }
        queue?.loadAd()
        applyLayout()
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

    // MARK: - DEBUG fake cards (no SDK, guaranteed visible)

    #if DEBUG
    private static func makeFakeCard(_ index: Int) -> NativeAdCardView {
        let card = NativeAdCardView()
        switch index % 3 {
        case 0:
            card.fillFake(title: "RADIUSaaS",
                          body: "Skift RADIUS-boksen ud med sikker cloud-login — hurtigt, enkelt og skalerbart.",
                          cta: "Prøv gratis",
                          image: demoImage(UIColor(red: 0.55, green: 0.78, blue: 0.35, alpha: 1), "R"),
                          icon: demoImage(.systemGreen, "R"))
        case 1:
            card.fillFake(title: "Nordisk Opsparing",
                          body: "Få 3,5% i rente på din opsparing. Ingen binding, ingen gebyrer.",
                          cta: "Læs mere", image: nil, icon: demoImage(.systemBlue, "N"))
        default:
            card.fillFake(title: "FitPuls", body: nil, cta: "Installer",
                          image: nil, icon: demoImage(.systemOrange, "F"))
        }
        return card
    }

    private static func demoImage(_ color: UIColor, _ text: String) -> UIImage {
        let size = CGSize(width: 160, height: 160)
        return UIGraphicsImageRenderer(size: size).image { ctx in
            color.setFill(); ctx.fill(CGRect(origin: .zero, size: size))
            let attrs: [NSAttributedString.Key: Any] = [
                .foregroundColor: UIColor.white,
                .font: UIFont.systemFont(ofSize: 84, weight: .heavy),
            ]
            let s = text as NSString
            let ts = s.size(withAttributes: attrs)
            s.draw(at: CGPoint(x: (size.width - ts.width) / 2, y: (size.height - ts.height) / 2),
                   withAttributes: attrs)
        }
    }
    #endif
}

// MARK: - Native ad queue delegate

extension AdsManager: APDNativeAdQueueDelegate {
    nonisolated func adQueueAdIsAvailable(_ adQueue: APDNativeAdQueue, ofCount count: UInt) {
        #if DEBUG
        print("VF-ADS native available: \(count)")
        #endif
        Task { @MainActor in self.applyLayout() }
    }

    nonisolated func adQueue(_ adQueue: APDNativeAdQueue, failedWithError error: Error) {
        // No-fill / mediation error. Fix is on the Appodeal/AdMob side (native format
        // + demand for app 782028), not in the app. Cards simply stay collapsed.
        #if DEBUG
        print("VF-ADS native ⛔️ no-fill: \(error.localizedDescription)")
        #endif
    }
}

// MARK: - Native ad presentation delegate (impression / interaction / expiry)

extension AdsManager: APDNativeAdPresentationDelegate {
    nonisolated func nativeAdDidExpired(_ nativeAd: APDNativeAd) {
        let id = ObjectIdentifier(nativeAd)
        Task { @MainActor in self.nativeAdExpired(id) }
    }
    nonisolated func nativeAdWillLogImpression(_ nativeAd: APDNativeAd) {
        #if DEBUG
        print("VF-ADS native ✅ impression")
        #endif
    }
    nonisolated func nativeAdWillLogUserInteraction(_ nativeAd: APDNativeAd) {
        #if DEBUG
        print("VF-ADS native 👆 tap")
        #endif
    }
}

// MARK: - Appodeal initialisation delegate

extension AdsManager: AppodealInitializationDelegate {
    nonisolated func appodealSDKDidInitialize() {
        Task { @MainActor in
            self.isInitialized = true
            self.buildIfPossible()
            self.applyLayout()
        }
    }
}
