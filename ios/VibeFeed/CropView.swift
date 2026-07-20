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

                // Dim everything outside the crop frame (even-odd hole) + a thin frame line
                CropMaskShape(frame: frame, circular: circular, center: CGPoint(x: geo.size.width / 2, y: geo.size.height / 2))
                    .fill(Color.black.opacity(0.62), style: FillStyle(eoFill: true))
                    .allowsHitTesting(false)
                Group {
                    if circular {
                        Circle().stroke(Color.white.opacity(0.8), lineWidth: 1.5)
                            .frame(width: frame.width, height: frame.height)
                    } else {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .stroke(Color.white.opacity(0.8), lineWidth: 1.5)
                            .frame(width: frame.width, height: frame.height)
                    }
                }
                .position(x: geo.size.width / 2, y: geo.size.height / 2)
                .allowsHitTesting(false)

                VStack {
                    Text(title)
                        .font(.system(size: 16, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.top, 16)
                    Spacer()
                    HStack {
                        Button { onCancel() } label: {
                            Text(cancelLabel)
                                .font(.system(size: 16, weight: .semibold))
                                .foregroundStyle(.white)
                                .padding(.vertical, 12).padding(.horizontal, 22)
                                .background(Capsule().fill(Color.white.opacity(0.16)))
                        }
                        .buttonStyle(.plain)
                        Spacer()
                        Button { onDone(cropped(frame: frame, t: t, off: off)) } label: {
                            Text(useLabel)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.vertical, 12).padding(.horizontal, 26)
                                .background(Capsule().fill(vfRed))
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 22)
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
                            offset = CGSize(width: offsetAnchor.width + v.translation.width,
                                            height: offsetAnchor.height + v.translation.height)
                        }
                        .onEnded { _ in
                            offset = clampedOffset(offset, frame: frame, t: t)
                            offsetAnchor = offset
                        },
                    MagnificationGesture()
                        .onChanged { v in
                            zoom = min(5, max(1, zoomAnchor * v))
                        }
                        .onEnded { _ in
                            zoomAnchor = zoom
                            offset = clampedOffset(offset, frame: frame, t: coverScale(frame) * zoom)
                            offsetAnchor = offset
                        }
                )
            )
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
    private func frameSize(in size: CGSize) -> CGSize {
        let maxW = size.width - 32
        let maxH = size.height * 0.6
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
private struct CropMaskShape: Shape {
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
