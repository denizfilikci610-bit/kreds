package dk.vibefeed.app.profil

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/**
 * Rediger profil, oversat fra ios/VibeFeed/EsheetView.swift (fuldskærms-siden).
 *
 * Vigtig forskel fra web-arket: dér uploades billeder STRAKS ved valg, mens Gem kun gemmer
 * tekstfelterne. Den native side vender det om, "Gem gør alt", og det er bevidst.
 */

data class EsheetAvatar(
    val avatarUrl: String = "",
    val initials: String = "",
    val gradient: List<String> = emptyList(),
)

class EsheetModel {

    var open by mutableStateOf(false)
        private set

    /** Gemmes, bruges aldrig. */
    var token = 0
        private set

    // Alle etiketter kommer færdigoversatte fra web.
    var title by mutableStateOf("")
    var picLabel by mutableStateOf("")
    var nameLabel by mutableStateOf("")
    var namePlaceholder by mutableStateOf("")
    var nameMaxLength by mutableIntStateOf(40)
    var handleLabel by mutableStateOf("")
    var handle by mutableStateOf("")
    var bannerLabel by mutableStateOf("")
    var bannerUrl by mutableStateOf("")
    var useLabel by mutableStateOf("OK")
    var bioLabel by mutableStateOf("")
    var bioPlaceholder by mutableStateOf("")
    var bioMaxLength by mutableIntStateOf(160)

    /** Modtages men tegnes ALDRIG: den manglende overskrift er en del af udseendet. */
    var activityLabel by mutableStateOf("")
    var shareLabel by mutableStateOf("")
    var shareNote by mutableStateOf("")
    var langLabel by mutableStateOf("")
    var langDaLabel by mutableStateOf("")
    var langEnLabel by mutableStateOf("")

    /** 32 par af [kode, sprogets eget navn], i webbens LANGS-rækkefølge. */
    var langs by mutableStateOf<List<Pair<String, String>>>(emptyList())
    var privacyLabel by mutableStateOf("")
    var adsPersonalLabel by mutableStateOf("")
    var adsLimitedLabel by mutableStateOf("")
    var policyLabel by mutableStateOf("")
    var policyUrl by mutableStateOf("")
    var saveLabel by mutableStateOf("")
    var deleteOpenLabel by mutableStateOf("")
    var delSure by mutableStateOf("")
    var delText by mutableStateOf("")
    var delBtn by mutableStateOf("")
    var cancelLabel by mutableStateOf("")

    var avatar by mutableStateOf(EsheetAvatar())
    var name by mutableStateOf("")
    var bio by mutableStateOf("")
    var share by mutableStateOf(true)
    var lang by mutableStateOf("da")
    var consent by mutableStateOf("personal")
    var adsOn by mutableStateOf(false)

    // ---- Ren native tilstand
    /** Beskårne billeder til forhåndsvisning, som iOS' UIImages. Gem gør alt. */
    var pickedAvatar by mutableStateOf<android.graphics.Bitmap?>(null)
    var pickedBanner by mutableStateOf<android.graphics.Bitmap?>(null)
    var saving by mutableStateOf(false)
    var deleting by mutableStateOf(false)
    var deleteStep by mutableStateOf(false)

    /** Bumpes af tilbage-pil OG systemets tilbage: glid ud først, dismiss bagefter. */
    var exitTick by mutableIntStateOf(0)
        private set

    fun exit() {
        exitTick++
    }

    /** Rækkefølgen er bindende: close, update, den bevogtede open. */
    fun apply(json: JSONObject) {
        if (json.opt("close") == true) {
            open = false
            deleteStep = false
            return
        }
        if (json.opt("update") == true) {
            (json.opt("saving") as? Boolean)?.let { saving = it }
            (json.opt("deleting") as? Boolean)?.let { deleting = it }
            // Avatar-grenen er død kode i web, bygget for symmetriens skyld.
            json.optJSONObject("avatar")?.let { fletAvatar(it) }
            return
        }
        if (json.opt("open") != true) return

        token = json.optInt("token")
        title = json.optString("title")
        picLabel = json.optString("picLabel")
        nameLabel = json.optString("nameLabel")
        namePlaceholder = json.optString("namePlaceholder")
        nameMaxLength = json.optInt("nameMaxLength", 40)
        handleLabel = json.optString("handleLabel")
        handle = json.optString("handle")
        bannerLabel = json.optString("bannerLabel")
        bannerUrl = json.optString("bannerUrl")
        useLabel = json.optString("useLabel").ifBlank { "OK" }
        bioLabel = json.optString("bioLabel")
        bioPlaceholder = json.optString("bioPlaceholder")
        bioMaxLength = json.optInt("bioMaxLength", 160)
        activityLabel = json.optString("activityLabel")
        shareLabel = json.optString("shareLabel")
        shareNote = json.optString("shareNote")
        langLabel = json.optString("langLabel")
        langDaLabel = json.optString("langDaLabel")
        langEnLabel = json.optString("langEnLabel")
        langs = json.optJSONArray("langs")?.let { arr ->
            (0 until arr.length()).mapNotNull { i ->
                arr.optJSONArray(i)?.let { par ->
                    val kode = par.optString(0)
                    if (kode.isBlank()) null else kode to par.optString(1)
                }
            }
        } ?: emptyList()
        privacyLabel = json.optString("privacyLabel")
        adsPersonalLabel = json.optString("adsPersonalLabel")
        adsLimitedLabel = json.optString("adsLimitedLabel")
        policyLabel = json.optString("policyLabel")
        policyUrl = json.optString("policyUrl")
        saveLabel = json.optString("saveLabel")
        deleteOpenLabel = json.optString("deleteOpenLabel")
        delSure = json.optString("delSure")
        delText = json.optString("delText")
        delBtn = json.optString("delBtn")
        cancelLabel = json.optString("cancelLabel")

        json.optJSONObject("avatar")?.let { fletAvatar(it) }
        name = json.optString("name")
        bio = json.optString("bio")
        share = json.opt("share") as? Boolean ?: true
        lang = json.optString("lang").ifBlank { "da" }
        consent = json.optString("consent").ifBlank { "personal" }
        adsOn = json.opt("adsOn") == true

        // Åbningen nulstiller den lokale tilstand FØR open, så en gemning der hang aldrig
        // låser en ny session: åbnings-snapshottet er sikkerhedsventilen for saving.
        pickedAvatar = null
        pickedBanner = null
        saving = false
        deleting = false
        deleteStep = false

        open = true
    }

    /** Fletter: hver nøgle falder tilbage på den nuværende værdi. */
    private fun fletAvatar(a: JSONObject) {
        avatar = EsheetAvatar(
            avatarUrl = a.optString("avatarUrl", avatar.avatarUrl),
            initials = a.optString("initials", avatar.initials),
            gradient = a.optJSONArray("gradient")?.let { g ->
                (0 until g.length()).map { g.optString(it) }
            } ?: avatar.gradient,
        )
    }

    /** Nødværnet når web ikke ekkoer close inden for ~1200 ms. Bevidst afvigelse fra iOS. */
    fun lukLokalt() {
        open = false
        deleteStep = false
    }
}
