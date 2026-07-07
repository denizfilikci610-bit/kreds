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

// Reports zero safe-area insets to the web content, so the page never
// double-pads: the native layer (SwiftUI) owns the safe areas exclusively.
final class InsetFreeWebView: WKWebView {
    override var safeAreaInsets: UIEdgeInsets { .zero }
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

        let webView = InsetFreeWebView(frame: .zero, configuration: config)
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

        let refresh = UIRefreshControl()
        refresh.addTarget(context.coordinator, action: #selector(Coordinator.pullToRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refresh

        model.webView = webView
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

        @objc func pullToRefresh(_ sender: UIRefreshControl) {
            model.webView?.reload()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                sender.endRefreshing()
            }
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
