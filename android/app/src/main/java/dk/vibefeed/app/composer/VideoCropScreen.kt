package dk.vibefeed.app.composer

import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlin.math.max
import kotlin.math.min

private val BRAND = Color(0xFFE0402F)

/**
 * Video-beskæreren: samme matematik og samme pynt som billed-beskæreren, men indholdet er
 * en loopende, lydløs video i stedet for et stillbillede.
 *
 * Videoen må IKKE tage imod tryk, ellers rammer trækket afspilleren i stedet for beskæreren.
 * Resultatet er et normaliseret udsnit, ikke et billede: selve beskæringen bages først ind
 * under eksporten.
 */
@OptIn(UnstableApi::class)
@Composable
fun VideoCropScreen(
    kilde: Uri,
    videoBredde: Int,
    videoHoejde: Int,
    startMs: Long,
    laengdeMs: Long,
    erStory: Boolean,
    startFormat: Format,
    formatLabel: String,
    annullerLabel: String,
    brugLabel: String,
    topPad: Dp,
    bottomPad: Dp,
    onCancel: () -> Unit,
    onDone: (Format, VideoExport.Udsnit) -> Unit,
) {
    val context = LocalContext.current
    var format by remember { mutableStateOf(if (erStory) Format.STORY else startFormat) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var justerer by remember { mutableStateOf(false) }

    var rammeB by remember { mutableFloatStateOf(0f) }
    var rammeH by remember { mutableFloatStateOf(0f) }
    var skala by remember { mutableFloatStateOf(1f) }
    var brugtOffset by remember { mutableStateOf(Offset.Zero) }

    LaunchedEffect(format) { zoom = 1f; offset = Offset.Zero }

    val afspiller = remember {
        ExoPlayer.Builder(context).build().apply {
            volume = 0f
            repeatMode = Player.REPEAT_MODE_ONE
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            afspiller.setVideoSurface(null)
            afspiller.release()
        }
    }
    LaunchedEffect(kilde, startMs, laengdeMs) {
        afspiller.setMediaItem(
            MediaItem.Builder().setUri(kilde).setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(startMs)
                    .setEndPositionMs(startMs + laengdeMs)
                    .build()
            ).build()
        )
        afspiller.prepare()
        afspiller.play()
    }

    val imgB = videoBredde.toFloat().coerceAtLeast(1f)
    val imgH = videoHoejde.toFloat().coerceAtLeast(1f)

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val tæthed = LocalDensity.current
            val fladeB = with(tæthed) { this@BoxWithConstraints.maxWidth.toPx() }
            val fladeH = with(tæthed) { this@BoxWithConstraints.maxHeight.toPx() }
            val margen = with(tæthed) { 24.dp.toPx() }

            val maxB = fladeB - margen
            val maxH = fladeH * 0.72f
            var rB = maxB
            var rH = rB / format.forhold
            if (rH > maxH) { rH = maxH; rB = rH * format.forhold }

            val dæk = max(rB / imgB, rH / imgH)
            val t = dæk * zoom

            fun klem(o: Offset): Offset {
                val maxX = max(0f, (imgB * t - rB) / 2f)
                val maxY = max(0f, (imgH * t - rH) / 2f)
                return Offset(min(maxX, max(-maxX, o.x)), min(maxY, max(-maxY, o.y)))
            }

            val faktisk = klem(offset)
            rammeB = rB; rammeH = rH; skala = t; brugtOffset = faktisk

            // Selve videoen, klippet til rammen. Den ligger i en boks med videoens EGNE mål
            // ganget med skalaen, præcis som billedet, så matematikken er den samme.
            Box(
                Modifier
                    .align(Alignment.Center)
                    .size(with(tæthed) { rB.toDp() }, with(tæthed) { rH.toDp() })
                    .clip(androidx.compose.foundation.shape.RoundedCornerShape(6.dp)),
                contentAlignment = Alignment.Center,
            ) {
                AndroidView(
                    modifier = Modifier
                        .size(with(tæthed) { (imgB * t).toDp() }, with(tæthed) { (imgH * t).toDp() })
                        .offset {
                            androidx.compose.ui.unit.IntOffset(
                                faktisk.x.toInt(), faktisk.y.toInt()
                            )
                        },
                    factory = { ctx ->
                        PlayerView(ctx).apply {
                            useController = false
                            // Rammen har allerede videoens præcise forhold, så intet strækkes
                            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FILL
                            setBackgroundColor(android.graphics.Color.TRANSPARENT)
                            player = afspiller
                        }
                    },
                )
            }

            // Gestus-laget OVEN PÅ videoen, så trækket rammer beskæreren og ikke afspilleren
            Canvas(
                Modifier
                    .fillMaxSize()
                    .pointerInput(format, kilde) {
                        detectTransformGestures { _, pan, zoomChange, _ ->
                            justerer = true
                            zoom = min(5f, max(1f, zoom * zoomChange))
                            offset = klem(offset + pan)
                        }
                    }
                    .pointerInput(format, kilde) {
                        detectTapGestures(onDoubleTap = {
                            zoom = if (zoom > 1.01f) 1f else 2f
                            offset = Offset.Zero
                        })
                    },
            ) {
                val midte = Offset(fladeB / 2f, fladeH / 2f)
                val r = Rect(
                    midte.x - rB / 2f, midte.y - rH / 2f,
                    midte.x + rB / 2f, midte.y + rH / 2f,
                )
                drawRect(
                    Color.White.copy(alpha = 0.4f),
                    topLeft = androidx.compose.ui.geometry.Offset(r.left, r.top),
                    size = androidx.compose.ui.geometry.Size(r.width, r.height),
                    style = Stroke(1.dp.toPx()),
                )
                if (justerer) {
                    val farve = Color.White.copy(alpha = 0.55f)
                    for (i in 1..2) {
                        val x = r.left + r.width * i / 3f
                        drawLine(farve, Offset(x, r.top), Offset(x, r.bottom), 0.75.dp.toPx())
                        val y = r.top + r.height * i / 3f
                        drawLine(farve, Offset(r.left, y), Offset(r.right, y), 0.75.dp.toPx())
                    }
                }
                val L = min(26.dp.toPx(), min(r.width, r.height) / 3f)
                val p = Path().apply {
                    moveTo(r.left, r.top + L); lineTo(r.left, r.top); lineTo(r.left + L, r.top)
                    moveTo(r.right - L, r.top); lineTo(r.right, r.top); lineTo(r.right, r.top + L)
                    moveTo(r.right, r.bottom - L); lineTo(r.right, r.bottom); lineTo(r.right - L, r.bottom)
                    moveTo(r.left + L, r.bottom); lineTo(r.left, r.bottom); lineTo(r.left, r.bottom - L)
                }
                drawPath(
                    p, Color.White,
                    style = Stroke(
                        3.dp.toPx(),
                        cap = androidx.compose.ui.graphics.StrokeCap.Round,
                        join = androidx.compose.ui.graphics.StrokeJoin.Round,
                    ),
                )
            }
        }

        Column(Modifier.fillMaxSize().padding(top = topPad, bottom = bottomPad)) {
            Spacer(Modifier.weight(1f))
            if (!erStory) {
                Text(
                    formatLabel,
                    color = Color.White, fontSize = 15.sp,
                    modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 10.dp),
                )
                Row(
                    Modifier.align(Alignment.CenterHorizontally).clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.12f))
                        .border(1.dp, Color.White.copy(alpha = 0.16f), CircleShape)
                        .padding(3.dp),
                ) {
                    listOf(Format.KVADRAT, Format.STAAENDE, Format.LIGGENDE).forEach { f ->
                        val on = f == format
                        Box(
                            Modifier.size(60.dp, 44.dp).clip(CircleShape)
                                .background(if (on) BRAND else Color.Transparent)
                                .clickable { format = f },
                            contentAlignment = Alignment.Center,
                        ) {
                            FormatIkonPublic(f, if (on) Color.White else Color.White.copy(alpha = 0.6f))
                        }
                    }
                }
                Spacer(Modifier.height(18.dp))
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CropKnapPublic(annullerLabel, false, Modifier.weight(1f), onCancel)
                CropKnapPublic(brugLabel, true, Modifier.weight(1f)) {
                    // Det synlige område regnes tilbage til videoens egne koordinater og
                    // normaliseres til 0 til 1 med top-venstre origo. Eksporten vender
                    // selv Y-aksen om til Media3s koordinatsystem.
                    val synligB = rammeB / skala
                    val synligH = rammeH / skala
                    val cx = imgB / 2f - brugtOffset.x / skala
                    val cy = imgH / 2f - brugtOffset.y / skala
                    onDone(
                        format,
                        VideoExport.Udsnit(
                            left = ((cx - synligB / 2f) / imgB).coerceIn(0f, 1f),
                            top = ((cy - synligH / 2f) / imgH).coerceIn(0f, 1f),
                            width = (synligB / imgB).coerceIn(0.01f, 1f),
                            height = (synligH / imgH).coerceIn(0.01f, 1f),
                        ),
                    )
                }
            }
        }
    }

    LaunchedEffect(zoom, offset) {
        justerer = true
        kotlinx.coroutines.delay(260)
        justerer = false
    }
}
