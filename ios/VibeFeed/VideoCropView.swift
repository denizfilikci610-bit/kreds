import SwiftUI
import AVFoundation
import UIKit

/// Interaktiv beskærer for VIDEO — samme træk/knib-oplevelse som billed-beskæreren (VFCropView),
/// men indholdet er en live, loopende video. Brugeren panorerer/zoomer inde i en fast ramme
/// (1:1 / 4:5 / landscape) og bekræfter. onDone leverer et NORMALISERET udsnit (0-1, top-venstre,
/// i det OPRETTE video-rum), som eksporten (PhotoLibModel.exportTrimmedVideo) beskærer efter.
///
/// orientedSize = videosporets naturlige størrelse EFTER preferredTransform (altså som den vises
/// oprejst) — det matcher req.sourceImage.extent i video-compositionen, så udsnittet passer 1:1.

struct VFVideoCropView: View {
    let asset: AVAsset
    let trimStart: Double
    let trimDuration: Double
    let orientedSize: CGSize     // videoens oprejste pixel-størrelse (W×H)
    let aspect: CGFloat          // rammens bredde/højde (1 / 0.8 / 1.908)
    let cancelLabel: String
    let useLabel: String
    let onCancel: () -> Void
    let onDone: (CGRect) -> Void // normaliseret udsnit (0-1, top-venstre)

    @StateObject private var loop: LoopPlayer
    @State private var zoom: CGFloat = 1
    @State private var zoomAnchor: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var offsetAnchor: CGSize = .zero
    @State private var interacting = false

    init(asset: AVAsset, trimStart: Double, trimDuration: Double, orientedSize: CGSize,
         aspect: CGFloat, cancelLabel: String, useLabel: String,
         onCancel: @escaping () -> Void, onDone: @escaping (CGRect) -> Void) {
        self.asset = asset; self.trimStart = trimStart; self.trimDuration = trimDuration
        self.orientedSize = orientedSize; self.aspect = aspect
        self.cancelLabel = cancelLabel; self.useLabel = useLabel
        self.onCancel = onCancel; self.onDone = onDone
        _loop = StateObject(wrappedValue: LoopPlayer(asset: asset, start: trimStart, dur: trimDuration))
    }

    private var vidSize: CGSize {
        (orientedSize.width > 0 && orientedSize.height > 0) ? orientedSize : CGSize(width: 1080, height: 1080)
    }

    var body: some View {
        GeometryReader { geo in
            let frame = frameSize(in: geo.size)
            let s0 = coverScale(frame)
            let t = s0 * zoom
            let off = clampedOffset(offset, frame: frame, t: t)
            ZStack {
                Color.black.ignoresSafeArea()

                // Videoen KLIPPES til rammen, så man kun ser den inde i det valgte layout
                // (sort udenfor) og panorerer indenfor — ligesom billed-beskæreren.
                VideoLayerView(player: loop.player)
                    .frame(width: vidSize.width * t, height: vidSize.height * t)
                    .offset(off)
                    .frame(width: frame.width, height: frame.height)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
                    .allowsHitTesting(false)

                // Dæmpning udenfor + ramme + hjørne-markører + gitter (samme pynt som billed-beskæreren).
                CropChrome(frame: frame, circular: false,
                           center: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2),
                           interacting: interacting)

                VStack {
                    Spacer()
                    CropButtons(cancelLabel: cancelLabel, useLabel: useLabel,
                                onCancel: onCancel,
                                onUse: { onDone(normalizedCrop(frame: frame, t: t, off: off)) })
                        .padding(.bottom, 16)
                }
                .padding(.bottom, safeInsets.bottom)
            }
            .contentShape(Rectangle())
            .gesture(
                SimultaneousGesture(
                    DragGesture()
                        .onChanged { v in
                            interacting = true
                            offset = CGSize(width: offsetAnchor.width + v.translation.width,
                                            height: offsetAnchor.height + v.translation.height)
                        }
                        .onEnded { _ in
                            offset = clampedOffset(offset, frame: frame, t: t); offsetAnchor = offset
                            withAnimation(.easeOut(duration: 0.25)) { interacting = false }
                        },
                    MagnificationGesture()
                        .onChanged { v in interacting = true; zoom = min(5, max(1, zoomAnchor * v)) }
                        .onEnded { _ in
                            zoomAnchor = zoom
                            offset = clampedOffset(offset, frame: frame, t: coverScale(frame) * zoom)
                            offsetAnchor = offset
                            withAnimation(.easeOut(duration: 0.25)) { interacting = false }
                        }
                )
            )
            // Dobbelt-tryk zoomer ind/ud (touch-venligt, som Fotos).
            .onTapGesture(count: 2) {
                withAnimation(.easeInOut(duration: 0.25)) {
                    if zoom > 1.01 { zoom = 1 } else { zoom = 2 }
                    zoomAnchor = zoom
                    offset = .zero
                    offsetAnchor = .zero
                }
            }
        }
        .ignoresSafeArea()
        .onDisappear { loop.stop() }
    }

    private var safeInsets: UIEdgeInsets {
        (UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?.keyWindow?.safeAreaInsets) ?? .zero
    }

    private func frameSize(in size: CGSize) -> CGSize {
        let maxW = size.width - 24
        let maxH = size.height * 0.72
        var w = maxW
        var h = w / aspect
        if h > maxH { h = maxH; w = h * aspect }
        return CGSize(width: w, height: h)
    }
    private func coverScale(_ frame: CGSize) -> CGFloat {
        guard vidSize.width > 0, vidSize.height > 0 else { return 1 }
        return max(frame.width / vidSize.width, frame.height / vidSize.height)
    }
    private func clampedOffset(_ o: CGSize, frame: CGSize, t: CGFloat) -> CGSize {
        let maxX = max(0, (vidSize.width * t - frame.width) / 2)
        let maxY = max(0, (vidSize.height * t - frame.height) / 2)
        return CGSize(width: min(maxX, max(-maxX, o.width)), height: min(maxY, max(-maxY, o.height)))
    }
    /// Det synlige udsnit i normaliserede oprejste video-koordinater (0-1, top-venstre).
    private func normalizedCrop(frame: CGSize, t: CGFloat, off: CGSize) -> CGRect {
        let W = vidSize.width, H = vidSize.height
        let visW = frame.width / t
        let visH = frame.height / t
        let cx = W / 2 - off.width / t
        let cy = H / 2 - off.height / t
        var x = (cx - visW / 2) / W
        var y = (cy - visH / 2) / H
        var w = visW / W
        var h = visH / H
        // clamp inden for [0,1] (afrundings-sikkerhed)
        w = min(1, max(0.01, w)); h = min(1, max(0.01, h))
        x = min(1 - w, max(0, x)); y = min(1 - h, max(0, y))
        return CGRect(x: x, y: y, width: w, height: h)
    }
}

/// AVPlayerLayer-vært med .resize (rammen har videoens præcise aspekt, så intet strækkes forkert).
struct VideoLayerView: UIViewRepresentable {
    let player: AVPlayer
    func makeUIView(context: Context) -> PLayerBox { let v = PLayerBox(); v.playerLayer.player = player; return v }
    func updateUIView(_ v: PLayerBox, context: Context) { v.playerLayer.player = player }
    final class PLayerBox: UIView {
        override class var layerClass: AnyClass { AVPlayerLayer.self }
        var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
        override init(frame: CGRect) { super.init(frame: frame); playerLayer.videoGravity = .resize; backgroundColor = .black }
        required init?(coder: NSCoder) { fatalError() }
    }
}

/// Loopende afspiller af [start, start+dur] — muted (beskærings-trin, ikke afspilning).
final class LoopPlayer: ObservableObject {
    let player: AVPlayer
    private var token: Any?
    private let start: Double
    private let dur: Double
    private var seeking = false
    init(asset: AVAsset, start: Double, dur: Double) {
        self.start = start; self.dur = dur
        player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        player.isMuted = true
        token = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.05, preferredTimescale: 600), queue: .main) { [weak self] tm in
            guard let self, !self.seeking else { return }
            if CMTimeGetSeconds(tm) >= self.start + self.dur - 0.02 { self.seek() }
        }
        seek(); player.play()
    }
    private func seek() {
        seeking = true
        player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in self?.seeking = false }
    }
    func stop() { player.pause(); if let token { player.removeTimeObserver(token); self.token = nil } }
    deinit { stop() }
}
