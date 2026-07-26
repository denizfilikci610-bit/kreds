package dk.vibefeed.app.composer

import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject

/** Hvilket flow web bad om. Sendes som "purpose" i photolib-beskeden. */
enum class Purpose { MEMORY, COMPOSE, STORY }

/** Trinnene i komposeren, samme rækkefølge som på iOS. */
enum class Step { CAMERA, GALLERY, CROP, CAPTION }

/** En kreds i destinations-vælgeren. */
data class Feed(val id: String, val name: String)

/** Teksterne kommer fra web, så komposeren taler brugerens sprog uden at kende de 32 sprog. */
data class Labels(val map: Map<String, String>) {
    operator fun get(key: String): String = map[key].orEmpty()
    fun or(key: String, fallback: String): String = map[key]?.takeIf { it.isNotBlank() } ?: fallback
}

/** Det valgte medie, før det er skaleret og gjort klar til upload. */
data class Picked(val uri: Uri, val isVideo: Boolean, val durationMs: Long = 0)

/**
 * Tilstanden i den native medie-komposer.
 *
 * Web ejer flowet: den beder om komposeren, den regner sti og bøtte ud, den opretter selve
 * opslaget. Komposeren her leverer kun mediet, billedteksten og destinationen tilbage.
 */
class ComposerModel {

    var open by mutableStateOf(false)
        private set
    var step by mutableStateOf(Step.CAMERA)
    var purpose by mutableStateOf(Purpose.MEMORY)

    /** Minde eller story. På iOS skiftes der med en vælger under udløseren i kameraet. */
    var isStory by mutableStateOf(false)

    var feeds by mutableStateOf<List<Feed>>(emptyList())
    var dest by mutableStateOf("all")
    var labels by mutableStateOf(Labels(emptyMap()))

    var picked by mutableStateOf<Picked?>(null)

    /** Billedbiblioteket, hentet én gang. Kameraets genvej viser det nyeste som miniature. */
    var seneste by mutableStateOf<List<Picked>>(emptyList())

    /** Det markerede medie i galleriet. Først ved Videre går flowet videre. */
    var valgt by mutableStateOf<Picked?>(null)

    /** Tændt mens et valgt medie hentes. Gitteret fryses imens, så det rigtige medie følger med. */
    var forbereder by mutableStateOf(false)

    /** Kandidater til @-omtaler, pr. destination. Følger den valgte kreds. */
    var mentionables by mutableStateOf<Map<String, List<MentionCard>>>(emptyMap())
    var caption by mutableStateOf("")

    /** Tændt mens web arbejder, så der ikke kan deles to gange. */
    var sharing by mutableStateOf(false)

    /** Det færdigt beskårne billede. Sat når beskæreren er brugt. */
    var cropped by mutableStateOf<android.graphics.Bitmap?>(null)

    /** Mediet holdes her indtil web sender upload-ordren. */
    var pendingBytes: ByteArray? = null
    var pendingMime: String = "image/jpeg"

    fun start(json: JSONObject) {
        purpose = when (json.optString("purpose")) {
            "story" -> Purpose.STORY
            "compose" -> Purpose.COMPOSE
            else -> Purpose.MEMORY
        }
        isStory = purpose == Purpose.STORY
        dest = json.optString("dest").ifBlank { "all" }
        step = if (json.optString("start") == "gallery") Step.GALLERY else Step.CAMERA

        feeds = json.optJSONArray("feeds")?.let { arr ->
            (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let { Feed(it.optString("id"), it.optString("name")) }
            }
        } ?: emptyList()

        mentionables = Mentions.parse(json.optJSONObject("mentionables"))

        labels = json.optJSONObject("labels")?.let { o ->
            Labels(o.keys().asSequence().associateWith { o.optString(it) })
        } ?: Labels(emptyMap())

        picked = null
        valgt = null
        cropped = null
        forbereder = false
        caption = ""
        sharing = false
        pendingBytes = null
        open = true
    }

    fun close() {
        open = false
        picked = null
        valgt = null
        forbereder = false
        cropped = null
        caption = ""
        sharing = false
        pendingBytes = null
    }

    /** Kvitteringen fra web: "ok" lukker komposeren, alt andet slukker kun spinneren. */
    fun result(value: String) {
        if (value == "ok") close() else sharing = false
    }

    /** Målet for det færdige medie. Præcis de tal iOS bruger. */
    fun target(): Pair<Int, Int> = when {
        isStory -> 1080 to 1920
        else -> 1080 to 1350
    }

    val title: String
        get() = if (isStory) labels.or("titleStory", "Story") else labels.or("titleMemory", "Nyt minde")

    val shareLabel: String
        get() = if (isStory) labels.or("shareStory", "Del") else labels.or("shareMemory", "Del")

    /** Kandidaterne der gælder den valgte destination, med fald tilbage til hele kredsen. */
    val aktuelleMentions: List<MentionCard>
        get() = mentionables[dest] ?: mentionables["all"] ?: emptyList()
}
