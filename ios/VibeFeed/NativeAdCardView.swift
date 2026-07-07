import UIKit
import Appodeal

/// A post-styled native ad card (X/Twitter-style "sponsoreret opslag"). The whole
/// card is drawn natively so the Appodeal SDK can bind and click-/impression-track
/// the ad's asset views (title, media, CTA) via the `APDNativeAdView` protocol.
///
/// Only the asset views returned by the protocol getters are handed to the SDK and
/// made tappable. The "profile" chrome (avatar frame, the "Annonce" label, the
/// muted sub-line) is plain non-interactive decoration the SDK never registers — so
/// it can never be mistaken for a real, clickable profile.
///
/// The layout is a vertical stack, so a missing asset (no body, no media) simply
/// collapses its row → three templates fall out of one view:
///   • Media card   — icon + name + (body) + 16:9 image + CTA   (richest, X-like)
///   • Body card    — icon + name + body + CTA                  (text-forward)
///   • Compact card — icon + name + CTA                         (always-valid minimum)
///
/// Height is content-driven (Auto Layout), so `AdsManager` can measure the exact
/// height for a given width and have the web reserve precisely that much space — the
/// card therefore never overflows its slot.
final class NativeAdCardView: UIView, APDNativeAdView {

    // MARK: - Asset views (bound by the SDK via the protocol getters)

    private let iconImageView: UIImageView = {
        let v = UIImageView()
        v.contentMode = .scaleAspectFill
        v.clipsToBounds = true
        v.layer.cornerRadius = 20
        v.backgroundColor = .tertiarySystemFill
        v.translatesAutoresizingMaskIntoConstraints = false
        v.widthAnchor.constraint(equalToConstant: 40).isActive = true
        v.heightAnchor.constraint(equalToConstant: 40).isActive = true
        return v
    }()

    private let titleLbl: UILabel = {
        let l = UILabel()
        l.font = .systemFont(ofSize: 15, weight: .bold)
        l.textColor = .label
        l.numberOfLines = 1
        return l
    }()

    private let descriptionLbl: UILabel = {
        let l = UILabel()
        l.font = .systemFont(ofSize: 14)
        l.textColor = .label
        l.numberOfLines = 2   // fixed cap → deterministic height
        return l
    }()

    private let mediaView: UIView = {
        let v = UIView()
        v.backgroundColor = .tertiarySystemFill
        v.clipsToBounds = true
        v.layer.cornerRadius = 12
        return v
    }()

    private let ctaLbl: PaddedLabel = {
        let l = PaddedLabel()
        l.font = .systemFont(ofSize: 15, weight: .semibold)
        l.textColor = .white
        l.backgroundColor = UIColor(red: 0xE0/255, green: 0x40/255, blue: 0x2F/255, alpha: 1) // VibeFeed accent
        l.textAlignment = .center
        l.clipsToBounds = true
        l.layer.cornerRadius = 10
        return l
    }()

    private let adChoicesBox: UIView = {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.widthAnchor.constraint(equalToConstant: 20).isActive = true
        v.heightAnchor.constraint(equalToConstant: 20).isActive = true
        return v
    }()

    // MARK: - Chrome (never handed to the SDK, never clickable)

    private let annonceLbl: PaddedLabel = {
        let l = PaddedLabel()
        l.text = "Annonce"
        l.font = .systemFont(ofSize: 11, weight: .bold)
        l.textColor = .secondaryLabel
        l.layer.borderWidth = 1
        l.layer.borderColor = UIColor.separator.cgColor
        l.layer.cornerRadius = 5
        l.clipsToBounds = true
        return l
    }()

    private let subLbl: UILabel = {
        let l = UILabel()
        l.text = "Promoveret"
        l.font = .systemFont(ofSize: 12)
        l.textColor = .secondaryLabel
        l.numberOfLines = 1
        return l
    }()

    private var mediaAspect: NSLayoutConstraint?

    // MARK: - Init

    override init(frame: CGRect) {
        super.init(frame: frame)
        build()
    }
    required init?(coder: NSCoder) {
        super.init(coder: coder)
        build()
    }

    private func build() {
        backgroundColor = .systemBackground
        layer.cornerRadius = 14
        layer.borderWidth = 1
        layer.borderColor = UIColor.separator.cgColor
        clipsToBounds = true
        insetsLayoutMarginsFromSafeArea = false

        // Header: icon | (name / sub) | Annonce | AdChoices
        let nameStack = vstack([titleLbl, subLbl], spacing: 1)
        titleLbl.setContentHuggingPriority(.defaultLow, for: .horizontal)
        titleLbl.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let header = UIStackView(arrangedSubviews: [iconImageView, nameStack, annonceLbl, adChoicesBox])
        header.axis = .horizontal
        header.alignment = .center
        header.spacing = 8

        let root = UIStackView(arrangedSubviews: [header, descriptionLbl, mediaView, ctaLbl])
        root.axis = .vertical
        root.spacing = 10
        root.translatesAutoresizingMaskIntoConstraints = false
        addSubview(root)

        NSLayoutConstraint.activate([
            root.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            root.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            root.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            root.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            ctaLbl.heightAnchor.constraint(equalToConstant: 38),
        ])

        // 16:9 media, driven off the media view's own width.
        let aspect = mediaView.heightAnchor.constraint(equalTo: mediaView.widthAnchor, multiplier: 9.0 / 16.0)
        aspect.priority = .required
        aspect.isActive = true
        mediaAspect = aspect
    }

    // MARK: - Template selection

    /// Show/hide rows for the assets this ad actually has. The stack collapses hidden
    /// rows, so the card is exactly as tall as its content (measured by AdsManager).
    func applyTemplate(hasBody: Bool, hasMedia: Bool, hasIcon: Bool) {
        descriptionLbl.isHidden = !hasBody
        mediaView.isHidden = !hasMedia
        iconImageView.isHidden = !hasIcon
    }

    // MARK: - Populate from raw asset values

    /// Fill the card from raw ad-asset values. Used by the DEBUG path, which reads a
    /// REAL Google native TEST ad's assets and shows them directly (no invented data).
    /// Production ads are populated by the Appodeal SDK via the protocol getters.
    func populate(title: String, body: String?, cta: String, image: UIImage?, icon: UIImage?) {
        titleLbl.text = title
        descriptionLbl.text = body
        ctaLbl.text = cta
        iconImageView.image = icon
        if let image = image {
            let iv = UIImageView(image: image)
            iv.contentMode = .scaleAspectFill
            iv.clipsToBounds = true
            iv.frame = mediaView.bounds
            iv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            mediaView.subviews.forEach { $0.removeFromSuperview() }
            mediaView.addSubview(iv)
        }
        applyTemplate(hasBody: (body?.isEmpty == false), hasMedia: image != nil, hasIcon: icon != nil)
    }

    // MARK: - APDNativeAdView protocol (asset views the SDK binds + tracks)

    func titleLabel() -> UILabel { titleLbl }
    func callToActionLabel() -> UILabel { ctaLbl }
    func descriptionLabel() -> UILabel { descriptionLbl }
    func iconView() -> UIImageView { iconImageView }
    func mediaContainerView() -> UIView { mediaView }
    func adChoicesView() -> UIView { adChoicesBox }

    // MARK: - Small helpers

    private func vstack(_ views: [UIView], spacing: CGFloat) -> UIStackView {
        let s = UIStackView(arrangedSubviews: views)
        s.axis = .vertical
        s.spacing = spacing
        s.alignment = .leading
        return s
    }
}

/// A UILabel with content insets — used for the "Annonce" pill and the CTA button.
final class PaddedLabel: UILabel {
    var insets = UIEdgeInsets(top: 3, left: 8, bottom: 3, right: 8)
    override func drawText(in rect: CGRect) { super.drawText(in: rect.inset(by: insets)) }
    override var intrinsicContentSize: CGSize {
        let s = super.intrinsicContentSize
        return CGSize(width: s.width + insets.left + insets.right,
                      height: s.height + insets.top + insets.bottom)
    }
}
