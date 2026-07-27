package dk.vibefeed.app.pages

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.offset
import dk.vibefeed.app.bars.BRAND
import dk.vibefeed.app.bars.VfIcon
import dk.vibefeed.app.bars.VfIcons
import dk.vibefeed.app.ui.EaseOut
import dk.vibefeed.app.ui.VfGlassAvatar
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * Liste-siden: Venner og Kredse som Instagram-agtig fuldskærms-side, oversat fra
 * ios/VibeFeed/ListPageView.swift.
 *
 * Web bygger snapshotten med BEGGE datasæt og pusher den; faneskift og søgning er rent
 * native og web får dem aldrig at vide. `null` betyder spinner, tom liste betyder tom.
 * Fire kald går tilbage gennem `window.vfListPage`: profile, kreds, kredsreq og dismiss.
 */

data class ListFriend(
    val handle: String,
    val name: String,
    val avatarUrl: String,
    val initials: String,
    val gradient: List<String>,
)

data class ListKreds(
    val id: String,
    val name: String,
    /** Færdigformaterede strenge fra web ("3 medlemmer"). Native må aldrig bøje tal. */
    val members: String,
    val friends: String,
    val isMember: Boolean,
    val requested: Boolean,
)

data class ListLabels(
    val friendsTab: String = "",
    val kredseTab: String = "",
    val searchPh: String = "",
    val emptyFriends: String = "",
    val emptyKredse: String = "",
    val request: String = "",
    val requested: String = "",
)

class ListPageModel {

    var open by mutableStateOf(false)
        private set
    var title by mutableStateOf("")
        private set
    var tab by mutableStateOf("friends")
    var query by mutableStateOf("")
    var friends by mutableStateOf<List<ListFriend>?>(null)
        private set
    var kredse by mutableStateOf<List<ListKreds>?>(null)
        private set
    var labels by mutableStateOf(ListLabels())
        private set

    /** Bumpes af tilbage-pilen OG systemets tilbage-knap: glid ud først, dismiss bagefter. */
    var exitTick by mutableIntStateOf(0)
        private set

    fun exit() {
        exitTick++
    }

    /**
     * Apply-reglen, den vigtigste i skærmen: samme titel plus allerede åben betyder at KUN
     * data opdateres, så brugerens faneskift og søgetekst overlever en gen-push (fx den
     * optimistiske Anmod-flipning).
     */
    /** Generation: bumpes ved hvert åbn/luk, så et gammelt nødværn aldrig kan
     *  ramme en NY session der blev åbnet efter at timeren blev armeret. */
    var gen: Int = 0
        private set

    /** Nødværnet: lukker lokalt når web aldrig ekkoer close (reload-vindue). */
    fun lukLokalt() {
        open = false
        gen += 1
    }

    fun apply(json: JSONObject) {
        if (json.opt("close") == true) {
            // Luk nulstiller KUN open og query. Titel, faner, labels og begge datasæt
            // bliver stående, så en gen-åbning af samme side ikke blinker.
            open = false
            gen += 1
            query = ""
            return
        }
        if (json.opt("open") != true) return

        val nyTitel = json.opt("title") as? String ?: ""
        val frisk = !open || nyTitel != title
        title = nyTitel
        if (frisk) {
            tab = if ((json.opt("tab") as? String) == "kredse") "kredse" else "friends"
            query = ""
        }

        if (json.has("friends")) {
            friends = if (json.isNull("friends")) null else buildList {
                val arr = json.optJSONArray("friends") ?: return@buildList
                for (i in 0 until arr.length()) {
                    val f = arr.optJSONObject(i) ?: continue
                    add(
                        ListFriend(
                            handle = f.optString("handle"),
                            name = f.optString("name"),
                            avatarUrl = f.optString("avatarUrl"),
                            initials = f.optString("initials"),
                            gradient = buildList {
                                val g = f.optJSONArray("gradient") ?: return@buildList
                                for (j in 0 until g.length()) (g.opt(j) as? String)?.let { add(it) }
                            },
                        )
                    )
                }
            }
        }

        if (json.has("kredse")) {
            kredse = if (json.isNull("kredse")) null else buildList {
                val arr = json.optJSONArray("kredse") ?: return@buildList
                for (i in 0 until arr.length()) {
                    val k = arr.optJSONObject(i) ?: continue
                    add(
                        ListKreds(
                            id = k.optString("id"),
                            name = k.optString("name"),
                            members = k.optString("members"),
                            friends = k.optString("friends"),
                            isMember = k.optBoolean("isMember"),
                            requested = k.optBoolean("requested"),
                        )
                    )
                }
            }
        }

        // Labels UDSKIFTES HELT når nøglen er der. Mangler den, beholdes de forrige.
        json.optJSONObject("labels")?.let { l ->
            labels = ListLabels(
                friendsTab = l.optString("friendsTab"),
                kredseTab = l.optString("kredseTab"),
                searchPh = l.optString("searchPh"),
                emptyFriends = l.optString("emptyFriends"),
                emptyKredse = l.optString("emptyKredse"),
                request = l.optString("request"),
                requested = l.optString("requested"),
            )
        }

        open = true
        gen += 1
    }
}

/**
 * Værten: glider siden ind fra højre, ejer swipe-tilbage og holder siden i live mens den
 * animerer ud. Skal ligge UDEN FOR `if (nativeBars)` i overlayet.
 */
@Composable
fun ListPageHost(
    model: ListPageModel,
    blæk: Color,
    baggrund: Color,
    topIndhak: Dp,
    bundIndhak: Dp,
    onEvent: (JSONObject) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val breddePx = constraints.maxWidth.toFloat()
        val dragX = remember { Animatable(breddePx) }
        var synlig by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()

        LaunchedEffect(model.open) {
            if (model.open) {
                synlig = true
                dragX.animateTo(0f, tween(280, easing = EaseOut))
            } else if (synlig) {
                // Web lukkede uden vores dismiss (fx log ud): glid ud og forsvind, OGSÅ
                // hvis close ankom midt i ind-animationen eller et swipe. Kravet om
                // dragX == 0 lod ellers siden fryse halvvejs på skærmen.
                dragX.animateTo(breddePx, tween(280, easing = EaseOut))
                synlig = false
            }
        }

        // Tilbage-pil og systemets tilbage-knap: glid ud FØRST, send dismiss bagefter.
        LaunchedEffect(model.exitTick) {
            if (model.exitTick > 0 && synlig) {
                dragX.animateTo(breddePx, tween(280, easing = EaseOut))
                synlig = false
                onEvent(JSONObject().put("kind", "dismiss"))
            }
        }

        if (!synlig) return@BoxWithConstraints

        val density = androidx.compose.ui.platform.LocalDensity.current
        val greb18 = with(density) { 18.dp.toPx() }
        val luk90 = with(density) { 90.dp.toPx() }
        val fart1000 = with(density) { 1000.dp.toPx() }

        Box(
            Modifier
                .fillMaxSize()
                .offset { IntOffset(dragX.value.roundToInt(), 0) }
                .background(baggrund)
                // Siden skal SLUGE tryk, ellers scroller webviewet bagved.
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {}
                .pointerInput(Unit) {
                    // Swipe-tilbage. Compose giver DELTA per hændelse og regner i PIXELS,
                    // så tærsklerne 18, 90 og 1000 dp/s er omregnet med density ovenfor.
                    var dx = 0f
                    var dy = 0f
                    var iGang = false
                    val fart = VelocityTracker()
                    detectDragGestures(
                        onDragStart = {
                            dx = 0f; dy = 0f; iGang = false
                            fart.resetTracking()
                        },
                        onDrag = { change, delta ->
                            dx += delta.x
                            dy += delta.y
                            fart.addPointerInputChange(change)
                            if (!iGang && dx > greb18 && abs(dx) > abs(dy) * 1.4f) iGang = true
                            if (iGang) {
                                change.consume()
                                scope.launch {
                                    dragX.snapTo((dragX.value + delta.x).coerceAtLeast(0f))
                                }
                            }
                        },
                        onDragEnd = {
                            if (!iGang) return@detectDragGestures
                            val v = fart.calculateVelocity().x
                            if (dragX.value > luk90 || v > fart1000) {
                                // Ved swipe sendes dismiss MED DET SAMME, ikke bagefter.
                                onEvent(JSONObject().put("kind", "dismiss"))
                                scope.launch {
                                    dragX.animateTo(breddePx, tween(200, easing = EaseOut))
                                    synlig = false
                                }
                            } else {
                                scope.launch {
                                    dragX.animateTo(0f, spring(0.85f, 440f))
                                }
                            }
                        },
                        onDragCancel = {
                            // Et annulleret træk fjedrer tilbage, ellers står siden forskudt
                            if (iGang) {
                                iGang = false
                                scope.launch { dragX.animateTo(0f, spring(0.85f, 440f)) }
                            }
                        },
                    )
                },
        ) {
            ListPageContent(model, blæk, topIndhak, bundIndhak, onEvent)
        }
    }
}

@Composable
private fun ListPageContent(
    model: ListPageModel,
    blæk: Color,
    topIndhak: Dp,
    bundIndhak: Dp,
    onEvent: (JSONObject) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        // Header: titlen er personens handle, råt og uden @, også på egen profil.
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = topIndhak)
                .height(52.dp),
        ) {
            Text(
                text = model.title,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = blæk,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth()
                    .padding(horizontal = 60.dp),
            )
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .padding(horizontal = 12.dp)
                    .vfPress(VfPress.SCALE) { model.exit() }
                    .padding(6.dp),
            ) {
                VfIcon(VfIcons.ChevronLeft, blæk, 20.dp)
            }
        }

        // Fane-rækken. Skiftet er rent lokalt, web får det aldrig at vide, og
        // søgeteksten bliver stående (kun en frisk åbning nulstiller den).
        Row(Modifier.fillMaxWidth()) {
            Fane(model.labels.friendsTab, model.tab == "friends", blæk, Modifier.weight(1f)) {
                model.tab = "friends"
            }
            Fane(model.labels.kredseTab, model.tab == "kredse", blæk, Modifier.weight(1f)) {
                model.tab = "kredse"
            }
        }

        // Søgefeltet. Må ikke auto-fokusere, ingen versal-automatik, ingen autokorrektur.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp)
                .padding(top = 12.dp, bottom = 6.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(blæk.copy(alpha = 0.06f))
                .padding(horizontal = 12.dp, vertical = 10.dp),
        ) {
            Box(Modifier.alpha(0.6f)) { VfIcon(VfIcons.Search, blæk, 15.dp) }
            Box(Modifier.weight(1f)) {
                if (model.query.isEmpty()) {
                    Text(
                        text = model.labels.searchPh,
                        fontSize = 15.sp,
                        color = blæk.copy(alpha = 0.4f),
                        maxLines = 1,
                    )
                }
                BasicTextField(
                    value = model.query,
                    onValueChange = { model.query = it },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 15.sp, color = blæk),
                    cursorBrush = SolidColor(BRAND),
                    keyboardOptions = KeyboardOptions(
                        capitalization = KeyboardCapitalization.None,
                        autoCorrectEnabled = false,
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        val q = model.query.trim()
        // Scroller man i listen, glider tastaturet væk, som iOS' scrollDismissesKeyboard
        val listState = androidx.compose.foundation.lazy.rememberLazyListState()
        val fokus = androidx.compose.ui.platform.LocalFocusManager.current
        LaunchedEffect(listState.isScrollInProgress) {
            if (listState.isScrollInProgress) fokus.clearFocus()
        }
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(top = 4.dp, bottom = maxOf(16.dp, bundIndhak)),
            modifier = Modifier.fillMaxSize(),
        ) {
            if (model.tab == "friends") {
                val alle = model.friends
                if (alle == null) {
                    item { Spinner() }
                } else {
                    // Venner søges i både navn og handle. Kredse kun i navnet.
                    val viste = if (q.isEmpty()) alle else alle.filter {
                        it.name.contains(q, ignoreCase = true) ||
                            it.handle.contains(q, ignoreCase = true)
                    }
                    if (viste.isEmpty()) {
                        item { TomTekst(model.labels.emptyFriends, blæk) }
                    } else {
                        items(viste.size, key = { viste[it].handle }) { i ->
                            VenneRække(viste[i], blæk) {
                                onEvent(
                                    JSONObject()
                                        .put("kind", "profile")
                                        .put("handle", viste[i].handle)
                                )
                            }
                        }
                    }
                }
            } else {
                val alle = model.kredse
                if (alle == null) {
                    item { Spinner() }
                } else {
                    val viste = if (q.isEmpty()) alle else alle.filter {
                        it.name.contains(q, ignoreCase = true)
                    }
                    if (viste.isEmpty()) {
                        item { TomTekst(model.labels.emptyKredse, blæk) }
                    } else {
                        items(viste.size, key = { viste[it].id }) { i ->
                            KredsRække(viste[i], model.labels, blæk, onEvent)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Fane(
    tekst: String,
    aktiv: Boolean,
    blæk: Color,
    modifier: Modifier,
    onTap: () -> Unit,
) {
    // Farverne GLIDER ved faneskift som iOS' withAnimation(.easeOut 0.18); et hårdt
    // snap lignede en anden app.
    val tekstFarve by androidx.compose.animation.animateColorAsState(
        targetValue = if (aktiv) blæk else blæk.copy(alpha = 0.6f),
        animationSpec = tween(180, easing = EaseOut),
        label = "faneTekst",
    )
    val stregFarve by androidx.compose.animation.animateColorAsState(
        targetValue = if (aktiv) blæk else Color.Transparent,
        animationSpec = tween(180, easing = EaseOut),
        label = "faneStreg",
    )
    Column(
        modifier.vfPress(VfPress.FADE, onClick = onTap),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = tekst,
            fontSize = 15.sp,
            fontWeight = if (aktiv) FontWeight.Bold else FontWeight.SemiBold,
            color = tekstFarve,
            modifier = Modifier.padding(vertical = 12.dp),
        )
        // Understregningen fylder HELE halvdelens bredde. Ingen skillelinje under
        // rækken, det var et ejer-ønske på iPhone.
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(stregFarve),
        )
    }
}

@Composable
private fun VenneRække(ven: ListFriend, blæk: Color, onTap: () -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            .vfPress(VfPress.CARD, onClick = onTap)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        VfGlassAvatar(ven.avatarUrl, ven.initials, ven.gradient, 46.dp)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
            Text(
                text = ven.name,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = blæk,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = "@" + ven.handle,
                fontSize = 13.5.sp,
                color = blæk.copy(alpha = 0.6f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun KredsRække(
    kreds: ListKreds,
    labels: ListLabels,
    blæk: Color,
    onEvent: (JSONObject) -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier
            .fillMaxWidth()
            // Ikke-medlems-rækker viser tryk-animationen men gør intet. Det er
            // utilsigtet på iPhone, og kopieres for troskab.
            .vfPress(VfPress.CARD) {
                if (kreds.isMember) {
                    onEvent(JSONObject().put("kind", "kreds").put("id", kreds.id))
                }
            }
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        KredsIkon(blæk)
        Column(verticalArrangement = Arrangement.spacedBy(2.dp), modifier = Modifier.weight(1f)) {
            Text(
                text = kreds.name,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                color = blæk,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (kreds.friends.isBlank()) kreds.members
                else kreds.members + " · " + kreds.friends,
                fontSize = 13.5.sp,
                color = blæk.copy(alpha = 0.6f),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (kreds.isMember) {
            Box(Modifier.alpha(0.6f)) { VfIcon(VfIcons.ChevronRight, blæk, 14.dp) }
        } else {
            // Anmod-pillen. Native gætter ALDRIG tilstanden selv: web flipper requested
            // og pusher hele snapshotten igen før RPC-kaldet.
            Text(
                text = if (kreds.requested) labels.requested else labels.request,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                color = if (kreds.requested) blæk.copy(alpha = 0.6f) else Color.White,
                // vfPress FORREST: graphicsLayer skalerer kun det der ligger efter den i
                // kæden, så stod kapslen stille mens teksten skrumpede. iOS skalerer
                // hele pillen.
                modifier = Modifier
                    .vfPress(VfPress.POP) {
                        onEvent(
                            JSONObject()
                                .put("kind", "kredsreq")
                                .put("id", kreds.id)
                                .put("on", !kreds.requested)
                        )
                    }
                    .clip(CircleShape)
                    .background(if (kreds.requested) blæk.copy(alpha = 0.06f) else BRAND)
                    .padding(horizontal = 14.dp, vertical = 8.dp),
            )
        }
    }
}

/**
 * Kreds-ringen efter Swift-tallene: 20 dp lærred, ring med 1,6 dp streg og tre prikker
 * på 2,5 dp med centre i (0,-10), (-8.7,5.2) og (8.7,5.2). Prikkerne rager en anelse ud
 * over stregen, og det er den korrekte fortolkning, IKKE web-SVG'ens 24-viewport-tal.
 */
@Composable
private fun KredsIkon(blæk: Color) {
    Box(
        Modifier.size(46.dp).clip(CircleShape).background(blæk.copy(alpha = 0.06f)),
        contentAlignment = Alignment.Center,
    ) {
        val grå = blæk.copy(alpha = 0.6f)
        Canvas(Modifier.size(20.dp)) {
            val c = center
            drawCircle(
                color = grå,
                radius = size.minDimension / 2f - 0.8.dp.toPx(),
                style = Stroke(width = 1.6.dp.toPx()),
            )
            listOf(
                Offset(0f, -10f),
                Offset(-8.7f, 5.2f),
                Offset(8.7f, 5.2f),
            ).forEach { o ->
                drawCircle(
                    color = grå,
                    radius = 2.5.dp.toPx(),
                    center = Offset(c.x + o.x.dp.toPx(), c.y + o.y.dp.toPx()),
                )
            }
        }
    }
}

@Composable
private fun Spinner() {
    Box(
        Modifier.fillMaxWidth().padding(vertical = 40.dp),
        contentAlignment = Alignment.Center,
    ) {
        // Utonet grå som iOS' ProgressView, ikke brand-rød
        CircularProgressIndicator(color = Color.Gray, strokeWidth = 2.5.dp)
    }
}

@Composable
private fun TomTekst(tekst: String, blæk: Color) {
    Box(
        Modifier.fillMaxWidth().padding(vertical = 40.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = tekst,
            fontSize = 14.sp,
            color = blæk.copy(alpha = 0.6f),
            textAlign = TextAlign.Center,
        )
    }
}
