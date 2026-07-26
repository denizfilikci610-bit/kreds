package dk.vibefeed.app.comments

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dk.vibefeed.app.composer.MentionCard
import dk.vibefeed.app.composer.Mentions
import org.json.JSONObject

/**
 * Kommentar-arket for minder, oversat fra ios/VibeFeed/CommentsSheetView.swift.
 *
 * Web ejer HELE tråden: snapshottet kommer færdigbygget (dybde-først fra hver rod,
 * forældreløse som top-niveau, indent 0 eller 1), og native må ALDRIG selv bygge træ.
 * Arket lukker sig heller aldrig selv: dismiss er en rundtur, og først webbens close
 * slukker det.
 */

data class CommentRow(
    val id: String,
    val handle: String,
    val name: String,
    val avatarUrl: String,
    val initials: String,
    val gradient: List<String>,
    /** RÅ tekst, mentions er IKKE segmenteret. */
    val text: String,
    val img: String,
    /** Handle på forældrekommentarens forfatter, tom for top-niveau. */
    val replyTo: String,
    /** 0 eller 1, aldrig dybere. */
    val indent: Int,
    val time: String,
    val liked: Boolean,
    val likeCount: Int,
    val mine: Boolean,
)

data class CommentLabels(
    val empty: String = "",
    val placeholder: String = "",
    val send: String = "",
    val reply: String = "",
    val cancelReply: String = "",
    /** "Svarer @{u}", @ ligger INDE i skabelonen: indsæt det nøgne handle. */
    val replyingTo: String = "",
    val del: String = "",
    val delConfirm: String = "",
)

class CommentsModel : CommentHost {

    override var open by mutableStateOf(false)
        private set
    override var postId by mutableStateOf("")
        private set
    var title by mutableStateOf("")
        private set
    override var canPost by mutableStateOf(false)
        private set
    override var emoji by mutableStateOf<List<String>>(emptyList())
        private set
    override var comments by mutableStateOf<List<CommentRow>>(emptyList())
        private set
    override var mentionables by mutableStateOf<List<MentionCard>>(emptyList())
        private set
    override var labels by mutableStateOf(CommentLabels())
        private set

    /** Engangs: deep-linkets kommentar-id. Hvert efterfølgende snapshot nulstiller det. */
    var focusId by mutableStateOf<String?>(null)

    /** Bumpes per snapshot, så indholdsskift kan animeres og armeringer falde. */
    var token by mutableIntStateOf(0)
        private set

    // ---- Lokal composer-tilstand. Bor i modellen så den overlever rekomposition,
    // men aldrig i snapshottet: web kender den ikke.
    override var text by mutableStateOf("")
    override var replyingToId by mutableStateOf<String?>(null)
    override var replyingToHandle by mutableStateOf("")

    /** To-trins slet: id'et der er armeret ("Slet?"), falder efter 3 s og ved snapshots. */
    override var deleteArmId by mutableStateOf<String?>(null)

    /** Bumpes når Svar skal rejse tastaturet. */
    override var focusToken by mutableIntStateOf(0)

    /** Bumpes efter egen afsendelse, så listen ruller til bunden. */
    override var scrollToken by mutableIntStateOf(0)

    fun apply(json: JSONObject) {
        if (json.opt("close") == true) {
            // Uden denne rydning genopstod et gammelt "Svarer @bruger" plus udkast ved
            // genåbning af SAMME minde. Close rører intet af det øvrige indhold.
            open = false
            text = ""
            replyingToId = null
            replyingToHandle = ""
            return
        }
        if (json.opt("open") != true) return

        val pid = json.opt("postId")?.toString() ?: ""
        val fresh = pid.isNotEmpty() && pid != postId
        // Web sender aldrig token, så et manglende felt bumper selv.
        token = json.optInt("token", token + 1)
        postId = pid
        title = json.opt("title") as? String ?: ""
        canPost = json.opt("canPost") == true

        json.optJSONArray("emoji")?.let { arr ->
            emoji = (0 until arr.length()).mapNotNull { arr.opt(it) as? String }
        }

        json.optJSONArray("comments")?.let { arr ->
            comments = (0 until arr.length()).mapNotNull { i ->
                val c = arr.optJSONObject(i) ?: return@mapNotNull null
                // Et element uden id kan hverken likes, slettes eller besvares: drop det.
                val id = c.opt("id")?.toString()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                CommentRow(
                    id = id,
                    handle = c.optString("handle"),
                    name = c.optString("name").ifEmpty { "?" },
                    avatarUrl = c.optString("avatarUrl"),
                    initials = c.optString("initials").ifEmpty { "?" },
                    gradient = c.optJSONArray("gradient")?.let { g ->
                        (0 until g.length()).map { g.optString(it) }
                    } ?: emptyList(),
                    text = c.optString("text"),
                    img = c.optString("img"),
                    replyTo = c.optString("replyTo"),
                    indent = if (c.optInt("indent") > 0) 1 else 0,
                    time = c.optString("time"),
                    liked = c.opt("liked") == true,
                    likeCount = c.optInt("likeCount"),
                    mine = c.opt("mine") == true,
                )
            }
        }

        mentionables = Mentions.parseListe(json.optJSONArray("mentionables"))

        // Kun åbnings-snapshottet ved deep-link bærer focus; alle andre nulstiller.
        focusId = json.opt("focus")?.toString()?.takeIf { it.isNotEmpty() }

        json.optJSONObject("labels")?.let { l ->
            labels = CommentLabels(
                empty = l.optString("empty"),
                placeholder = l.optString("placeholder"),
                send = l.optString("send"),
                reply = l.optString("reply"),
                cancelReply = l.optString("cancelReply"),
                replyingTo = l.optString("replyingTo"),
                del = l.optString("del"),
                delConfirm = l.optString("delConfirm"),
            )
        }

        // Nyt opslag nulstiller udkastet, EFTER at comments er sat.
        if (fresh) {
            text = ""
            replyingToId = null
            replyingToHandle = ""
        }
        // Svar-målet kan være slettet i mellemtiden; ellers hænger chippen på en død række.
        if (replyingToId != null && comments.none { it.id == replyingToId }) {
            replyingToId = null
            replyingToHandle = ""
        }
        // Hvert snapshot afvæbner et armeret "Slet?", præcis som på iPhone (feedet pusher
        // ved hver gentegning, også realtime).
        deleteArmId = null

        open = true
    }

    /**
     * Nødværnet: web svarer ikke (fx fordi opslaget forsvandt af state.posts, hvor
     * pushNativeComments så gør INTET). Luk lokalt med samme rydning som close-grenen.
     */
    fun lukLokalt() {
        open = false
        text = ""
        replyingToId = null
        replyingToHandle = ""
    }
}
