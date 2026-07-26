package dk.vibefeed.app.post

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import dk.vibefeed.app.bars.BRAND
import dk.vibefeed.app.bars.VfIcon
import dk.vibefeed.app.bars.VfIcons
import dk.vibefeed.app.comments.KommentarComposer
import dk.vibefeed.app.comments.KommentarRække
import dk.vibefeed.app.ui.EaseOut
import dk.vibefeed.app.ui.VfGlassAvatar
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Den X-agtige detalje-side for tanker: opslaget øverst, tråden under, composer i bunden,
 * swipe-tilbage hvor som helst. Web ejer alt indhold; siden lukker først når web ekkoer
 * close, og udgangs-animationen drives af den SAMME værdi som fingeren styrer.
 */
@Composable
fun PostPageHost(
    model: PostPageModel,
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

        val send: (String, (JSONObject) -> Unit) -> Unit = { kind, fyld ->
            val o = JSONObject().put("kind", kind).put("postId", model.postId)
            fyld(o)
            onEvent(o)
        }

        // Ud-glidningen: via knap venter dismiss på animationen (ellers "hopper" den),
        // via swipe sendes dismiss MED DET SAMME (siden er allerede næsten ude).
        fun glidUd(hurtigt: Boolean, dismissStraks: Boolean) {
            scope.launch {
                if (dismissStraks) send("dismiss") {}
                dragX.animateTo(breddePx, tween(if (hurtigt) 200 else 280, easing = EaseOut))
                synlig = false
                if (!dismissStraks) send("dismiss") {}
            }
        }

        LaunchedEffect(model.open) {
            if (model.open) {
                synlig = true
                dragX.animateTo(0f, tween(280, easing = EaseOut))
            } else if (synlig && dragX.value == 0f) {
                // Uopfordret close (opslaget forsvandt, logout): glid ud uden dismiss.
                dragX.animateTo(breddePx, tween(280, easing = EaseOut))
                synlig = false
            }
        }

        LaunchedEffect(model.exitTick) {
            if (model.exitTick > 0 && synlig) glidUd(hurtigt = false, dismissStraks = false)
        }

        if (!synlig) return@BoxWithConstraints

        val density = LocalDensity.current
        val greb18 = with(density) { 18.dp.toPx() }
        val luk90 = with(density) { 90.dp.toPx() }
        val fart1000 = with(density) { 1000.dp.toPx() }

        Column(
            Modifier
                .fillMaxSize()
                .offset { IntOffset(max(0f, dragX.value).roundToInt(), 0) }
                .background(baggrund)
                // Siden skal SLUGE tryk, ellers scroller webviewet bagved.
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {}
                .pointerInput(Unit) {
                    // Swipe-tilbage hvor som helst. 1.4-forholdet er det ENESTE der afgør
                    // om scrollet eller swipet vinder, og Compose regner i PIXELS.
                    var dx = 0f
                    var dy = 0f
                    var iGang = false
                    val fart = VelocityTracker()
                    detectDragGestures(
                        onDragStart = { dx = 0f; dy = 0f; iGang = false; fart.resetTracking() },
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
                                glidUd(hurtigt = true, dismissStraks = true)
                            } else {
                                scope.launch { dragX.animateTo(0f, spring(0.85f, 440f)) }
                            }
                        },
                        onDragCancel = { iGang = false },
                    )
                },
        ) {
            // Header, INGEN skillelinje under (ejer-ønske; doc-kommentaren i Swift lyver).
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(top = topIndhak)
                    .height(52.dp)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Box(
                    Modifier
                        .vfPress(VfPress.SCALE) { model.exit() }
                        .padding(6.dp),
                ) {
                    VfIcon(VfIcons.ChevronLeft, blæk, 20.dp)
                }
                Text(
                    model.title,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    color = blæk,
                )
                Spacer(Modifier.weight(1f))
            }

            val listState = rememberLazyListState()
            var fremhævet by remember { mutableStateOf<String?>(null) }
            val fremhævAlpha = remember { Animatable(0f) }

            // Deep-link-fremhævning, samme to parallelle timere som kommentar-arket.
            // +1 for opslags-blokken der ligger som første element i listen.
            LaunchedEffect(model.token) {
                val id = model.focusId ?: return@LaunchedEffect
                val idx = model.comments.indexOfFirst { it.id == id }
                if (idx < 0) return@LaunchedEffect
                model.focusId = null
                fremhævet = id
                fremhævAlpha.snapTo(0.08f)
                launch {
                    delay(300)
                    listState.animateScrollToItem(idx + 1)
                }
                launch {
                    delay(2200)
                    fremhævAlpha.animateTo(0f, tween(400))
                    fremhævet = null
                }
            }

            LaunchedEffect(model.scrollToken) {
                if (model.scrollToken > 0 && model.comments.isNotEmpty()) {
                    listState.animateScrollToItem(model.comments.lastIndex + 1)
                }
            }

            // Nyt opslag mens siden er åben: til tops, uden ny glid-ind.
            LaunchedEffect(model.freshToken) {
                if (model.freshToken > 0) {
                    listState.scrollToItem(0)
                    dragX.snapTo(0f)
                }
            }

            LaunchedEffect(model.deleteArmId) {
                val armet = model.deleteArmId ?: return@LaunchedEffect
                delay(3000)
                if (model.open && model.deleteArmId == armet) model.deleteArmId = null
            }

            LazyColumn(state = listState, modifier = Modifier.weight(1f).fillMaxWidth()) {
                item(key = "__post") {
                    model.post?.let { OpslagsBlok(it, blæk, model, send) }
                }
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

            KommentarComposer(model, blæk, maxOf(bundIndhak - 10.dp, 0.dp), send)
        }
    }
}

@Composable
private fun OpslagsBlok(
    post: PostData,
    blæk: Color,
    model: PostPageModel,
    send: (String, (JSONObject) -> Unit) -> Unit,
) {
    val sekundær = blæk.copy(alpha = 0.6f)
    val chipFill = blæk.copy(alpha = 0.06f)
    val hårstreg = blæk.copy(alpha = 0.12f)

    Row(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier.vfPress(VfPress.CARD) {
                send("profile") { it.put("handle", post.handle) }
            },
        ) {
            VfGlassAvatar(post.avatarUrl, post.initials, post.gradient, 40.dp)
        }

        Column(Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                Text(
                    post.name,
                    fontSize = 14.5.sp,
                    fontWeight = FontWeight.Bold,
                    color = blæk,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.widthIn(max = 160.dp),
                )
                // Mærket vises for ALLE profiler, som på iPhone.
                Box(
                    Modifier.size(15.dp).clip(CircleShape).background(BRAND),
                    contentAlignment = Alignment.Center,
                ) {
                    VfIcon(VfIcons.Check, Color.White, 8.dp)
                }
                Text(
                    "@${post.handle} · ${post.time}",
                    fontSize = 13.5.sp,
                    color = sekundær,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(Modifier.width(4.dp))
                Text(
                    "⋯",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = sekundær,
                    modifier = Modifier
                        .vfPress(VfPress.SCALE) { send("menu") {} }
                        .padding(vertical = 6.dp)
                        .padding(start = 10.dp),
                )
            }

            // Segmenterne er facit: native leder ALDRIG selv efter @ i teksten.
            if (post.segs.isNotEmpty()) {
                Text(
                    buildAnnotatedString {
                        post.segs.forEach { seg ->
                            val m = seg.m
                            if (m != null) {
                                // Stilen skal gives EKSPLICIT: uden den lægger Compose sin
                                // egen link-understregning på, og iOS har ingen.
                                withLink(
                                    LinkAnnotation.Clickable(
                                        tag = "mention",
                                        styles = TextLinkStyles(
                                            style = SpanStyle(
                                                fontWeight = FontWeight.Bold,
                                                color = BRAND,
                                            ),
                                        ),
                                    ) {
                                        send("mention") { it.put("handle", m) }
                                    }
                                ) { append("@$m") }
                            } else {
                                append(seg.t ?: "")
                            }
                        }
                    },
                    fontSize = 15.sp,
                    color = blæk,
                    modifier = Modifier.padding(top = 2.dp),
                )
            }

            // Video VINDER over billede.
            if (post.videoUrl.isNotEmpty()) {
                LoopVideo(
                    url = post.videoUrl,
                    modifier = Modifier
                        .padding(top = 9.dp)
                        .fillMaxWidth()
                        .height(320.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, hårstreg, RoundedCornerShape(16.dp)),
                )
            } else if (post.imgUrl.isNotEmpty()) {
                SubcomposeAsyncImage(
                    model = post.imgUrl,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    loading = {
                        Box(Modifier.fillMaxWidth().height(220.dp).background(chipFill))
                    },
                    modifier = Modifier
                        .padding(top = 9.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .border(1.dp, hårstreg, RoundedCornerShape(16.dp)),
                )
            }

            post.poll?.let { Afstemning(it, blæk, send) }

            // Kreds-mærket i sin egen række, Swift-geometrien og ikke web-SVG'ens.
            if (post.kredsName.isNotEmpty()) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .padding(top = 9.dp)
                        .vfPress(VfPress.CHIP) { send("kreds") {} }
                        .clip(CircleShape)
                        .background(chipFill)
                        .padding(vertical = 3.dp)
                        .padding(start = 6.dp, end = 8.dp),
                ) {
                    KredsRing(sekundær)
                    Text(
                        post.kredsName,
                        fontSize = 11.5.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = sekundær,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }

            // Handlingsrækken: boble, hjerte, papirfly, med luft imellem. Kommentar-
            // ikonet krydser ikke broen, det hejser bare composeren.
            Row(
                Modifier.fillMaxWidth().padding(top = 8.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    modifier = Modifier
                        .vfPress(VfPress.SCALE) { if (model.canPost) model.focusToken++ }
                        .padding(vertical = 6.dp),
                ) {
                    VfIcon(VfIcons.ChatOutline, sekundær, 17.dp)
                    if (post.cmtCount > 0) {
                        Text(
                            "${post.cmtCount}",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = sekundær,
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                    modifier = Modifier
                        .vfPress(VfPress.BOUNCE) { send("postlike") {} }
                        .padding(vertical = 6.dp),
                ) {
                    VfIcon(
                        if (post.liked) VfIcons.Heart else VfIcons.HeartOutline,
                        if (post.liked) BRAND else sekundær,
                        17.dp,
                    )
                    if (post.likeCount > 0) {
                        Text(
                            "${post.likeCount}",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = if (post.liked) BRAND else sekundær,
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                if (post.canShare) {
                    Box(
                        Modifier
                            .vfPress(VfPress.POP) { send("share") {} }
                            .padding(vertical = 6.dp),
                    ) {
                        VfIcon(VfIcons.Send, sekundær, 17.dp)
                    }
                } else {
                    // Usynlig plads, så hjertet ikke flytter sig på private kreds-opslag.
                    Box(Modifier.size(24.dp))
                }
            }
        }
    }
}

@Composable
private fun Afstemning(
    poll: PostPoll,
    blæk: Color,
    send: (String, (JSONObject) -> Unit) -> Unit,
) {
    val sekundær = blæk.copy(alpha = 0.6f)
    val chipFill = blæk.copy(alpha = 0.06f)
    val kant = blæk.copy(alpha = 0.12f)

    Column(Modifier.padding(top = 6.dp)) {
        if (poll.head.isNotEmpty()) {
            Text(
                poll.head,
                fontSize = 12.sp,
                fontWeight = FontWeight.Black,
                color = sekundær,
                modifier = Modifier.padding(bottom = 4.dp),
            )
        }
        poll.options.forEach { mulighed ->
            if (!poll.showRes) {
                // Ikke-stemt: en rigtig knap med chip-feedback.
                Text(
                    mulighed.text,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = blæk,
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .fillMaxWidth()
                        .vfPress(VfPress.CHIP) {
                            send("vote") { it.put("optionId", mulighed.id) }
                        }
                        .border(1.dp, kant, RoundedCornerShape(8.dp))
                        .padding(vertical = 9.dp, horizontal = 12.dp),
                )
            } else {
                // Resultat-række: tryk-mål uden animation; sluger trykket når resolved.
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier
                        .padding(top = 6.dp)
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .drawBehind {
                            drawRect(
                                color = chipFill,
                                size = Size(size.width * mulighed.pct / 100f, size.height),
                            )
                        }
                        .border(1.dp, kant, RoundedCornerShape(8.dp))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) {
                            if (!poll.resolved) {
                                send("vote") { it.put("optionId", mulighed.id) }
                            }
                        }
                        .padding(vertical = 9.dp, horizontal = 12.dp),
                ) {
                    Text(
                        mulighed.text,
                        fontSize = 14.sp,
                        fontWeight = if (mulighed.mine) FontWeight.Bold else FontWeight.Normal,
                        color = blæk,
                    )
                    if (mulighed.mine) {
                        Box(
                            Modifier.size(14.dp).clip(CircleShape).background(BRAND),
                            contentAlignment = Alignment.Center,
                        ) {
                            VfIcon(VfIcons.Check, Color.White, 8.dp)
                        }
                    }
                    // Spaceren skubber procenten helt ud til højre, som på iPhone.
                    Spacer(Modifier.weight(1f).widthIn(min = 8.dp))
                    Text(
                        "${mulighed.pct}%",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold,
                        color = sekundær,
                    )
                }
            }
        }
        if (poll.meta.isNotEmpty()) {
            Text(
                poll.meta,
                fontSize = 12.5.sp,
                color = sekundær,
                modifier = Modifier.padding(top = 7.dp),
            )
        }
    }
}

/**
 * Kreds-ringen i 12x12 dp fra Swift-oversættelsen: streg 1,3 dp plus tre prikker på
 * 3,6 dp ved (0, -6), (-5.2, 3.1) og (5.2, 3.1). IKKE web-SVG'ens 24-viewport-tal.
 */
@Composable
private fun KredsRing(farve: Color) {
    Canvas(Modifier.size(12.dp)) {
        val c = center
        drawCircle(
            color = farve,
            radius = size.minDimension / 2f - 0.65.dp.toPx(),
            style = Stroke(width = 1.3.dp.toPx()),
        )
        listOf(
            Offset(0f, -6f),
            Offset(-5.2f, 3.1f),
            Offset(5.2f, 3.1f),
        ).forEach { o ->
            drawCircle(
                color = farve,
                radius = 1.8.dp.toPx(),
                center = Offset(c.x + o.x.dp.toPx(), c.y + o.y.dp.toPx()),
            )
        }
    }
}
