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
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import dk.vibefeed.app.bars.BRAND
import dk.vibefeed.app.bars.VfIcon
import dk.vibefeed.app.bars.VfIcons
import dk.vibefeed.app.composer.Mentions
import dk.vibefeed.app.ui.VfGlassAvatar
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Selve kommentar-arket. Al forretningslogik bor i web; arket tegner snapshottet og
 * melder fem slags handlinger tilbage gennem `window.vfComments`: send, like, delete,
 * profile og dismiss. postId sendes ALTID med, som streng.
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
                // Grebet, det ENESTE træk-følsomme sted. dragY følger fingeren nedad og
                // fjedrer ALTID tilbage til 0; selv når trækket lukker, glider arket på
                // plads og forsvinder først når web ekkoer close.
                Box(
                    Modifier
                        .padding(top = 8.dp, bottom = 6.dp)
                        .pointerInput(Unit) {
                            var akk = 0f
                            var sidsteDelta = 0f
                            detectDragGestures(
                                onDragStart = { akk = 0f; sidsteDelta = 0f },
                                onDrag = { change, delta ->
                                    change.consume()
                                    akk += delta.y
                                    sidsteDelta = delta.y
                                    scope.launch { dragY.snapTo(max(0f, akk)) }
                                },
                                onDragEnd = {
                                    // Flick nedad tæller som luk, ligesom iOS' forudsagte
                                    // slutposition. 16 px per frame ved 60 Hz er ~1000 dp/s.
                                    if (dragY.value > luk110 || sidsteDelta > 16f) dismiss()
                                    scope.launch { dragY.animateTo(0f, spring(0.85f, 440f)) }
                                },
                                onDragCancel = {
                                    scope.launch { dragY.animateTo(0f, spring(0.85f, 440f)) }
                                },
                            )
                        }
                        .width(38.dp)
                        .height(5.dp)
                        .clip(CircleShape)
                        .background(blæk.copy(alpha = 0.28f)),
                )

                Text(
                    text = model.title.ifBlank { "…" },
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = blæk,
                    modifier = Modifier.padding(bottom = 10.dp),
                )

                Tråd(model, blæk, send, Modifier.weight(1f, fill = false))

                Composer(model, blæk, bundIndhak, send)
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
    val scope = rememberCoroutineScope()
    var fremhævet by remember { mutableStateOf<String?>(null) }
    val fremhævAlpha = remember { Animatable(0f) }

    // Deep-link: scroll og fremhævning kører som TO parallelle timere fra samme
    // nulpunkt, fordi animateScrollToItem suspenderer.
    LaunchedEffect(model.token) {
        val id = model.focusId ?: return@LaunchedEffect
        val idx = model.comments.indexOfFirst { it.id == id }
        if (idx < 0) return@LaunchedEffect
        model.focusId = null
        fremhævet = id
        fremhævAlpha.snapTo(0.08f)
        launch {
            delay(250)
            listState.animateScrollToItem(idx)
        }
        launch {
            delay(2200)
            fremhævAlpha.animateTo(0f, tween(400))
            fremhævet = null
        }
    }

    // Efter egen afsendelse ruller listen til bunden, springes over ved tom liste.
    LaunchedEffect(model.scrollToken) {
        if (model.scrollToken > 0 && model.comments.isNotEmpty()) {
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
            Modifier.fillMaxWidth().padding(vertical = 40.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(model.labels.empty, fontSize = 14.sp, color = blæk.copy(alpha = 0.6f))
        }
        return
    }

    LazyColumn(state = listState, modifier = modifier.fillMaxWidth()) {
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
                        // Web læser commentId, ikke id (js/comments.js:399).
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

@Composable
private fun KommentarRække(
    række: CommentRow,
    labels: CommentLabels,
    blæk: Color,
    fremhævAlpha: Float,
    armet: Boolean,
    onProfil: () -> Unit,
    onSvar: () -> Unit,
    onSlet: () -> Unit,
    onLike: () -> Unit,
) {
    val sekundær = blæk.copy(alpha = 0.6f)
    Box(
        Modifier
            .fillMaxWidth()
            .padding(start = if (række.indent > 0) 34.dp else 0.dp)
            .padding(horizontal = 8.dp)
            // Formen er ALTID der, kun alfaen skifter: det er dét der gør udtoningen mulig.
            .clip(RoundedCornerShape(14.dp))
            .background(blæk.copy(alpha = fremhævAlpha)),
    ) {
        Row(
            Modifier.padding(horizontal = 8.dp).padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Box(Modifier.vfPress(VfPress.CARD, onClick = onProfil)) {
                VfGlassAvatar(række.avatarUrl, række.initials, række.gradient, 30.dp)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                // Navnet er bevidst IKKE tappable: det er flettet ind i teksten for
                // ombrydningens skyld, som på iPhone.
                Text(
                    buildAnnotatedString {
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) {
                            append(række.name)
                        }
                        append("  ")
                        if (række.replyTo.isNotEmpty()) {
                            withStyle(SpanStyle(color = sekundær)) {
                                append("@${række.replyTo} ")
                            }
                        }
                        append(række.text)
                    },
                    fontSize = 14.sp,
                    color = blæk,
                )
                if (række.img.isNotEmpty()) {
                    SubcomposeAsyncImage(
                        model = række.img,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        loading = {
                            Box(Modifier.fillMaxSize().background(blæk.copy(alpha = 0.06f)))
                        },
                        modifier = Modifier
                            .padding(top = 2.dp)
                            .size(120.dp)
                            .clip(RoundedCornerShape(10.dp)),
                    )
                }
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(række.time, fontSize = 12.sp, color = sekundær)
                    if (række.likeCount > 0) {
                        Text(
                            "${række.likeCount}",
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = sekundær,
                        )
                    }
                    // 44 dp tryk-mål: en nøgen 12 sp tekst er ~15 dp, og mis-tap postede
                    // kommentaren på top-niveau i stedet for som svar.
                    Text(
                        labels.reply,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = sekundær,
                        modifier = Modifier
                            .vfPress(VfPress.FADE, onClick = onSvar)
                            .padding(vertical = 10.dp, horizontal = 5.dp),
                    )
                    if (række.mine) {
                        Text(
                            if (armet) labels.delConfirm else labels.del,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (armet) BRAND else sekundær,
                            modifier = Modifier
                                .vfPress(VfPress.FADE, onClick = onSlet)
                                .padding(vertical = 10.dp, horizontal = 5.dp),
                        )
                    }
                }
            }
            Box(
                Modifier
                    .padding(top = 2.dp)
                    .vfPress(VfPress.BOUNCE, onClick = onLike),
            ) {
                VfIcon(
                    if (række.liked) VfIcons.Heart else VfIcons.HeartOutline,
                    if (række.liked) BRAND else sekundær,
                    14.dp,
                )
            }
        }
    }
}

@Composable
private fun Composer(
    model: CommentsModel,
    blæk: Color,
    bundIndhak: Dp,
    send: (String, (JSONObject) -> Unit) -> Unit,
) {
    val sekundær = blæk.copy(alpha = 0.6f)
    val fokus = remember { FocusRequester() }

    LaunchedEffect(model.focusToken) {
        if (model.focusToken > 0 && model.canPost) {
            runCatching { fokus.requestFocus() }
        }
    }

    val sendTekst: (String) -> Unit = { tekst ->
        send("send") { o ->
            o.put("text", tekst)
            model.replyingToId?.let {
                o.put("replyTo", it)
                o.put("replyToU", model.replyingToHandle)
            }
        }
    }

    Column(
        Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 10.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(blæk.copy(alpha = 0.1f)))

        // Mention-strip, kun med kandidater og kun når man overhovedet kan poste.
        val hits = if (model.canPost) Mentions.hits(model.text, model.mentionables) else emptyList()
        if (hits.isNotEmpty()) {
            Row(
                Modifier.padding(horizontal = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                hits.forEach { kandidat ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        modifier = Modifier
                            .clip(CircleShape)
                            .background(blæk.copy(alpha = 0.08f))
                            .border(1.dp, blæk.copy(alpha = 0.10f), CircleShape)
                            .vfPress(VfPress.CHIP) {
                                model.text = Mentions.insert(model.text, kandidat.handle)
                            }
                            .padding(horizontal = 10.dp, vertical = 6.dp),
                    ) {
                        VfGlassAvatar(
                            kandidat.avatarUrl ?: "",
                            kandidat.initials,
                            kandidat.gradient,
                            22.dp,
                        )
                        Text(
                            "@${kandidat.handle}",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = blæk,
                            maxLines = 1,
                        )
                    }
                }
            }
        }

        // Svar-chippen. @ ligger inde i skabelonen, så det nøgne handle sættes ind.
        if (model.replyingToId != null) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    model.labels.replyingTo.replace("{u}", model.replyingToHandle),
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = sekundær,
                )
                Box(Modifier.weight(1f))
                Text(
                    model.labels.cancelReply,
                    fontSize = 12.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = BRAND,
                    modifier = Modifier.vfPress(VfPress.FADE) {
                        model.replyingToId = null
                        model.replyingToHandle = ""
                    },
                )
            }
        }

        // Emoji-baren er bevidst IKKE gated på canPost: web returnerer selv på if(!me).
        // Den respekterer et armeret svar, rydder svar-målet og rører ALDRIG udkastet.
        if (model.emoji.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                model.emoji.forEach { e ->
                    Text(
                        e,
                        fontSize = 24.sp,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .weight(1f)
                            .vfPress(VfPress.BOUNCE) {
                                sendTekst(e)
                                model.replyingToId = null
                                model.replyingToHandle = ""
                            },
                    )
                }
            }
        }

        if (model.canPost) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp)
                    .padding(bottom = maxOf(bundIndhak - 10.dp, 0.dp)),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier
                        .weight(1f)
                        .clip(CircleShape)
                        .background(blæk.copy(alpha = 0.08f))
                        .border(1.dp, blæk.copy(alpha = 0.10f), CircleShape)
                        .padding(horizontal = 14.dp, vertical = 9.dp),
                ) {
                    if (model.text.isEmpty()) {
                        Text(model.labels.placeholder, fontSize = 15.sp, color = sekundær)
                    }
                    BasicTextField(
                        value = model.text,
                        // Hård klipning til 280 tegn, mens MentionSupport selv AFBRYDER
                        // i stedet for at klippe midt i et handle.
                        onValueChange = { model.text = it.take(280) },
                        maxLines = 4,
                        textStyle = TextStyle(fontSize = 15.sp, color = blæk),
                        cursorBrush = SolidColor(BRAND),
                        modifier = Modifier.fillMaxWidth().focusRequester(fokus),
                    )
                }
                val klar = model.text.trim().isNotEmpty()
                Text(
                    model.labels.send,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = if (klar) BRAND else sekundær,
                    modifier = Modifier.vfPress(VfPress.POP, enabled = klar) {
                        val tekst = model.text.trim()
                        if (tekst.isNotEmpty()) {
                            // Optimistisk rydning FØR rundturen, som på iPhone. Fejler
                            // afsendelsen, er udkastet tabt her men bevaret i webbens state.
                            sendTekst(tekst)
                            model.text = ""
                            model.replyingToId = null
                            model.replyingToHandle = ""
                            model.scrollToken++
                        }
                    },
                )
            }
        }
    }
}
