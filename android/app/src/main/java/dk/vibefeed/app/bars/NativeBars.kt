package dk.vibefeed.app.bars

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

internal val BRAND = Color(0xFFE0402F)

/* ============================================================ tilstand */

/**
 * Fanebjælkens tilstand, drevet af web over broen (beskeden type:"tab").
 *
 * Felterne må KUN overskrives når de faktisk står i beskeden, præcis som Swift gør. Ellers
 * nulstilles et highlight den dag web udelader et felt.
 */
class TabBarModel {
    var active by mutableStateOf("feed")
    var dot by mutableStateOf(false)
    var chatDot by mutableStateOf(false)
    var compact by mutableStateOf(false)
    var visible by mutableStateOf(true)

    fun apply(json: JSONObject) {
        if (json.has("active")) active = json.optString("active")
        if (json.has("dot")) dot = json.optBoolean("dot")
        if (json.has("chatDot")) chatDot = json.optBoolean("chatDot")
        if (json.has("compact")) compact = json.optBoolean("compact")
        if (json.has("visible")) visible = json.optBoolean("visible")
    }
}

data class KredsItem(
    val id: String,
    val kind: String, // search | all | kreds | new
    val name: String,
    val active: Boolean,
    val unread: Boolean,
)

/** Kreds-vælgerens tilstand (beskeden type:"kreds"). */
class KredsBarModel {
    var items by mutableStateOf<List<KredsItem>>(emptyList())
    var compact by mutableStateOf(false)
    var visible by mutableStateOf(false)

    fun apply(json: JSONObject) {
        json.optJSONArray("items")?.let { arr ->
            items = (0 until arr.length()).mapNotNull { i ->
                arr.optJSONObject(i)?.let { o ->
                    val id = o.optString("id")
                    val kind = o.optString("kind")
                    if (id.isBlank() || kind.isBlank()) null
                    else KredsItem(id, kind, o.optString("name"), o.optBoolean("active"), o.optBoolean("unread"))
                }
            }
        }
        if (json.has("compact")) compact = json.optBoolean("compact")
        if (json.has("visible")) visible = json.optBoolean("visible")
    }
}

/* ============================================================ fanebjælke */

/**
 * Fanebjælken. Samme mål som iOS: 58 høj, 6 indvendig og 16 udvendig margen, glidende
 * highlight bag ikonerne, 8 px røde prikker på klokken og beskeder.
 *
 * Ved scroll ned glider den 130 ned og fader helt ud, i stedet for bare at krympe.
 */
@Composable
fun NativeTabBar(
    model: TabBarModel,
    ink: Color,
    surface: Color,
    bottomInset: Dp,
    onTap: (String) -> Unit,
) {
    val faner = listOf("feed", "search", "chat", "akt", "profil")
    val skjult = model.compact || !model.visible
    val yOffset by animateDpAsState(
        targetValue = if (model.compact) 130.dp else 0.dp,
        animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
        label = "tabOffset",
    )
    val alpha by animateFloatAsState(
        targetValue = if (skjult) 0f else 1f,
        animationSpec = tween(200),
        label = "tabAlpha",
    )
    // Samme regel som kreds-baren: en usynlig bjælke skal HELT ud af hit-testen, ellers
    // æder den webbens tryk i bunden (fx billedknappen i tanke-komposeren og chattens
    // felt). compact glider selv af skærmen, men visible=false gjorde ikke.
    if (skjult && alpha == 0f) return
    val valgt = faner.indexOf(model.active).coerceAtLeast(0)

    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            // Samme placering som web-bjælken havde: max(8, indhak - 8) over kanten, så den
            // ikke klistrer til hjemme-streget.
            .padding(bottom = maxOf(8.dp, bottomInset - 8.dp))
            .offset(y = yOffset)
            .alpha(alpha)
            .padding(horizontal = 16.dp),
    ) {
        val bredde = maxWidth - 12.dp // fratrukket den indvendige margen på 6 i hver side
        val fanebredde = bredde / faner.size
        val pilleX by animateDpAsState(
            targetValue = 6.dp + fanebredde * valgt,
            animationSpec = spring(dampingRatio = 0.72f, stiffness = Spring.StiffnessMediumLow),
            label = "pille",
        )

        Box(
            Modifier
                .fillMaxWidth()
                .height(58.dp)
                .shadow(12.dp, CircleShape, clip = false)
                .clip(CircleShape)
                .background(surface.copy(alpha = 0.86f))
                .border(1.dp, ink.copy(alpha = 0.10f), CircleShape),
        ) {
            // Den glidende markør bag ikonerne
            Box(
                Modifier
                    .offset(x = pilleX + 5.dp)
                    .align(Alignment.CenterStart)
                    .width(fanebredde - 10.dp)
                    .height(40.dp)
                    .clip(CircleShape)
                    .background(ink.copy(alpha = 0.14f)),
            )
            Row(Modifier.fillMaxSize().padding(horizontal = 6.dp)) {
                faner.forEach { id ->
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clickable(
                                enabled = !skjult,
                                interactionSource = remember { MutableInteractionSource() },
                                indication = null,
                            ) {
                                model.active = id // optimistisk highlight, som på iOS
                                onTap(id)
                            },
                        contentAlignment = Alignment.Center,
                    ) {
                        Box {
                            VfIcon(VfIcons.forTab(id, model.active == id), ink, 21.dp)
                            val prik = (id == "akt" && model.dot) || (id == "chat" && model.chatDot)
                            if (prik) {
                                Box(
                                    Modifier
                                        .align(Alignment.TopEnd)
                                        .offset(x = 6.dp, y = (-3).dp)
                                        .size(8.dp)
                                        .clip(CircleShape)
                                        .background(Color.Red),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/* ============================================================ opret-knapper */

/**
 * De to flydende opret-knapper. Minde øverst, tanke nederst, fordi den nederste er nemmest
 * at nå. De gemmer sig IKKE ved scroll som bjælken, de glider 44 ned i den plads den efterlader.
 */
@Composable
fun NativeComposeButtons(
    model: TabBarModel,
    bottomInset: Dp,
    onTap: (String) -> Unit,
) {
    val vist = model.visible && model.active == "feed"
    val yOffset by animateDpAsState(
        targetValue = if (model.compact) 44.dp else 0.dp,
        animationSpec = spring(dampingRatio = 0.58f, stiffness = Spring.StiffnessMediumLow),
        label = "fabOffset",
    )
    val alpha by animateFloatAsState(
        targetValue = if (vist) 1f else 0f,
        animationSpec = tween(200),
        label = "fabAlpha",
    )
    // Usynlige knapper skal helt ud af hit-testen, ellers æder de webbens tryk.
    if (!vist && alpha == 0f) return

    Column(
        Modifier
            .padding(end = 18.dp, bottom = bottomInset + 60.dp)
            .offset(y = yOffset)
            .alpha(alpha),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        FabKnap(VfIcons.Photo, vist) { onTap("compose-memory") }
        FabKnap(VfIcons.Plus, vist) { onTap("compose-thought") }
    }
}

@Composable
private fun FabKnap(ikon: VfIcon, aktiv: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .size(56.dp)
            .shadow(10.dp, CircleShape, clip = false)
            .clip(CircleShape)
            .background(BRAND)
            .clickable(
                enabled = aktiv,
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        VfIcon(ikon, Color.White, 22.dp)
    }
}

/* ============================================================ kreds-bar */

/**
 * Kreds-vælgeren. Søgningen er 100 procent native: lupen åbner et felt, og listen filtreres
 * lokalt til "Hele kredsen" plus de kredse der matcher, uden at web bliver spurgt.
 */
@Composable
fun NativeKredsBar(
    model: KredsBarModel,
    ink: Color,
    surface: Color,
    background: Color,
    topInset: Dp,
    søgTekst: String,
    onTap: (String) -> Unit,
) {
    var søger by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    val fokus = remember { FocusRequester() }

    LaunchedEffect(model.visible) {
        if (!model.visible) { søger = false; query = "" }
    }

    val topPadRå by animateDpAsState(
        targetValue = if (model.compact) 0.dp else 52.dp,
        animationSpec = spring(dampingRatio = 0.82f, stiffness = Spring.StiffnessMediumLow),
        label = "kredsTop",
    )
    // En fjeder UNDERSKYDER under målet. Går den under nul, kaster Compose
    // "Padding must be non-negative" og hele appen går ned. Derfor klemmes den fast.
    val topPad = topPadRå.coerceAtLeast(0.dp)
    val alpha by animateFloatAsState(
        targetValue = if (model.visible) 1f else 0f,
        animationSpec = tween(180),
        label = "kredsAlpha",
    )
    // En usynlig bar må ikke blive liggende i hit-testen: så æder den webbens tryk i
    // toppen (fx tilbage-pilen på en åben web-side). Væk er væk, når faden er færdig.
    if (!model.visible && alpha == 0f) return

    val vist = remember(model.items, søger, query) {
        if (!søger) model.items else {
            val q = query.lowercase()
            model.items.filter {
                when (it.kind) {
                    "all" -> true
                    "kreds" -> q.isEmpty() || it.name.lowercase().contains(q)
                    else -> false
                }
            }
        }
    }

    Column(
        Modifier
            .fillMaxWidth()
            .padding(top = topInset + topPad)
            .padding(vertical = 7.dp)
            .alpha(alpha),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (søger) {
            Row(
                Modifier
                    .padding(horizontal = 12.dp)
                    .fillMaxWidth()
                    .height(40.dp)
                    .clip(CircleShape)
                    .background(surface.copy(alpha = 0.86f))
                    .border(1.dp, ink.copy(alpha = 0.10f), CircleShape)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(9.dp),
            ) {
                VfIcon(VfIcons.Search, ink.copy(alpha = 0.6f), 15.dp)
                BasicTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    textStyle = TextStyle(color = ink, fontSize = 15.sp),
                    cursorBrush = SolidColor(BRAND),
                    modifier = Modifier.weight(1f).focusRequester(fokus),
                    decorationBox = { indre ->
                        if (query.isEmpty()) {
                            Text(søgTekst, color = ink.copy(alpha = 0.45f), fontSize = 15.sp)
                        }
                        indre()
                    },
                )
                Box(
                    Modifier.size(36.dp).clickable {
                        query = ""; søger = false
                    },
                    contentAlignment = Alignment.Center,
                ) {
                    VfIcon(VfIcons.Close, ink.copy(alpha = 0.6f), 14.dp)
                }
            }
            LaunchedEffect(Unit) { runCatching { fokus.requestFocus() } }
        }

        Row(
            Modifier
                .height(44.dp)
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            vist.forEach { item ->
                Chip(
                    item = item,
                    ink = ink,
                    surface = surface,
                    background = background,
                    enabled = model.visible,
                ) {
                    if (item.kind == "search") {
                        søger = true
                    } else {
                        onTap(item.id)
                        søger = false; query = ""
                    }
                }
            }
        }
    }
}

@Composable
private fun Chip(
    item: KredsItem,
    ink: Color,
    surface: Color,
    background: Color,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    val forgrund = when {
        item.active -> background
        item.kind == "new" -> BRAND
        else -> ink
    }
    val baggrund = if (item.active) ink else surface.copy(alpha = 0.86f)

    Row(
        Modifier
            .height(36.dp)
            .clip(CircleShape)
            .background(baggrund)
            .then(
                if (item.active) Modifier
                else Modifier.border(1.dp, ink.copy(alpha = 0.10f), CircleShape)
            )
            .clickable(enabled = enabled) { onClick() }
            .padding(horizontal = if (item.kind == "search") 0.dp else 15.dp)
            .width(if (item.kind == "search") 36.dp else Dp.Unspecified),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
    ) {
        if (item.kind == "search") {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                VfIcon(VfIcons.Search, forgrund, 15.dp)
            }
        } else {
            Text(item.name, color = forgrund, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            if (item.unread) {
                Box(Modifier.size(7.dp).clip(CircleShape).background(Color.Red))
            }
        }
    }
}
