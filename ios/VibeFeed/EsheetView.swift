import SwiftUI
import PhotosUI
import UIKit

/// Native Liquid Glass "Rediger profil" (edit profile) bottom sheet. A staged form: name, bio, share,
/// language, ad-consent and a picked photo are all held natively and committed together on Save (the
/// owner chose "Save = everything"). The web owns every mutation: it uploads the staged avatar, updates
/// the profile, applies setLang/setConsent, and runs the (unchanged) account-delete sequence. Native
/// only renders glass, collects input, and reports actions. Browser keeps the CSS #esheet.

final class EsheetModel: ObservableObject {
    static let shared = EsheetModel()

    @Published var open = false
    @Published var token = 0

    // Pushed labels (all i18n from the web)
    @Published var title = ""
    @Published var picLabel = ""
    @Published var nameLabel = ""
    @Published var namePlaceholder = ""
    @Published var bioLabel = ""
    @Published var bioPlaceholder = ""
    @Published var activityLabel = ""
    @Published var shareLabel = ""
    @Published var shareNote = ""
    @Published var langLabel = ""
    @Published var langDaLabel = ""
    @Published var langEnLabel = ""
    @Published var privacyLabel = ""
    @Published var adsPersonalLabel = ""
    @Published var adsLimitedLabel = ""
    @Published var policyLabel = ""
    var policyUrl = "" // sat af apply(); ikke UI-bundet
    @Published var saveLabel = ""
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
        bioLabel = str(dict, "bioLabel"); bioPlaceholder = str(dict, "bioPlaceholder")
        activityLabel = str(dict, "activityLabel"); shareLabel = str(dict, "shareLabel"); shareNote = str(dict, "shareNote")
        langLabel = str(dict, "langLabel"); langDaLabel = str(dict, "langDaLabel"); langEnLabel = str(dict, "langEnLabel")
        privacyLabel = str(dict, "privacyLabel"); adsPersonalLabel = str(dict, "adsPersonalLabel")
        adsLimitedLabel = str(dict, "adsLimitedLabel"); policyLabel = str(dict, "policyLabel")
        policyUrl = str(dict, "policyUrl") // absolut URL fra web (sprogafhængig); tom på ældre web → fallback
        saveLabel = str(dict, "saveLabel"); deleteOpenLabel = str(dict, "deleteOpenLabel")
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
    /// Åbner privatlivspolitikken i Safari OVENPÅ appen — sheetet (og de stagede ændringer)
    /// bliver stående. Den gamle vej ({kind:"policy"} → web window.open) var dobbelt defekt:
    /// WKWebView blokerer window.open uden side-gestus, og en navigation væk fra index.html
    /// ville dræbe SPA'en under sheetet (frosne native barer, fastlåst scrim).
    func openPolicy() {
        let s = policyUrl.isEmpty ? "https://vibefeed.dk/privatliv.html" : policyUrl
        if let url = URL(string: s) { UIApplication.shared.open(url) }
    }
    func confirmDelete() { guard !deleting else { return }; deleting = true; send(["kind": "delete"]) }

    func stagePickedImage(_ image: UIImage, dataURL: String) {
        pickedAvatar = image
        onAvatar?(dataURL)
    }

    private func send(_ obj: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else { return }
        onAction?(s)
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

struct GlassEditProfileSheet: View {
    @ObservedObject private var model = EsheetModel.shared
    @State private var pickerItem: PhotosPickerItem?
    @State private var slet = ""
    @FocusState private var nameFocused: Bool

    var body: some View {
        GlassBottomSheet(onDismiss: { if model.deleteStep { model.deleteStep = false } else { model.dismiss() } }) {
            VStack(spacing: 0) {
                Text(model.deleteStep ? model.delSure : model.title)
                    .font(.system(size: 16, weight: .bold)).foregroundStyle(Color.primary)
                    .padding(.bottom, 10)
                if model.deleteStep { deleteConfirm } else { form }
            }
            .padding(.top, 2)
        }
        .onChange(of: pickerItem) { _, item in loadPicked(item) }
    }

    // MARK: form
    private var form: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    avatarRow
                    sectionLabel(model.nameLabel)
                    field { TextField(model.namePlaceholder, text: $model.name)
                        .focused($nameFocused)
                        .font(.system(size: 16, weight: .semibold))
                        .onChange(of: model.name) { _, v in if v.count > model.nameMaxLength { model.name = String(v.prefix(model.nameMaxLength)) } }
                    }
                    sectionLabel(model.bioLabel)
                    field {
                        ZStack(alignment: .topLeading) {
                            if model.bio.isEmpty {
                                Text(model.bioPlaceholder).font(.system(size: 16)).foregroundStyle(.secondary)
                                    .padding(.top, 2).padding(.leading, 5)
                            }
                            TextEditor(text: $model.bio)
                                .font(.system(size: 16)).frame(minHeight: 74)
                                .scrollContentBackground(.hidden)
                                .onChange(of: model.bio) { _, v in if v.count > model.bioMaxLength { model.bio = String(v.prefix(model.bioMaxLength)) } }
                        }
                    }
                    sectionLabel(model.activityLabel)
                    HStack {
                        Text(model.shareLabel).font(.system(size: 16, weight: .semibold)).foregroundStyle(Color.primary)
                        Spacer()
                        Toggle("", isOn: $model.share).labelsHidden().tint(vfRed)
                    }.padding(.horizontal, 18).padding(.top, 2)
                    Text(model.shareNote).font(.system(size: 13)).foregroundStyle(.secondary)
                        .padding(.horizontal, 18).padding(.top, 4)
                    sectionLabel(model.langLabel)
                    segments([(("da"), model.langDaLabel), ("en", model.langEnLabel)], selected: model.lang) { model.chooseLang($0) }
                    sectionLabel(model.privacyLabel)
                    segments([("personal", model.adsPersonalLabel), ("limited", model.adsLimitedLabel)], selected: model.consent) { model.chooseConsent($0) }
                    Button { model.openPolicy() } label: {
                        Text(model.policyLabel).font(.system(size: 13, weight: .semibold)).underline()
                            .foregroundStyle(.secondary).padding(.horizontal, 18).padding(.top, 14)
                    }.buttonStyle(.plain)
                    Button { model.deleteStep = true; slet = "" } label: {
                        Text(model.deleteOpenLabel).font(.system(size: 14, weight: .semibold)).foregroundStyle(vfRed)
                            .padding(.horizontal, 18).padding(.top, 18).padding(.bottom, 6)
                    }.buttonStyle(.plain)
                }
                .padding(.bottom, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            saveButton
        }
    }

    private var avatarRow: some View {
        HStack(spacing: 14) {
            Group {
                if let img = model.pickedAvatar {
                    Image(uiImage: img).resizable().scaledToFill()
                } else {
                    GlassAvatar(url: model.avatarUrl, initials: model.avatarInitials, gradient: model.avatarGradient, size: 72)
                }
            }
            .frame(width: 72, height: 72).clipShape(Circle())
            PhotosPicker(selection: $pickerItem, matching: .images) {
                Text(model.picLabel).font(.system(size: 15, weight: .bold)).foregroundStyle(vfRed)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18).padding(.top, 6).padding(.bottom, 2)
    }

    private var saveButton: some View {
        Button { nameFocused = false; model.save() } label: {
            ZStack {
                Text(model.saveLabel).font(.system(size: 16, weight: .bold)).foregroundStyle(.white).opacity(model.saving ? 0 : 1)
                if model.saving { ProgressView().tint(.white) }
            }
            .frame(maxWidth: .infinity).padding(.vertical, 15)
            .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(vfRed))
            .opacity(model.canSave && !model.saving ? 1 : 0.45)
        }
        .buttonStyle(.plain).disabled(!model.canSave || model.saving)
        .padding(.horizontal, 16).padding(.top, 8).padding(.bottom, 4)
    }

    // MARK: delete confirm
    private var deleteConfirm: some View {
        VStack(spacing: 12) {
            Text(model.delText).font(.system(size: 14)).foregroundStyle(.secondary)
                .multilineTextAlignment(.center).padding(.horizontal, 20)
            TextField("SLET", text: $slet)
                .textInputAutocapitalization(.characters).autocorrectionDisabled()
                .multilineTextAlignment(.center).font(.system(size: 17, weight: .bold))
                .padding(.horizontal, 16).padding(.vertical, 13)
                .glassBG(RoundedRectangle(cornerRadius: 12, style: .continuous))
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
        }
        .padding(.top, 8).padding(.bottom, 16)
    }

    // MARK: helpers
    private func sectionLabel(_ s: String) -> some View {
        Text(s.uppercased()).font(.system(size: 12, weight: .bold)).foregroundStyle(.secondary).kerning(0.4)
            .padding(.leading, 18).padding(.top, 16).padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func field<V: View>(@ViewBuilder _ content: () -> V) -> some View {
        content()
            .foregroundStyle(Color.primary)
            .padding(.horizontal, 14).padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .glassBG(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, 16)
    }
    private func segments(_ opts: [(String, String)], selected: String, _ pick: @escaping (String) -> Void) -> some View {
        HStack(spacing: 8) {
            ForEach(opts, id: \.0) { value, label in
                let on = selected == value
                Button { pick(value) } label: {
                    Text(label).font(.system(size: 14, weight: .bold))
                        .foregroundStyle(on ? Color(.systemBackground) : Color.primary)
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

    private func loadPicked(_ item: PhotosPickerItem?) {
        guard let item else { return }
        Task {
            if let data = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: data),
               let dataURL = vfImageDataURL(img) {
                await MainActor.run { model.stagePickedImage(img, dataURL: dataURL) }
            }
        }
    }
}

/// Overlays the edit-profile glass sheet + a dimming scrim on the host view when open.
struct EsheetHost: ViewModifier {
    @ObservedObject private var model = EsheetModel.shared
    func body(content: Content) -> some View {
        ZStack {
            content
            if model.open {
                Color.black.opacity(0.28).ignoresSafeArea()
                    .contentShape(Rectangle())
                    .onTapGesture { model.dismiss() }
                    .transition(.opacity)
                GlassEditProfileSheet()
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.spring(response: 0.36, dampingFraction: 0.86), value: model.open)
    }
}
