import SwiftUI
import PhotosUI
import UIKit

/// Native "Rediger profil" — a FULL-SCREEN page (Instagram-style: centered avatar with a
/// "change picture" link, label/value form rows, sections below) that slides in from the
/// right with the app's standard back chevron and swipe-right-to-go-back. Still a staged
/// form: name, bio, share, language, ad-consent and a picked photo are all held natively
/// and committed together on Save in the header (the owner chose "Save = everything").
/// The web owns every mutation: it uploads the staged avatar, updates the profile, applies
/// setLang/setConsent, and runs the (unchanged) account-delete sequence. Native only
/// renders, collects input, and reports actions. Browser keeps the CSS #esheet sheet.

final class EsheetModel: ObservableObject {
    static let shared = EsheetModel()

    @Published var open = false
    @Published var token = 0

    // Pushed labels (all i18n from the web)
    @Published var title = ""
    @Published var picLabel = ""
    @Published var nameLabel = ""
    @Published var namePlaceholder = ""
    @Published var handleLabel = ""
    @Published var handle = ""          // read-only (Brugernavn) — vises, kan ikke ændres
    @Published var bioLabel = ""
    @Published var bioPlaceholder = ""
    @Published var activityLabel = ""
    @Published var shareLabel = ""
    @Published var shareNote = ""
    @Published var langLabel = ""
    @Published var langDaLabel = ""
    @Published var langs: [[String]] = []     // [[kode, eget navn]] — alle appens sprog (fra web)
    @Published var langEnLabel = ""
    @Published var privacyLabel = ""
    @Published var adsPersonalLabel = ""
    @Published var adsLimitedLabel = ""
    @Published var policyLabel = ""
    var policyUrl = "" // sat af apply(); ikke UI-bundet
    @Published var saveLabel = ""
    @Published var useLabel = ""       // "Brug"-knappen i beskærings-fladen
    @Published var deleteOpenLabel = ""
    @Published var delSure = ""
    @Published var delText = ""
    @Published var delBtn = ""
    @Published var cancelLabel = ""
    @Published var nameMaxLength = 40
    @Published var bioMaxLength = 160

    // Pushed avatar (current)
    @Published var avatarUrl = ""
    @Published var avatarInitials = "?"
    @Published var avatarGradient: [String] = []

    // Banner (YouTube-agtigt, valgfrit)
    @Published var bannerLabel = ""
    @Published var bannerUrl = ""              // current banner ("" = none)
    @Published var pickedBanner: UIImage?      // preview of a newly-picked banner (uploaded on Save)

    // Native-local staged state
    @Published var name = ""
    @Published var bio = ""
    @Published var share = true
    @Published var lang = "da"
    @Published var consent = "personal"
    @Published var pickedAvatar: UIImage?      // preview of a newly-picked photo (uploaded on Save)
    @Published var saving = false
    @Published var deleting = false
    @Published var deleteStep = false

    var onAction: ((String) -> Void)?          // JSON object literal → window.vfEsheet
    var onAvatar: ((String) -> Void)?          // data URL → window.vfAvatar (stages it in the web)
    var onBanner: ((String) -> Void)?          // data URL → window.vfBanner (stages it in the web)

    var canSave: Bool { !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func apply(_ dict: [String: Any]) {
        if (dict["close"] as? Bool) == true { open = false; deleteStep = false; return }
        if (dict["update"] as? Bool) == true {
            if let s = dict["saving"] as? Bool { saving = s }
            if let d = dict["deleting"] as? Bool { deleting = d }
            if let a = dict["avatar"] as? [String: Any] { applyAvatar(a); pickedAvatar = nil }
            return
        }
        guard (dict["open"] as? Bool) == true else { return }
        token = (dict["token"] as? Int) ?? token + 1
        title = str(dict, "title"); picLabel = str(dict, "picLabel")
        nameLabel = str(dict, "nameLabel"); namePlaceholder = str(dict, "namePlaceholder")
        handleLabel = str(dict, "handleLabel"); handle = str(dict, "handle")
        bannerLabel = str(dict, "bannerLabel"); bannerUrl = str(dict, "bannerUrl"); pickedBanner = nil
        bioLabel = str(dict, "bioLabel"); bioPlaceholder = str(dict, "bioPlaceholder")
        activityLabel = str(dict, "activityLabel"); shareLabel = str(dict, "shareLabel"); shareNote = str(dict, "shareNote")
        langLabel = str(dict, "langLabel"); langDaLabel = str(dict, "langDaLabel"); langEnLabel = str(dict, "langEnLabel")
        if let ls = dict["langs"] as? [[String]] { langs = ls } // fuld sprogliste (32) fra web → Menu-picker
        privacyLabel = str(dict, "privacyLabel"); adsPersonalLabel = str(dict, "adsPersonalLabel")
        adsLimitedLabel = str(dict, "adsLimitedLabel"); policyLabel = str(dict, "policyLabel")
        policyUrl = str(dict, "policyUrl") // absolut URL fra web (sprogafhængig); tom på ældre web → fallback
        saveLabel = str(dict, "saveLabel"); deleteOpenLabel = str(dict, "deleteOpenLabel")
        useLabel = str(dict, "useLabel").isEmpty ? "OK" : str(dict, "useLabel") // ældre web → fallback
        delSure = str(dict, "delSure"); delText = str(dict, "delText"); delBtn = str(dict, "delBtn"); cancelLabel = str(dict, "cancelLabel")
        nameMaxLength = (dict["nameMaxLength"] as? Int) ?? 40
        bioMaxLength = (dict["bioMaxLength"] as? Int) ?? 160
        applyAvatar(dict["avatar"] as? [String: Any] ?? [:])
        name = str(dict, "name"); bio = str(dict, "bio")
        share = (dict["share"] as? Bool) ?? true
        lang = str(dict, "lang").isEmpty ? "da" : str(dict, "lang")
        consent = str(dict, "consent").isEmpty ? "personal" : str(dict, "consent")
        pickedAvatar = nil; saving = false; deleting = false; deleteStep = false
        open = true
    }

    private func applyAvatar(_ a: [String: Any]) {
        avatarUrl = a["avatarUrl"] as? String ?? avatarUrl
        avatarInitials = a["initials"] as? String ?? avatarInitials
        avatarGradient = a["gradient"] as? [String] ?? avatarGradient
    }
    private func str(_ d: [String: Any], _ k: String) -> String { d[k] as? String ?? "" }

    // MARK: actions
    func save() {
        guard canSave, !saving else { return }
        saving = true
        send(["kind": "save",
              "name": name.trimmingCharacters(in: .whitespacesAndNewlines),
              "bio": bio, "share": share, "lang": lang, "consent": consent])
    }
    func dismiss() { send(["kind": "dismiss"]) }
    func chooseLang(_ v: String) { lang = v }
    func chooseConsent(_ v: String) { consent = v }
    /// Åbner privatlivspolitikken i i-app-browseren OVENPÅ siden — brugeren bliver i
    /// appen, og de stagede ændringer består. (window.open over broen blokeres af WKWebView,
    /// og en navigation væk fra index.html ville dræbe SPA'en under siden.)
    func openPolicy() {
        let s = policyUrl.isEmpty ? "https://vibefeed.dk/privatliv.html" : policyUrl
        if let url = URL(string: s) { InAppBrowser.present(url) }
    }
    func confirmDelete() { guard !deleting else { return }; deleting = true; send(["kind": "delete"]) }

    func stagePickedImage(_ image: UIImage, dataURL: String) {
        pickedAvatar = image
        onAvatar?(dataURL)
    }

    func stagePickedBanner(_ image: UIImage, dataURL: String) {
        pickedBanner = image
        onBanner?(dataURL)
    }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        onAction?(s)
    }
}

/// Downscale a picked image so the crop view and renderer work on a manageable size.
func vfDownscaled(_ image: UIImage, maxEdge: CGFloat) -> UIImage {
    let w = image.size.width, h = image.size.height
    guard w > 0, h > 0, max(w, h) > maxEdge else { return image }
    let scale = maxEdge / max(w, h)
    let size = CGSize(width: w * scale, height: h * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    return UIGraphicsImageRenderer(size: size, format: format).image { _ in
        image.draw(in: CGRect(origin: .zero, size: size))
    }
}

/// Scale a picked image to a data URL small enough to cross the JS bridge (the web re-crops to 512²).
func vfImageDataURL(_ image: UIImage, maxEdge: CGFloat = 1024, quality: CGFloat = 0.82) -> String? {
    let w = image.size.width, h = image.size.height
    guard w > 0, h > 0 else { return nil }
    let scale = min(1, maxEdge / max(w, h))
    let size = CGSize(width: w * scale, height: h * scale)
    let scaled = UIGraphicsImageRenderer(size: size).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
    guard let data = scaled.jpegData(compressionQuality: quality) else { return nil }
    return "data:image/jpeg;base64," + data.base64EncodedString()
}

struct EditProfilePage: View {
    @ObservedObject private var model = EsheetModel.shared
    @State private var pickerItem: PhotosPickerItem?
    @State private var bannerItem: PhotosPickerItem?
    @State private var cropImage: UIImage? = nil   // valgt billede der afventer beskæring
    @State private var cropIsBanner = false
    @State private var slet = ""
    @FocusState private var nameFocused: Bool
    @State private var dragX: CGFloat = 0
    @State private var dragging = false

    private let hairline = Color.primary.opacity(0.1)

    /// Real top inset from the key window (the page ignores the container safe area,
    /// mirroring PostPageView).
    private var topInset: CGFloat {
        (UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive }?
            .keyWindow?.safeAreaInsets.top) ?? 0
    }

    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                header
                if model.deleteStep { deleteConfirm } else { form }
            }
            // Beskærings-trin: vælg selv hvilket udsnit af billedet der bruges
            if let ci = cropImage {
                VFCropView(
                    image: ci,
                    aspect: cropIsBanner ? 1280.0 / 432.0 : 1,
                    circular: !cropIsBanner,
                    targetSize: cropIsBanner ? CGSize(width: 1280, height: 432) : CGSize(width: 1024, height: 1024),
                    title: cropIsBanner ? model.bannerLabel : model.picLabel,
                    cancelLabel: model.cancelLabel,
                    useLabel: model.useLabel,
                    onCancel: { cropImage = nil; pickerItem = nil; bannerItem = nil },
                    onDone: { cropped in
                        if cropIsBanner {
                            if let dataURL = vfImageDataURL(cropped, maxEdge: 1600) {
                                model.stagePickedBanner(cropped, dataURL: dataURL)
                            }
                        } else if let dataURL = vfImageDataURL(cropped) {
                            model.stagePickedImage(cropped, dataURL: dataURL)
                        }
                        cropImage = nil; pickerItem = nil; bannerItem = nil
                    }
                )
                .transition(.opacity)
            }
        }
        .background(vfBackground)
        .ignoresSafeArea(.container) // kun skærm-kanterne — tastaturet skubber stadig felterne op
        .offset(x: max(0, dragX))
        // Swipe mod højre hvor som helst → tilbage (samme gestus som opslags-siden).
        // Deaktiveret mens beskærings-trinnet er åbent — dér panorerer trækket billedet.
        .simultaneousGesture(
            DragGesture(minimumDistance: 18)
                .onChanged { v in
                    guard cropImage == nil else { return }
                    let w = v.translation.width, h = v.translation.height
                    if dragging || (w > 0 && abs(w) > abs(h) * 1.4) {
                        dragging = true
                        dragX = max(0, w)
                    }
                }
                .onEnded { v in
                    guard cropImage == nil else { dragging = false; return }
                    let flick = v.predictedEndTranslation.width > 240
                    if dragging && (dragX > 90 || flick) {
                        withAnimation(.easeOut(duration: 0.2)) { dragX = UIScreen.main.bounds.width }
                        if model.deleteStep { model.deleteStep = false; dragX = 0 } else { model.dismiss() }
                    } else {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.85)) { dragX = 0 }
                    }
                    dragging = false
                }
        )
        .onAppear { dragX = 0; dragging = false; cropImage = nil }
        .onChange(of: pickerItem) { _, item in loadPicked(item) }
        .onChange(of: bannerItem) { _, item in loadPickedBanner(item) }
    }

    // MARK: - Header (standard back chevron + centered bold title + Gem til højre)

    private var header: some View {
        ZStack {
            Text(model.deleteStep ? model.delSure : model.title)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(Color.primary)
                .lineLimit(1)
                .padding(.horizontal, 84)
            HStack {
                Button {
                    if model.deleteStep { model.deleteStep = false } else { model.dismiss() }
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(Color.primary)
                        .padding(6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                Spacer()
                if !model.deleteStep {
                    Button { nameFocused = false; model.save() } label: {
                        ZStack {
                            Text(model.saveLabel)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(vfRed)
                                .opacity(model.saving ? 0 : 1)
                            if model.saving { ProgressView().tint(vfRed) }
                        }
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(!model.canSave || model.saving)
                    .opacity(model.canSave ? 1 : 0.45)
                }
            }
            .padding(.horizontal, 12)
        }
        .frame(height: 52)
        .padding(.top, topInset)
        .overlay(alignment: .bottom) { Rectangle().fill(hairline).frame(height: 0.5) }
    }

    // MARK: - Form (Instagram-agtigt: centreret avatar + link, label/værdi-rækker, sektioner)

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                avatarBlock
                Rectangle().fill(hairline).frame(height: 0.5)
                formRow(model.nameLabel) {
                    TextField(model.namePlaceholder, text: $model.name)
                        .focused($nameFocused)
                        .font(.system(size: 16))
                        .onChange(of: model.name) { _, v in if v.count > model.nameMaxLength { model.name = String(v.prefix(model.nameMaxLength)) } }
                }
                if !model.handle.isEmpty {
                    formRow(model.handleLabel) {
                        // Brugernavnet kan ikke ændres (mentions/venskaber peger på det)
                        Text(model.handle)
                            .font(.system(size: 16))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                formRow(model.bioLabel, lastRow: true) {
                    TextField(model.bioPlaceholder, text: $model.bio, axis: .vertical)
                        .font(.system(size: 16))
                        .lineLimit(1...5)
                        .onChange(of: model.bio) { _, v in if v.count > model.bioMaxLength { model.bio = String(v.prefix(model.bioMaxLength)) } }
                }
                Rectangle().fill(hairline).frame(height: 0.5)

                // Del min aktivitet (toggle-række som IG's etiket-række)
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(model.shareLabel).font(.system(size: 16)).foregroundStyle(Color.primary)
                        Text(model.shareNote).font(.system(size: 12.5)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 14)
                    Toggle("", isOn: $model.share).labelsHidden().tint(vfRed)
                }
                .padding(.horizontal, 16).padding(.vertical, 13)
                Rectangle().fill(hairline).frame(height: 0.5)

                sectionLabel(model.langLabel)
                if model.langs.count > 2 {
                    // Alle 32 sprog: native Menu-picker (viser det aktive sprogs eget navn)
                    Menu {
                        ForEach(model.langs, id: \.first) { pair in
                            Button(pair.count > 1 ? pair[1] : pair[0]) { model.chooseLang(pair[0]) }
                        }
                    } label: {
                        HStack {
                            Text(model.langs.first(where: { $0.first == model.lang }).map { $0.count > 1 ? $0[1] : $0[0] } ?? model.lang)
                                .font(.system(size: 14, weight: .bold))
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                        .padding(.horizontal, 14).padding(.vertical, 12)
                        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.primary.opacity(0.06)))
                        .padding(.horizontal, 16)
                    }
                    .buttonStyle(.plain)
                } else {
                    segments([("da", model.langDaLabel), ("en", model.langEnLabel)], selected: model.lang) { model.chooseLang($0) }
                }
                sectionLabel(model.privacyLabel)
                segments([("personal", model.adsPersonalLabel), ("limited", model.adsLimitedLabel)], selected: model.consent) { model.chooseConsent($0) }
                Button { model.openPolicy() } label: {
                    Text(model.policyLabel).font(.system(size: 13, weight: .semibold)).underline()
                        .foregroundStyle(.secondary).padding(.horizontal, 16).padding(.top, 14)
                }.buttonStyle(.plain)

                Rectangle().fill(hairline).frame(height: 0.5).padding(.top, 18)
                Button { model.deleteStep = true; slet = "" } label: {
                    Text(model.deleteOpenLabel)
                        .font(.system(size: 16, weight: .semibold)).foregroundStyle(vfRed)
                        .padding(.horizontal, 16).padding(.vertical, 14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }.buttonStyle(.plain)
            }
            .padding(.bottom, 30)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var avatarBlock: some View {
        VStack(spacing: 12) {
            // Banner (YouTube-agtigt) — tap på fladen eller linket vælger et nyt
            PhotosPicker(selection: $bannerItem, matching: .images) {
                ZStack {
                    Group {
                        if let img = model.pickedBanner {
                            Image(uiImage: img).resizable().scaledToFill()
                        } else if !model.bannerUrl.isEmpty, let u = URL(string: model.bannerUrl) {
                            AsyncImage(url: u) { img in img.resizable().scaledToFill() } placeholder: { Color.primary.opacity(0.06) }
                        } else {
                            Color.primary.opacity(0.06)
                        }
                    }
                    if model.pickedBanner == nil && model.bannerUrl.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: "photo")
                                .font(.system(size: 14, weight: .semibold))
                            Text(model.bannerLabel)
                                .font(.system(size: 13, weight: .semibold))
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                .frame(height: 92)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .padding(.horizontal, 16)
            }
            PhotosPicker(selection: $bannerItem, matching: .images) {
                Text(model.bannerLabel).font(.system(size: 14, weight: .bold)).foregroundStyle(vfRed)
            }
            PhotosPicker(selection: $pickerItem, matching: .images) {
                Group {
                    if let img = model.pickedAvatar {
                        Image(uiImage: img).resizable().scaledToFill()
                    } else {
                        GlassAvatar(url: model.avatarUrl, initials: model.avatarInitials, gradient: model.avatarGradient, size: 96)
                    }
                }
                .frame(width: 96, height: 96).clipShape(Circle())
                .padding(.top, 8)
            }
            PhotosPicker(selection: $pickerItem, matching: .images) {
                Text(model.picLabel).font(.system(size: 15, weight: .bold)).foregroundStyle(vfRed)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 14)
        .padding(.bottom, 22)
    }

    /// IG-agtig række: label i fast venstre kolonne, værdi/felt til højre, hårstreg under
    private func formRow<V: View>(_ label: String, lastRow: Bool = false, @ViewBuilder _ content: () -> V) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(label)
                .font(.system(size: 16))
                .foregroundStyle(Color.primary)
                .frame(width: 108, alignment: .leading)
            VStack(alignment: .leading, spacing: 0) {
                content()
                    .padding(.bottom, 12)
                if !lastRow { Rectangle().fill(hairline).frame(height: 0.5) }
            }
        }
        .padding(.leading, 16)
        .padding(.top, 13)
        .padding(.trailing, 16)
    }

    // MARK: - delete confirm (uændret to-trins SLET-flow, nu som side-indhold)
    private var deleteConfirm: some View {
        VStack(spacing: 12) {
            Text(model.delText).font(.system(size: 14)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 20)
            TextField("SLET", text: $slet)
                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                .multilineTextAlignment(.center).font(.system(size: 17, weight: .bold))
                .padding(.horizontal, 16).padding(.vertical, 13)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.primary.opacity(0.06)))
                .padding(.horizontal, 24)
            Button { model.confirmDelete() } label: {
                ZStack {
                    Text(model.delBtn).font(.system(size: 15, weight: .bold)).foregroundStyle(.white).opacity(model.deleting ? 0 : 1)
                    if model.deleting { ProgressView().tint(.white) }
                }
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(vfRed))
                .opacity(slet.trimmingCharacters(in: .whitespaces) == "SLET" && !model.deleting ? 1 : 0.45)
            }
            .buttonStyle(.plain)
            .disabled(slet.trimmingCharacters(in: .whitespaces) != "SLET" || model.deleting)
            .padding(.horizontal, 16)
            Button { model.deleteStep = false } label: {
                Text(model.cancelLabel).font(.system(size: 14, weight: .semibold)).foregroundStyle(.secondary).padding(.vertical, 4)
            }.buttonStyle(.plain)
            Spacer()
        }
        .padding(.top, 24)
    }

    // MARK: helpers
    private func sectionLabel(_ s: String) -> some View {
        Text(s.uppercased()).font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary).kerning(0.4)
            .padding(.leading, 16).padding(.top, 18).padding(.bottom, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func segments(_ opts: [(String, String)], selected: String, _ pick: @escaping (String) -> Void) -> some View {
        HStack(spacing: 8) {
            ForEach(opts, id: \.0) { value, label in
                let on = selected == value
                Button { pick(value) } label: {
                    Text(label).font(.system(size: 14, weight: .bold))
                        .foregroundStyle(on ? vfBackground : Color.primary)
                        .frame(maxWidth: .infinity).padding(.vertical, 11)
                        .background(
                            Group {
                                if on { RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Color.primary) }
                                else { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Color.primary.opacity(0.18), lineWidth: 1.5) }
                            }
                        )
                }.buttonStyle(.plain)
            }
        }.padding(.horizontal, 16)
    }

    /// Valgt foto → beskærings-trinnet (nedskaleret til håndterbar størrelse først).
    /// Selve stagingen sker i onDone med det FÆRDIGT beskårne billede.
    private func loadPicked(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                let small = vfDownscaled(img, maxEdge: 2400)
                await MainActor.run { cropIsBanner = false; cropImage = small }
            }
        }
    }

    private func loadPickedBanner(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data) {
                let small = vfDownscaled(img, maxEdge: 2400)
                await MainActor.run { cropIsBanner = true; cropImage = small }
            }
        }
    }
}

/// Overlays the full-screen edit-profile page on the host view when open (slides in from
/// the right like the post page / web profile pages).
struct EsheetHost: ViewModifier {
    @ObservedObject private var model = EsheetModel.shared
    func body(content: Content) -> some View {
        ZStack {
            content
            if model.open {
                EditProfilePage()
                    .transition(.move(edge: .trailing))
            }
        }
        .animation(.spring(response: 0.34, dampingFraction: 0.88), value: model.open)
    }
}
