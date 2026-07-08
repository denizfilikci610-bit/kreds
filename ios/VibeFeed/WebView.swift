import SwiftUI
import WebKit

let vibefeedURL = URL(string: "https://vibefeed.dk")!

final class WebViewModel: ObservableObject {
    @Published var failed = false
    weak var webView: WKWebView?

    func retry() {
        failed = false
        webView?.load(URLRequest(url: vibefeedURL))
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
        // __vfNativeSheets is a capability flag: it tells the web this build can render
        // native Liquid Glass action sheets (report / post menu / unfriend). Older installed
        // builds inject only __vfNative, so the web keeps using its web .modal fallback there —
        // which makes the web deploy safe to ship before/after this native rebuild, in any order.
        config.userContentController.addUserScript(
            WKUserScript(source: "window.__vfNative = true; window.__vfNativeSheets = true;",
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

        model.webView = webView
        // Let the ad manager call back into the page (fill/collapse slots).
        AdsManager.shared.setWebView(webView)
        webView.load(URLRequest(url: vibefeedURL))
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

        // target=_blank links load in the same view
        func webView(_ webView: WKWebView,
                     createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction,
                     windowFeatures: WKWindowFeatures) -> WKWebView? {
            if navigationAction.targetFrame == nil {
                webView.load(navigationAction.request)
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
