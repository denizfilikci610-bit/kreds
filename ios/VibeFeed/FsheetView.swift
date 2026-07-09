import SwiftUI

/// Native Liquid Glass "Ny kreds" (new circle) bottom sheet. Native owns the ephemeral form state
/// (name, governance, friend selection) for a zero-latency feel and only crosses the bridge for the
/// two things the web must run: create (with the full payload) and dismiss. The web owns create_feed,
/// validation errors, i18n and the friend data (pushed once on open). Browser keeps the CSS #fsheet.

struct FsFriend: Identifiable, Equatable {
    let id: String        // handle (stable)
    let name: String
    let handle: String
    let avatarUrl: String
    let initials: String
    let gradient: [String]
}

final class FsheetModel: ObservableObject {
    static let shared = FsheetModel()

    @Published var open = false
    @Published var token = 0
    @Published var title = ""
    @Published var namePlaceholder = ""
    @Published var nameMaxLength = 30
    @Published var govLabel = ""
    @Published var govVoteLabel = ""
    @Published var govOwnerLabel = ""
    @Published var pickLabel = ""
    @Published var createLabel = ""
    @Published var emptyLabel = ""
    @Published var selectAllLabel = ""
    @Published var deselectAllLabel = ""
    @Published var friends: [FsFriend] = []

    // Native-local ephemeral state
    @Published var name = ""
    @Published var governance = "vote"
    @Published var selected: Set<String> = []
    @Published var busy = false

    /// Native → web (a JSON string forming a JS object literal argument for window.vfFsheet).
    var onAction: ((String) -> Void)?

    var canCreate: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !selected.isEmpty }
    var allSelected: Bool { !friends.isEmpty && selected.count == friends.count }

    func apply(_ dict: [String: Any]) {
        if (dict["close"] as? Bool) == true { open = false; busy = false; return }
        if (dict["update"] as? Bool) == true {
            if let b = dict["busy"] as? Bool { busy = b }
            return
        }
        guard (dict["open"] as? Bool) == true else { return }
        token = (dict["token"] as? Int) ?? token + 1
        title = dict["title"] as? String ?? ""
        namePlaceholder = dict["namePlaceholder"] as? String ?? ""
        nameMaxLength = (dict["nameMaxLength"] as? Int) ?? 30
        govLabel = dict["govLabel"] as? String ?? ""
        govVoteLabel = dict["govVoteLabel"] as? String ?? ""
        govOwnerLabel = dict["govOwnerLabel"] as? String ?? ""
        pickLabel = dict["pickLabel"] as? String ?? ""
        createLabel = dict["createLabel"] as? String ?? ""
        emptyLabel = dict["emptyLabel"] as? String ?? ""
        selectAllLabel = dict["selectAllLabel"] as? String ?? ""
        deselectAllLabel = dict["deselectAllLabel"] as? String ?? ""
        friends = parseFriends(dict["friends"])
        // full reset on open (mirrors openFeedSheet clearing name/selection/governance)
        name = ""
        governance = "vote"
        selected = []
        busy = false
        open = true
    }

    private func parseFriends(_ raw: Any?) -> [FsFriend] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let h = d["handle"] as? String else { return nil }
            return FsFriend(id: h,
                            name: (d["name"] as? String) ?? h,
                            handle: h,
                            avatarUrl: (d["avatarUrl"] as? String) ?? "",
                            initials: (d["initials"] as? String) ?? "?",
                            gradient: (d["gradient"] as? [String]) ?? [])
        }
    }

    func toggle(_ handle: String) {
        if selected.contains(handle) { selected.remove(handle) } else { selected.insert(handle) }
    }
    func toggleAll() {
        if allSelected { selected = [] } else { selected = Set(friends.map { $0.handle }) }
    }

    func create() {
        guard canCreate, !busy else { return }
        busy = true
        send(["kind": "create", "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
              "governance": governance, "handles": Array(selected)])
    }
    func dismiss() { send(["kind": "dismiss"]) }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        onAction?(s)
    }
}

struct GlassNyKredsSheet: View {
    @ObservedObject private var model = FsheetModel.shared
    @FocusState private var nameFocused: Bool

    var body: some View {
        GlassBottomSheet(onDismiss: { model.dismiss() }) {
            VStack(spacing: 0) {
                Text(model.title)
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(Color.primary)
                    .padding(.bottom, 12)

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        nameField
                        sectionLabel(model.govLabel)
                        governance
                        HStack {
                            sectionLabel(model.pickLabel)
                            Spacer()
                            if !model.friends.isEmpty {
                                Button { model.toggleAll() } label: {
                                    Text(model.allSelected ? model.deselectAllLabel : model.selectAllLabel)
                                        .font(.system(size: 12.5, weight: .bold))
                                        .foregroundStyle(Color.primary)
                                        .padding(.horizontal, 12).padding(.vertical, 5)
                                        .glassBG(Capsule())
                                }.buttonStyle(.plain).padding(.trailing, 16)
                            }
                        }
                        if model.friends.isEmpty {
                            Text(model.emptyLabel)
                                .font(.system(size: 14)).foregroundStyle(.secondary)
                                .padding(.horizontal, 18).padding(.vertical, 14)
                        } else {
                            ForEach(model.friends) { f in friendRow(f) }
                        }
                    }
                    .padding(.bottom, 8)
                }
                .scrollDismissesKeyboard(.interactively)

                createButton
            }
            .padding(.top, 2)
        }
        .onChange(of: model.token) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { nameFocused = true }
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.28) { nameFocused = true }
        }
    }

    private func sectionLabel(_ s: String) -> some View {
        Text(s.uppercased())
            .font(.system(size: 12, weight: .bold))
            .foregroundStyle(.secondary)
            .kerning(0.4)
            .padding(.leading, 18).padding(.top, 14).padding(.bottom, 4)
    }

    private var nameField: some View {
        TextField(model.namePlaceholder, text: $model.name)
            .focused($nameFocused)
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.primary)
            .submitLabel(.done)
            .onSubmit { nameFocused = false }
            .onChange(of: model.name) { _, v in
                if v.count > model.nameMaxLength { model.name = String(v.prefix(model.nameMaxLength)) }
            }
            .padding(.horizontal, 16).padding(.vertical, 13)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassBG(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 16).padding(.top, 8)
    }

    private var governance: some View {
        HStack(spacing: 8) {
            govButton(value: "vote", label: model.govVoteLabel)
            govButton(value: "owner", label: model.govOwnerLabel)
        }
        .padding(.horizontal, 16)
    }

    private func govButton(value: String, label: String) -> some View {
        let on = model.governance == value
        return Button { model.governance = value } label: {
            Text(label)
                .font(.system(size: 13.5, weight: .bold))
                .foregroundStyle(on ? vfRed : Color.secondary)
                .frame(maxWidth: .infinity).padding(.vertical, 10)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(on ? vfRed : Color.primary.opacity(0.15), lineWidth: 1.5)
                )
        }.buttonStyle(.plain)
    }

    private func friendRow(_ f: FsFriend) -> some View {
        let sel = model.selected.contains(f.handle)
        return Button { model.toggle(f.handle) } label: {
            HStack(spacing: 12) {
                GlassAvatar(url: f.avatarUrl, initials: f.initials, gradient: f.gradient, size: 44)
                VStack(alignment: .leading, spacing: 1) {
                    Text(f.name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.primary).lineLimit(1)
                    Text("@\(f.handle)").font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                ZStack {
                    Circle().strokeBorder(sel ? vfRed : Color.primary.opacity(0.25), lineWidth: 2)
                        .background(Circle().fill(sel ? vfRed : Color.clear))
                        .frame(width: 24, height: 24)
                    if sel {
                        Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            .contentShape(Rectangle())
        }.buttonStyle(.plain)
    }

    private var createButton: some View {
        Button { model.create() } label: {
            ZStack {
                Text(model.createLabel).font(.system(size: 16, weight: .bold)).foregroundStyle(.white).opacity(model.busy ? 0 : 1)
                if model.busy { ProgressView().tint(.white) }
            }
            .frame(maxWidth: .infinity).padding(.vertical, 15)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(vfRed))
            .opacity(model.canCreate && !model.busy ? 1 : 0.45)
        }
        .buttonStyle(.plain)
        .disabled(!model.canCreate || model.busy)
        .padding(.horizontal, 16).padding(.top, 10)
        .padding(.bottom, 12)
    }
}

/// Overlays the "Ny kreds" glass sheet + a dimming scrim on the host view when open.
struct FsheetHost: ViewModifier {
    @ObservedObject private var model = FsheetModel.shared
    func body(content: Content) -> some View {
        ZStack {
            content
            if model.open {
                Color.black.opacity(0.28).ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { model.dismiss() }
                    .transition(.opacity)
                GlassNyKredsSheet()
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.spring(response: 0.36, dampingFraction: 0.86), value: model.open)
    }
}
