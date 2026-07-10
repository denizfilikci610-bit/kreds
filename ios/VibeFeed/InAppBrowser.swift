import SafariServices
import UIKit

/// Præsenterer en URL i Apples i-app-browser (SFSafariViewController) OVENPÅ appen —
/// brugeren BLIVER i appen: "Færdig" lukker tilbage til præcis hvor man var, inkl.
/// åbne glas-sheets med stagede ændringer. Bruges til privatlivspolitikken (esheet,
/// samtykke-gate, signup) og alle andre target=_blank-links fra webviewet.
enum InAppBrowser {
    static func present(_ url: URL) {
        // SFSafariViewController kan kun vise http(s) — alt andet (mailto, appstore…) til systemet
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
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = UIColor(red: 0xE0 / 255, green: 0x40 / 255, blue: 0x2F / 255, alpha: 1)
            top.present(safari, animated: true)
        }
    }
}
