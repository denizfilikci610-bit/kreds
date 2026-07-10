import UIKit
import WebKit

/// I-app-fremviser til privatlivspolitikken (og andre _blank-links fra webviewet):
/// egen WKWebView i et ark med "Færdig"-knap. Al navigation opsnappes — politik-
/// siderne (privatliv.html/privacy.html) må vises, men ethvert link VÆK fra dem på
/// vibefeed.dk (logoet → "/", "Tilbage til vibefeed.dk") LUKKER arket, så brugeren
/// lander i APPEN igen — aldrig på hjemmesiden inde i arket. (SFSafariViewController
/// kunne ikke dét: en rigtig browser navigerer bare videre.)
enum InAppBrowser {
    static func present(_ url: URL) {
        guard url.scheme == "https" || url.scheme == "http" else {
            UIApplication.shared.open(url)
            return
        }
        DispatchQueue.main.async {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
            guard let window = scene?.windows.first(where: { $0.isKeyWindow }) ?? scene?.windows.first,
                  let root = window.rootViewController else {
                UIApplication.shared.open(url) // ingen scene at præsentere fra → Safari som nødplan
                return
            }
            var top = root
            while let presented = top.presentedViewController { top = presented }
            let nav = UINavigationController(rootViewController: InAppBrowserVC(url: url))
            nav.navigationBar.tintColor = UIColor(red: 0xE0 / 255, green: 0x40 / 255, blue: 0x2F / 255, alpha: 1)
            top.present(nav, animated: true)
        }
    }
}

final class InAppBrowserVC: UIViewController, WKNavigationDelegate {
    private let startURL: URL
    private var webView: WKWebView!

    init(url: URL) {
        startURL = url
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView = WKWebView(frame: .zero)
        webView.navigationDelegate = self
        view = webView
        // Systemets Udført/Done-knap — følger enhedens sprog (native hardcoder aldrig tekst)
        navigationItem.rightBarButtonItem = UIBarButtonItem(
            barButtonSystemItem: .done, target: self, action: #selector(close))
        webView.load(URLRequest(url: startURL))
    }

    @objc private func close() { dismiss(animated: true) }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.allow); return }
        // Selve indlæsningen (og evt. redirects) skal igennem
        if navigationAction.navigationType != .linkActivated { decisionHandler(.allow); return }
        let host = (url.host ?? "").lowercased().replacingOccurrences(of: "www.", with: "")
        let isPolicyPage = url.path.hasSuffix("/privatliv.html") || url.path.hasSuffix("/privacy.html")
        if host == "vibefeed.dk" && isPolicyPage { decisionHandler(.allow); return } // sprogskifte-links
        decisionHandler(.cancel)
        if host == "vibefeed.dk" || host.isEmpty {
            dismiss(animated: true) // logo / "Tilbage til vibefeed.dk" = tilbage til APPEN
        } else {
            UIApplication.shared.open(url) // reelt eksterne links → Safari
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        navigationItem.title = webView.title
    }
}
