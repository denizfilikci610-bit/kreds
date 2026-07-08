import SwiftUI

/// A native action sheet driven entirely by the web app over the JS bridge.
///
/// The web posts `{type:"sheet", title, message, buttons:[{label, action, role}]}`
/// (NotifManager handles it → `SheetModel.shared.apply`). We render a system
/// `.confirmationDialog`, which on iOS 26 is real Liquid Glass — matching the native
/// tab bar and kreds bar. On the chosen button we call back `window.vfSheet(action)`;
/// the web owns all flow (it may post a follow-up sheet, e.g. a delete confirmation).
/// This replaces the web `.modal` popups (#rmenu / #pmenu / #ufmenu) inside the app.

struct SheetButton: Identifiable, Equatable {
    let id: Int
    let label: String
    let action: String   // web action id: "report" | "edit" | "delete" | "unfriend" | "__cancel"
    let role: String     // "destructive" | "cancel" | "default"
}

struct SheetRequest: Equatable {
    let token: Int       // bumps per sheet so a follow-up sheet re-presents cleanly
    let title: String
    let message: String
    let buttons: [SheetButton]
}

final class SheetModel: ObservableObject {
    static let shared = SheetModel()
    @Published var request: SheetRequest?
    private var counter = 0
    /// Native → web. Set by ContentView to evaluate `window.vfSheet(action)`.
    var onAction: ((String) -> Void)?

    func apply(_ dict: [String: Any]) {
        let raw = (dict["buttons"] as? [[String: Any]]) ?? []
        let buttons: [SheetButton] = raw.enumerated().compactMap { i, b in
            guard let label = b["label"] as? String, let action = b["action"] as? String else { return nil }
            return SheetButton(id: i, label: label, action: action, role: (b["role"] as? String) ?? "default")
        }
        guard !buttons.isEmpty else { return }
        counter += 1
        request = SheetRequest(token: counter,
                               title: (dict["title"] as? String) ?? "",
                               message: (dict["message"] as? String) ?? "",
                               buttons: buttons)
    }
}

/// Attaches the system confirmation dialog to a host view (ContentView's root ZStack).
struct SheetHost: ViewModifier {
    @ObservedObject private var model = SheetModel.shared

    func body(content: Content) -> some View {
        content.confirmationDialog(
            model.request?.title ?? "",
            isPresented: Binding(
                get: { model.request != nil },
                set: { presented in if !presented { model.request = nil } }
            ),
            titleVisibility: (model.request?.title.isEmpty == false) ? .visible : .automatic,
            presenting: model.request
        ) { req in
            ForEach(req.buttons) { btn in
                switch btn.role {
                case "cancel":
                    Button(btn.label, role: .cancel) { model.onAction?(btn.action) }
                case "destructive":
                    Button(btn.label, role: .destructive) { model.onAction?(btn.action) }
                default:
                    Button(btn.label) { model.onAction?(btn.action) }
                }
            }
        } message: { req in
            if !req.message.isEmpty { Text(req.message) }
        }
    }
}
