import SwiftUI

/// A CUSTOM centered action-sheet card driven entirely by the web app over the JS bridge —
/// REAL iOS 26 Liquid Glass (`.glassEffect`), matching the native tab bar & kreds bar.
///
/// This deliberately is NOT iOS's system `.confirmationDialog` (a bottom sheet that changed the
/// flow): it is a centered card that mirrors the WEB modal — same 2-step flow, same post preview —
/// but built from real glass pills. The web posts
/// `{type:"sheet", title, message, preview?, buttons:[{label, action, role}]}` (NotifManager routes
/// it to `SheetModel.shared.apply`); on a tap we call back `window.vfSheet(action)` and the WEB owns
/// all flow (it either posts the next sheet — e.g. a delete confirmation — or posts `{close:true}`).

private let vfRed = Color(red: 0xE0 / 255, green: 0x40 / 255, blue: 0x2F / 255)

struct SheetButton: Identifiable, Equatable {
    let id: Int
    let label: String
    let action: String   // "report" | "edit" | "delete" | "unfriend" | "__cancel" …
    let role: String      // "destructive" | "cancel" | "default"
}

struct SheetPreview: Equatable {
    let name: String
    let snippet: String
    let avatarUrl: String
    let initials: String
    var hasAvatar: Bool { !avatarUrl.isEmpty }
}

struct SheetRequest: Equatable {
    let token: Int        // bumps per sheet so content swaps (2-step) animate
    let title: String
    let message: String
    let preview: SheetPreview?
    let buttons: [SheetButton]
}

final class SheetModel: ObservableObject {
    static let shared = SheetModel()
    @Published var request: SheetRequest?
    private var counter = 0
    /// Native → web. Set by ContentView to evaluate `window.vfSheet(action)`.
    var onAction: ((String) -> Void)?

    func apply(_ dict: [String: Any]) {
        // The web can dismiss the card explicitly once a flow ends.
        if (dict["close"] as? Bool) == true { request = nil; return }

        let raw = (dict["buttons"] as? [[String: Any]]) ?? []
        let buttons: [SheetButton] = raw.enumerated().compactMap { i, b in
            guard let label = b["label"] as? String, let action = b["action"] as? String else { return nil }
            return SheetButton(id: i, label: label, action: action, role: (b["role"] as? String) ?? "default")
        }
        guard !buttons.isEmpty else { return }

        var preview: SheetPreview? = nil
        if let p = dict["preview"] as? [String: Any], let name = p["name"] as? String {
            preview = SheetPreview(name: name,
                                   snippet: (p["snippet"] as? String) ?? "",
                                   avatarUrl: (p["avatarUrl"] as? String) ?? "",
                                   initials: (p["initials"] as? String) ?? "")
        }
        counter += 1
        request = SheetRequest(token: counter,
                               title: (dict["title"] as? String) ?? "",
                               message: (dict["message"] as? String) ?? "",
                               preview: preview,
                               buttons: buttons)
    }
}

/// Real iOS 26 Liquid Glass on a rounded pill; `.clipShape` clips the downward glass shadow
/// (the dark line lesson from the kreds chips). Material-blur fallback on iOS 17–25.
private struct GlassPillBG: ViewModifier {
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)
        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: shape).clipShape(shape)
        } else {
            content
                .background(.ultraThinMaterial, in: shape)
                .overlay(shape.strokeBorder(Color.primary.opacity(0.10)))
                .clipShape(shape)
        }
    }
}

/// The centered glass card: an action group (optional preview / title+note + buttons) and a
/// separated "Annuller" pill below, matching the web modal's layout.
private struct GlassSheetCard: View {
    let req: SheetRequest
    let onAction: (String) -> Void

    private var actionButtons: [SheetButton] { req.buttons.filter { $0.role != "cancel" } }
    private var cancelButton: SheetButton? { req.buttons.first { $0.role == "cancel" } }
    private var hasHeader: Bool { req.preview != nil || !req.title.isEmpty }

    var body: some View {
        VStack(spacing: 10) {
            VStack(spacing: 0) {
                if let p = req.preview {
                    previewHeader(p)
                } else if !req.title.isEmpty {
                    titleHeader
                }
                ForEach(Array(actionButtons.enumerated()), id: \.element.id) { idx, btn in
                    if idx > 0 || hasHeader { hairline }
                    rowButton(btn)
                }
            }
            .modifier(GlassPillBG())

            if let c = cancelButton {
                rowButton(c).modifier(GlassPillBG())
            }
        }
        .frame(maxWidth: 300)
        .padding(.horizontal, 28)
    }

    private var hairline: some View {
        Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 0.5)
    }

    private func rowButton(_ btn: SheetButton) -> some View {
        Button {
            onAction(btn.action)
        } label: {
            Text(btn.label)
                .font(.system(size: 17, weight: btn.role == "default" ? .regular : .semibold))
                .foregroundStyle(btn.role == "destructive" ? vfRed : Color.primary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 15)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var titleHeader: some View {
        VStack(spacing: 3) {
            Text(req.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.primary)
                .multilineTextAlignment(.center)
            if !req.message.isEmpty {
                Text(req.message)
                    .font(.system(size: 13))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity)
    }

    private func previewHeader(_ p: SheetPreview) -> some View {
        HStack(spacing: 11) {
            avatar(p)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.name)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(Color.primary)
                    .lineLimit(1)
                if !p.snippet.isEmpty {
                    Text(p.snippet)
                        .font(.system(size: 13))
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 13)
    }

    @ViewBuilder
    private func avatar(_ p: SheetPreview) -> some View {
        if p.hasAvatar, let url = URL(string: p.avatarUrl) {
            AsyncImage(url: url) { img in
                img.resizable().scaledToFill()
            } placeholder: {
                Circle().fill(Color.secondary.opacity(0.2))
            }
            .frame(width: 38, height: 38)
            .clipShape(Circle())
        } else {
            Circle().fill(Color.secondary.opacity(0.25))
                .frame(width: 38, height: 38)
                .overlay(
                    Text(p.initials)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(Color.primary)
                )
        }
    }
}

/// Overlays the glass card (with a dimming scrim) on the host view when a sheet is requested.
struct SheetHost: ViewModifier {
    @ObservedObject private var model = SheetModel.shared

    func body(content: Content) -> some View {
        ZStack {
            content
            if let req = model.request {
                Color.black.opacity(0.28)
                    .ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { model.onAction?("__cancel") }
                    .transition(.opacity)
                GlassSheetCard(req: req) { action in
                    model.onAction?(action)
                }
                .transition(.scale(scale: 0.94).combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.84), value: model.request)
    }
}
