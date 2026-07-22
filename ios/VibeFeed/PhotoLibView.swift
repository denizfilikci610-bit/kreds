import SwiftUI
import Photos
import AVFoundation
import UIKit
import CoreImage
import CoreImage.CIFilterBuiltins
import MetalKit

/// ================= VibeFeed-kameraets ANALOGE FILM-LOOK =================
/// Film-looket er FJERNET igen (ejer-ønske 2026-07-21) — kameraet optager nu neutralt.
/// Enum'et består, fordi Metal-søgeren (FilmPreviewView) og video-eksporten stadig
/// bruger dets delte CIContext/Metal-device, og applyStill stadig bager foto-
/// orienteringen ind i selve pixels (som filteret gjorde før).
enum VFFilmLook {
    static let device: MTLDevice? = MTLCreateSystemDefaultDevice()
    static let context: CIContext = {
        if let d = device { return CIContext(mtlDevice: d, options: [.cacheIntermediates: false]) }
        return CIContext()
    }()

    /// Stillbillede (foto taget med kameraet): korrekt orientering bages ind i pixels.
    static func applyStill(_ ui: UIImage) -> UIImage {
        guard ui.imageOrientation != .up else { return ui }
        guard var ci = CIImage(image: ui) else { return ui }
        ci = ci.oriented(forExifOrientation: exif(ui.imageOrientation))
        guard let cg = context.createCGImage(ci, from: ci.extent) else { return ui }
        return UIImage(cgImage: cg)
    }
    private static func exif(_ o: UIImage.Orientation) -> Int32 {
        switch o {
        case .up: return 1; case .down: return 3; case .left: return 8; case .right: return 6
        case .upMirrored: return 2; case .downMirrored: return 4
        case .leftMirrored: return 5; case .rightMirrored: return 7
        @unknown default: return 1
        }
    }
}

/// Instagram-style IN-APP photo/video gallery composer for MEMORIES (the owner sent the IG screenshot).
/// A WKWebView can't read the photo library, so this is native PhotoKit: a grid of the user's own
/// photos + videos, a big preview, single-select, then a native caption + kreds screen. On "Del" the
/// picked media is staged to VFMediaScheme and the web is told to upload+insert (kind='memory') via
/// window.vfMemory. Fully native compose; the web owns only the Supabase upload/insert. Browser + the
/// pre-flag build keep the web file-picker fallback (gated on window.__vfPhotoLib).

/// Landscape-minde: 1080×566 (≈1.91:1). Tredje format ved siden af 1:1 og 4:5.
let VF_LANDSCAPE_ASPECT: CGFloat = 1080.0 / 566.0

struct PLFeed: Identifiable, Equatable { let id: String; let name: String }

final class PhotoLibModel: NSObject, ObservableObject {
    static let shared = PhotoLibModel()

    enum Step { case camera, gallery, trim, crop, videocrop, caption }
    @Published var open = false
    @Published var forCompose = false   // åbnet fra en TANKE (Tag med kamera) → hæft medie, opret ikke minde
    @Published var isStory = false      // STORY-tilstand → indsæt i stories (24t), ingen billedtekst, 9:16
    // Minde/Story-vælgeren i kameraet: titel + del-tekst pr. tilstand (fra web-i18n)
    @Published var titleMemory = ""
    @Published var titleStory = ""
    @Published var shareMemory = ""
    @Published var shareStory = ""
    @Published var modeMemoryLabel = ""
    @Published var modeStoryLabel = ""
    var curTitle: String { isStory ? (titleStory.isEmpty ? title : titleStory) : (titleMemory.isEmpty ? title : titleMemory) }
    var curShare: String { isStory ? (shareStory.isEmpty ? shareLabel : shareStory) : (shareMemory.isEmpty ? shareLabel : shareMemory) }
    /// Output-pixelmål: story fylder hele skærmen (9:16), minde er 4:5
    func outSize() -> CGSize { isStory ? CGSize(width: 1080, height: 1920) : CGSize(width: 1080, height: 1350) }
    /// Output-pixelmål for et minde-udsnit ud fra det VALGTE format (1:1 / 4:5 / landscape).
    func memTarget(_ aspect: CGFloat) -> CGSize {
        if isStory { return CGSize(width: 1080, height: 1920) }
        if abs(aspect - 1) < 0.02 { return CGSize(width: 1080, height: 1080) }   // 1:1
        if aspect > 1.4 { return CGSize(width: 1080, height: 566) }              // landscape (1.91:1)
        return CGSize(width: 1080, height: 1350)                                 // 4:5
    }
    @Published var step: Step = .camera
    @Published var status: PHAuthorizationStatus = .notDetermined
    @Published var assets: [PHAsset] = []
    @Published var selected: PHAsset?
    @Published var capturedImage: UIImage?   // et foto taget med kameraet, ELLER poster-frame for en optaget video
    // Galleri-billede → beskærings-trin: mindet SKAL være 1080x1080 (1:1) eller 1080x1350 (4:5)
    @Published var cropSource: UIImage?      // det valgte billede i fuld preview-opløsning
    @Published var croppedImage: UIImage?    // det godkendte udsnit (præcis 1080-format)
    @Published var cropAspect: CGFloat = 4.0 / 5.0
    @Published var fitLabel = ""
    @Published var capturedVideoURL: URL?    // en video optaget med det indbyggede kamera (≤6 s)
    // Galleri-video → beskærings-trin (fuld træk/zoom, samme som billeder)
    @Published var videoCropRect: CGRect?    // valgt udsnit (0-1, top-venstre, oprejst video-rum); nil = ingen crop
    @Published var videoOriented: CGSize = .zero  // videosporets oprejste pixel-størrelse
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
        forCompose = (dict["purpose"] as? String) == "compose"
        isStory = (dict["purpose"] as? String) == "story"
        dest = dict["dest"] as? String ?? "all"
        if let raw = dict["feeds"] as? [[String: Any]] {
            feeds = raw.compactMap { d in
                guard let id = d["id"] as? String, let name = d["name"] as? String else { return nil }
                return PLFeed(id: id, name: name)
            }
        }
        if let l = dict["labels"] as? [String: Any] {
            title = s(l, "title"); nextLabel = s(l, "next"); cancelLabel = s(l, "cancel"); shareLabel = s(l, "share")
            fitLabel = s(l, "fit")
            titleMemory = s(l, "titleMemory"); titleStory = s(l, "titleStory")
            shareMemory = s(l, "shareMemory"); shareStory = s(l, "shareStory")
            modeMemoryLabel = s(l, "modeMemory"); modeStoryLabel = s(l, "modeStory")
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
        caption = ""; selected = nil; capturedImage = nil; capturedVideoURL = nil; sharing = false; loadingOriginal = false
        step = (forCompose && (dict["start"] as? String) == "gallery") ? .gallery : .camera
        videoAsset = nil; videoDuration = 0; trimStart = 0; trimDuration = VF_MAX_VID; showTrimStep = false; preparingTrim = false
        pendingData = nil; exportSession = nil; trimReqSeq += 1
        cropSource = nil; croppedImage = nil; cropAspect = 4.0 / 5.0
        videoCropRect = nil; videoOriented = .zero
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
        if asset.mediaType != .video {
            showTrimStep = false
            if forCompose { share(); return }
            // Galleri-billeder beskæres altid: minde → 1:1/4:5, story → fast 9:16.
            // Hent fuld preview-opløsning og vis beskærings-trinnet.
            cropAspect = isStory ? 9.0 / 16.0 : 4.0 / 5.0
            trimReqSeq += 1
            let seqI = trimReqSeq
            preparingTrim = true
            previewImageFull(asset) { [weak self] img in
                guard let self, seqI == self.trimReqSeq else { return }
                self.preparingTrim = false
                guard let img else { return }
                self.cropSource = img
                self.croppedImage = nil
                self.step = .crop
            }
            return
        }
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
                guard let avAsset else { self.showTrimStep = false; self.afterVideoReady(); return }
                self.videoAsset = avAsset
                // Oprejst pixel-størrelse (til video-beskæreren) — samme rum som req.sourceImage i eksporten.
                if let vt = avAsset.tracks(withMediaType: .video).first {
                    let os = vt.naturalSize.applying(vt.preferredTransform)
                    self.videoOriented = CGSize(width: abs(os.width), height: abs(os.height))
                } else { self.videoOriented = .zero }
                let dur = CMTimeGetSeconds(avAsset.duration)
                self.videoDuration = (dur.isFinite && dur > 0) ? dur : 0
                self.trimDuration = min(VF_MAX_VID, max(0.1, self.videoDuration))
                self.trimStart = 0
                self.showTrimStep = self.videoDuration > VF_MAX_VID + 0.05
                if self.showTrimStep { self.step = .trim }
                else { self.afterVideoReady() }
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
        // Galleri-billede beskåret til 1080-formatet: upload det beskårne.
        if let cimg = croppedImage {
            sharing = true
            guard let data = cimg.jpegData(compressionQuality: 0.88) else { sharing = false; return }
            pendingData = data
            send(isVideo: false, ext: "jpg", mime: "image/jpeg")
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

    /// Beskåret galleri-billede godkendt (allerede PRÆCIS 1080-format) → billedtekst
    func useCropped(_ img: UIImage) {
        croppedImage = img
        step = .caption
    }

    /// Efter en galleri-video er klar (asset loadet, evt. trimmet): minde → video-beskærer,
    /// tanke → upload straks, story → billedtekst (uændret adfærd for de to sidste).
    func afterVideoReady() {
        if forCompose { share() }
        else if isStory { step = .caption }
        else { cropAspect = 4.0 / 5.0; step = .videocrop }
    }

    /// Video-udsnit godkendt (normaliseret rect) → billedtekst. exportTrimmedVideo beskærer efter.
    func useVideoCrop(_ rect: CGRect) {
        videoCropRect = rect
        step = .caption
    }

    /// Et foto taget med kameraet → beskær til minde-formatet (4:5 lodret, 1080×566 vandret).
    /// Tanke: upload straks; minde: billedtekst.
    func useCaptured(_ image: UIImage) {
        capturedImage = cropToSize(image, cameraTarget(image))
        capturedVideoURL = nil
        selected = nil; videoAsset = nil; showTrimStep = false
        cropSource = nil; croppedImage = nil
        if forCompose { share() } else { step = .caption }
    }

    /// En video optaget med kameraet → gem URL + poster-frame. Tanke: upload straks; minde: billedtekst.
    func useCapturedVideo(_ url: URL) {
        capturedVideoURL = url
        capturedImage = posterFrame(url)   // vises i billedtekst-trinet (minde)
        selected = nil; videoAsset = nil; showTrimStep = false
        if forCompose { share() } else { step = .caption }
    }

    /// Center-beskær (aspectFill) + skalér et billede til et givet output-format. draw respekterer orienteringen.
    private func cropToSize(_ image: UIImage, _ out: CGSize) -> UIImage {
        let fmt = UIGraphicsImageRendererFormat.default(); fmt.scale = 1; fmt.opaque = true
        return UIGraphicsImageRenderer(size: out, format: fmt).image { _ in
            let iw = image.size.width, ih = image.size.height
            guard iw > 0, ih > 0 else { return }
            let scale = max(out.width / iw, out.height / ih)   // aspectFill
            let dw = iw * scale, dh = ih * scale
            image.draw(in: CGRect(x: (out.width - dw) / 2, y: (out.height - dh) / 2, width: dw, height: dh))
        }
    }
    /// Kamera-output-format ud fra billedets orientering: vandret → landscape (1080×566),
    /// lodret → 4:5; en story er altid 9:16.
    private func cameraTarget(_ image: UIImage) -> CGSize {
        if isStory { return CGSize(width: 1080, height: 1920) }
        return image.size.width > image.size.height ? CGSize(width: 1080, height: 566) : CGSize(width: 1080, height: 1350)
    }

    /// Første frame af en video som poster (til billedtekst-forhåndsvisningen).
    private func posterFrame(_ url: URL) -> UIImage? {
        let gen = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        gen.appliesPreferredTrackTransform = true
        gen.maximumSize = CGSize(width: 1080, height: 1920)
        guard let cg = try? gen.copyCGImage(at: CMTime(seconds: 0.1, preferredTimescale: 600), actualTime: nil) else { return nil }
        let ui = VFFilmLook.applyStill(UIImage(cgImage: cg))
        return cropToSize(ui, cameraTarget(ui))   // poster matcher den færdige video (samme orientering)
    }

    /// Beskær den optagne video til 4:5 (1080x1350) via en video-composition og upload som mp4.
    private func export45Video(_ url: URL) {
        let asset = AVURLAsset(url: url)
        guard let vt = asset.tracks(withMediaType: .video).first else { sharing = false; onUploadFailed?(); return }
        // Vandret optaget video → landscape-output (1080×566); ellers 4:5 (story = 9:16).
        let os = vt.naturalSize.applying(vt.preferredTransform)
        let landscape = abs(os.width) > abs(os.height)
        let render = (landscape && !isStory) ? CGSize(width: 1080, height: 566) : outSize()
        // CI-pipeline pr. frame: aspect-fill-beskær til render-størrelsen
        // (sourceImage kommer allerede opret — preferredTransform er anvendt)
        let comp = AVMutableVideoComposition(asset: asset) { req in
            var img = req.sourceImage
            let iw = img.extent.width, ih = img.extent.height
            if iw > 0, ih > 0 {
                let scale = max(render.width / iw, render.height / ih)
                img = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
                let e = img.extent
                let ox = (render.width - e.width) / 2, oy = (render.height - e.height) / 2
                img = img.transformed(by: CGAffineTransform(translationX: ox - e.origin.x, y: oy - e.origin.y))
                img = img.cropped(to: CGRect(origin: .zero, size: render))
            }
            req.finish(with: img, context: VFFilmLook.context)
        }
        comp.renderSize = render
        comp.frameDuration = CMTime(value: 1, timescale: 30)

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
        // Minde-video: beskær til det VALGTE udsnit + format (samme oplevelse som billeder).
        // req.sourceImage er allerede oprejst (preferredTransform anvendt), så crop-rect'en
        // (0-1, top-venstre i det oprejste rum) mapper 1:1 til extent'en; Y flippes til CIImage.
        if let crop = videoCropRect {
            let render = memTarget(cropAspect)
            let comp = AVMutableVideoComposition(asset: avAsset) { req in
                let src = req.sourceImage
                let e = src.extent
                let W = max(1, e.width), H = max(1, e.height)
                let cw = max(1, crop.width * W), ch = max(1, crop.height * H)
                let cx = e.origin.x + crop.origin.x * W
                let cy = e.origin.y + (H - crop.origin.y * H - ch)
                var img = src.cropped(to: CGRect(x: cx, y: cy, width: cw, height: ch))
                img = img.transformed(by: CGAffineTransform(translationX: -cx, y: -cy))
                img = img.transformed(by: CGAffineTransform(scaleX: render.width / cw, y: render.height / ch))
                img = img.cropped(to: CGRect(origin: .zero, size: render))
                req.finish(with: img, context: VFFilmLook.context)
            }
            comp.renderSize = render
            comp.frameDuration = CMTime(value: 1, timescale: 30)
            export.videoComposition = comp
        }
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
        let obj: [String: Any] = ["isVideo": isVideo, "caption": caption, "dest": dest, "ext": ext, "mime": mime, "forCompose": forCompose, "isStory": isStory]
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
            vfBackground.ignoresSafeArea()   // matcher appens tema (#161616/off-white) — kameraet har sit eget sorte chrome
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
                    case .crop: cropStep
                    case .videocrop: videoCropStep
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
                case .gallery: if model.forCompose { model.dismiss() } else { model.step = .camera }  // tanke: annuller lukker; minde: tilbage til kameraet
                case .trim: model.step = .gallery
                case .crop: model.step = .gallery
                case .videocrop: model.step = model.showTrimStep ? .trim : .gallery
                case .caption:
                    if model.capturedImage != nil { model.step = .camera }
                    else if model.croppedImage != nil { model.step = .crop } // tilbage til beskæringen
                    else if model.videoCropRect != nil { model.step = .videocrop } // tilbage til video-beskæringen
                    else { model.step = model.showTrimStep ? .trim : .gallery }
                }
            }
            .foregroundStyle(Color.primary)
            Spacer()
            Text(model.curTitle).font(.system(size: 16, weight: .bold))
            Spacer()
            switch model.step {
            case .camera:
                EmptyView()
            case .gallery:
                Button { model.prepareAndAdvance() } label: {
                    if model.preparingTrim || model.sharing { ProgressView() }
                    else {
                        Text(model.nextLabel).font(.system(size: 16, weight: .bold))
                            .foregroundStyle(model.selected == nil ? Color.secondary : vfRed)
                    }
                }
                .disabled(model.selected == nil || model.preparingTrim || model.sharing)
            case .trim:
                Button(model.nextLabel) { model.afterVideoReady() }
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(vfRed)
            case .crop, .videocrop:
                EmptyView()   // beskærings-trinnene har deres egne knapper
            case .caption:
                Button { model.share() } label: {
                    if model.sharing { ProgressView() } else {
                        Text(model.curShare).font(.system(size: 16, weight: .bold)).foregroundStyle(vfRed)
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
    /// Beskærings-trinnet: mindet SKAL være 1080x1080 (1:1) eller 1080x1350 (4:5).
    /// Træk/knib tilpasser udsnittet; format-pillerne skifter rammen.
    private var cropStep: some View {
        ZStack(alignment: .top) {
            if let src = model.cropSource {
                VFCropView(
                    image: src,
                    aspect: model.cropAspect,
                    circular: false,
                    targetSize: model.memTarget(model.cropAspect),
                    title: "",
                    cancelLabel: model.cancelLabel,
                    useLabel: model.nextLabel,
                    onCancel: { model.step = .gallery },
                    onDone: { model.useCropped($0) }
                )
                .id(model.cropAspect)   // ny ramme (og frisk pan/zoom) når formatet skiftes
            }
            VStack(spacing: 7) {
                if !model.fitLabel.isEmpty {
                    Text(model.fitLabel)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white)   // crop-baggrunden (VFCropView) er sort
                }
                if !model.isStory {   // story er ALTID fuldskærms 9:16 — ingen format-valg
                    aspectPills   // 1:1 / 4:5 / landscape
                }
            }
            .padding(.top, 10)
        }
    }

    /// Format-piller som ikoner (kvadrat / stående / liggende) — ingen tekst at oversætte.
    private var aspectPills: some View {
        HStack(spacing: 8) {
            aspectPill("square", value: 1)
            aspectPill("rectangle.portrait", value: 4.0 / 5.0)
            aspectPill("rectangle", value: VF_LANDSCAPE_ASPECT)   // landscape 1080×566
        }
    }

    private func aspectPill(_ symbol: String, value: CGFloat) -> some View {
        let on = abs(model.cropAspect - value) < 0.02
        return Button { model.cropAspect = value } label: {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(on ? .white : .white.opacity(0.85))   // crop-baggrunden er sort
                .frame(width: 30, height: 26)
                .background(Capsule().fill(on ? vfRed : Color.white.opacity(0.18)))
        }
        .buttonStyle(.plain)
    }

    /// Video-beskærings-trinnet: fuld træk/zoom af den loopende video, samme format-piller.
    private var videoCropStep: some View {
        ZStack(alignment: .top) {
            if let a = model.videoAsset {
                VFVideoCropView(
                    asset: a,
                    trimStart: model.trimStart,
                    trimDuration: model.trimDuration,
                    orientedSize: model.videoOriented,
                    aspect: model.cropAspect,
                    cancelLabel: model.cancelLabel,
                    useLabel: model.nextLabel,
                    onCancel: { model.step = model.showTrimStep ? .trim : .gallery },
                    onDone: { model.useVideoCrop($0) }
                )
                .id(model.cropAspect)   // frisk ramme + afspiller når formatet skiftes
            }
            VStack(spacing: 7) {
                if !model.fitLabel.isEmpty {
                    Text(model.fitLabel).font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                }
                if !model.isStory { aspectPills }
            }
            .padding(.top, 10)
        }
    }

    private var caption: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let vurl = model.capturedVideoURL {
                    // Rammen følger posterens format (1080×566 vandret, ellers 4:5), så en
                    // vandret video ikke klemmes ind i en 4:5-boks. Posteren er allerede
                    // beskåret til det færdige format, og afspilleren fylder (resizeAspectFill).
                    let vAspect: CGFloat = (model.capturedImage.map { $0.size.height > 0 ? $0.size.width / $0.size.height : 4.0 / 5.0 }) ?? 4.0 / 5.0
                    LoopingVideoView(url: vurl)       // loop af den optagne video (neutral, som eksporten)
                        .aspectRatio(vAspect, contentMode: .fit)
                        .frame(maxWidth: .infinity, maxHeight: UIScreen.main.bounds.height * 0.5)
                        .clipped()
                        .padding(.bottom, 6)
                } else if let shot = model.capturedImage {
                    Image(uiImage: shot).resizable().scaledToFit()   // hele 4:5, ikke beskåret
                        .frame(maxWidth: .infinity, maxHeight: UIScreen.main.bounds.height * 0.5)
                        .padding(.bottom, 6)
                } else if let ci = model.croppedImage {
                    Image(uiImage: ci).resizable().scaledToFit()   // det godkendte 1080-udsnit
                        .frame(maxWidth: .infinity, maxHeight: UIScreen.main.bounds.height * 0.5)
                        .padding(.bottom, 6)
                } else if let sel = model.selected {
                    PreviewPane(asset: sel).frame(height: UIScreen.main.bounds.height * 0.34).padding(.bottom, 6)
                }
                if !model.isStory {   // en story har ingen billedtekst
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
                .foregroundStyle(on ? vfBackground : Color.primary)
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
            vfBackground   // letterbox i tema-farven (før ren sort)
            if let image { Image(uiImage: image).resizable().scaledToFit() }
            else { ProgressView() }
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
final class MemoryCamera: NSObject, ObservableObject, AVCapturePhotoCaptureDelegate, AVCaptureFileOutputRecordingDelegate, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    private let photoOutput = AVCapturePhotoOutput()
    private let movieOutput = AVCaptureMovieFileOutput()
    private var videoInput: AVCaptureDeviceInput?
    private var audioInput: AVCaptureDeviceInput?
    private let queue = DispatchQueue(label: "vf.memory.camera")
    // Film-look-søgeren: rå frames filtreres på preview-køen og skubbes til Metal-viewet
    private let videoDataOutput = AVCaptureVideoDataOutput()
    private let previewQueue = DispatchQueue(label: "vf.memory.camera.preview")
    var previewSink: ((CIImage) -> Void)?
    private var onCapture: ((UIImage) -> Void)?
    private var onVideo: ((URL) -> Void)?
    private var configured = false

    @Published var authorized = false
    @Published var flashOn = false {
        didSet {   // blitz-tap MIDT i en optagelse slår lygten til/fra med det samme
            let on = flashOn
            queue.async { [weak self] in
                guard let self, self.movieOutput.isRecording else { return }
                self.applyTorch(on)
            }
        }
    }
    @Published var recording = false
    @Published var secondsLeft = 0                    // nedtælling under optagelse (6 → 0)
    @Published var zoomFactor: CGFloat = 1.0          // aktuel zoom (1x → maks)
    @Published var position: AVCaptureDevice.Position = .back
    private var countdownTimer: Timer?
    // Fysisk orientering (uafhængig af app'ens portrait-lås). Preview-forbindelsen holdes
    // horisont-plan, og capture-vinklen bages ind i foto/video ved optagelse, så et vandret
    // motiv kommer ud i landscape (1080×566) korrekt vendt. Preview-RAMMEN skifter ikke form.
    private var rotationCoordinator: AVCaptureDevice.RotationCoordinator?
    private var rotationObs: NSKeyValueObservation?

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
            guard let self else { return }
            self.applyTorch(false)   // lygten må aldrig blive hængende tændt
            if self.movieOutput.isRecording { self.movieOutput.stopRecording() }
            if self.session.isRunning { self.session.stopRunning() }
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
                if self.session.canAddOutput(self.videoDataOutput) {
                    self.videoDataOutput.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
                    self.videoDataOutput.alwaysDiscardsLateVideoFrames = true
                    self.videoDataOutput.setSampleBufferDelegate(self, queue: self.previewQueue)
                    self.session.addOutput(self.videoDataOutput)
                }
                self.updatePreviewConnection()
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
        setupRotation(for: device)
    }

    /// Følg telefonens FYSISKE orientering (uafhængigt af app'ens portrait-lås) via
    /// RotationCoordinator. Vi renderer selv videoDataOutput-bufferen i et fast Metal-view
    /// (ikke et AVCaptureVideoPreviewLayer), så vi bruger CAPTURE-vinklen (horisont-plan for
    /// optaget medie, layer-uafhængig) til BÅDE søgeren og selve optagelsen. Preview-vinklen
    /// forudsætter et preview-layer og gav forkert rotation (lodret vistes sidelæns).
    private func setupRotation(for device: AVCaptureDevice) {
        rotationObs = nil
        let coord = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: nil)
        rotationCoordinator = coord
        rotationObs = coord.observe(\.videoRotationAngleForHorizonLevelCapture, options: [.initial, .new]) { [weak self] _, _ in
            guard let self else { return }
            self.queue.async { self.updatePreviewConnection() }
        }
    }

    /// Sæt en capture-forbindelse (foto/video) til horisont-plan-vinklen, så det tagne medie
    /// kommer ud korrekt vendt uanset hvordan telefonen holdes.
    private func applyCaptureRotation(_ c: AVCaptureConnection?) {
        guard let c, let coord = rotationCoordinator else { return }
        let a = coord.videoRotationAngleForHorizonLevelCapture
        if c.isVideoRotationAngleSupported(a) { c.videoRotationAngle = a }
    }

    private func setAudioInput() {
        guard audioInput == nil, let mic = AVCaptureDevice.default(for: .audio),
              let ai = try? AVCaptureDeviceInput(device: mic), session.canAddInput(ai) else { return }
        session.addInput(ai); audioInput = ai
    }

    func flip() {
        position = (position == .back) ? .front : .back
        zoomFactor = 1.0
        queue.async { [weak self] in
            guard let self else { return }
            self.session.beginConfiguration(); self.setVideoInput(self.position); self.session.commitConfiguration()
            self.updatePreviewConnection()   // spejling følger front/bag
        }
    }

    /// Søger-forbindelsen: rotationsvinklen følger telefonens orientering (capture horisont-plan),
    /// så motivet altid vises oprejst (lodret = oprejst, vandret = oprejst). Front-kameraet spejles.
    private func updatePreviewConnection() {
        guard let c = videoDataOutput.connection(with: .video) else { return }
        let angle = rotationCoordinator?.videoRotationAngleForHorizonLevelCapture ?? 90
        if c.isVideoRotationAngleSupported(angle) { c.videoRotationAngle = angle }
        c.automaticallyAdjustsVideoMirroring = false
        if c.isVideoMirroringSupported { c.isVideoMirrored = (position == .front) }
    }

    /// Live-frames → søgeren (Metal-viewet) — neutralt, uden filter
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let sink = previewSink, let pb = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        sink(CIImage(cvPixelBuffer: pb))
    }

    /// Fokus ud fra et normaliseret punkt i den viste (upright) søger-buffer.
    func focusNormalized(_ p: CGPoint) {
        queue.async { [weak self] in
            guard let self else { return }
            let r = self.videoDataOutput.metadataOutputRectConverted(
                fromOutputRect: CGRect(x: p.x, y: p.y, width: 0.001, height: 0.001))
            self.focus(at: r.origin)
        }
    }

    /// Knib for at zoome (1x → maks 8x). Sætter enhedens videoZoomFactor.
    func setZoom(_ factor: CGFloat) {
        queue.async { [weak self] in
            guard let self, let device = self.videoInput?.device else { return }
            let maxF = min(device.activeFormat.videoMaxZoomFactor, 8.0)
            let clamped = max(1.0, min(factor, maxF))
            do { try device.lockForConfiguration() } catch { return }
            device.videoZoomFactor = clamped
            device.unlockForConfiguration()
            DispatchQueue.main.async { self.zoomFactor = clamped }
        }
    }

    /// Tryk for at fokusere + justere lys på et punkt (enheds-koordinater 0-1).
    func focus(at point: CGPoint) {
        queue.async { [weak self] in
            guard let self, let device = self.videoInput?.device else { return }
            do { try device.lockForConfiguration() } catch { return }
            if device.isFocusPointOfInterestSupported { device.focusPointOfInterest = point }
            if device.isFocusModeSupported(.autoFocus) { device.focusMode = .autoFocus }
            if device.isExposurePointOfInterestSupported { device.exposurePointOfInterest = point }
            if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
            device.unlockForConfiguration()
        }
    }

    /// VIDEO-blitz er LYGTEN (torch) — foto-flashen virker ikke under en optagelse.
    /// Skal kaldes på kamera-køen. Front-kameraet har ingen lygte (hasTorch-guard).
    private func applyTorch(_ on: Bool) {
        guard let device = videoInput?.device, device.hasTorch else { return }
        do {
            try device.lockForConfiguration()
            device.torchMode = (on && device.isTorchModeSupported(.on)) ? .on : .off
            device.unlockForConfiguration()
        } catch {}
    }

    func capture() {
        queue.async { [weak self] in
            guard let self, self.session.isRunning, !self.movieOutput.isRecording else { return }
            self.applyCaptureRotation(self.photoOutput.connection(with: .video))   // vandret → landscape-foto
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
            self.applyCaptureRotation(self.movieOutput.connection(with: .video))   // vandret → landscape-video
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString + ".mov")
            try? FileManager.default.removeItem(at: url)
            self.movieOutput.startRecording(to: url, recordingDelegate: self)
            if self.flashOn { self.applyTorch(true) }   // blitz under video = lygten
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
            self.applyTorch(false)
            self.movieOutput.stopRecording()
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        guard error == nil, let data = photo.fileDataRepresentation(), let image = UIImage(data: data) else { return }
        let upright = VFFilmLook.applyStill(image)   // kun EXIF-orienteringen bages ind (looket er fjernet)
        DispatchQueue.main.async { [weak self] in self?.onCapture?(upright) }
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
/// Tryk konverteres til enheds-koordinater og meldes tilbage (device-punkt 0-1, view-punkt).
/// Metal-søgeren: viser de FÆRDIG-filtrerede film-look-frames fra MemoryCamera
/// (aspect-fill). Ingen AVCaptureVideoPreviewLayer → ingen session-berøring ved
/// nedrivning (den gamle dealloc/stopRunning-crash-klasse er dermed helt væk).
struct FilmCameraPreview: UIViewRepresentable {
    let camera: MemoryCamera
    var onFocus: ((CGPoint) -> Void)? = nil   // view-punktet (til fokus-firkanten)
    func makeUIView(context: Context) -> FilmPreviewView {
        let v = FilmPreviewView()
        v.onTap = { [weak v] viewPoint in
            guard let v else { return }
            if let norm = v.normalizedImagePoint(for: viewPoint) { camera.focusNormalized(norm) }
            onFocus?(viewPoint)
        }
        camera.previewSink = { [weak v] img in
            DispatchQueue.main.async { v?.push(img) }
        }
        return v
    }
    func updateUIView(_ uiView: FilmPreviewView, context: Context) {}
}

final class FilmPreviewView: UIView, MTKViewDelegate {
    private let mtk: MTKView
    private let commandQueue: MTLCommandQueue?
    private var image: CIImage?
    var onTap: ((CGPoint) -> Void)?

    override init(frame: CGRect) {
        let dev = VFFilmLook.device
        mtk = MTKView(frame: .zero, device: dev)
        commandQueue = dev?.makeCommandQueue()
        super.init(frame: frame)
        backgroundColor = .black
        clipsToBounds = true
        mtk.framebufferOnly = false
        mtk.isPaused = true
        mtk.enableSetNeedsDisplay = false
        mtk.isUserInteractionEnabled = false
        mtk.delegate = self
        addSubview(mtk)
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func layoutSubviews() { super.layoutSubviews(); mtk.frame = bounds }

    func push(_ img: CIImage) { image = img; mtk.draw() }

    /// View-punkt → normaliseret punkt i den viste (upright) buffer (aspect-fill-regnestykke)
    func normalizedImagePoint(for p: CGPoint) -> CGPoint? {
        guard let img = image, bounds.width > 0, bounds.height > 0,
              img.extent.width > 0, img.extent.height > 0 else { return nil }
        let scale = max(bounds.width / img.extent.width, bounds.height / img.extent.height)
        let ox = (bounds.width - img.extent.width * scale) / 2
        let oy = (bounds.height - img.extent.height * scale) / 2
        let x = (p.x - ox) / scale / img.extent.width
        let y = (p.y - oy) / scale / img.extent.height
        guard x >= 0, x <= 1, y >= 0, y <= 1 else { return nil }
        return CGPoint(x: x, y: y)
    }
    @objc private func tapped(_ g: UITapGestureRecognizer) { onTap?(g.location(in: self)) }

    func mtkView(_ view: MTKView, drawableSizeWillChange size: CGSize) {}
    func draw(in view: MTKView) {
        guard let img = image, let drawable = view.currentDrawable, let cq = commandQueue,
              let buffer = cq.makeCommandBuffer(),
              img.extent.width > 0, img.extent.height > 0 else { return }
        let dw = CGFloat(view.drawableSize.width), dh = CGFloat(view.drawableSize.height)
        guard dw > 0, dh > 0 else { return }
        let scale = max(dw / img.extent.width, dh / img.extent.height)
        var out = img.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let e = out.extent
        out = out.transformed(by: CGAffineTransform(translationX: (dw - e.width) / 2 - e.origin.x,
                                                    y: (dh - e.height) / 2 - e.origin.y))
        // INGEN Y-flip: render(to:texture:) rammer teksturen i samme retning som
        // kamera-bufferen — flippet vendte søgeren på hovedet (medierne var korrekte)
        VFFilmLook.context.render(out, to: drawable.texture, commandBuffer: buffer,
                                  bounds: CGRect(x: 0, y: 0, width: dw, height: dh),
                                  colorSpace: CGColorSpaceCreateDeviceRGB())
        buffer.present(drawable)
        buffer.commit()
    }
}

/// Loopende video-afspiller MED lyd (til at forhåndsvise en optaget video i billedtekst-trinet).
/// Spiller hele klippet, genstarter ved slut (loop), og tvinger lyd-sessionen til playback så
/// lyden høres selv med lydløs-kontakten. resizeAspectFill i 4:5 → samme udsnit som den endelige beskæring.
struct LoopingVideoView: UIViewRepresentable {
    let url: URL
    func makeUIView(context: Context) -> PlayerBox {
        let v = PlayerBox(); v.configure(url: url); return v
    }
    func updateUIView(_ uiView: PlayerBox, context: Context) {}
    static func dismantleUIView(_ uiView: PlayerBox, coordinator: ()) { uiView.teardown() }

    final class PlayerBox: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        private var player: AVPlayer?
        private var item: AVPlayerItem?
        private var keepAlive: Timer?
        private var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }

        func configure(url: URL) {
            let it = AVPlayerItem(url: url)
            let p = AVPlayer(playerItem: it)
            p.isMuted = false
            p.actionAtItemEnd = .none
            p.automaticallyWaitsToMinimizeStalling = false
            playerLayer.player = p
            playerLayer.videoGravity = .resizeAspectFill
            player = p; item = it
            NotificationCenter.default.addObserver(self, selector: #selector(loopBack),
                                                   name: .AVPlayerItemDidPlayToEndTime, object: it)
            activateAudio()
            p.play()
            // Vagt: hvis noget pauser afspilningen før tid (fx kamera-sessionen der lukker og
            // afbryder lyd-sessionen), så genaktiver lyden og spil videre. Sikrer fuldt loop.
            keepAlive = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] _ in
                guard let self, let p = self.player else { return }
                if p.timeControlStatus != .playing {
                    self.activateAudio()
                    p.play()
                }
            }
        }
        private func activateAudio() {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
            try? AVAudioSession.sharedInstance().setActive(true)
        }
        @objc private func loopBack() { player?.seek(to: .zero); player?.play() }
        func teardown() {
            keepAlive?.invalidate(); keepAlive = nil
            NotificationCenter.default.removeObserver(self)
            player?.pause(); player = nil; item = nil; playerLayer.player = nil
        }
    }
}

/// Kamera-trinet i minde-komposeren: fuldskærms preview + skræddersyet chrome
/// (luk, blitz, optage-knap, vend-kamera, galleri-miniature). Ingen OPSLAG/STORY/REELS.
struct MemoryCameraScreen: View {
    @ObservedObject private var model = PhotoLibModel.shared

    /// Minde/Story-knappen: den valgte tilstand står hvid og fed, den anden dæmpet
    private func modeButton(_ label: String, story: Bool) -> some View {
        Button { model.isStory = story } label: {
            Text(label.uppercased())
                .font(.system(size: 13, weight: .bold))
                .kerning(0.7)
                .foregroundStyle(model.isStory == story ? .white : .white.opacity(0.5))
                .padding(.horizontal, 6).padding(.vertical, 5)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
    @StateObject private var cam = MemoryCamera()
    @State private var thumb: UIImage?
    @State private var holdWork: DispatchWorkItem?   // udløser video-start hvis knappen holdes
    @State private var didRecord = false             // dette tryk startede en optagelse
    @State private var baseZoom: CGFloat = 1.0       // zoom ved knib-start
    @State private var focusPt: CGPoint?             // seneste fokus-tryk (view-koordinat)
    @State private var focusSeq = 0                  // fader fokus-firkanten ud igen

    var body: some View {
        GeometryReader { geo in
            let w = geo.size.width
            // Minde: fast 4:5-optageområde (1080x1350). Preview-rammen skifter IKKE form når
            // telefonen drejes. Holdes telefonen vandret, bliver kun OUTPUTTET landscape
            // (cameraTarget/export detekterer orienteringen af det tagne medie). Story: fuld skærm.
            let fh = model.isStory ? geo.size.height : w * 5.0 / 4.0
            ZStack {
                Color.black.ignoresSafeArea()

                // Live-preview begrænset til 4:5, centreret. Alt uden for rammen er mørkt (fade).
                Group {
                    if cam.authorized {
                        FilmCameraPreview(camera: cam, onFocus: { vp in
                            // fokus sættes internt (normaliseret punkt) — her kun firkanten
                            focusPt = vp
                            focusSeq += 1
                            let s = focusSeq
                            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { if focusSeq == s { focusPt = nil } }
                        })
                        .frame(width: w, height: fh).clipped()
                        .overlay {
                            if let fp = focusPt {
                                RoundedRectangle(cornerRadius: 4).strokeBorder(Color.yellow, lineWidth: 1.5)
                                    .frame(width: 74, height: 74)
                                    .position(x: fp.x, y: fp.y)
                                    .allowsHitTesting(false)
                            }
                        }
                    } else {
                        deniedPanel.frame(width: w, height: fh)
                    }
                }
                .overlay(Rectangle().strokeBorder(Color.white.opacity(model.isStory ? 0 : 0.22), lineWidth: 1).frame(width: w, height: fh))
                // Minde: 4:5-rammen ligger ØVERST (under top-kontrollerne), så den ikke
                // rammer udløser-knappen og Minde/Story-vælgeren. Story: fuld skærm.
                .padding(.top, model.isStory ? 0 : 106)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: model.isStory ? .center : .top)
                .gesture(
                    MagnificationGesture()
                        .onChanged { scale in cam.setZoom(baseZoom * scale) }
                        .onEnded { _ in baseZoom = cam.zoomFactor }
                )

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

                    if cam.zoomFactor > 1.02 {
                        Text(String(format: "%.1fx", cam.zoomFactor))
                            .font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(Capsule().fill(Color.black.opacity(0.4)))
                            .padding(.bottom, 6)
                    }

                    // Hint tæt over knappen, på en mørk pille så den ikke flyder ud over billedet
                    if !cam.recording {
                        Text("Tryk for foto · hold for video")
                            .font(.system(size: 12, weight: .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 12).padding(.vertical, 5)
                            .background(Capsule().fill(Color.black.opacity(0.4)))
                            .padding(.bottom, 8)
                    }

                    HStack(alignment: .center) {
                        if model.forCompose {
                            Color.clear.frame(width: 48, height: 48)   // tanke: ingen galleri-genvej (bruger web-biblioteket)
                        } else {
                            Button { model.step = .gallery } label: { thumbView }
                        }
                        Spacer()
                        captureButton
                        Spacer()
                        iconButton("arrow.triangle.2.circlepath.camera") { cam.flip() }
                            .frame(width: 48, height: 48)
                    }
                    .padding(.horizontal, 26).padding(.bottom, 10)

                    // Minde/Story-vælgeren (Instagram-agtig, under udløseren)
                    if !model.forCompose {
                        HStack(spacing: 26) {
                            modeButton(model.modeMemoryLabel.isEmpty ? "Minde" : model.modeMemoryLabel, story: false)
                            modeButton(model.modeStoryLabel.isEmpty ? "Story" : model.modeStoryLabel, story: true)
                        }
                        .padding(.bottom, 16)
                    }
                }

                // Tanke-tilstand: kort upload-spinner mens det tagne medie uploades og hæftes på.
                if model.sharing {
                    Color.black.opacity(0.55).ignoresSafeArea()
                    ProgressView().tint(.white).scaleEffect(1.4)
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
