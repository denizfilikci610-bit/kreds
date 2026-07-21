import SwiftUI
import AVFoundation

/// Custom Instagram-style video trimmer for memory videos. A looping AVPlayer preview on top, a
/// filmstrip of thumbnails below with a draggable fixed-width window (≤ 6 s). It writes the chosen
/// start time into PhotoLibModel; the composer exports that CMTimeRange on "Del" (see PhotoLibModel).
/// Shown only when the picked video is longer than the 6 s cap; shorter clips skip straight to caption.

let VF_MAX_VID: Double = 6.0

/// AVPlayerLayer host — SwiftUI's VideoPlayer can't precisely seek/loop a sub-range.
final class TrimPlayerUIView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}
struct TrimPlayerView: UIViewRepresentable {
    let player: AVPlayer
    func makeUIView(context: Context) -> TrimPlayerUIView {
        let v = TrimPlayerUIView()
        v.playerLayer.player = player
        v.playerLayer.videoGravity = .resizeAspect
        v.backgroundColor = .clear   // SwiftUI-baggrunden (tema-farven) skinner igennem
        return v
    }
    func updateUIView(_ v: TrimPlayerUIView, context: Context) { v.playerLayer.player = player }
}

/// Owns the AVPlayer and loops playback inside [start, start + duration].
final class TrimController: ObservableObject {
    let player: AVPlayer
    private var token: Any?
    private var start: Double = 0
    private var dur: Double = VF_MAX_VID
    private var seeking = false   // guards against a seek-storm at the loop boundary
    init(asset: AVAsset) {
        player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        player.isMuted = true
        token = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.05, preferredTimescale: 600), queue: .main) { [weak self] t in
            guard let self, !self.seeking else { return }
            if CMTimeGetSeconds(t) >= self.start + self.dur { self.seek() }
        }
        seek()
        player.play()
    }
    /// Move the trim window (seek to its start) WITHOUT changing the play/pause state.
    func setWindow(start: Double, dur: Double) { self.start = start; self.dur = dur; seek() }
    private func seek() {
        seeking = true
        player.seek(to: CMTime(seconds: start, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
            self?.seeking = false
        }
    }
    func play() { player.play() }
    func pause() { player.pause() }
    deinit { if let token { player.removeTimeObserver(token) }; player.pause() }
}

/// Filmstrip of evenly-spaced thumbnails across the whole video (a visual guide for the trim window).
struct FilmstripView: View {
    let asset: AVAsset
    let duration: Double
    @State private var thumbs: [UIImage] = []
    private let count = 8

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                if thumbs.isEmpty {
                    Color.secondary.opacity(0.15)
                } else {
                    ForEach(Array(thumbs.enumerated()), id: \.offset) { _, img in
                        Image(uiImage: img).resizable().scaledToFill()
                            .frame(width: geo.size.width / CGFloat(count), height: geo.size.height)
                            .clipped()
                    }
                }
            }
            .onAppear { generate(height: geo.size.height) }
        }
    }

    private func generate(height: CGFloat) {
        let asset = self.asset, count = self.count, duration = self.duration
        DispatchQueue.global(qos: .userInitiated).async {
            let gen = AVAssetImageGenerator(asset: asset)
            gen.appliesPreferredTrackTransform = true
            gen.maximumSize = CGSize(width: height * 3, height: height * 3)
            gen.requestedTimeToleranceBefore = .positiveInfinity
            gen.requestedTimeToleranceAfter = .positiveInfinity
            var out: [UIImage] = []
            for i in 0..<count {
                let sec = duration * (Double(i) + 0.5) / Double(count)
                if let cg = try? gen.copyCGImage(at: CMTime(seconds: sec, preferredTimescale: 600), actualTime: nil) {
                    out.append(UIImage(cgImage: cg))
                }
            }
            DispatchQueue.main.async { self.thumbs = out }
        }
    }
}

struct VideoTrimView: View {
    @ObservedObject private var model = PhotoLibModel.shared
    @StateObject private var controller: TrimController
    @State private var dragBase: Double? = nil

    init(asset: AVAsset) {
        _controller = StateObject(wrappedValue: TrimController(asset: asset))
    }

    var body: some View {
        VStack(spacing: 0) {
            TrimPlayerView(player: controller.player)
                .frame(maxWidth: .infinity)
                .frame(height: UIScreen.main.bounds.height * 0.44)
                .background(vfBackground)   // tema-farven i stedet for ren sort

            Spacer(minLength: 0)

            if !model.trimHint.isEmpty {
                Text(model.trimHint)
                    .font(.system(size: 13)).foregroundStyle(.secondary)
                    .padding(.bottom, 12)
            }

            if let asset = model.videoAsset {
                GeometryReader { geo in
                    let stripW = geo.size.width
                    let ratio = model.trimDuration / max(0.01, model.videoDuration)
                    let winW = min(stripW, stripW * CGFloat(ratio))
                    let travel = max(1, stripW - winW)                 // draggable range in points
                    let range = max(0.0001, model.videoDuration - model.trimDuration) // in seconds
                    let x = CGFloat(model.trimStart / range) * (stripW - winW)
                    ZStack(alignment: .leading) {
                        FilmstripView(asset: asset, duration: model.videoDuration)
                            .frame(height: 56)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        // The chosen window: bright border + rounded, over the dimmed strip
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.white, lineWidth: 3)
                            .background(RoundedRectangle(cornerRadius: 8).fill(Color.white.opacity(0.001)))
                            .frame(width: winW, height: 56)
                            .offset(x: x)
                            .gesture(
                                DragGesture()
                                    .onChanged { v in
                                        let base = dragBase ?? model.trimStart
                                        if dragBase == nil { dragBase = base; controller.pause() } // freeze on the frame while scrubbing
                                        let dxSec = Double(v.translation.width / travel) * range
                                        model.trimStart = min(range, max(0, base + dxSec))
                                        controller.setWindow(start: model.trimStart, dur: model.trimDuration)
                                    }
                                    .onEnded { _ in dragBase = nil; controller.play() } // resume the looping preview
                            )
                    }
                }
                .frame(height: 56)
                .padding(.horizontal, 16)
            }

            Spacer(minLength: 0)
        }
        .onAppear { controller.setWindow(start: model.trimStart, dur: model.trimDuration) }
        .onDisappear { controller.pause() }
    }
}
