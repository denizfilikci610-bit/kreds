import SwiftUI

/// State for the native kreds selector, driven by the web (NotifManager handles `type:"kreds"`).
final class KredsBarModel: ObservableObject {
    static let shared = KredsBarModel()
    @Published var items: [KredsItem] = []
    @Published var compact: Bool = false      // scrolled down → topbar hidden → sit at the very top
    @Published var visible: Bool = false      // only on the feed tab, no overlay, not searching
    /// Native → web: window.vfKreds(id)  (id = "all" | feed-id | "__new" | "__search").
    var onTap: ((String) -> Void)?

    func apply(_ dict: [String: Any]) {
        if let raw = dict["items"] as? [[String: Any]] {
            items = raw.compactMap { d in
                guard let id = d["id"] as? String, let kind = d["kind"] as? String else { return nil }
                return KredsItem(id: id, kind: kind,
                                 name: (d["name"] as? String) ?? "",
                                 active: (d["active"] as? Bool) ?? false,
                                 unread: (d["unread"] as? Bool) ?? false)
            }
        }
        if let c = dict["compact"] as? Bool { compact = c }
        if let v = dict["visible"] as? Bool { visible = v }
    }
}

struct KredsItem: Identifiable, Equatable {
    let id: String
    let kind: String   // search | all | kreds | new
    let name: String
    let active: Bool
    let unread: Bool
}

/// Liquid Glass on a chip (iOS 26), material blur fallback below. Solid ink when active.
private struct ChipBackground: ViewModifier {
    let active: Bool
    func body(content: Content) -> some View {
        if active {
            content.background(Color.primary, in: Capsule())
        } else if #available(iOS 26.0, *) {
            // .clipShape klipper Liquid Glass' nedadgående skygge (den mørke streg i bunden) væk,
            // mens selve glasset bevares.
            content.glassEffect(.regular, in: Capsule()).clipShape(Capsule())
        } else {
            content
                .background(.ultraThinMaterial, in: Capsule())
                .overlay(Capsule().strokeBorder(Color.primary.opacity(0.10)))
        }
    }
}

struct NativeKredsBar: View {
    @ObservedObject private var model = KredsBarModel.shared
    @State private var searching = false
    @State private var query = ""
    @FocusState private var focused: Bool

    private var searchPlaceholder: String {
        (UserDefaults.standard.string(forKey: "vf_lang") ?? "da") == "en" ? "Search your circles …" : "Søg i dine kredse …"
    }

    // During search: "Hele kredsen" + matching kredse only (no search circle / no "+ Ny").
    private var shownItems: [KredsItem] {
        guard searching else { return model.items }
        let q = query.lowercased()
        return model.items.filter { item in
            if item.kind == "all" { return true }
            if item.kind == "kreds" { return q.isEmpty || item.name.lowercased().contains(q) }
            return false
        }
    }

    var body: some View {
        VStack(spacing: 8) {
            if searching { searchField }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(shownItems) { item in chip(item) }
                }
                .padding(.horizontal, 12)
            }
            .frame(height: 44)
        }
        .padding(.vertical, 7)
        .padding(.top, model.compact ? 0 : 52)   // below the web topbar unless scrolled
        .opacity(model.visible ? 1 : 0)
        .allowsHitTesting(model.visible)
        .onChange(of: model.visible) { _, v in if !v { searching = false; query = ""; focused = false } }
        .animation(.spring(response: 0.32, dampingFraction: 0.82), value: model.compact)
        .animation(.easeInOut(duration: 0.18), value: model.visible)
        .animation(.spring(response: 0.35, dampingFraction: 0.85), value: searching)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: model.items)
    }

    private var searchField: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass").font(.system(size: 15, weight: .semibold)).foregroundStyle(.secondary)
            TextField(searchPlaceholder, text: $query)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .foregroundStyle(Color.primary)
            Button {
                query = ""
                focused = false
                searching = false
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.secondary)
                    .frame(width: 36, height: 36)      // stort, robust tryk-område
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 16)
        .frame(height: 40)
        .modifier(ChipBackground(active: false))
        .padding(.horizontal, 12)
    }

    @ViewBuilder
    private func chip(_ item: KredsItem) -> some View {
        Button {
            if item.kind == "search" {
                searching = true
                DispatchQueue.main.async { focused = true }
            } else {
                model.onTap?(item.id)
                searching = false; query = ""; focused = false
            }
        } label: {
            content(item)
                .foregroundStyle(item.active ? Color(.systemBackground)
                                 : (item.kind == "new" ? Color.red : Color.primary))
                .modifier(ChipBackground(active: item.active))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func content(_ item: KredsItem) -> some View {
        switch item.kind {
        case "search":
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15, weight: .semibold))
                .frame(width: 36, height: 36)
        default:
            HStack(spacing: 5) {
                Text(item.name).font(.system(size: 14, weight: .bold))
                if item.unread {
                    Circle().fill(Color.red).frame(width: 7, height: 7)
                }
            }
            .padding(.horizontal, 15)
            .frame(height: 36)
        }
    }
}
