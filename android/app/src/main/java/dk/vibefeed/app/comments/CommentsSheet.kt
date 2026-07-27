package dk.vibefeed.app.comments

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.platform.LocalDensity
import dk.vibefeed.app.ui.vfSkjulTastaturVedTraek
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Selve kommentar-arket. Al forretningslogik bor i web; arket tegner snapshottet og
 * melder fem slags handlinger tilbage gennem `window.vfComments`: send, like, delete,
 * profile og dismiss. postId sendes ALTID med, som streng, og like/delete bærer
 * `commentId` (js/comments.js:398), ikke `id`.
 */
@Composable
fun CommentsSheetHost(
    model: CommentsModel,
    blæk: Color,
    overflade: Color,
    bundIndhak: Dp,
    onEvent: (JSONObject) -> Unit,
) {
    val send: (String, (JSONObject) -> Unit) -> Unit = { kind, fyld ->
        val o = JSONObject().put("kind", kind).put("postId", model.postId)
        fyld(o)
        onEvent(o)
    }
    val dismiss = { send("dismiss") {} }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val maksHøjde = maxHeight * 0.9f
        val scope = rememberCoroutineScope()
        val dragY = remember { Animatable(0f) }

        AnimatedVisibility(
            visible = model.open,
            enter = fadeIn(spring(stiffness = 304.6f)),
            exit = fadeOut(spring(stiffness = 304.6f)),
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.28f))
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { dismiss() },
            )
        }

        AnimatedVisibility(
            visible = model.open,
            enter = slideInVertically(spring(0.86f, 304.6f)) { it } + fadeIn(spring(0.86f, 304.6f)),
            exit = slideOutVertically(spring(0.86f, 304.6f)) { it } + fadeOut(spring(0.86f, 304.6f)),
            modifier = Modifier.align(Alignment.BottomCenter),
        ) {
            val form = RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)
            val density = LocalDensity.current
            val luk110 = with(density) { 110.dp.toPx() }

            Column(
                Modifier
                    .offset { IntOffset(0, dragY.value.roundToInt()) }
                    .fillMaxWidth()
                    .heightIn(max = maksHøjde)
                    .shadow(18.dp, form, clip = false)
                    .clip(form)
                    .background(overflade.copy(alpha = 0.86f))
                    .border(1.dp, blæk.copy(alpha = 0.10f), form)
                    // Arket skal sluge tryk, ellers annullerer et fejltryk gennem scrimen.
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) {},
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // Grebet, det ENESTE træk-følsomme sted. Trækfladen er ARKETS FULDE
                // bredde (kapslen er kun pynt i midten), som iOS' contentShape, og
                // flick måles i ægte dp/s med VelocityTracker: sidste-frame-deltaet
                // var frame-rate-afhængigt og dobbelt så følsomt ved 120 Hz.
                // dragY fjedrer ALTID tilbage til 0; selv når trækket lukker, glider
                // arket på plads og forsvinder først når web ekkoer close.
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp, bottom = 6.dp)
                        .pointerInput(Unit) {
                            var akk = 0f
                            val fart = androidx.compose.ui.input.pointer.util.VelocityTracker()
                            val flick1000 = 1000.dp.toPx()
                            detectDragGestures(
                                onDragStart = { akk = 0f; fart.resetTracking() },
                                onDrag = { change, delta ->
                                    change.consume()
                                    akk += delta.y
                                    fart.addPointerInputChange(change)
                                    scope.launch { dragY.snapTo(max(0f, akk)) }
                                },
                                onDragEnd = {
                                    val v = fart.calculateVelocity().y
                                    if (dragY.value > luk110 || v > flick1000) dismiss()
                                    scope.launch { dragY.animateTo(0f, spring(0.85f, 440f)) }
                                },
                                onDragCancel = {
                                    scope.launch { dragY.animateTo(0f, spring(0.85f, 440f)) }
                                },
                            )
                        },
                    contentAlignment = Alignment.Center,
                ) {
                    Box(
                        Modifier
                            .width(38.dp)
                            .height(5.dp)
                            .clip(CircleShape)
                            .background(blæk.copy(alpha = 0.28f)),
                    )
                }

                Text(
                    text = model.title.ifBlank { "…" },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = blæk,
                    modifier = Modifier.padding(bottom = 10.dp),
                )

                Tråd(model, blæk, send, Modifier.weight(1f, fill = false))

                // Det ægte indhak lægges OVEN I composerens interne polstring, som iOS
                KommentarComposer(model, blæk, bundIndhak, send)
            }
        }
    }
}

@Composable
private fun Tråd(
    model: CommentsModel,
    blæk: Color,
    send: (String, (JSONObject) -> Unit) -> Unit,
    modifier: Modifier,
) {
    val listState = rememberLazyListState()
    var fremhævet by remember { mutableStateOf<String?>(null) }
    val fremhævAlpha = remember { Animatable(0f) }

    // Deep-link: scroll og fremhævning kører som TO parallelle timere fra samme
    // nulpunkt, fordi animateScrollToItem suspenderer. Timerne bor i deres EGEN effekt,
    // nøglet på målet: web pusher et snapshot ved hver render, og lå de i token-
    // effekten, blev flashen annulleret af det næste snapshot før den nåede at falme.
    var fremhævMål by remember { mutableStateOf<Pair<String, Int>?>(null) }
    LaunchedEffect(model.token) {
        val id = model.focusId ?: return@LaunchedEffect
        val idx = model.comments.indexOfFirst { it.id == id }
        if (idx < 0) return@LaunchedEffect
        model.focusId = null
        fremhævMål = id to idx
    }
    LaunchedEffect(fremhævMål) {
        val (id, idx) = fremhævMål ?: return@LaunchedEffect
        fremhævet = id
        fremhævAlpha.snapTo(0.08f)
        launch {
            delay(250)
            listState.animateScrollToItem(idx)
        }
        delay(2200)
        fremhævAlpha.animateTo(0f, tween(400))
        fremhævet = null
        fremhævMål = null
    }

    // Efter egen afsendelse ruller listen til bunden, springes over ved tom liste.
    // Første komposition tæller IKKE: scrollToken ryddes ikke ved close, så en
    // genåbning af arket ville ellers auto-scrolle til bunden med det samme.
    var sidsteScrollToken by remember { mutableIntStateOf(model.scrollToken) }
    LaunchedEffect(model.scrollToken) {
        if (model.scrollToken == sidsteScrollToken) return@LaunchedEffect
        sidsteScrollToken = model.scrollToken
        if (model.comments.isNotEmpty()) {
            listState.animateScrollToItem(model.comments.lastIndex)
        }
    }

    // To-trins slet: armeringen falder efter 3 sekunder, men kun hvis arket stadig er
    // åbent og id'et stadig er det samme.
    LaunchedEffect(model.deleteArmId) {
        val armet = model.deleteArmId ?: return@LaunchedEffect
        delay(3000)
        if (model.open && model.deleteArmId == armet) model.deleteArmId = null
    }

    if (model.comments.isEmpty()) {
        Box(
            Modifier.fillMaxWidth().padding(vertical = 34.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(model.labels.empty, fontSize = 14.sp, color = blæk.copy(alpha = 0.6f))
        }
        return
    }

    LazyColumn(
        state = listState,
        // Træk nedad i tråden gemmer tastaturet, som på iPhone
        modifier = modifier.fillMaxWidth().vfSkjulTastaturVedTraek(),
    ) {
        items(model.comments.size, key = { model.comments[it].id }) { i ->
            val række = model.comments[i]
            KommentarRække(
                række = række,
                labels = model.labels,
                blæk = blæk,
                fremhævAlpha = if (række.id == fremhævet) fremhævAlpha.value else 0f,
                armet = model.deleteArmId == række.id,
                onProfil = { send("profile") { it.put("handle", række.handle) } },
                onSvar = {
                    model.replyingToId = række.id
                    model.replyingToHandle = række.handle
                    model.focusToken++
                },
                onSlet = {
                    if (model.deleteArmId == række.id) {
                        model.deleteArmId = null
                        send("delete") { it.put("commentId", række.id) }
                    } else {
                        model.deleteArmId = række.id
                    }
                },
                onLike = { send("like") { it.put("commentId", række.id) } },
            )
        }
    }
}
