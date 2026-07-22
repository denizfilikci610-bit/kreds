import SwiftUI
import Combine

/// Tracks the on-screen keyboard height so the pinned composer can sit just above it. Needed because
/// GlassBottomSheet `.ignoresSafeArea(edges: .bottom)` (incl. the keyboard region) would otherwise let
/// the keyboard cover the input field — unlike the other sheets, whose fields live inside a ScrollView.
final class KeyboardObserver: ObservableObject {
    @Published var height: CGFloat = 0
    private var tokens: [NSObjectProtocol] = []
    init() {
        let c = NotificationCenter.default
        tokens.append(c.addObserver(forName: UIResponder.keyboardWillChangeFrameNotification, object: nil, queue: .main) { [weak self] n in
            guard let f = (n.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
            self?.height = max(0, UIScreen.main.bounds.height - f.origin.y)
        })
        tokens.append(c.addObserver(forName: UIResponder.keyboardWillHideNotification, object: nil, queue: .main) { [weak self] _ in
            self?.height = 0
        })
    }
    deinit { tokens.forEach { NotificationCenter.default.removeObserver($0) } }
}

/// Native Liquid Glass comment sheet for MEMORY posts (Instagram-style). The web pushes the WHOLE
/// thread snapshot on open and on every change (send / like / delete / realtime — pushNativeComments
/// runs at those moments), so native stays live. Native renders real glass, an emoji quick-bar and a
/// text input; it reports actions back and the web runs all the logic/RPCs (sendComment / toggleCmtLike
/// / deleteComment) + owns i18n. The reply target and the delete two-step are native-local (snappy);
/// only the resulting action crosses. Browser + thoughts + older builds keep the inline web comments
/// (capability-flag gated by window.__vfComments).

struct CmtItem: Identifiable, Equatable {
    let id: String          // comment id (stable)
    let handle: String
    let name: String
    let avatarUrl: String
    let initials: String
    let gradient: [String]
    let text: String
    let img: String         // full URL or ""
    let replyTo: String     // handle this is a reply to ("" = top-level)
    let indent: Int         // 0 or 1
    let time: String
    let liked: Bool
    let likeCount: Int
    let mine: Bool
}

final class CommentsModel: ObservableObject {
    static let shared = CommentsModel()

    @Published var open = false
    @Published var token = 0
    @Published var postId = ""
    @Published var title = ""
    @Published var canPost = false
    @Published var emoji: [String] = []
    @Published var comments: [CmtItem] = []
    @Published var mentionables: [MentionCard] = [] // @-kandidater (opslagets publikum, fra web)
    @Published var labels: [String: String] = [:]

    // Ephemeral, native-local UI state (never crosses to the web on its own)
    @Published var text = ""
    @Published var replyingToId: String? = nil
    @Published var replyingToHandle = ""
    @Published var focusToken = 0   // bumped to request keyboard focus (reply tapped)
    @Published var scrollToken = 0  // bumped after I post → scroll to the newest comment
    @Published var focusId: String? = nil // deep-link: scroll to/highlight this comment on open

    var onAction: ((String) -> Void)?

    func L(_ k: String) -> String { labels[k] ?? "" }

    func apply(_ dict: [String: Any]) {
        if (dict["close"] as? Bool) == true {
            // Ryd flygtig composer-state ved luk — ellers genopstod et gammelt armeret
            // "Svarer @bruger" + udkast ved genåbning af SAMME mindes sheet, og den
            // næste kommentar blev uventet et svar på det gamle mål.
            open = false
            text = ""; replyingToId = nil; replyingToHandle = ""
            return
        }
        guard (dict["open"] as? Bool) == true else { return }
        let pid = dict["postId"] as? String ?? ""
        let fresh = pid != postId   // a different post → reset the draft/reply
        token = (dict["token"] as? Int) ?? token + 1
        postId = pid
        title = dict["title"] as? String ?? ""
        canPost = (dict["canPost"] as? Bool) ?? false
        emoji = (dict["emoji"] as? [String]) ?? []
        comments = parseComments(dict["comments"])
        mentionables = MentionSupport.parseCards(dict["mentionables"])
        // Only the deep-link OPENING snapshot carries "focus" — later syncs reset it,
        // so the sheet never re-scrolls while the user is reading/typing.
        focusId = dict["focus"] as? String
        if let l = dict["labels"] as? [String: Any] { labels = l.compactMapValues { $0 as? String } }
        if fresh { text = ""; replyingToId = nil; replyingToHandle = "" }
        // If the comment we were replying to is gone, drop the reply target.
        if let rid = replyingToId, !comments.contains(where: { $0.id == rid }) {
            replyingToId = nil; replyingToHandle = ""
        }
        open = true
    }

    private func parseComments(_ raw: Any?) -> [CmtItem] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let id = d["id"] as? String else { return nil }
            return CmtItem(
                id: id,
                handle: (d["handle"] as? String) ?? "",
                name: (d["name"] as? String) ?? "?",
                avatarUrl: (d["avatarUrl"] as? String) ?? "",
                initials: (d["initials"] as? String) ?? "?",
                gradient: (d["gradient"] as? [String]) ?? [],
                text: (d["text"] as? String) ?? "",
                img: (d["img"] as? String) ?? "",
                replyTo: (d["replyTo"] as? String) ?? "",
                indent: (d["indent"] as? Int) ?? 0,
                time: (d["time"] as? String) ?? "",
                liked: (d["liked"] as? Bool) ?? false,
                likeCount: (d["likeCount"] as? Int) ?? 0,
                mine: (d["mine"] as? Bool) ?? false
            )
        }
    }

    // MARK: - Actions (native-local state → web)

    func send() {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        var obj: [String: Any] = ["kind": "send", "postId": postId, "text": t]
        if let rid = replyingToId { obj["replyTo"] = rid; obj["replyToU"] = replyingToHandle }
        text = ""; replyingToId = nil; replyingToHandle = ""
        scrollToken += 1
        send(obj)
    }

    func sendEmoji(_ e: String) {
        // Quick-emoji poster straks — men RESPEKTERER et armeret svar ("Svarer @bruger"-chippen):
        // ellers postede ❤️ som top-niveau OG efterlod chippen armeret, så en SENERE tekst
        // uventet blev et svar på det gamle mål.
        var obj: [String: Any] = ["kind": "send", "postId": postId, "text": e]
        if let rid = replyingToId { obj["replyTo"] = rid; obj["replyToU"] = replyingToHandle }
        replyingToId = nil; replyingToHandle = ""
        scrollToken += 1
        send(obj)
    }

    func like(_ id: String) { send(["kind": "like", "postId": postId, "commentId": id]) }
    func del(_ id: String) { send(["kind": "delete", "postId": postId, "commentId": id]) }
    /// Tap på en kommentators avatar → web lukker sheetet og åbner profilen.
    func profile(_ handle: String) {
        guard !handle.isEmpty else { return }
        send(["kind": "profile", "postId": postId, "handle": handle])
    }

    func reply(_ id: String, _ handle: String) {
        replyingToId = id; replyingToHandle = handle; focusToken += 1
    }
    func cancelReply() { replyingToId = nil; replyingToHandle = "" }

    func dismiss() { send(["kind": "dismiss", "postId": postId]) }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        onAction?(s)
    }
}

struct GlassCommentsSheet: View {
    @ObservedObject private var model = CommentsModel.shared
    @StateObject private var kb = KeyboardObserver()
    @FocusState private var focused: Bool
    @State private var deleteArmId: String? = nil
    @State private var highlightId: String? = nil  // deep-link: briefly highlighted comment

    var body: some View {
        GlassBottomSheet(maxHeightFraction: 0.9, onDismiss: { model.dismiss() }) {
            VStack(spacing: 0) {
                Text(model.title.isEmpty ? "…" : model.title)
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Color.primary)
                    .padding(.bottom, 10)

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 0) {
                            if model.comments.isEmpty {
                                Text(model.L("empty"))
                                    .font(.system(size: 14)).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity).padding(.vertical, 34)
                            } else {
                                ForEach(model.comments) { c in row(c).id(c.id) }
                            }
                        }
                        .padding(.bottom, 6)
                    }
                    .scrollDismissesKeyboard(.interactively)
                    .onChange(of: model.scrollToken) { _, _ in
                        if let last = model.comments.last?.id {
                            withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(last, anchor: .bottom) }
                        }
                    }
                    // Deep-link fra en notifikation: sheet'et er kun i hierarkiet mens det er
                    // åbent, så åbnings-snapshottet håndteres i onAppear (token-onChange kan
                    // ikke nå at fyre) — genåbning mens det allerede er åbent via token.
                    .onAppear { focusIfNeeded(proxy) }
                    .onChange(of: model.token) { _, _ in focusIfNeeded(proxy) }
                }

                composer
            }
            .padding(.top, 2)
            .padding(.bottom, kb.height)   // lift the pinned composer above the keyboard
            .animation(.easeOut(duration: 0.22), value: kb.height)
            .onChange(of: model.focusToken) { _, _ in focused = true }
            .onChange(of: model.token) { _, _ in deleteArmId = nil }
        }
    }

    // MARK: - Comment row

    private func row(_ c: CmtItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            // Avataren åbner kommentatorens profil (navnet er konkateneret med kommentar-
            // teksten i ét Text-view for ombrydningen, så kun avataren er tappable).
            Button { model.profile(c.handle) } label: {
                GlassAvatar(url: c.avatarUrl, initials: c.initials, gradient: c.gradient, size: 30)
            }
            .buttonStyle(.vfPressCard)
            VStack(alignment: .leading, spacing: 3) {
                (Text(c.name).font(.system(size: 14, weight: .semibold)).foregroundColor(.primary)
                    + Text("  ")
                    + (c.replyTo.isEmpty ? Text("") : Text("@\(c.replyTo) ").foregroundColor(.secondary))
                    + Text(c.text).font(.system(size: 14)).foregroundColor(.primary))
                    .fixedSize(horizontal: false, vertical: true)

                if !c.img.isEmpty, let u = URL(string: c.img) {
                    AsyncImage(url: u) { img in img.resizable().scaledToFill() } placeholder: { Color.primary.opacity(0.06) }
                        .frame(width: 120, height: 120)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .padding(.top, 2)
                }

                // Svar/Slet får rigtige tap-mål (44pt-reglen): en nøgen 12pt-tekst var ~15pt
                // høj — mis-tap armerede aldrig svaret, og kommentaren blev postet top-niveau.
                HStack(spacing: 8) {
                    Text(c.time).font(.system(size: 12)).foregroundStyle(.secondary)
                    if c.likeCount > 0 {
                        Text("\(c.likeCount)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                    }
                    Button { model.reply(c.id, c.handle) } label: {
                        Text(model.L("reply")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                            .padding(.vertical, 10).padding(.horizontal, 5)
                            .contentShape(Rectangle())
                    }.buttonStyle(.vfPressFade)
                    if c.mine {
                        Button { armDelete(c.id) } label: {
                            Text(deleteArmId == c.id ? model.L("delConfirm") : model.L("del"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(deleteArmId == c.id ? vfRed : .secondary)
                                .padding(.vertical, 10).padding(.horizontal, 5)
                                .contentShape(Rectangle())
                        }.buttonStyle(.vfPressFade)
                    }
                }
                .padding(.top, 1)
            }
            Spacer(minLength: 6)
            VStack(spacing: 2) {
                Button { model.like(c.id) } label: {
                    Image(systemName: c.liked ? "heart.fill" : "heart")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(c.liked ? vfRed : Color.secondary)
                }.buttonStyle(.vfPressBounce)
            }
            .padding(.top, 2)
        }
        .padding(.leading, c.indent > 0 ? 34 : 0)
        .padding(.horizontal, 16).padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.primary.opacity(highlightId == c.id ? 0.08 : 0))
                .padding(.horizontal, 8)
        )
    }

    /// Scroll to and briefly highlight the deep-linked comment (one-shot per opening snapshot).
    private func focusIfNeeded(_ proxy: ScrollViewProxy) {
        guard let f = model.focusId, model.comments.contains(where: { $0.id == f }) else { return }
        model.focusId = nil
        highlightId = f
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            withAnimation(.easeOut(duration: 0.3)) { proxy.scrollTo(f, anchor: .center) }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.2) {
            withAnimation(.easeOut(duration: 0.4)) { if highlightId == f { highlightId = nil } }
        }
    }

    private func armDelete(_ id: String) {
        if deleteArmId == id { deleteArmId = nil; model.del(id); return }
        deleteArmId = id
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            if model.open, deleteArmId == id { deleteArmId = nil }
        }
    }

    // MARK: - Composer (emoji quick-bar + reply chip + text input)

    /// @-kandidater der matcher det token brugeren er ved at skrive (tom når inaktiv)
    private var mentionHits: [MentionCard] {
        model.canPost ? MentionSupport.hits(model.text, model.mentionables) : []
    }

    private var composer: some View {
        VStack(spacing: 8) {
            if !mentionHits.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(mentionHits) { m in
                            Button { model.text = MentionSupport.insert(model.text, m.handle) } label: {
                                HStack(spacing: 6) {
                                    GlassAvatar(url: m.avatarUrl, initials: m.initials, gradient: m.gradient, size: 22)
                                    Text("@\(m.handle)")
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundStyle(Color.primary)
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .glassBG(Capsule())
                            }
                            .buttonStyle(.vfPressChip)
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }
            if model.replyingToId != nil {
                HStack(spacing: 8) {
                    Text(model.L("replyingTo").replacingOccurrences(of: "{u}", with: model.replyingToHandle))
                        .font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Button { model.cancelReply() } label: {
                        Text(model.L("cancelReply")).font(.system(size: 12, weight: .semibold)).foregroundStyle(vfRed)
                    }.buttonStyle(.vfPressFade)
                }
                .padding(.horizontal, 16)
            }

            if !model.emoji.isEmpty {
                HStack(spacing: 0) {
                    ForEach(model.emoji, id: \.self) { e in
                        Button { model.sendEmoji(e) } label: {
                            Text(e).font(.system(size: 24)).frame(maxWidth: .infinity)
                        }.buttonStyle(.vfPressBounce)
                    }
                }
                .padding(.horizontal, 12)
            }

            if model.canPost {
                HStack(spacing: 10) {
                    TextField(model.L("placeholder"), text: $model.text, axis: .vertical)
                        .font(.system(size: 15))
                        .lineLimit(1...4)
                        .focused($focused)
                        .textInputAutocapitalization(.sentences)
                        .onChange(of: model.text) { _, v in
                            if v.count > 280 { model.text = String(v.prefix(280)) }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .glassBG(Capsule())
                    Button { model.send() } label: {
                        Text(model.L("send")).font(.system(size: 15, weight: .bold))
                            .foregroundStyle(model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.secondary : vfRed)
                    }
                    .buttonStyle(.vfPressPop)
                    .disabled(model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 10)
        .overlay(Rectangle().fill(Color.primary.opacity(0.1)).frame(height: 0.5), alignment: .top)
    }
}

/// Overlays the comments glass sheet + a dimming scrim on the host view when open.
struct CommentsSheetHost: ViewModifier {
    @ObservedObject private var model = CommentsModel.shared
    func body(content: Content) -> some View {
        ZStack {
            content
            if model.open {
                Color.black.opacity(0.28).ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { model.dismiss() }
                    .transition(.opacity)
                GlassCommentsSheet()
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.spring(response: 0.36, dampingFraction: 0.86), value: model.open)
    }
}
