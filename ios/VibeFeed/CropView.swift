import SwiftUI
import UIKit

/// Interactive crop step for the edit-profile page: pan and pinch-zoom the picked image
/// inside a fixed frame (circle for the avatar, wide 1280:432 for the banner), then confirm.
/// The CROPPED image is what gets staged and uploaded, so the web pipeline's center-crop
/// becomes a no-op (the staged image already has the right aspect). Labels come from the
/// web snapshot (i18n); the view itself is pure native-local UI.
struct VFCropView: View {
    let image: UIImage
    let aspect: CGFloat          // frame width / height (1 = avatar, 1280/432 = banner)
    let circular: Bool
    let targetSize: CGSize       // output-pixelmål (1024² avatar, 1280x432 banner, 1080x… minde)
    let title: String
    let cancelLabel: String
    let useLabel: String
    let onCancel: () -> Void
    let onDone: (UIImage) -> Void

    @State private var zoom: CGFloat = 1
    @State private var zoomAnchor: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var offsetAnchor: CGSize = .zero
    @State private var interacting = false

    var body: some View {
        GeometryReader { geo in
            let frame = frameSize(in: geo.size)
            let s0 = coverScale(frame)
            let t = s0 * zoom
            let off = clampedOffset(offset, frame: frame, t: t)
            ZStack {
                Color.black.ignoresSafeArea()

                Image(uiImage: image)
                    .resizable()
                    .frame(width: image.size.width * t, height: image.size.height * t)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
                    .offset(off)

                // Dæmpning udenfor + ramme + hjørne-markører + gitter (fælles pynt).
                CropChrome(frame: frame, circular: circular,
                           center: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2),
                           interacting: interacting)

                VStack {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.top, 16)
                    Spacer()
                    CropButtons(cancelLabel: cancelLabel, useLabel: useLabel,
                                onCancel: onCancel,
                                onUse: { onDone(cropped(frame: frame, t: t, off: off)) })
                        .padding(.bottom, 16)
                }
                .padding(.top, safeInsets.top)
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
                            offset = clampedOffset(offset, frame: frame, t: t)
                            offsetAnchor = offset
                            withAnimation(.easeOut(duration: 0.25)) { interacting = false }
                        },
                    MagnificationGesture()
                        .onChanged { v in
                            interacting = true
                            zoom = min(5, max(1, zoomAnchor * v))
                        }
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
    }

    private var safeInsets: UIEdgeInsets {
        (UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .keyWindow?.safeAreaInsets) ?? .zero
    }

    /// Crop frame centered on screen with side margins, honoring the target aspect.
    /// Større ramme end før (fylder mere af skærmen) for en bedre beskærings-oplevelse.
    private func frameSize(in size: CGSize) -> CGSize {
        let maxW = size.width - 24
        let maxH = size.height * 0.72
        var w = maxW
        var h = w / aspect
        if h > maxH { h = maxH; w = h * aspect }
        return CGSize(width: w, height: h)
    }

    /// Minimum scale so the image always covers the frame.
    private func coverScale(_ frame: CGSize) -> CGFloat {
        guard image.size.width > 0, image.size.height > 0 else { return 1 }
        return max(frame.width / image.size.width, frame.height / image.size.height)
    }

    /// Keep the image covering the frame — no gaps at any edge.
    private func clampedOffset(_ o: CGSize, frame: CGSize, t: CGFloat) -> CGSize {
        let maxX = max(0, (image.size.width * t - frame.width) / 2)
        let maxY = max(0, (image.size.height * t - frame.height) / 2)
        return CGSize(width: min(maxX, max(-maxX, o.width)),
                      height: min(maxY, max(-maxY, o.height)))
    }

    /// Render exactly the visible frame area to the target size (1024² avatar / 1280x432 banner).
    private func cropped(frame: CGSize, t: CGFloat, off: CGSize) -> UIImage {
        let visW = frame.width / t
        let visH = frame.height / t
        let cx = image.size.width / 2 - off.width / t
        let cy = image.size.height / 2 - off.height / t
        let vx = cx - visW / 2
        let vy = cy - visH / 2
        let target = targetSize
        let k = target.width / visW
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(x: -vx * k, y: -vy * k,
                                  width: image.size.width * k, height: image.size.height * k))
        }
    }
}

/// Full-screen dim with an even-odd "hole" where the crop frame sits.
// Ikke private: genbruges også af VFVideoCropView (VideoCropView.swift).
struct CropMaskShape: Shape {
    let frame: CGSize
    let circular: Bool
    let center: CGPoint

    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.addRect(rect)
        let hole = CGRect(x: center.x - frame.width / 2, y: center.y - frame.height / 2,
                          width: frame.width, height: frame.height)
        if circular { p.addEllipse(in: hole) }
        else { p.addRoundedRect(in: hole, cornerSize: CGSize(width: 4, height: 4)) }
        return p
    }
}

/// To lodrette + to vandrette linjer der deler rammen i tredjedele (kompositions-hjælp).
struct ThirdsGrid: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        for i in 1...2 {
            let x = rect.width * CGFloat(i) / 3
            p.move(to: CGPoint(x: x, y: 0)); p.addLine(to: CGPoint(x: x, y: rect.height))
            let y = rect.height * CGFloat(i) / 3
            p.move(to: CGPoint(x: 0, y: y)); p.addLine(to: CGPoint(x: rect.width, y: y))
        }
        return p
    }
}

/// L-formede hjørne-markører i rammens fire hjørner (kraftige, som en rigtig beskærer).
struct CropCorners: Shape {
    var len: CGFloat = 26
    func path(in rect: CGRect) -> Path {
        var p = Path()
        let L = min(len, min(rect.width, rect.height) / 3)
        // øverste venstre
        p.move(to: CGPoint(x: rect.minX, y: rect.minY + L)); p.addLine(to: CGPoint(x: rect.minX, y: rect.minY)); p.addLine(to: CGPoint(x: rect.minX + L, y: rect.minY))
        // øverste højre
        p.move(to: CGPoint(x: rect.maxX - L, y: rect.minY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + L))
        // nederste højre
        p.move(to: CGPoint(x: rect.maxX, y: rect.maxY - L)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY)); p.addLine(to: CGPoint(x: rect.maxX - L, y: rect.maxY))
        // nederste venstre
        p.move(to: CGPoint(x: rect.minX + L, y: rect.maxY)); p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY)); p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - L))
        return p
    }
}

/// Fælles beskærings-"pynt": blød dæmpning udenfor rammen, tynd ramme + kraftige hjørne-markører,
/// og et tredjedels-gitter der kun toner frem mens man trækker/knibzoomer. Bruges af både billed-
/// og video-beskæreren, så de ser ens ud.
struct CropChrome: View {
    let frame: CGSize
    let circular: Bool
    let center: CGPoint
    let interacting: Bool
    var body: some View {
        ZStack {
            CropMaskShape(frame: frame, circular: circular, center: center)
                .fill(Color.black.opacity(0.55), style: FillStyle(eoFill: true))
                .allowsHitTesting(false)
            Group {
                if circular {
                    Circle().stroke(Color.white.opacity(0.9), lineWidth: 2)
                        .frame(width: frame.width, height: frame.height)
                } else {
                    ZStack {
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(Color.white.opacity(0.4), lineWidth: 1)
                            .frame(width: frame.width, height: frame.height)
                        ThirdsGrid()
                            .stroke(Color.white.opacity(0.55), lineWidth: 0.75)
                            .frame(width: frame.width, height: frame.height)
                            .opacity(interacting ? 1 : 0)
                        CropCorners()
                            .stroke(Color.white, style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                            .frame(width: frame.width, height: frame.height)
                    }
                }
            }
            .position(center)
            .allowsHitTesting(false)
            .shadow(color: .black.opacity(0.3), radius: 3)
        }
    }
}

/// Fælles handlingslinje nederst i beskæreren: to fuldbredde-knapper (Annuller + brug).
struct CropButtons: View {
    let cancelLabel: String
    let useLabel: String
    let onCancel: () -> Void
    let onUse: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Button(action: onCancel) {
                Text(cancelLabel)
                    .font(.system(size: 16, weight: .semibold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 15)
                    .background(Capsule().fill(.ultraThinMaterial))
                    .overlay(Capsule().stroke(Color.white.opacity(0.16), lineWidth: 1))
            }.buttonStyle(.plain)
            Button(action: onUse) {
                Text(useLabel)
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    .frame(maxWidth: .infinity).padding(.vertical, 15)
                    .background(Capsule().fill(vfRed))
            }.buttonStyle(.plain)
        }
        .padding(.horizontal, 20)
    }
}
