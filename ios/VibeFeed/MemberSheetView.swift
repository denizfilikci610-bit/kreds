import SwiftUI

/// Native Liquid Glass "Kredsens medlemmer" (members) bottom sheet. The web pushes the WHOLE
/// snapshot on open and on every re-render (action / realtime / poll — renderMemberSheet already
/// runs at those moments), so native stays live. Native renders real glass, reports per-row taps
/// back, and the web runs all RPCs (remove/add/cancel/leave) + decides direct-vs-vote. The leave
/// two-step is native-local (snappy); only the final confirm crosses. Browser keeps the CSS #msheet.

struct MSMember: Identifiable, Equatable {
    let id: String        // uid (stable)
    let name: String
    let handle: String
    let avatarUrl: String
    let initials: String
    let gradient: [String]
    let isOwner: Bool
    let removable: Bool
}

struct MSInvitable: Identifiable, Equatable {
    let id: String        // uid (stable)
    let name: String
    let handle: String
    let avatarUrl: String
    let initials: String
    let gradient: [String]
    let invited: Bool
    let cancelable: Bool
}

final class MemberSheetModel: ObservableObject {
    static let shared = MemberSheetModel()

    @Published var open = false
    @Published var token = 0
    @Published var feedId = ""
    @Published var title = ""
    @Published var canManage = false
    @Published var governanceNote = ""
    @Published var showInviteSection = false
    @Published var emptyInvitable = ""
    @Published var members: [MSMember] = []
    @Published var invitable: [MSInvitable] = []
    @Published var labels: [String: String] = [:]
    /// Rows with an in-flight action → their button is disabled until the next snapshot.
    @Published var pending: Set<String> = []

    var onAction: ((String) -> Void)?

    func L(_ k: String) -> String { labels[k] ?? "" }

    func apply(_ dict: [String: Any]) {
        if (dict["close"] as? Bool) == true { open = false; pending = []; return }
        guard (dict["open"] as? Bool) == true else { return }
        // Ignore a stale snapshot for a circle we're no longer showing.
        let fid = dict["feedId"] as? String ?? ""
        if open, !feedId.isEmpty, !fid.isEmpty, fid != feedId { return }
        token = (dict["token"] as? Int) ?? token + 1
        feedId = fid
        title = dict["title"] as? String ?? ""
        canManage = (dict["canManage"] as? Bool) ?? false
        governanceNote = dict["governanceNote"] as? String ?? ""
        showInviteSection = (dict["showInviteSection"] as? Bool) ?? false
        emptyInvitable = dict["emptyInvitable"] as? String ?? ""
        members = parseMembers(dict["members"])
        invitable = parseInvitable(dict["invitable"])
        if let l = dict["labels"] as? [String: Any] { labels = l.compactMapValues { $0 as? String } }
        pending = []   // a fresh authoritative snapshot clears optimistic disables
        open = true
    }

    private func parseMembers(_ raw: Any?) -> [MSMember] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let id = d["id"] as? String else { return nil }
            return MSMember(id: id, name: (d["name"] as? String) ?? "?", handle: (d["handle"] as? String) ?? "",
                            avatarUrl: (d["avatarUrl"] as? String) ?? "", initials: (d["initials"] as? String) ?? "?",
                            gradient: (d["gradient"] as? [String]) ?? [],
                            isOwner: (d["isOwner"] as? Bool) ?? false, removable: (d["removable"] as? Bool) ?? false)
        }
    }
    private func parseInvitable(_ raw: Any?) -> [MSInvitable] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let id = d["id"] as? String else { return nil }
            return MSInvitable(id: id, name: (d["name"] as? String) ?? "?", handle: (d["handle"] as? String) ?? "",
                               avatarUrl: (d["avatarUrl"] as? String) ?? "", initials: (d["initials"] as? String) ?? "?",
                               gradient: (d["gradient"] as? [String]) ?? [],
                               invited: (d["invited"] as? Bool) ?? false, cancelable: (d["cancelable"] as? Bool) ?? false)
        }
    }

    func remove(_ uid: String) { pending.insert(uid); send(["kind": "remove", "feedId": feedId, "uid": uid]) }
    func invite(_ uid: String) { pending.insert(uid); send(["kind": "invite", "feedId": feedId, "uid": uid]) }
    func cancelInvite(_ uid: String) { pending.insert(uid); send(["kind": "cancelInvite", "feedId": feedId, "uid": uid]) }
    func leaveConfirm() { send(["kind": "leaveConfirm", "feedId": feedId]) }
    func dismiss() { send(["kind": "dismiss", "feedId": feedId]) }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        onAction?(s)
    }
}

struct GlassMemberSheet: View {
    @ObservedObject private var model = MemberSheetModel.shared
    @State private var leaveConfirming = false

    var body: some View {
        GlassBottomSheet(onDismiss: { model.dismiss() }) {
            VStack(spacing: 0) {
                Text(model.title)
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Color.primary)
                    .padding(.bottom, 10)

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if !model.governanceNote.isEmpty {
                            Text(model.governanceNote)
                                .font(.system(size: 13, weight: .semibold)).foregroundStyle(Color.primary)
                                .padding(.horizontal, 12).padding(.vertical, 9)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .glassBG(RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .padding(.horizontal, 16).padding(.top, 6)
                        }
                        label(model.L("members"))
                        ForEach(model.members) { m in memberRow(m) }
                        if model.showInviteSection {
                            label(model.L("inviteLabel"))
                            if model.invitable.isEmpty {
                                Text(model.emptyInvitable)
                                    .font(.system(size: 14)).foregroundStyle(.secondary)
                                    .padding(.horizontal, 18).padding(.vertical, 12)
                            } else {
                                ForEach(model.invitable) { i in invitableRow(i) }
                            }
                        }
                    }
                    .padding(.bottom, 8)
                }

                leaveZone
            }
            .padding(.top, 2)
        }
    }

    private func label(_ s: String) -> some View {
        Text(s.uppercased())
            .font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary).kerning(0.4)
            .padding(.leading, 18).padding(.top, 14).padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func personRow<Trailing: View>(_ avatarUrl: String, _ initials: String, _ gradient: [String],
                                            _ name: String, _ handle: String, ownerBadge: Bool,
                                            @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: 12) {
            GlassAvatar(url: avatarUrl, initials: initials, gradient: gradient, size: 44)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(name).font(.system(size: 15, weight: .semibold)).foregroundStyle(Color.primary).lineLimit(1)
                    if ownerBadge {
                        Text(model.L("owner"))
                            .font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .glassBG(Capsule())
                    }
                }
                Text("@\(handle)").font(.system(size: 13)).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer(minLength: 8)
            trailing()
        }
        .padding(.horizontal, 16).padding(.vertical, 8)
    }

    private func memberRow(_ m: MSMember) -> some View {
        personRow(m.avatarUrl, m.initials, m.gradient, m.name, m.handle, ownerBadge: m.isOwner) {
            if m.removable {
                pillButton(model.L("remove"), tint: Color.primary, disabled: model.pending.contains(m.id)) {
                    model.remove(m.id)
                }
            }
        }
    }

    private func invitableRow(_ i: MSInvitable) -> some View {
        personRow(i.avatarUrl, i.initials, i.gradient, i.name, i.handle, ownerBadge: false) {
            if i.invited {
                HStack(spacing: 8) {
                    Text(model.L("invited")).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
                    if i.cancelable {
                        pillButton(model.L("inviteCancel"), tint: vfRed, disabled: model.pending.contains(i.id)) {
                            model.cancelInvite(i.id)
                        }
                    }
                }
            } else {
                pillButton(model.L("invite"), tint: vfRed, disabled: model.pending.contains(i.id)) {
                    model.invite(i.id)
                }
            }
        }
    }

    private func pillButton(_ label: String, tint: Color, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label).font(.system(size: 13.5, weight: .bold)).foregroundStyle(tint)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .glassBG(Capsule())
                .opacity(disabled ? 0.5 : 1)
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private var leaveZone: some View {
        VStack(spacing: 8) {
            if leaveConfirming {
                Text(model.L("leaveConfirm"))
                    .font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    .padding(.horizontal, 16)
                Button { model.leaveConfirm() } label: {
                    Text(model.L("leaveYes")).font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(vfRed))
                }.buttonStyle(.plain).padding(.horizontal, 16)
                Button { leaveConfirming = false } label: {
                    Text(model.L("cancel")).font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
                        .padding(.vertical, 4)
                }.buttonStyle(.plain)
            } else {
                Button { leaveConfirming = true } label: {
                    Text(model.L("leave")).font(.system(size: 15, weight: .bold)).foregroundStyle(vfRed)
                        .padding(.vertical, 10)
                }.buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 10)
        .padding(.bottom, 14)
        .overlay(Rectangle().fill(Color.primary.opacity(0.1)).frame(height: 0.5), alignment: .top)
        .onChange(of: model.token) { _, _ in leaveConfirming = false }
    }
}

/// Overlays the members glass sheet + a dimming scrim on the host view when open.
struct MemberSheetHost: ViewModifier {
    @ObservedObject private var model = MemberSheetModel.shared
    func body(content: Content) -> some View {
        ZStack {
            content
            if model.open {
                Color.black.opacity(0.28).ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { model.dismiss() }
                    .transition(.opacity)
                GlassMemberSheet()
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.spring(response: 0.36, dampingFraction: 0.86), value: model.open)
    }
}
