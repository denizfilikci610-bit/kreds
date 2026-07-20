import SwiftUI
import WebKit

let vibefeedURL = URL(string: "https://vibefeed.dk")!

/// iOS lægger som standard en tilbehørsbjælke (pil op/ned + flueben) oven på tastaturet
/// i et WKWebView. Den fjernes her, så chat-composeren klæber direkte på tastaturet som
/// i Messenger: WKContentView får en dynamisk runtime-subklasse hvis inputAccessoryView
/// er nil. (Ingen private API-kald — kun offentlige Objective-C-runtime-funktioner; er
/// klassen ikke fundet på en fremtidig iOS, sker der bare ingenting.)
private func hideKeyboardAccessoryBar(of webView: WKWebView) {
    guard let contentView = webView.scrollView.subviews.first(where: {
        String(describing: type(of: $0)).hasPrefix("WKContent")
    }) else { return }
    let subclassName = "WKContentView_VFNoAccessory"
    var subclass: AnyClass? = NSClassFromString(subclassName)
    if subclass == nil, let superclass = object_getClass(contentView) {
        subclass = objc_allocateClassPair(superclass, subclassName, 0)
        if let subclass {
            let selector = #selector(getter: UIResponder.inputAccessoryView)
            let block: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            class_addMethod(subclass, selector, imp_implementationWithBlock(block), "@@:")
            objc_registerClassPair(subclass)
        }
    }
    if let subclass { object_setClass(contentView, subclass) }
}

final class WebViewModel: ObservableObject {
    @Published var failed = false
    weak var webView: WKWebView?
    /// Universal link (fx vibefeed.dk/?token_hash=…) der ankom FØR webviewet var klar (kold start)
    var pendingDeepLink: URL?

    func retry() {
        failed = false
        webView?.load(URLRequest(url: vibefeedURL))
    }

    /// Åbn et universal link i webviewet — auth-links (token_hash) fører til bekræft-/
    /// nulstillings-skærmen i SPA'en. Ved kold start gemmes linket til makeUIView.
    func openDeepLink(_ url: URL) {
        if let webView {
            webView.load(URLRequest(url: url))
        } else {
            pendingDeepLink = url
        }
    }
}

struct WebView: UIViewRepresentable {
    @ObservedObject var model: WebViewModel

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // Allow autoplay (incl. unmuted lightbox video) without a direct user gesture;
        // safe because the webview only loads vibefeed.dk's own content.
        config.mediaTypesRequiringUserActionForPlayback = []
        // persistent store: login/session survives app restarts
        config.websiteDataStore = .default()
        // bridge: the web app hands over a device secret for background notifications
        config.userContentController.add(NotifManager.shared, name: "vibefeed")
        // Tell the page it's inside the native app BEFORE its scripts run, so it hides its own
        // web tabbar and drives the native Liquid Glass bar instead (window.__vfNative + vfTab bridge).
        // __vfGlassCard is a capability flag: it tells the web this build can render the native
        // Liquid Glass action-sheet CARD (report / post menu / unfriend). Only builds with this flag
        // route to native; the browser and older installed builds keep the CSS-glass .modal fallback,
        // so the web deploy is safe to ship in any order relative to this native rebuild.
        config.userContentController.addUserScript(
            WKUserScript(source: "window.__vfNative = true; window.__vfGlassCard = true;"
                         + " window.__vfFsheet = true; window.__vfMemberSheet = true; window.__vfEsheet = true;"
                         + " window.__vfPhotoLib = true; window.__vfComments = true; window.__vfComposeCamera = true;"
                         + " window.__vfPostPage = true; window.__vfListPage = true;"
                         + " window.__vfSheetEmojis = true;",
                         injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        // Edge-to-edge: the web view extends under the notch/home indicator (SwiftUI
        // .ignoresSafeArea), and iOS reports the real safe-area insets to the page via
        // env(safe-area-inset-*). The web owns all safe-area padding.
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.showsVerticalScrollIndicator = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.isOpaque = false
        webView.backgroundColor = .clear
        #if DEBUG
        if #available(iOS 16.4, *) {
            webView.isInspectable = true
        }
        #endif

        // No native pull-to-refresh / outer bounce: the feed scrolls in the web's own
        // inner container (#app), so the outer WKWebView must NOT rubber-band (that was
        // what revealed a black gap + spinner and pushed the whole UI down). Pull-to-
        // refresh is now a clean in-app gesture handled in the web (js/pullrefresh.js).
        webView.scrollView.bounces = false

        hideKeyboardAccessoryBar(of: webView)

        model.webView = webView
        // Let the ad manager call back into the page (fill/collapse slots).
        AdsManager.shared.setWebView(webView)
        // Kold start via universal link: load linket (auth-landing) i stedet for bare forsiden
        webView.load(URLRequest(url: model.pendingDeepLink ?? vibefeedURL))
        model.pendingDeepLink = nil
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(model: model)
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let model: WebViewModel

        init(model: WebViewModel) {
            self.model = model
        }

        // keep VibeFeed (and its Supabase backend) inside the app;
        // any other website opens in Safari
        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard navigationAction.targetFrame?.isMainFrame != false,
                  let url = navigationAction.request.url,
                  let host = url.host,
                  url.scheme?.hasPrefix("http") == true
            else {
                decisionHandler(.allow)
                return
            }
            let internalHosts = ["vibefeed.dk", "www.vibefeed.dk",
                                 "kreds-sepia.vercel.app",
                                 "iduotqxkohuezxkveawc.supabase.co"]
            if internalHosts.contains(host) {
                decisionHandler(.allow)
            } else {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            }
        }

        // target=_blank links (fx privatlivspolitikken fra samtykke-gaten/signup) åbner i
        // I-APP-BROWSEREN (SFSafariViewController) — brugeren bliver i appen. At loade dem
        // i SAMME webview navigerede væk fra index.html og dræbte SPA'en under de native
        // overlays (frosne barer, fastlåst esheet-scrim).
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
                InAppBrowser.present(url)
            }
            return nil
        }

        func webView(_ webView: WKWebView,
                     didFailProvisionalNavigation navigation: WKNavigation!,
                     withError error: Error) {
            model.failed = true
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.failed = false
        }
    }
}
