package dk.vibefeed.app.sheets

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dk.vibefeed.app.bars.BRAND
import dk.vibefeed.app.ui.VfPlainAvatar
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress
import org.json.JSONObject

/**
 * Det centrerede handlings-kort, oversat fra ios/VibeFeed/SheetView.swift.
 *
 * Kortet er den menu der åbner sig ti steder i appen: opslags-menuen bag ⋯, anmeld, blokér,
 * fjern ven, chattens besked-menu og tråd-menu, story-menuen, medie-menuen, plus-vælgeren og
 * person-listerne. Web ejer HELE flowet. Native tegner kun kortet og melder tryk tilbage med
 * `window.vfSheet(action)`, hvorefter web enten poster det næste kort (fx en slet-bekræftelse)
 * eller poster `{close:true}`.
 *
 * Grunden til at den skal være native er ikke udseendet: web tegner sin egen udgave inde i
 * websiden, og den ligger derfor BAG ethvert native fuldskærmslag. Uden det her kort er de ti
 * menuer usynlige på de native sider.
 *
 * Kortet lukker sig ALDRIG selv. Præcis ét sted sættes request til null, og det er når web
 * siger `close`. Hverken tryk, scrim, tilbage eller timeout gør det.
 */

/** [id] er RÅ-indekset fra web. Frafiltrerede elementer efterlader huller, og det er meningen. */
data class SheetButton(val id: Int, val label: String, val action: String, val role: String)

data class SheetPreview(
    val name: String,
    val snippet: String,
    val avatarUrl: String,
    val initials: String,
)

data class SheetRequest(
    /** Bumpes per kort, så et indholdsskift i to-trins-flowet kan animere. */
    val token: Int,
    val title: String,
    val message: String,
    val preview: SheetPreview?,
    val buttons: List<SheetButton>,
    val emojis: List<String>,
    val selected: String,
)

class SheetModel {

    var request: SheetRequest? by mutableStateOf(null)
        private set

    /**
     * Låser kortets knapper efter det FØRSTE tryk.
     *
     * To hurtige tryk på "Slet" sender ellers `todelete` to gange, og det andet kald rammer
     * trin 2 med en handling den ikke kender, hvorefter web lukker kortet. Det er en ægte fejl
     * på iPhone i dag. Kontrakten er altid præcis én handling per kort, så låsen er sikker.
     */
    var låst by mutableStateOf(false)
        private set

    private var tæller = 0

    fun apply(json: JSONObject) {
        // Kun == true lukker. optBoolean ville også sige ja til strengen "true", og det er
        // ikke det samme som Swifts cast.
        if (json.opt("close") == true) {
            request = null
            låst = false
            return
        }

        val rå = json.optJSONArray("buttons")
        val knapper = ArrayList<SheetButton>()
        for (i in 0 until (rå?.length() ?: 0)) {
            val b = rå?.optJSONObject(i) ?: continue
            val label = b.opt("label") as? String ?: continue
            val action = b.opt("action") as? String ?: continue
            // En TOM rolle er ikke "default": kun en manglende nøgle giver default, så "" ender
            // med halvfed vægt inde i gruppen.
            val role = b.opt("role") as? String ?: "default"
            knapper.add(SheetButton(i, label, action, role))
        }
        // En tom knapliste vinder ikke over et åbent kort. Det bliver stående uændret.
        if (knapper.isEmpty()) return

        val p = json.optJSONObject("preview")
        val navn = p?.opt("name") as? String
        val preview = if (p != null && navn != null) {
            SheetPreview(
                name = navn,
                snippet = p.opt("snippet") as? String ?: "",
                avatarUrl = p.opt("avatarUrl") as? String ?: "",
                initials = p.opt("initials") as? String ?: "",
            )
        } else {
            null
        }

        val emojiArray = json.optJSONArray("emojis")
        val emojis = ArrayList<String>()
        for (i in 0 until (emojiArray?.length() ?: 0)) {
            (emojiArray?.opt(i) as? String)?.let { emojis.add(it) }
        }

        tæller++
        request = SheetRequest(
            token = tæller,
            title = json.opt("title") as? String ?: "",
            message = json.opt("message") as? String ?: "",
            preview = preview,
            buttons = knapper,
            emojis = emojis,
            selected = json.opt("selected") as? String ?: "",
        )
        låst = false
    }

    /** Kaldes af værten ved det første tryk. Returnerer false hvis kortet allerede er låst. */
    internal fun lås(): Boolean {
        if (låst) return false
        låst = true
        return true
    }
}

/**
 * Lægger kortet og dæmpningen oven på det hele.
 *
 * MÅ IKKE ligge inde i `if (nativeBars)`: kortet skal kunne komme frem uanset barernes
 * tilstand. Og når det lukker, SKAL scrimen forsvinde helt ud af sammensætningen igen,
 * ellers spiser den alle tryk i resten af appen.
 */
@Composable
fun GlassSheetHost(
    model: SheetModel,
    blæk: Color,
    overflade: Color,
    topIndhak: Dp,
    bundIndhak: Dp,
    onAction: (String) -> Unit,
) {
    val req = model.request

    // Kortet skal blive stående mens det animerer UD, hvor request allerede er null.
    var sidste by remember { mutableStateOf<SheetRequest?>(null) }
    LaunchedEffect(req) { if (req != null) sidste = req }

    val send: (String) -> Unit = { handling ->
        // Låsen gælder kun HANDLINGER (mod dobbelt-tryk på fx "Slet"). __cancel skal
        // ALTID kunne sendes, ellers findes der ingen vej ud hvis web aldrig svarer på
        // den første handling: webs vfSheet er alligevel idempotent for __cancel.
        if (handling == "__cancel") onAction(handling)
        else if (model.lås()) onAction(handling)
    }

    Box(Modifier.fillMaxSize()) {
        AnimatedVisibility(
            visible = req != null,
            enter = fadeIn(spring(stiffness = 341.5f)),
            exit = fadeOut(spring(stiffness = 341.5f)),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.28f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { send("__cancel") },
            )
        }

        // Kortet centreres i SAFE-AREA-rektanglet, ikke i den fysiske skærm. Kun scrimen
        // dækker helt ud til kanterne.
        BoxWithConstraints(
            Modifier
                .fillMaxSize()
                .padding(top = topIndhak, bottom = bundIndhak),
            contentAlignment = Alignment.Center,
        ) {
            // Person-listen bygger én række per person og har ingen maks-højde på iPhone, så
            // en kreds med 40 medlemmer løber ud over skærmen. Her får gruppen et loft.
            val maksGruppe = maxHeight * 0.7f
            AnimatedVisibility(
                visible = req != null,
                enter = scaleIn(spring(0.84f, 341.5f), initialScale = 0.94f) +
                    fadeIn(spring(0.84f, 341.5f)),
                exit = scaleOut(spring(0.84f, 341.5f), targetScale = 0.94f) +
                    fadeOut(spring(0.84f, 341.5f)),
            ) {
                sidste?.let { GlasKort(it, blæk, overflade, maksGruppe, model.låst, send) }
            }
        }
    }
}

@Composable
private fun GlasKort(
    req: SheetRequest,
    blæk: Color,
    overflade: Color,
    maksGruppeHøjde: Dp,
    låst: Boolean,
    send: (String) -> Unit,
) {
    val handlinger = req.buttons.filter { it.role != "cancel" }
    // To knapper med rolle "cancel" giver kun én pille. Den anden forsvinder, som på iPhone.
    val annuller = req.buttons.firstOrNull { it.role == "cancel" }
    // Preview VINDER over titel, aldrig begge. Sendes begge, forsvinder titel og note tavst.
    val harHeader = req.preview != null || req.title.isNotEmpty()

    Column(
        modifier = Modifier
            .padding(horizontal = 28.dp)
            .widthIn(max = 300.dp)
            // Et tryk på kortet uden for en knap skal SLUGES. Ellers falder det ned i scrimen
            // og annullerer flowet.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) {}
            // Trin 2 i to-trins-flowet skifter kortets indhold. Størrelsen skal morfe, ikke
            // krydsfade, ellers bevæger den sig anderledes end på iPhone.
            .animateContentSize(spring(0.84f, 341.5f)),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (req.emojis.isNotEmpty()) {
            EmojiRække(req.emojis, req.selected, blæk, overflade, låst, send)
        }

        Column(
            Modifier
                .glasPille(blæk, overflade)
                .heightIn(max = maksGruppeHøjde)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            val p = req.preview
            if (p != null) {
                PreviewHeader(p, blæk)
            } else if (req.title.isNotEmpty()) {
                TitelHeader(req.title, req.message, blæk)
            }
            handlinger.forEachIndexed { idx, knap ->
                if (idx > 0 || harHeader) Hårstreg(blæk)
                RækkeKnap(knap, blæk, låst, send)
            }
        }

        // Annuller tages UD af gruppen og får sin egen pille under kortet.
        annuller?.let {
            Box(Modifier.glasPille(blæk, overflade)) { RækkeKnap(it, blæk, låst, send) }
        }
    }
}

/**
 * Rækkefølgen shadow, clip, background, border er den samme som de native barer bruger, og
 * det er den der undgår den mørke streg under pillen.
 */
private fun Modifier.glasPille(blæk: Color, overflade: Color): Modifier {
    val form = RoundedCornerShape(20.dp)
    return this
        .shadow(20.dp, form, clip = false)
        .clip(form)
        .background(overflade.copy(alpha = 0.86f))
        .border(1.dp, blæk.copy(alpha = 0.10f), form)
}

@Composable
private fun RækkeKnap(knap: SheetButton, blæk: Color, låst: Boolean, send: (String) -> Unit) {
    Text(
        text = knap.label,
        fontSize = 17.sp,
        fontWeight = if (knap.role == "default") FontWeight.Normal else FontWeight.SemiBold,
        color = if (knap.role == "destructive") BRAND else blæk,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            // vfPress FØR polstringen, så hele rækkens højde er trykbar.
            .vfPress(VfPress.CARD, enabled = !låst) { send(knap.action) }
            .padding(vertical = 15.dp),
    )
}

@Composable
private fun Hårstreg(blæk: Color) {
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(blæk.copy(alpha = 0.12f)))
}

@Composable
private fun TitelHeader(titel: String, note: String, blæk: Color) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(3.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = titel,
            fontSize = 16.sp,
            fontWeight = FontWeight.SemiBold,
            color = blæk,
            textAlign = TextAlign.Center,
        )
        // En note uden titel vises aldrig. Den bor inde i titel-headeren.
        if (note.isNotEmpty()) {
            Text(
                text = note,
                fontSize = 13.sp,
                color = blæk.copy(alpha = 0.6f),
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** Den eneste venstrestillede del af kortet. Teksten er RÅ fra web, aldrig HTML. */
@Composable
private fun PreviewHeader(p: SheetPreview, blæk: Color) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp),
        horizontalArrangement = Arrangement.spacedBy(11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        VfPlainAvatar(p.avatarUrl, p.initials, blæk, 38.dp)
        Column(
            Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text(
                text = p.name,
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
                color = blæk,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (p.snippet.isNotEmpty()) {
                Text(
                    text = p.snippet,
                    fontSize = 13.sp,
                    color = blæk.copy(alpha = 0.6f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

/**
 * Chattens seks reaktioner i deres egen pille over kortet. Web sender dem kun når
 * `__vfSheetEmojis` er sat, men native tegner dem hver gang listen er ikke tom.
 *
 * Bredden er spids: en emoji fylder cirka 1,17 gange punktstørrelsen, så seks styks lander
 * lige omkring de 300 dp. Måles på en rigtig telefon før flaget tændes.
 */
@Composable
private fun EmojiRække(
    emojis: List<String>,
    valgt: String,
    blæk: Color,
    overflade: Color,
    låst: Boolean,
    send: (String) -> Unit,
) {
    Row(
        Modifier
            .widthIn(max = 300.dp)
            .glasPille(blæk, overflade)
            .padding(horizontal = 9.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        emojis.forEach { e ->
            Text(
                text = e,
                fontSize = 27.sp,
                modifier = Modifier
                    .clip(CircleShape)
                    .background(if (e == valgt) blæk.copy(alpha = 0.14f) else Color.Transparent)
                    .vfPress(VfPress.BOUNCE, enabled = !låst) { send("emoji:$e") }
                    .padding(7.dp),
            )
        }
    }
}
