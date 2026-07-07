import SwiftUI
import UIKit
import Appodeal

/// Embeds the shared Appodeal banner (a UIKit `APDBannerView`) into SwiftUI.
/// The banner instance lives in `AdsManager`; this just parents it and keeps its
/// `rootViewController` current.
struct BannerContainer: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let holder = UIView()
        holder.backgroundColor = .clear
        attach(to: holder)
        return holder
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        attach(to: uiView)
    }

    private func attach(to holder: UIView) {
        guard let banner = AdsManager.shared.ensureBanner() else { return }
        banner.rootViewController = AdsManager.topViewController()
        guard banner.superview !== holder else { return }
        banner.removeFromSuperview()
        banner.translatesAutoresizingMaskIntoConstraints = false
        holder.addSubview(banner)
        NSLayoutConstraint.activate([
            banner.centerXAnchor.constraint(equalTo: holder.centerXAnchor),
            banner.centerYAnchor.constraint(equalTo: holder.centerYAnchor),
        ])
    }
}

/// The bottom ad strip: a hairline separator, a tiny localized "Reklame"/"Ad"
/// label, and the banner.
///
/// The banner view is kept mounted in the hierarchy at ALL times (Appodeal
/// needs it attached to a window to load/render), but the whole strip collapses
/// to zero height and is clipped away until a real ad has loaded — so the app
/// is visually unchanged when there is no fill.
struct AdBannerStrip: View {
    @ObservedObject private var ads = AdsManager.shared

    var body: some View {
        VStack(spacing: 0) {
            if ads.isBannerReady {
                Divider()
                HStack(spacing: 0) {
                    Text(ads.adLabelText)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(.secondary)
                        .padding(.leading, 10)
                    Spacer(minLength: 0)
                }
                .frame(height: 12)
                .padding(.top, 2)
            }

            // Always mounted so Appodeal can load into it; height 0 (clipped)
            // hides it entirely when there is no ad.
            BannerContainer()
                .frame(maxWidth: .infinity)
                .frame(height: ads.isBannerReady ? ads.bannerHeight : 0)
                .clipped()
        }
        .background(ads.isBannerReady ? Color(UIColor.systemBackground) : Color.clear)
        .animation(.easeInOut(duration: 0.2), value: ads.isBannerReady)
    }
}
