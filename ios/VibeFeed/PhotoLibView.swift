import SwiftUI
import Photos
import AVFoundation
import UIKit

/// Instagram-style IN-APP photo/video gallery composer for MEMORIES (the owner sent the IG screenshot).
/// A WKWebView can't read the photo library, so this is native PhotoKit: a grid of the user's own
/// photos + videos, a big preview, single-select, then a native caption + kreds screen. On "Del" the
/// picked media is staged to VFMediaScheme and the web is told to upload+insert (kind='memory') via
/// window.vfMemory. Fully native compose; the web owns only the Supabase upload/insert. Browser + the
/// pre-flag build keep the web file-picker fallback (gated on window.__vfPhotoLib).

struct PLFeed: Identifiable, Equatable { let id: String; let name: String }

final class PhotoLibModel: NSObject, ObservableObject {
    static let shared = PhotoLibModel()

    enum Step { case camera, gallery, trim, caption }
    @Published var open = false
    @Published var step: Step = .camera
    @Published var status: PHAuthorizationStatus = .notDetermined
    @Published var assets: [PHAsset] = []
    @Published var selected: PHAsset?
    @Published var capturedImage: UIImage?   // et foto taget med kameraet, ELLER poster-frame for en optaget video
    @Published var capturedVideoURL: URL?    // en video optaget med det indbyggede kamera (≤6 s)
    @Published var caption = ""
    @Published var dest = "all"
    @Published var mentionables: [String: [MentionCard]] = [:] // @-kandidater pr. destination (fra web)
    @Published var feeds: [PLFeed] = []
    @Published var sharing = false
    @Published var loadingOriginal = false

    // Video trim (a picked video longer than 6 s → the user picks a 6 s window; see VideoTrimView)
    @Published var videoDuration: Double = 0
    @Published var trimStart: Double = 0
    @Published var trimDuration: Double = VF_MAX_VID
    @Published var showTrimStep = false   // did the picked video need trimming?
    @Published var preparingTrim = false  // loading the AVAsset after "Videre"
    @Published var trimHint = ""
    var videoAsset: AVAsset?

    // labels (pushed from web)
    @Published var title = ""
    @Published var nextLabel = ""
    @Published var cancelLabel = ""
    @Published var shareLabel = ""
    @Published var captionPlaceholder = ""
    @Published var destLabel = ""
    @Published var allLabel = ""
    @Published var limitedNote = ""
    @Published var manageLabel = ""
    @Published var deniedNote = ""
    @Published var settingsLabel = ""

    /// Native → web: the picked media JSON ({isVideo,caption,dest}). The web returns a Storage upload
    /// URL + token, and native uploads the held media directly (see performUpload).
    var onShare: ((String) -> Void)?
    /// Native → web: media uploaded to Storage → the web creates the post.
    var onUploaded: (() -> Void)?
    /// Native → web: the direct upload failed.
    var onUploadFailed: (() -> Void)?
    /// Native → web: user cancelled without posting.
    var onCancel: (() -> Void)?
    /// Native → web: fall back to the web file-picker memory compose (denied access / no library UI).
    var onFallback: (() -> Void)?

    private let imageManager = PHCachingImageManager()
    private var pendingData: Data?
    private var pendingMime = "image/jpeg"
    private var trimReqSeq = 0                          // supersedes out-of-order AVAsset loads
    private var exportSession: AVAssetExportSession?    // in-flight trim export (for the safety timeout)

    func apply(_ dict: [String: Any]) {
        if let up = dict["upload"] as? [String: Any] { performUpload(up); return }
        if let r = dict["result"] as? String {
            if r == "ok" { open = false } else { sharing = false }
            return
        }
        guard (dict["open"] as? Bool) == true else { return }
        dest = dict["dest"] as? String ?? "all"
        if let raw = dict["feeds"] as? [[String: Any]] {
            feeds = raw.compactMap { d in
                guard let id = d["id"] as? String, let name = d["name"] as? String else { return nil }
                return PLFeed(id: id, name: name)
            }
        }
        if let l = dict["labels"] as? [String: Any] {
            title = s(l, "title"); nextLabel = s(l, "next"); cancelLabel = s(l, "cancel"); shareLabel = s(l, "share")
            captionPlaceholder = s(l, "captionPlaceholder"); destLabel = s(l, "destLabel"); allLabel = s(l, "allLabel")
            limitedNote = s(l, "limited"); manageLabel = s(l, "manage"); deniedNote = s(l, "denied"); settingsLabel = s(l, "settings")
            trimHint = s(l, "trimHint")
        }
        // @-kandidater pr. destination ("all" = venner; pr. kreds = venner + medlemmer) —
        // strippen filtrerer lokalt og følger dest-pillen. Ældre web uden feltet → tom (ingen strip).
        if let m = dict["mentionables"] as? [String: Any] {
            mentionables = m.mapValues { MentionSupport.parseCards($0) }
        } else {
            mentionables = [:]
        }
        caption = ""; selected = nil; capturedImage = nil; capturedVideoURL = nil; sharing = false; loadingOriginal = false; step = .camera
        videoAsset = nil; videoDuration = 0; trimStart = 0; trimDuration = VF_MAX_VID; showTrimStep = false; preparingTrim = false
        pendingData = nil; exportSession = nil; trimReqSeq += 1
        open = true
        requestAndLoad()
    }
    private func s(_ d: [String: Any], _ k: String) -> String { d[k] as? String ?? "" }

    func requestAndLoad() {
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { [weak self] st in
            DispatchQueue.main.async {
                self?.status = st
                if st == .authorized || st == .limited { self?.fetch() }
            }
        }
    }

    private func fetch() {
        let opts = PHFetchOptions()
        opts.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
        // photos + videos
        opts.predicate = NSPredicate(format: "mediaType == %d || mediaType == %d",
                                     PHAssetMediaType.image.rawValue, PHAssetMediaType.video.rawValue)
        let result = PHAsset.fetchAssets(with: opts)
        var arr: [PHAsset] = []
        result.enumerateObjects { a, _, _ in arr.append(a) }
        assets = arr
        if selected == nil { selected = arr.first }
    }

    func thumb(_ asset: PHAsset, side: CGFloat, _ done: @escaping (UIImage?) -> Void) {
        let opts = PHImageRequestOptions()
        opts.deliveryMode = .opportunistic
        opts.resizeMode = .fast
        opts.isNetworkAccessAllowed = true
        let px = side * UIScreen.main.scale
        imageManager.requestImage(for: asset, targetSize: CGSize(width: px, height: px),
                                  contentMode: .aspectFill, options: opts) { img, _ in done(img) }
    }

    func previewImage(_ asset: PHAsset, _ done: @escaping (UIImage?) -> Void) {
        let opts = PHImageRequestOptions()
        opts.deliveryMode = .highQualityFormat
        opts.isNetworkAccessAllowed = true
        let px = UIScreen.main.bounds.width * UIScreen.main.scale
        imageManager.requestImage(for: asset, targetSize: CGSize(width: px, height: px),
                                  contentMode: .aspectFit, options: opts) { img, _ in done(img) }
    }

    func openManage() {
        guard let root = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive })?
            .keyWindow?.rootViewController else { return }
        PHPhotoLibrary.shared().presentLimitedLibraryPicker(from: root)
        // re-fetch shortly after the user finishes managing
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in self?.fetch() }
    }

    func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }

    func dismiss() { open = false; onCancel?() }
    func fallbackToWeb() { open = false; onFallback?() }

    /// "Videre" from the gallery. For a VIDEO, load the AVAsset and decide: longer than 6 s → the trim
    /// step; otherwise straight to caption (the whole short clip is used). For an IMAGE, go to caption.
    func prepareAndAdvance() {
        guard let asset = selected else { return }
        if asset.mediaType != .video { showTrimStep = false; step = .caption; return }
        trimReqSeq += 1
        let seq = trimReqSeq   // the grid is frozen while preparingTrim, so `selected` == `asset` in the callback
        preparingTrim = true
        let opts = PHVideoRequestOptions()
        opts.deliveryMode = .highQualityFormat
        opts.isNetworkAccessAllowed = true
        imageManager.requestAVAsset(forVideo: asset, options: opts) { [weak self] avAsset, _, _ in
            guard let self else { return }
            DispatchQueue.main.async {
                guard seq == self.trimReqSeq else { return } // superseded by a newer request / reopen
                self.preparingTrim = false
                guard let avAsset else { self.showTrimStep = false; self.step = .caption; return }
                self.videoAsset = avAsset
                let dur = CMTimeGetSeconds(avAsset.duration)
                self.videoDuration = (dur.isFinite && dur > 0) ? dur : 0
                self.trimDuration = min(VF_MAX_VID, max(0.1, self.videoDuration))
                self.trimStart = 0
                self.showTrimStep = self.videoDuration > VF_MAX_VID + 0.05
                self.step = self.showTrimStep ? .trim : .caption
            }
        }
        // Safety: never leave the "Videre" spinner stuck if the callback is dropped (rare iCloud edge).
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self, self.preparingTrim, seq == self.trimReqSeq else { return }
            self.preparingTrim = false
        }
    }

    /// "Del": export the picked media, then ask the web for a Storage upload URL.
    func share() {
        guard !sharing else { return }
        // Video optaget med kameraet: beskær til 4:5 og upload som mp4.
        if let vurl = capturedVideoURL {
            sharing = true
            export45Video(vurl)
            return
        }
        // Foto taget med kameraet (allerede beskåret til 4:5): upload direkte.
        if let shot = capturedImage {
            sharing = true
            guard let data = shot.jpegData(compressionQuality: 0.9) else { sharing = false; return }
            pendingData = data
            send(isVideo: false, ext: "jpg", mime: "image/jpeg")
            return
        }
        guard let asset = selected else { return }
        sharing = true
        if asset.mediaType == .video {
            exportTrimmedVideo()
        } else {
            previewImageFull(asset) { [weak self] img in
                guard let self else { return }
                guard let img, let data = img.jpegData(compressionQuality: 0.87) else {
                    self.sharing = false; return
                }
                self.pendingData = data
                self.send(isVideo: false, ext: "jpg", mime: "image/jpeg")
            }
        }
    }

    /// Et foto taget med kameraet → beskær til præcis 4:5 (1080x1350) og gå til billedtekst.
    func useCaptured(_ image: UIImage) {
        capturedImage = cropTo45(image)
        capturedVideoURL = nil
        selected = nil; videoAsset = nil; showTrimStep = false
        step = .caption
    }

    /// En video optaget med kameraet → gem URL + poster-frame og gå til billedtekst (beskæres ved Del).
    func useCapturedVideo(_ url: URL) {
        capturedVideoURL = url
        capturedImage = posterFrame(url)   // vises i billedtekst-trinet
        selected = nil; videoAsset = nil; showTrimStep = false
        step = .caption
    }

    /// Center-beskær + skalér til præcis 1080x1350 (4:5). draw(in:) respekterer orienteringen.
    private func cropTo45(_ image: UIImage) -> UIImage {
        let out = CGSize(width: 1080, height: 1350)
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1; fmt.opaque = true
        return UIGraphicsImageRenderer(size: out, format: fmt).image { _ in
            let iw = image.size.width, ih = image.size.height
            guard iw > 0, ih > 0 else { return }
            let scale = max(out.width / iw, out.height / ih)   // aspectFill
            let dw = iw * scale, dh = ih * scale
            image.draw(in: CGRect(x: (out.width - dw) / 2, y: (out.height - dh) / 2, width: dw, height: dh))
        }
    }

    /// Første frame af en video som poster (til billedtekst-forhåndsvisningen).
    private func posterFrame(_ url: URL) -> UIImage? {
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 1080, height: 1350)
        guard let cg = try? gen.copyCGImage(at: CMTime(seconds: 0.1, preferredTimescale: 600), actualTime: nil) else { return nil }
        return cropTo45(UIImage(cgImage: cg))
    }

    /// Beskær den optagne video til 4:5 (1080x1350) via en video-composition og upload som mp4.
    private func export45Video(_ url: URL) {
        let asset = AVURLAsset(url: url)
        guard let track = asset.tracks(withMediaType: .video).first else { sharing = false; onUploadFailed?(); return }
        let render = CGSize(width: 1080, height: 1350)
        let comp = AVMutableVideoComposition()
        comp.renderSize = render
        comp.frameDuration = CMTime(value: 1, timescale: 30)
        let instruction = AVMutableVideoCompositionInstruction()
        instruction.timeRange = CMTimeRange(start: .zero, duration: asset.duration)
        let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
        layer.setTransform(aspectFill45(track: track, render: render), at: .zero)
        instruction.layerInstructions = [layer]
        comp.instructions = [instruction]

        let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
        try? FileManager.default.removeItem(at: out)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else {
            sharing = false; onUploadFailed?(); return
        }
        export.videoComposition = comp
        export.outputURL = out
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.exportAsynchronously { [weak self] in
            guard let self else { return }
            let ok = export.status == .completed
            let data = ok ? try? Data(contentsOf: out) : nil
            DispatchQueue.main.async {
                try? FileManager.default.removeItem(at: out)
                if let data { self.pendingData = data; self.send(isVideo: true, ext: "mp4", mime: "video/mp4") }
                else { self.sharing = false; self.onUploadFailed?() }
            }
        }
    }

    /// Transform: orientér kildesporet og aspect-fill-beskær det ind i 4:5-render-størrelsen.
    private func aspectFill45(track: AVAssetTrack, render: CGSize) -> CGAffineTransform {
        let pt = track.preferredTransform
        let oriented = track.naturalSize.applying(pt)
        let ow = abs(oriented.width), oh = abs(oriented.height)
        guard ow > 0, oh > 0 else { return pt }
        let scale = max(render.width / ow, render.height / oh)
        let tx = (render.width - ow * scale) / 2, ty = (render.height - oh * scale) / 2
        return pt
            .concatenating(CGAffineTransform(scaleX: scale, y: scale))
            .concatenating(CGAffineTransform(translationX: tx, y: ty))
    }

    /// Export the chosen ≤6 s window (or the whole clip if it was already short) to a small H.264 mp4.
    /// Trimming keeps the upload tiny + fast (a full-length video would blow the Storage size limit —
    /// that was the "can't share video" symptom).
    private func exportTrimmedVideo() {
        guard let avAsset = videoAsset else { sharing = false; onUploadFailed?(); return }
        let dur = videoDuration > 0 ? videoDuration : CMTimeGetSeconds(avAsset.duration)
        guard dur.isFinite, dur > 0 else { sharing = false; onUploadFailed?(); return } // corrupt/unloadable metadata
        let start = max(0, min(trimStart, max(0, dur - 0.1)))
        let length = max(0.1, min(trimDuration, dur - start))
        let out = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mp4")
        try? FileManager.default.removeItem(at: out)
        guard let export = AVAssetExportSession(asset: avAsset, presetName: AVAssetExportPreset1280x720) else {
            sharing = false; onUploadFailed?(); return
        }
        exportSession = export
        export.outputURL = out
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        export.timeRange = CMTimeRange(start: CMTime(seconds: start, preferredTimescale: 600),
                                       duration: CMTime(seconds: length, preferredTimescale: 600))
        export.exportAsynchronously { [weak self] in
            guard let self else { return }
            let ok = export.status == .completed
            let data = ok ? try? Data(contentsOf: out) : nil   // runs on the export's queue, not main
            DispatchQueue.main.async {
                try? FileManager.default.removeItem(at: out)
                guard self.exportSession === export else { return } // superseded by the safety timeout / reopen
                self.exportSession = nil
                if let data {
                    self.pendingData = data
                    self.send(isVideo: true, ext: "mp4", mime: "video/mp4")
                } else {
                    self.sharing = false; self.onUploadFailed?()
                }
            }
        }
        // Safety: unblock the "Del" spinner if the export never reports back (app backgrounded, etc.).
        DispatchQueue.main.asyncAfter(deadline: .now() + 90) { [weak self] in
            guard let self, self.exportSession === export else { return }
            export.cancelExport()
            self.exportSession = nil
            self.sharing = false
            self.onUploadFailed?()
        }
    }

    private func previewImageFull(_ asset: PHAsset, _ done: @escaping (UIImage?) -> Void) {
        let opts = PHImageRequestOptions()
        opts.deliveryMode = .highQualityFormat
        opts.isNetworkAccessAllowed = true
        let px: CGFloat = 1440
        imageManager.requestImage(for: asset, targetSize: CGSize(width: px, height: px),
                                  contentMode: .aspectFit, options: opts) { img, _ in DispatchQueue.main.async { done(img) } }
    }

    private func send(isVideo: Bool, ext: String, mime: String) {
        pendingMime = mime
        let obj: [String: Any] = ["isVideo": isVideo, "caption": caption, "dest": dest, "ext": ext, "mime": mime]
        guard let d = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: d, encoding: .utf8) else {
            sharing = false; pendingData = nil; onUploadFailed?(); return
        }
        onShare?(s)
    }

    /// The web returned a Storage upload URL + user token → PUT/POST the held media directly (not
    /// bound by the web CSP or WKWebView scheme limits). Success → the web creates the post.
    private func performUpload(_ up: [String: Any]) {
        guard let urlStr = up["url"] as? String, let url = URL(string: urlStr),
              let token = up["token"] as? String, let data = pendingData else {
            sharing = false; pendingData = nil; onUploadFailed?(); return
        }
        let apikey = up["apikey"] as? String ?? ""
        let ct = up["contentType"] as? String ?? pendingMime
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue(apikey, forHTTPHeaderField: "apikey")
        req.setValue(ct, forHTTPHeaderField: "Content-Type")
        req.setValue("max-age=3600", forHTTPHeaderField: "cache-control")
        req.setValue("false", forHTTPHeaderField: "x-upsert")
        req.httpBody = data
        req.timeoutInterval = 120
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, err in
            DispatchQueue.main.async {
                self?.pendingData = nil
                let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
                if err == nil, (200..<300).contains(code) { self?.onUploaded?() }
                else { self?.sharing = false; self?.onUploadFailed?() }
            }
        }.resume()
    }
}

// MARK: - Views

struct MemoryGalleryScreen: View {
    @ObservedObject private var model = PhotoLibModel.shared

    var body: some View {
        ZStack {
            Color(.systemBackground).ignoresSafeArea()
            if model.step == .camera {
                MemoryCameraScreen()   // fuldskærm, eget kamera-chrome
            } else {
                VStack(spacing: 0) {
                    navBar
                    Divider().opacity(0.4)
                    switch model.step {
                    case .camera: EmptyView()   // håndteres fuldskærm ovenfor
                    case .gallery: gallery
                    case .trim:
                        if let a = model.videoAsset { VideoTrimView(asset: a) } else { gallery }
                    case .caption: caption
                    }
                }
            }
        }
    }

    private var navBar: some View {
        HStack {
            Button(model.cancelLabel) {
                switch model.step {
                case .camera: model.dismiss()
                case .gallery: model.step = .camera            // tilbage til kameraet
                case .trim: model.step = .gallery
                case .caption:
                    if model.capturedImage != nil { model.step = .camera }
                    else { model.step = model.showTrimStep ? .trim : .gallery }
                }
            }
            .foregroundStyle(Color.primary)
            Spacer()
            Text(model.title).font(.system(size: 16, weight: .bold))
            Spacer()
            switch model.step {
            case .camera:
                EmptyView()
            case .gallery:
                Button { model.prepareAndAdvance() } label: {
                    if model.preparingTrim { ProgressView() }
                    else {
                        Text(model.nextLabel).font(.system(size: 16, weight: .bold))
                            .foregroundStyle(model.selected == nil ? Color.secondary : vfRed)
                    }
                }
                .disabled(model.selected == nil || model.preparingTrim)
            case .trim:
                Button(model.nextLabel) { model.step = .caption }
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(vfRed)
            case .caption:
                Button { model.share() } label: {
                    if model.sharing { ProgressView() } else {
                        Text(model.shareLabel).font(.system(size: 16, weight: .bold)).foregroundStyle(vfRed)
                    }
                }.disabled(model.sharing)
            }
        }
        .padding(.horizontal, 16).frame(height: 48)
    }

    // MARK: gallery step
    @ViewBuilder private var gallery: some View {
        switch model.status {
        case .denied, .restricted:
            deniedPanel
        default:
            VStack(spacing: 0) {
                if let sel = model.selected { PreviewPane(asset: sel).frame(height: UIScreen.main.bounds.height * 0.38) }
                if model.status == .limited { limitedBanner }
                grid
            }
        }
    }

    private var grid: some View {
        let cols = [GridItem(.flexible(), spacing: 2), GridItem(.flexible(), spacing: 2),
                    GridItem(.flexible(), spacing: 2), GridItem(.flexible(), spacing: 2)]
        return ScrollView {
            LazyVGrid(columns: cols, spacing: 2) {
                ForEach(model.assets, id: \.localIdentifier) { a in
                    MemoryThumbCell(asset: a, selected: model.selected?.localIdentifier == a.localIdentifier)
                        .onTapGesture { if !model.preparingTrim { model.selected = a } } // freeze selection while loading the AVAsset
                }
            }
        }
    }

    private var limitedBanner: some View {
        HStack {
            Text(model.limitedNote).font(.system(size: 12.5)).foregroundStyle(.secondary)
            Spacer()
            Button(model.manageLabel) { model.openManage() }
                .font(.system(size: 12.5, weight: .bold)).foregroundStyle(vfRed)
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(Color.secondary.opacity(0.08))
    }

    private var deniedPanel: some View {
        VStack(spacing: 14) {
            Spacer()
            Text(model.deniedNote).font(.system(size: 15)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 30)
            Button(model.settingsLabel) { model.openSettings() }
                .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                .padding(.horizontal, 22).padding(.vertical, 11)
                .background(RoundedRectangle(cornerRadius: 12).fill(vfRed))
            Button(model.cancelLabel) { model.fallbackToWeb() }
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary)
            Spacer()
        }.frame(maxWidth: .infinity)
    }

    // MARK: caption step
    private var caption: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let vurl = model.capturedVideoURL {
                    LoopingVideoView(url: vurl)                       // videoen spiller i loop, 4:5
                        .aspectRatio(4.0 / 5.0, contentMode: .fit)
                        .frame(maxWidth: .infinity, maxHeight: UIScreen.main.bounds.height * 0.5)
                        .clipped()
                        .padding(.bottom, 6)
                } else if let shot = model.capturedImage {
                    Image(uiImage: shot).resizable().scaledToFit()   // hele 4:5, ikke beskåret
                        .frame(maxWidth: .infinity, maxHeight: UIScreen.main.bounds.height * 0.5)
                        .padding(.bottom, 6)
                } else if let sel = model.selected {
                    PreviewPane(asset: sel).frame(height: UIScreen.main.bounds.height * 0.34).padding(.bottom, 6)
                }
                TextField(model.captionPlaceholder, text: $model.caption, axis: .vertical)
                    .font(.system(size: 16)).lineLimit(1...5)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                if !mentionHits.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(mentionHits) { m in
                                Button { model.caption = MentionSupport.insert(model.caption, m.handle) } label: {
                                    HStack(spacing: 6) {
                                        GlassAvatar(url: m.avatarUrl, initials: m.initials, gradient: m.gradient, size: 22)
                                        Text("@\(m.handle)")
                                            .font(.system(size: 13, weight: .semibold))
                                            .foregroundStyle(Color.primary)
                                    }
                                    .padding(.horizontal, 10).padding(.vertical, 6)
                                    .glassBG(Capsule())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 8)
                }
                Divider().opacity(0.4)
                Text(model.destLabel.uppercased()).font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.secondary).kerning(0.4).padding(.leading, 16).padding(.top, 14).padding(.bottom, 6)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        destPill("all", model.allLabel)
                        ForEach(model.feeds) { f in destPill(f.id, f.name) }
                    }.padding(.horizontal, 16)
                }
            }
        }
    }

    /// @-kandidater der matcher det token brugeren er ved at skrive i captionen
    private var mentionHits: [MentionCard] {
        MentionSupport.hits(model.caption, model.mentionables[model.dest] ?? model.mentionables["all"] ?? [])
    }

    private func destPill(_ id: String, _ name: String) -> some View {
        let on = model.dest == id
        return Button { model.dest = id } label: {
            Text(name).font(.system(size: 14, weight: .bold))
                .foregroundStyle(on ? Color(.systemBackground) : Color.primary)
                .padding(.horizontal, 15).frame(height: 34)
                .background(Group {
                    if on { Capsule().fill(Color.primary) } else { Capsule().strokeBorder(Color.primary.opacity(0.2), lineWidth: 1.5) }
                })
        }.buttonStyle(.plain)
    }
}

private struct PreviewPane: View {
    let asset: PHAsset
    @State private var image: UIImage?
    var body: some View {
        ZStack {
            Color.black
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else { ProgressView().tint(.white) }
            if asset.mediaType == .video {
                Image(systemName: "play.circle.fill").font(.system(size: 34)).foregroundStyle(.white.opacity(0.85))
            }
        }
        .frame(maxWidth: .infinity)
        .onAppear { PhotoLibModel.shared.previewImage(asset) { self.image = $0 } }
        .onChange(of: asset.localIdentifier) { _, _ in image = nil; PhotoLibModel.shared.previewImage(asset) { self.image = $0 } }
    }
}

struct MemoryThumbCell: View {
    let asset: PHAsset
    let selected: Bool
    @State private var image: UIImage?

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay(
                Group {
                    if let image { Image(uiImage: image).resizable().scaledToFill() }
                    else { Color.secondary.opacity(0.12) }
                }
            )
            .overlay(alignment: .bottomTrailing) {
                if asset.mediaType == .video {
                    Text(durationText).font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 4).padding(.vertical, 1)
                        .background(Color.black.opacity(0.4)).cornerRadius(4).padding(4)
                }
            }
            .overlay(selected ? Rectangle().strokeBorder(vfRed, lineWidth: 3) : nil)
            .clipped()
            .contentShape(Rectangle())
            .onAppear { PhotoLibModel.shared.thumb(asset, side: 110) { self.image = $0 } }
    }
    private var durationText: String {
        let s = Int(asset.duration.rounded())
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

/// Full-screen cover of the memory gallery composer when open.
struct PhotoLibHost: ViewModifier {
    @ObservedObject private var model = PhotoLibModel.shared
    func body(content: Content) -> some View {
        content.fullScreenCover(isPresented: Binding(get: { model.open }, set: { if !$0 { model.open = false } })) {
            MemoryGalleryScreen()
        }
    }
}

// MARK: - Native kamera (skræddersyet, som Instagram-kameraet men uden mode-faner)

/// Ejer AVCaptureSession'en for minde-kameraet: live-preview, foto-optagelse, blitz og vend-kamera.
final class MemoryCamera: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate, AVCaptureFileOutputRecordingDelegate {
    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private let queue = DispatchQueue(label: "vf.memory.camera")
    private var onCapture: ((UIImage) -> Void)?
    private var onVideo: ((URL) -> Void)?
    private var configured = false

    @Published var authorized = false
    @Published var flashOn = false
    @Published var recording = false
    @Published var secondsLeft = 0                    // nedtælling under optagelse (6 → 0)
    @Published var position: AVCaptureDevice.Position = .back
    private var countdownTimer: Timer?

    /// Bed om kamera- (og mikrofon-) adgang og start sessionen. Callbacks kaldes på main-tråden.
    func start(onCapture: @escaping (UIImage) -> Void, onVideo: @escaping (URL) -> Void) {
        self.onCapture = onCapture
        self.onVideo = onVideo
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            authorized = true; configureAndRun()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] ok in
                DispatchQueue.main.async {
                    self?.authorized = ok
                    if ok { self?.configureAndRun() }
                }
            }
        default:
            authorized = false
        }
        AVCaptureDevice.requestAccess(for: .audio) { _ in }   // mikrofon til video-lyd
    }

    func stop() {
        queue.async { [weak self] in
            if self?.movieOutput.isRecording == true { self?.movieOutput.stopRecording() }
            if self?.session.isRunning == true { self?.session.stopRunning() }
        }
    }

    private func configureAndRun() {
        queue.async { [weak self] in
            guard let self else { return }
            if !self.configured {
                self.configured = true
                self.session.beginConfiguration()
                self.session.sessionPreset = .high   // understøtter både foto og video
                self.setVideoInput(self.position)
                self.setAudioInput()
                if self.session.canAddOutput(self.photoOutput) { self.session.addOutput(self.photoOutput) }
                if self.session.canAddOutput(self.movieOutput) { self.session.addOutput(self.movieOutput) }
                self.session.commitConfiguration()
            }
            if !self.session.isRunning { self.session.startRunning() }
        }
    }

    private func setVideoInput(_ pos: AVCaptureDevice.Position) {
        if let cur = videoInput { session.removeInput(cur) }
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: pos),
              let newInput = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(newInput) else { return }
        session.addInput(newInput); videoInput = newInput
    }

    private func setAudioInput() {
        guard audioInput == nil, let mic = AVCaptureDevice.default(for: .audio),
              let ai = try? AVCaptureDeviceInput(device: mic), session.canAddInput(ai) else { return }
        session.addInput(ai); audioInput = ai
    }

    func flip() {
        position = (position == .back) ? .front : .back
        queue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration(); self.setVideoInput(self.position); self.session.commitConfiguration()
        }
    }

    func capture() {
        queue.async { [weak self] in
            guard let self, self.session.isRunning, !self.movieOutput.isRecording else { return }
            let settings = AVCapturePhotoSettings()
            let mode: AVCaptureDevice.FlashMode = self.flashOn ? .on : .off
            if self.photoOutput.supportedFlashModes.contains(mode) { settings.flashMode = mode }
            self.photoOutput.capturePhoto(with: settings, delegate: self)
        }
    }

    /// Hold optage-knappen → start video (nedtælling fra 6 s, auto-stop ved 0).
    func startRecording() {
        queue.async { [weak self] in
            guard let self, self.session.isRunning, !self.movieOutput.isRecording else { return }
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
            try? FileManager.default.removeItem(at: url)
            self.movieOutput.startRecording(to: url, recordingDelegate: self)
            DispatchQueue.main.async { self.beginCountdown() }
        }
    }

    private func beginCountdown() {
        recording = true
        secondsLeft = Int(VF_MAX_VID)
        countdownTimer?.invalidate()
        countdownTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] t in
            guard let self else { t.invalidate(); return }
            self.secondsLeft -= 1
            if self.secondsLeft <= 0 { self.stopRecording() }
        }
    }

    func stopRecording() {
        countdownTimer?.invalidate(); countdownTimer = nil
        queue.async { [weak self] in
            guard let self, self.movieOutput.isRecording else { return }
            self.movieOutput.stopRecording()
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard error == nil, let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else { return }
        DispatchQueue.main.async { [weak self] in self?.onCapture?(image) }
    }

    func fileOutput(_ output: AVCaptureFileOutput, didFinishRecordingTo outputFileURL: URL, from connections: [AVCaptureConnection], error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.countdownTimer?.invalidate(); self?.countdownTimer = nil
            self?.recording = false
            self?.secondsLeft = 0
            guard error == nil else { return }
            self?.onVideo?(outputFileURL)
        }
    }
}

/// SwiftUI-wrapper om AVCaptureVideoPreviewLayer (den live kamera-forhåndsvisning).
struct CameraPreview: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

/// Loopende, lydløs video-afspiller (til at forhåndsvise en optaget video i billedtekst-trinet).
/// resizeAspectFill i en 4:5-ramme → viser samme udsnit som den endelige 4:5-beskæring.
struct LoopingVideoView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> PlayerBox {
        let v = PlayerBox(); v.configure(url: url); return v
    }
    func updateUIView(_ uiView: PlayerBox, context: Context) {}
    static func dismantleUIView(_ uiView: PlayerBox, coordinator: ()) { uiView.teardown() }

    final class PlayerBox: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        private var player: AVQueuePlayer?
        private var looper: AVPlayerLooper?
        private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

        func configure(url: URL) {
            let item = AVPlayerItem(url: url)
            let qp = AVQueuePlayer()
            qp.isMuted = true
            looper = AVPlayerLooper(player: qp, templateItem: item)
            playerLayer.player = qp
            playerLayer.videoGravity = .resizeAspectFill
            player = qp
            qp.play()
        }
        func teardown() { player?.pause(); player = nil; looper = nil; playerLayer.player = nil }
    }
}

/// Kamera-trinet i minde-komposeren: fuldskærms preview + skræddersyet chrome
/// (luk, blitz, optage-knap, vend-kamera, galleri-miniature). Ingen OPSLAG/STORY/REELS.
struct MemoryCameraScreen: View {
    @ObservedObject private var model = PhotoLibModel.shared
    @StateObject private var cam = MemoryCamera()
    @State private var thumb: UIImage?
    @State private var holdWork: DispatchWorkItem?   // udløser video-start hvis knappen holdes
    @State private var didRecord = false             // dette tryk startede en optagelse

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            let fh = w * 5.0 / 4.0   // 4:5-optageområdet (1080x1350)
            ZStack {
                Color.black.ignoresSafeArea()

                // Live-preview begrænset til 4:5, centreret. Alt uden for rammen er mørkt (fade).
                Group {
                    if cam.authorized {
                        CameraPreview(session: cam.session).frame(width: w, height: fh).clipped()
                    } else {
                        deniedPanel.frame(width: w, height: fh)
                    }
                }
                .overlay(Rectangle().strokeBorder(Color.white.opacity(0.22), lineWidth: 1).frame(width: w, height: fh))
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Fade øverst + nederst (så kontrollerne kan læses og 4:5-rammen popper)
                VStack(spacing: 0) {
                    LinearGradient(colors: [.black.opacity(0.55), .clear], startPoint: .top, endPoint: .bottom).frame(height: 130)
                    Spacer()
                    LinearGradient(colors: [.clear, .black.opacity(0.62)], startPoint: .top, endPoint: .bottom).frame(height: 165)
                }
                .ignoresSafeArea().allowsHitTesting(false)

                VStack {
                    HStack {
                        iconButton("xmark") { model.dismiss() }
                        Spacer()
                        if cam.recording {
                            HStack(spacing: 6) {
                                Circle().fill(Color.white).frame(width: 8, height: 8)
                                Text("0:0\(max(0, cam.secondsLeft))").font(.system(size: 14, weight: .heavy)).monospacedDigit().foregroundStyle(.white)
                            }
                            .padding(.horizontal, 11).padding(.vertical, 5)
                            .background(Capsule().fill(Color.red))
                        }
                        Spacer()
                        iconButton(cam.flashOn ? "bolt.fill" : "bolt.slash.fill") { cam.flashOn.toggle() }
                    }
                    .padding(.horizontal, 20).padding(.top, 6)

                    Spacer()

                    // Hint tæt over knappen, på en mørk pille så den ikke flyder ud over billedet
                    if !cam.recording {
                        Text("Tryk for foto · hold for video")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(Capsule().fill(Color.black.opacity(0.4)))
                            .padding(.bottom, 8)
                    }

                    HStack(alignment: .center) {
                        Button { model.step = .gallery } label: { thumbView }
                        Spacer()
                        captureButton
                        Spacer()
                        iconButton("arrow.triangle.2.circlepath.camera") { cam.flip() }
                            .frame(width: 48, height: 48)
                    }
                    .padding(.horizontal, 26).padding(.bottom, 28)
                }
            }
        }
        .onAppear {
            cam.start(onCapture: { img in model.useCaptured(img) },
                      onVideo: { url in model.useCapturedVideo(url) })
            if let a = model.assets.first { model.thumb(a, side: 48) { self.thumb = $0 } }
        }
        .onDisappear { cam.stop() }
    }

    // Optage-knap: tryk = foto, hold = video (rød firkant mens den optager).
    private var captureButton: some View {
        ZStack {
            Circle().stroke(cam.recording ? Color.red : Color.white, lineWidth: 5).frame(width: 78, height: 78)
            RoundedRectangle(cornerRadius: cam.recording ? 8 : 31, style: .continuous)
                .fill(cam.recording ? Color.red : Color.white)
                .frame(width: cam.recording ? 32 : 62, height: cam.recording ? 32 : 62)
                .animation(.easeInOut(duration: 0.2), value: cam.recording)
        }
        .contentShape(Circle())
        .opacity(cam.authorized ? 1 : 0.4)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { _ in
                    // Første berøring: planlæg video-start hvis knappen holdes ≥ 0,32 s
                    if holdWork == nil && !didRecord {
                        let work = DispatchWorkItem { didRecord = true; cam.startRecording() }
                        holdWork = work
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.32, execute: work)
                    }
                }
                .onEnded { _ in
                    holdWork?.cancel(); holdWork = nil
                    if didRecord {
                        if cam.recording { cam.stopRecording() }   // slip → stop video
                    } else {
                        cam.capture()                              // hurtigt tryk → foto
                    }
                    didRecord = false
                }
        )
        .disabled(!cam.authorized)
    }

    private var thumbView: some View {
        Group {
            if let thumb { Image(uiImage: thumb).resizable().scaledToFill() }
            else { Image(systemName: "photo.on.rectangle").font(.system(size: 20)).foregroundStyle(.white) }
        }
        .frame(width: 48, height: 48)
        .background(Color.white.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.white.opacity(0.7), lineWidth: 1.5))
    }

    private var deniedPanel: some View {
        VStack(spacing: 14) {
            Image(systemName: "camera.fill").font(.system(size: 42)).foregroundStyle(.white.opacity(0.65))
            Text(model.deniedNote.isEmpty ? "Giv adgang til kameraet i Indstillinger, eller vælg fra galleriet." : model.deniedNote)
                .font(.system(size: 15)).foregroundStyle(.white.opacity(0.85))
                .multilineTextAlignment(.center).padding(.horizontal, 36)
            Button(model.settingsLabel.isEmpty ? "Åbn Indstillinger" : model.settingsLabel) { model.openSettings() }
                .font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                .padding(.horizontal, 22).padding(.vertical, 11)
                .background(RoundedRectangle(cornerRadius: 12).fill(vfRed))
        }
    }

    private func iconButton(_ symbol: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 42, height: 42)
                .background(Color.black.opacity(0.28))
                .clipShape(Circle())
        }
    }
}
