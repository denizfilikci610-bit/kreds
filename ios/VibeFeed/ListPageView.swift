import SwiftUI

/// Native full-screen friends/kredse list page (Instagram-style follower page): the
/// profile's handle centered on top next to the app's standard back chevron, two
/// underlined tabs (Venner | Kredse), a search field and the list. Opened by tapping
/// the Venner/Kredse numbers on a profile. Same web-driven pattern as the other pages:
/// the web pushes a snapshot with BOTH data sets (tab switching and search are pure
/// native-local), reports row taps back, and owns all logic/i18n. Swipe right anywhere
/// to go back. Browser + older builds keep the web #lsheet bottom sheet.

struct ListKredsRow: Identifiable, Equatable {
    let id: String
    let name: String
    let members: String   // "3 medlemmer" (i18n from the web)
}

final class ListPageModel: ObservableObject {
    static let shared = ListPageModel()

    @Published var open = false
    @Published var token = 0
    @Published var title = ""
    @Published var tab = "friends"              // "friends" | "kredse" (native-local after open)
    @Published var friends: [MentionCard]? = [] // nil = still loading (others' list via RPC)
    @Published var kredse: [ListKredsRow] = []
    @Published var sharedNote = ""
    @Published var labels: [String: String] = [:]

    // Native-local UI state
    @Published var query = ""

    var onAction: ((String) -> Void)?

    func L(_ k: String) -> String { labels[k] ?? "" }

    func apply(_ dict: [String: Any]) {
        if (dict["close"] as? Bool) == true { open = false; query = ""; return }
        guard (dict["open"] as? Bool) == true else { return }
        let newTitle = dict["title"] as? String ?? ""
        // Frisk åbning (anden profil eller lukket) nulstiller fane + søgning; en
        // efter-push med vennelisten må IKKE nulstille et nativt faneskift.
        let fresh = !open || newTitle != title
        token = (dict["token"] as? Int) ?? token + 1
        title = newTitle
        if fresh {
            tab = (dict["tab"] as? String) == "kredse" ? "kredse" : "friends"
            query = ""
        }
        if dict["friends"] is NSNull || dict["friends"] == nil {
            friends = nil
        } else {
            friends = MentionSupport.parseCards(dict["friends"])
        }
        kredse = ((dict["kredse"] as? [[String: Any]]) ?? []).compactMap { d in
            guard let id = d["id"] as? String else { return nil }
            return ListKredsRow(id: id,
                                name: (d["name"] as? String) ?? "",
                                members: (d["members"] as? String) ?? "")
        }
        sharedNote = dict["sharedNote"] as? String ?? ""
        if let l = dict["labels"] as? [String: Any] { labels = l.compactMapValues { $0 as? String } }
        open = true
    }

    // MARK: actions
    func profile(_ handle: String) { send(["kind": "profile", "handle": handle]) }
    func kreds(_ id: String) { send(["kind": "kreds", "id": id]) }
    func dismiss() { send(["kind": "dismiss"]) }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        onAction?(s)
    }
}

struct ListPageView: View {
    @ObservedObject private var model = ListPageModel.shared
    @FocusState private var searchFocused: Bool
    @State private var dragX: CGFloat = 0
    @State private var dragging = false

    private let hairline = Color.primary.opacity(0.1)
    private let chipFill = Color.primary.opacity(0.06)

    private var insets: UIEdgeInsets {
        (UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .keyWindow?.safeAreaInsets) ?? .zero
    }

    private var filteredFriends: [MentionCard] {
        guard let all = model.friends else { return [] }
        let q = model.query.trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return all }
        return all.filter { $0.name.localizedCaseInsensitiveContains(q) || $0.handle.localizedCaseInsensitiveContains(q) }
    }
    private var filteredKredse: [ListKredsRow] {
        let q = model.query.trimmingCharacters(in: .whitespaces)
        if q.isEmpty { return model.kredse }
        return model.kredse.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            tabs
            search
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    if model.tab == "friends" { friendsList } else { kredsList }
                }
                .padding(.top, 4)
                .padding(.bottom, max(16, insets.bottom))
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .background(Color(uiColor: .systemBackground))
        .ignoresSafeArea(.container)
        .offset(x: max(0, dragX))
        // Swipe mod højre hvor som helst → tilbage (samme gestus som de andre sider)
        .simultaneousGesture(
            DragGesture(minimumDistance: 18)
                .onChanged { v in
                    let w = v.translation.width, h = v.translation.height
                    if dragging || (w > 0 && abs(w) > abs(h) * 1.4) {
                        dragging = true
                        dragX = max(0, w)
                    }
                }
                .onEnded { v in
                    let flick = v.predictedEndTranslation.width > 240
                    if dragging && (dragX > 90 || flick) {
                        withAnimation(.easeOut(duration: 0.2)) { dragX = UIScreen.main.bounds.width }
                        model.dismiss()
                    } else {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { dragX = 0 }
                    }
                    dragging = false
                }
        )
        .onAppear { dragX = 0; dragging = false }
    }

    // MARK: - Header (standard tilbage-chevron + profilens handle centreret)

    private var header: some View {
        ZStack {
            Text(model.title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.primary)
                .lineLimit(1)
                .padding(.horizontal, 60)
            HStack {
                Button { model.dismiss() } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color.primary)
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Spacer()
            }
            .padding(.horizontal, 12)
        }
        .frame(height: 52)
        .padding(.top, insets.top)
    }

    // MARK: - Faner (Venner | Kredse, Instagram-agtig understregning)

    private var tabs: some View {
        HStack(spacing: 0) {
            tabButton("friends", model.L("friendsTab"))
            tabButton("kredse", model.L("kredseTab"))
        }
        .overlay(alignment: .bottom) { Rectangle().fill(hairline).frame(height: 0.5) }
    }

    private func tabButton(_ id: String, _ label: String) -> some View {
        let on = model.tab == id
        return Button {
            withAnimation(.easeOut(duration: 0.18)) { model.tab = id }
        } label: {
            Text(label)
                .font(.system(size: 15, weight: on ? .bold : .semibold))
                .foregroundStyle(on ? Color.primary : Color.secondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(on ? Color.primary : Color.clear).frame(height: 2)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Søgefelt

    private var search: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.secondary)
            TextField(model.L("searchPh"), text: $model.query)
                .font(.system(size: 15))
                .focused($searchFocused)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(chipFill))
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 6)
    }

    // MARK: - Lister

    @ViewBuilder
    private var friendsList: some View {
        if model.friends == nil {
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 40)
        } else if filteredFriends.isEmpty {
            Text(model.L("emptyFriends"))
                .font(.system(size: 14)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity).padding(.vertical, 40)
                .multilineTextAlignment(.center)
        } else {
            ForEach(filteredFriends) { f in
                Button { model.profile(f.handle) } label: {
                    HStack(spacing: 12) {
                        GlassAvatar(url: f.avatarUrl, initials: f.initials, gradient: f.gradient, size: 46)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.name)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Color.primary)
                                .lineLimit(1)
                            Text("@\(f.handle)")
                                .font(.system(size: 13.5))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private var kredsList: some View {
        if !model.sharedNote.isEmpty {
            Text(model.sharedNote)
                .font(.system(size: 12.5)).foregroundStyle(.secondary)
                .padding(.horizontal, 16).padding(.top, 2).padding(.bottom, 6)
        }
        if filteredKredse.isEmpty {
            Text(model.L("emptyKredse"))
                .font(.system(size: 14)).foregroundStyle(.secondary)
                .frame(maxWidth: .infinity).padding(.vertical, 40)
                .multilineTextAlignment(.center)
        } else {
            ForEach(filteredKredse) { f in
                Button { model.kreds(f.id) } label: {
                    HStack(spacing: 12) {
                        ZStack {
                            Circle().fill(chipFill)
                            // Kreds-ikonet: streg-ring med tre prikker (som webbens kchip)
                            ZStack {
                                Circle().strokeBorder(Color.secondary, lineWidth: 1.6)
                                Circle().fill(Color.secondary).frame(width: 5, height: 5).offset(y: -10)
                                Circle().fill(Color.secondary).frame(width: 5, height: 5).offset(x: -8.7, y: 5.2)
                                Circle().fill(Color.secondary).frame(width: 5, height: 5).offset(x: 8.7, y: 5.2)
                            }
                            .frame(width: 20, height: 20)
                        }
                        .frame(width: 46, height: 46)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(f.name)
                                .font(.system(size: 15, weight: .bold))
                                .foregroundStyle(Color.primary)
                                .lineLimit(1)
                            Text(f.members)
                                .font(.system(size: 13.5))
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16).padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }
}

/// Overlays the full-screen list page on the host view when open (slides in from the right).
struct ListPageHost: ViewModifier {
    @ObservedObject private var model = ListPageModel.shared
    func body(content: Content) -> some View {
        ZStack {
            content
            if model.open {
                ListPageView()
                    .transition(.move(edge: .trailing))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.88), value: model.open)
    }
}
