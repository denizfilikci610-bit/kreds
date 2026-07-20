import SwiftUI
import AVKit
import Combine

/// Native full-screen POST DETAIL page for THOUGHT posts (X-style: the post on top, the
/// comment thread below, composer pinned at the bottom). Same web-driven pattern as the
/// memory comment sheet (CommentsSheetView): the web pushes a full snapshot (post + thread +
/// labels) on open and on every change, native renders and reports actions back, the web runs
/// all logic/RPCs and owns i18n. Slides in from the right like the web profile page and can be
/// dismissed with the back button (styled like the web's .pv-head .back chevron so ALL back
/// buttons look the same) or by swiping right anywhere on the page.
/// Browser + older builds keep the web detail page (capability-flag gated by window.__vfPostPage).

struct PostSeg: Equatable {
    let text: String     // plain text ("" when this is a mention)
    let mention: String  // handle ("" when this is plain text)
}

struct PostPollOpt: Identifiable, Equatable {
    let id: String
    let text: String
    let pct: Int
    let mine: Bool
}

struct PostPoll: Equatable {
    let gov: Bool
    let head: String     // governance header incl. countdown/closed suffix ("" = none)
    let showRes: Bool    // show percentages (voted / own post / resolved)
    let resolved: Bool   // resolved governance vote → rows are not tappable
    let meta: String     // "X stemmer" ("" = hidden)
    let options: [PostPollOpt]
}

struct PostData: Equatable {
    let handle: String
    let name: String
    let avatarUrl: String
    let initials: String
    let gradient: [String]
    let time: String
    let kredsName: String
    let segs: [PostSeg]
    let imgUrl: String
    let videoUrl: String
    let liked: Bool
    let likeCount: Int
    let cmtCount: Int
    let canShare: Bool
    let poll: PostPoll?
}

final class PostPageModel: ObservableObject {
    static let shared = PostPageModel()

    @Published var open = false
    @Published var token = 0
    @Published var postId = ""
    @Published var title = ""
    @Published var post: PostData? = nil
    @Published var canPost = false
    @Published var emoji: [String] = []
    @Published var comments: [CmtItem] = []
    @Published var mentionables: [MentionCard] = []
    @Published var labels: [String: String] = [:]

    // Ephemeral, native-local UI state (never crosses to the web on its own)
    @Published var text = ""
    @Published var replyingToId: String? = nil
    @Published var replyingToHandle = ""
    @Published var focusToken = 0   // bumped to request keyboard focus (reply / comment icon)
    @Published var scrollToken = 0  // bumped after I post → scroll to the newest comment
    @Published var focusId: String? = nil // deep-link: scroll to/highlight this comment on open

    var onAction: ((String) -> Void)?

    func L(_ k: String) -> String { labels[k] ?? "" }

    func apply(_ dict: [String: Any]) {
        if (dict["close"] as? Bool) == true {
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
        post = parsePost(dict["post"])
        canPost = (dict["canPost"] as? Bool) ?? false
        emoji = (dict["emoji"] as? [String]) ?? []
        comments = parseComments(dict["comments"])
        mentionables = MentionSupport.parseCards(dict["mentionables"])
        // Only the deep-link OPENING snapshot carries "focus" — later syncs reset it.
        focusId = dict["focus"] as? String
        if let l = dict["labels"] as? [String: Any] { labels = l.compactMapValues { $0 as? String } }
        if fresh { text = ""; replyingToId = nil; replyingToHandle = "" }
        if let rid = replyingToId, !comments.contains(where: { $0.id == rid }) {
            replyingToId = nil; replyingToHandle = ""
        }
        open = true
    }

    private func parsePost(_ raw: Any?) -> PostData? {
        guard let d = raw as? [String: Any] else { return nil }
        let segs = ((d["segs"] as? [[String: Any]]) ?? []).map { s in
            PostSeg(text: (s["t"] as? String) ?? "", mention: (s["m"] as? String) ?? "")
        }
        var poll: PostPoll? = nil
        if let pd = d["poll"] as? [String: Any] {
            let opts = ((pd["options"] as? [[String: Any]]) ?? []).compactMap { o -> PostPollOpt? in
                guard let id = o["id"] as? String else { return nil }
                return PostPollOpt(id: id,
                                   text: (o["text"] as? String) ?? "",
                                   pct: (o["pct"] as? Int) ?? 0,
                                   mine: (o["mine"] as? Bool) ?? false)
            }
            poll = PostPoll(gov: (pd["gov"] as? Bool) ?? false,
                            head: (pd["head"] as? String) ?? "",
                            showRes: (pd["showRes"] as? Bool) ?? false,
                            resolved: (pd["resolved"] as? Bool) ?? false,
                            meta: (pd["meta"] as? String) ?? "",
                            options: opts)
        }
        return PostData(handle: (d["handle"] as? String) ?? "",
                        name: (d["name"] as? String) ?? "?",
                        avatarUrl: (d["avatarUrl"] as? String) ?? "",
                        initials: (d["initials"] as? String) ?? "?",
                        gradient: (d["gradient"] as? [String]) ?? [],
                        time: (d["time"] as? String) ?? "",
                        kredsName: (d["kredsName"] as? String) ?? "",
                        segs: segs,
                        imgUrl: (d["imgUrl"] as? String) ?? "",
                        videoUrl: (d["videoUrl"] as? String) ?? "",
                        liked: (d["liked"] as? Bool) ?? false,
                        likeCount: (d["likeCount"] as? Int) ?? 0,
                        cmtCount: (d["cmtCount"] as? Int) ?? 0,
                        canShare: (d["canShare"] as? Bool) ?? false,
                        poll: poll)
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
        var obj: [String: Any] = ["kind": "send", "postId": postId, "text": e]
        if let rid = replyingToId { obj["replyTo"] = rid; obj["replyToU"] = replyingToHandle }
        replyingToId = nil; replyingToHandle = ""
        scrollToken += 1
        send(obj)
    }

    func like(_ id: String) { send(["kind": "like", "postId": postId, "commentId": id]) }
    func del(_ id: String) { send(["kind": "delete", "postId": postId, "commentId": id]) }
    func postLike() { send(["kind": "postlike", "postId": postId]) }
    func share() { send(["kind": "share", "postId": postId]) }
    func vote(_ optionId: String) { send(["kind": "vote", "postId": postId, "optionId": optionId]) }
    func kreds() { send(["kind": "kreds", "postId": postId]) }
    func menu() { send(["kind": "menu", "postId": postId]) }
    func profile(_ handle: String) {
        guard !handle.isEmpty else { return }
        send(["kind": "profile", "postId": postId, "handle": handle])
    }
    func mention(_ handle: String) {
        guard !handle.isEmpty else { return }
        send(["kind": "mention", "postId": postId, "handle": handle])
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

// MARK: - Looping muted video (feed style: autoplay, loop, no controls — sound lives in web contexts)

final class LoopPlayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

struct LoopVideoView: UIViewRepresentable {
    let url: URL

    final class Coordinator {
        var player: AVQueuePlayer?
        var looper: AVPlayerLooper?
    }
    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> LoopPlayerUIView {
        let v = LoopPlayerUIView()
        let item = AVPlayerItem(url: url)
        let player = AVQueuePlayer()
        player.isMuted = true
        context.coordinator.looper = AVPlayerLooper(player: player, templateItem: item)
        context.coordinator.player = player
        v.playerLayer.player = player
        v.playerLayer.videoGravity = .resizeAspectFill
        player.play()
        return v
    }

    func updateUIView(_ uiView: LoopPlayerUIView, context: Context) {}

    static func dismantleUIView(_ uiView: LoopPlayerUIView, coordinator: Coordinator) {
        coordinator.player?.pause()
        coordinator.looper = nil
        coordinator.player = nil
    }
}

// MARK: - The page

struct PostPageView: View {
    @ObservedObject private var model = PostPageModel.shared
    @StateObject private var kb = KeyboardObserver()
    @FocusState private var focused: Bool
    @State private var deleteArmId: String? = nil
    @State private var highlightId: String? = nil
    @State private var dragX: CGFloat = 0
    @State private var dragging = false

    private let hairline = Color.primary.opacity(0.1)
    private let chipFill = Color.primary.opacity(0.06)

    /// Real safe-area insets from the key window (the page ignores the safe area itself,
    /// mirroring how GlassBottomSheet measures the home-indicator inset).
    private var insets: UIEdgeInsets {
        (UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .keyWindow?.safeAreaInsets) ?? .zero
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if let p = model.post { postBlock(p) }
                        Rectangle().fill(hairline).frame(height: 0.5)
                        if model.comments.isEmpty {
                            Text(model.L("empty"))
                                .font(.system(size: 14)).foregroundStyle(.secondary)
                                .frame(maxWidth: .infinity).padding(.vertical, 34)
                        } else {
                            ForEach(model.comments) { c in row(c).id(c.id) }
                        }
                    }
                    .padding(.bottom, 8)
                }
                .scrollDismissesKeyboard(.interactively)
                .onChange(of: model.scrollToken) { _, _ in
                    if let last = model.comments.last?.id {
                        withAnimation(.easeOut(duration: 0.25)) { proxy.scrollTo(last, anchor: .bottom) }
                    }
                }
                .onAppear { focusIfNeeded(proxy) }
                .onChange(of: model.token) { _, _ in focusIfNeeded(proxy) }
            }
            composer
                .padding(.bottom, kb.height > 0 ? kb.height : insets.bottom)
        }
        .background(Color(uiColor: .systemBackground))
        .ignoresSafeArea()
        .offset(x: max(0, dragX))
        // Swipe anywhere towards the right → back (plus the header's back button). The gesture
        // engages only when clearly horizontal, so vertical thread scrolling wins otherwise.
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
        .onChange(of: model.token) { _, _ in deleteArmId = nil }
        .onAppear { dragX = 0; dragging = false }
        .onChange(of: model.focusToken) { _, _ in focused = true }
    }

    // MARK: - Header (mirrors the web .pv-head: chevron back + bold title, hairline below)

    private var header: some View {
        HStack(spacing: 16) {
            Button { model.dismiss() } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(Color.primary)
                    .padding(6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Text(model.title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.primary)
            Spacer()
        }
        .padding(.horizontal, 12)
        .frame(height: 52)
        .padding(.top, insets.top)
        .overlay(alignment: .bottom) { Rectangle().fill(hairline).frame(height: 0.5) }
    }

    // MARK: - Post block (feed thought anatomy: avatar column + content column)

    private func postBlock(_ p: PostData) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button { model.profile(p.handle) } label: {
                GlassAvatar(url: p.avatarUrl, initials: p.initials, gradient: p.gradient, size: 40)
            }
            .buttonStyle(.plain)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 5) {
                    Text(p.name)
                        .font(.system(size: 14.5, weight: .bold))
                        .foregroundStyle(Color.primary)
                        .lineLimit(1)
                    badge
                    Text("@\(p.handle) · \(p.time)")
                        .font(.system(size: 13.5))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Button { model.menu() } label: {
                        Image(systemName: "ellipsis")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .padding(.vertical, 6).padding(.leading, 10)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                if !p.kredsName.isEmpty { kredsChip(p.kredsName) }
                if !p.segs.isEmpty {
                    Text(attributed(p.segs))
                        .font(.system(size: 15))
                        .foregroundStyle(Color.primary)
                        .tint(vfRed)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 2)
                        .environment(\.openURL, OpenURLAction { url in
                            if url.scheme == "vfmention" {
                                model.mention(url.absoluteString.replacingOccurrences(of: "vfmention:", with: ""))
                                return .handled
                            }
                            return .systemAction
                        })
                }
                media(p)
                if let poll = p.poll { pollView(poll) }
                actionsRow(p)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    /// The web BADGE(): red circle with a white check, shown for every profile.
    private var badge: some View {
        ZStack {
            Circle().fill(vfRed)
            Image(systemName: "checkmark")
                .font(.system(size: 7.5, weight: .heavy))
                .foregroundStyle(.white)
        }
        .frame(width: 15, height: 15)
    }

    /// Small kreds pill (mirrors the web .kchip: ring with three dots + name; tap opens the kreds).
    private func kredsChip(_ name: String) -> some View {
        Button { model.kreds() } label: {
            HStack(spacing: 4) {
                ZStack {
                    Circle().strokeBorder(Color.secondary, lineWidth: 1.3)
                    Circle().fill(Color.secondary).frame(width: 3.6, height: 3.6).offset(y: -6)
                    Circle().fill(Color.secondary).frame(width: 3.6, height: 3.6).offset(x: -5.2, y: 3.1)
                    Circle().fill(Color.secondary).frame(width: 3.6, height: 3.6).offset(x: 5.2, y: 3.1)
                }
                .frame(width: 12, height: 12)
                Text(name)
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.vertical, 3).padding(.leading, 6).padding(.trailing, 8)
            .background(Capsule().fill(chipFill))
        }
        .buttonStyle(.plain)
        .padding(.top, 2)
    }

    private func attributed(_ segs: [PostSeg]) -> AttributedString {
        var out = AttributedString()
        for s in segs {
            if s.mention.isEmpty {
                out += AttributedString(s.text)
            } else {
                var a = AttributedString("@\(s.mention)")
                a.link = URL(string: "vfmention:\(s.mention)")
                a.font = .system(size: 15, weight: .bold)
                out += a
            }
        }
        return out
    }

    @ViewBuilder
    private func media(_ p: PostData) -> some View {
        if !p.videoUrl.isEmpty, let u = URL(string: p.videoUrl) {
            LoopVideoView(url: u)
                .frame(maxWidth: .infinity)
                .frame(height: 320)
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(hairline, lineWidth: 1))
                .padding(.top, 9)
        } else if !p.imgUrl.isEmpty, let u = URL(string: p.imgUrl) {
            AsyncImage(url: u) { img in
                img.resizable().scaledToFit()
            } placeholder: {
                Rectangle().fill(chipFill).frame(height: 220)
            }
            .frame(maxWidth: .infinity)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).stroke(hairline, lineWidth: 1))
            .padding(.top, 9)
        }
    }

    // MARK: - Poll (mirrors the web pollHTML states: plain options / results / resolved)

    private func pollView(_ poll: PostPoll) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            if !poll.head.isEmpty {
                Text(poll.head)
                    .font(.system(size: 12, weight: .heavy))
                    .foregroundStyle(Color.primary)
                    .padding(.bottom, 4)
            }
            ForEach(poll.options) { o in
                if poll.showRes {
                    resultRow(o, clickable: !poll.resolved)
                } else {
                    Button { model.vote(o.id) } label: {
                        Text(o.text)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 9).padding(.horizontal, 12)
                            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(hairline, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .padding(.top, 6)
                }
            }
            if !poll.meta.isEmpty {
                Text(poll.meta)
                    .font(.system(size: 12.5))
                    .foregroundStyle(.secondary)
                    .padding(.top, 7)
            }
        }
        .padding(.top, 6)
    }

    private func resultRow(_ o: PostPollOpt, clickable: Bool) -> some View {
        HStack(spacing: 6) {
            Text(o.text)
                .font(.system(size: 14, weight: o.mine ? .bold : .regular))
                .foregroundStyle(Color.primary)
            if o.mine {
                ZStack {
                    Circle().fill(vfRed)
                    Image(systemName: "checkmark")
                        .font(.system(size: 7, weight: .heavy))
                        .foregroundStyle(.white)
                }
                .frame(width: 14, height: 14)
            }
            Spacer(minLength: 8)
            Text("\(o.pct)%")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 9).padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            GeometryReader { g in
                Rectangle().fill(chipFill).frame(width: g.size.width * CGFloat(o.pct) / 100)
            }
        )
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(hairline, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { if clickable { model.vote(o.id) } }
        .padding(.top, 6)
    }

    // MARK: - Actions row (web thought order: comment / like / share, spread out)

    private func actionsRow(_ p: PostData) -> some View {
        HStack {
            Button { focused = true } label: {
                HStack(spacing: 5) {
                    Image(systemName: "bubble.left")
                        .font(.system(size: 17, weight: .medium))
                    if p.cmtCount > 0 {
                        Text("\(p.cmtCount)").font(.system(size: 13, weight: .semibold))
                    }
                }
                .foregroundStyle(.secondary)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Spacer()
            Button { model.postLike() } label: {
                HStack(spacing: 5) {
                    Image(systemName: p.liked ? "heart.fill" : "heart")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(p.liked ? vfRed : Color.secondary)
                    if p.likeCount > 0 {
                        Text("\(p.likeCount)")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(p.liked ? vfRed : Color.secondary)
                    }
                }
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Spacer()
            if p.canShare {
                Button { model.share() } label: {
                    Image(systemName: "paperplane")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else {
                // Private kreds posts cannot be shared — keep the row's rhythm without the button
                Color.clear.frame(width: 24, height: 24)
            }
        }
        .padding(.top, 8)
        .padding(.trailing, 6)
    }

    // MARK: - Comment row (mirrors CommentsSheetView's row — keep the two in sync visually)

    private func row(_ c: CmtItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Button { model.profile(c.handle) } label: {
                GlassAvatar(url: c.avatarUrl, initials: c.initials, gradient: c.gradient, size: 30)
            }
            .buttonStyle(.plain)
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

                HStack(spacing: 8) {
                    Text(c.time).font(.system(size: 12)).foregroundStyle(.secondary)
                    if c.likeCount > 0 {
                        Text("\(c.likeCount)").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                    }
                    Button { model.reply(c.id, c.handle) } label: {
                        Text(model.L("reply")).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                            .padding(.vertical, 10).padding(.horizontal, 5)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain)
                    if c.mine {
                        Button { armDelete(c.id) } label: {
                            Text(deleteArmId == c.id ? model.L("delConfirm") : model.L("del"))
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(deleteArmId == c.id ? vfRed : .secondary)
                                .padding(.vertical, 10).padding(.horizontal, 5)
                                .contentShape(Rectangle())
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.top, 1)
            }
            Spacer(minLength: 6)
            Button { model.like(c.id) } label: {
                Image(systemName: c.liked ? "heart.fill" : "heart")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(c.liked ? vfRed : Color.secondary)
            }
            .buttonStyle(.plain)
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
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
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

    // MARK: - Composer (mirrors CommentsSheetView's composer — keep the two in sync visually)

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
                                .background(Capsule().fill(chipFill))
                            }
                            .buttonStyle(.plain)
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
                    }.buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
            }

            if !model.emoji.isEmpty {
                HStack(spacing: 0) {
                    ForEach(model.emoji, id: \.self) { e in
                        Button { model.sendEmoji(e) } label: {
                            Text(e).font(.system(size: 24)).frame(maxWidth: .infinity)
                        }.buttonStyle(.plain)
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
                        .background(Capsule().fill(chipFill))
                    Button { model.send() } label: {
                        Text(model.L("send")).font(.system(size: 15, weight: .bold))
                            .foregroundStyle(model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Color.secondary : vfRed)
                    }
                    .buttonStyle(.plain)
                    .disabled(model.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 16)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 10)
        .overlay(Rectangle().fill(hairline).frame(height: 0.5), alignment: .top)
    }
}

/// Overlays the full-screen post page on the host view when open (slides in from the right,
/// like the web profile/memory pages).
struct PostPageHost: ViewModifier {
    @ObservedObject private var model = PostPageModel.shared
    func body(content: Content) -> some View {
        ZStack {
            content
            if model.open {
                PostPageView()
                    .transition(.move(edge: .trailing))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.88), value: model.open)
    }
}
