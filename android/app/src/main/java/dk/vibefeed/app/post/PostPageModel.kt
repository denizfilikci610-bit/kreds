package dk.vibefeed.app.post

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import dk.vibefeed.app.comments.CommentHost
import dk.vibefeed.app.comments.CommentLabels
import dk.vibefeed.app.comments.CommentRow
import dk.vibefeed.app.composer.MentionCard
import dk.vibefeed.app.composer.Mentions
import org.json.JSONObject

/**
 * Opslags-siden for TANKER, oversat fra ios/VibeFeed/PostPageView.swift.
 *
 * Web ejer alt: snapshottet kommer færdigt (segmenter er facit, native leder ALDRIG selv
 * efter @ i teksten), og siden lukker først når web ekkoer close. Minder rammer aldrig
 * siden: postPageSnapshot returnerer null for dem.
 */

/** Ét tekst-segment: ren tekst ELLER et handle der skal være tappable. */
data class PostSeg(val t: String?, val m: String?)

data class PollOption(val id: String, val text: String, val pct: Int, val mine: Boolean)

data class PostPoll(
    val gov: Boolean,
    /** Færdig overskrift inkl. nedtælling. Bygges kun for governance-afstemninger. */
    val head: String,
    val showRes: Boolean,
    /** Når sand er rækkerne IKKE tappable. */
    val resolved: Boolean,
    val meta: String,
    val options: List<PollOption>,
)

data class PostData(
    val handle: String,
    val name: String,
    val avatarUrl: String,
    val initials: String,
    val gradient: List<String>,
    val time: String,
    val kredsName: String,
    val segs: List<PostSeg>,
    val imgUrl: String,
    val videoUrl: String,
    val liked: Boolean,
    val likeCount: Int,
    val cmtCount: Int,
    /** Falsk for private kreds-opslag: papirflyet erstattes af en usynlig plads. */
    val canShare: Boolean,
    val poll: PostPoll?,
)

class PostPageModel : CommentHost {

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
    var post by mutableStateOf<PostData?>(null)
        private set
    override var comments by mutableStateOf<List<CommentRow>>(emptyList())
        private set
    override var mentionables by mutableStateOf<List<MentionCard>>(emptyList())
        private set
    override var labels by mutableStateOf(CommentLabels())
        private set

    var focusId by mutableStateOf<String?>(null)
    var token by mutableIntStateOf(0)
        private set

    /** Bumpes når et NYT opslag lander mens siden er åben: scroll til top, ingen glid-ind. */
    var freshToken by mutableIntStateOf(0)
        private set

    /** Bumpes af tilbage-knap OG chevron: glid ud først, dismiss bagefter. */
    var exitTick by mutableIntStateOf(0)
        private set

    /** Generation: bumpes ved hvert åbn/luk, så et gammelt nødværn aldrig kan
     *  ramme en NY session der blev åbnet efter at timeren blev armeret. */
    var gen: Int = 0
        private set

    fun exit() {
        exitTick++
    }

    override var text by mutableStateOf("")
    override var replyingToId by mutableStateOf<String?>(null)
    override var replyingToHandle by mutableStateOf("")
    override var deleteArmId by mutableStateOf<String?>(null)
    override var focusToken by mutableIntStateOf(0)
    override var scrollToken by mutableIntStateOf(0)

    fun apply(json: JSONObject) {
        if (json.opt("close") == true) {
            // Kun open, udkast og svar-mål. token, postId, post og comments bliver stående.
            open = false
            gen += 1
            text = ""
            replyingToId = null
            replyingToHandle = ""
            return
        }
        if (json.opt("open") != true) return

        val pid = json.opt("postId")?.toString() ?: ""
        val fresh = pid != postId
        // Web sender ALDRIG token. json.optInt("token") ville give 0 hver gang, og så
        // holdt både slet-armeringen og deep-link-fremhævningen op med at virke.
        token = if (json.has("token")) json.optInt("token") else token + 1
        postId = pid
        title = json.opt("title") as? String ?: ""
        canPost = json.opt("canPost") == true

        json.optJSONArray("emoji")?.let { arr ->
            emoji = (0 until arr.length()).mapNotNull { arr.opt(it) as? String }
        }

        post = json.optJSONObject("post")?.let { p ->
            PostData(
                handle = p.optString("handle"),
                name = p.optString("name").ifEmpty { "?" },
                avatarUrl = p.optString("avatarUrl"),
                initials = p.optString("initials").ifEmpty { "?" },
                gradient = p.optJSONArray("gradient")?.let { g ->
                    (0 until g.length()).map { g.optString(it) }
                } ?: emptyList(),
                time = p.optString("time"),
                kredsName = p.optString("kredsName"),
                segs = p.optJSONArray("segs")?.let { s ->
                    (0 until s.length()).mapNotNull { i ->
                        s.optJSONObject(i)?.let { o ->
                            PostSeg(
                                t = o.opt("t") as? String,
                                m = o.opt("m") as? String,
                            )
                        }
                    }
                } ?: emptyList(),
                imgUrl = p.optString("imgUrl"),
                videoUrl = p.optString("videoUrl"),
                liked = p.opt("liked") == true,
                likeCount = p.optInt("likeCount"),
                cmtCount = p.optInt("cmtCount"),
                canShare = p.opt("canShare") == true,
                poll = p.optJSONObject("poll")?.let { q ->
                    PostPoll(
                        gov = q.opt("gov") == true,
                        head = q.optString("head"),
                        showRes = q.opt("showRes") == true,
                        resolved = q.opt("resolved") == true,
                        meta = q.optString("meta"),
                        options = q.optJSONArray("options")?.let { arr ->
                            (0 until arr.length()).mapNotNull { i ->
                                arr.optJSONObject(i)?.let { o ->
                                    PollOption(
                                        id = o.opt("id")?.toString() ?: return@let null,
                                        text = o.optString("text"),
                                        pct = o.optInt("pct"),
                                        mine = o.opt("mine") == true,
                                    )
                                }
                            }
                        } ?: emptyList(),
                    )
                },
            )
        }

        json.optJSONArray("comments")?.let { arr ->
            comments = (0 until arr.length()).mapNotNull { i ->
                val c = arr.optJSONObject(i) ?: return@mapNotNull null
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

        // UBETINGET tildeling: kun deep-link-åbningen bærer focus, hver synk nulstiller.
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

        if (fresh) {
            text = ""
            replyingToId = null
            replyingToHandle = ""
            // Viewet er allerede oppe: scroll til top og lad være at glide ind igen.
            if (open) freshToken++
        }
        if (replyingToId != null && comments.none { it.id == replyingToId }) {
            replyingToId = null
            replyingToHandle = ""
        }
        deleteArmId = null

        open = true
        gen += 1
    }

    /** Nødværnet, samme rydning som close-grenen. */
    fun lukLokalt() {
        open = false
        gen += 1
        text = ""
        replyingToId = null
        replyingToHandle = ""
    }
}
