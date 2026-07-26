package dk.vibefeed.app.composer

import org.json.JSONArray
import org.json.JSONObject

/** Én kandidat til en @-omtale, som web sender dem i photolib-beskeden. */
data class MentionCard(
    val handle: String,
    val name: String,
    val avatarUrl: String?,
    val initials: String,
    val gradient: List<String>,
)

/**
 * @-omtaler i billedteksten, portet fra MentionSupport.swift.
 *
 * Kandidaterne filtreres LOKALT på det sidste @-token, og listen følger den valgte destination:
 * man kan kun nævne folk der kan se opslaget.
 */
object Mentions {

    private fun isHandleChar(c: Char) = c.code < 128 && (c.isLetterOrDigit() || c == '_' || c == '.')

    /**
     * Det @-token der står til sidst i teksten, eller null.
     *
     * Står der et bogstav eller et andet @ lige før snabel-a'et, ligner det en mailadresse
     * eller noget midt i et ord, og så er det ikke en omtale.
     */
    fun trailingToken(text: String): String? {
        val at = text.lastIndexOf('@')
        if (at < 0) return null
        if (at > 0) {
            val prev = text[at - 1]
            if (prev == '@' || isHandleChar(prev)) return null
        }
        val q = text.substring(at + 1)
        if (q.length > 20 || !q.all(::isHandleChar)) return null
        return q.lowercase()
    }

    fun hits(text: String, cards: List<MentionCard>): List<MentionCard> {
        val q = trailingToken(text) ?: return emptyList()
        return cards.filter {
            q.isEmpty() || it.handle.startsWith(q) || it.name.lowercase().startsWith(q)
        }.take(6)
    }

    /**
     * Indsætter omtalen. Ville det bringe teksten over 280 tegn, sker der INTET.
     *
     * Grunden står i forlægget: et efterfølgende klip må aldrig halvere et handle, for en
     * midt-klippet omtale peger på en forkert eller ukendt bruger.
     */
    fun insert(text: String, handle: String): String {
        val at = text.lastIndexOf('@')
        if (at < 0) return text
        val ud = text.substring(0, at) + "@" + handle + " "
        return if (ud.length > 280) text else ud
    }

    /**
     * Kommentar-arkets mentionables er et ARRAY, ikke photolib-beskedens map af
     * destinationer. Kandidater uden handle droppes, som i [parse].
     */
    fun parseListe(arr: JSONArray?): List<MentionCard> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { i ->
            arr.optJSONObject(i)?.let { o ->
                val handle = o.optString("handle")
                if (handle.isBlank()) null else MentionCard(
                    handle = handle,
                    name = o.optString("name"),
                    avatarUrl = o.optString("avatarUrl").takeIf { it.isNotBlank() },
                    initials = o.optString("initials"),
                    gradient = o.optJSONArray("gradient")?.let { g ->
                        (0 until g.length()).map { g.optString(it) }
                    } ?: emptyList(),
                )
            }
        }
    }

    /** Læser mentionables-objektet fra web: nøgle er destination, værdi er kandidaterne. */
    fun parse(json: JSONObject?): Map<String, List<MentionCard>> {
        if (json == null) return emptyMap()
        val ud = mutableMapOf<String, List<MentionCard>>()
        for (nøgle in json.keys()) {
            val arr = json.optJSONArray(nøgle) ?: continue
            ud[nøgle] = (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let { o ->
                    val handle = o.optString("handle")
                    if (handle.isBlank()) null else MentionCard(
                        handle = handle,
                        name = o.optString("name"),
                        avatarUrl = o.optString("avatarUrl").takeIf { it.isNotBlank() },
                        initials = o.optString("initials"),
                        gradient = o.optJSONArray("gradient")?.let { g ->
                            (0 until g.length()).map { g.optString(it) }
                        } ?: emptyList(),
                    )
                }
            }
        }
        return ud
    }
}
