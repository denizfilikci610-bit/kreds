package dk.vibefeed.app.composer

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min

private val BRAND = Color(0xFFE0402F)

/**
 * Trim-trinnet. Vises KUN når en galleri-video er længere end 6,05 sekunder.
 * Kamera-videoer kommer aldrig herind, deres længde styres af nedtællingen.
 *
 * Vinduet har FAST bredde og ingen kant-håndtag: man vælger kun HVOR de seks sekunder
 * ligger, ikke hvor lange de er. Det er bevidst, og det er sådan iOS gør det.
 */
@OptIn(UnstableApi::class)
@Composable
fun TrimStep(
    model: ComposerModel,
    baggrund: Color,
    blæk: Color,
    topPad: Dp,
    bottomPad: Dp,
    onCancel: () -> Unit,
    onNext: () -> Unit,
) {
    val context = LocalContext.current
    val tæthed = LocalDensity.current
    val kilde = model.picked?.uri ?: return
    var strimmel by remember(kilde) { mutableStateOf<List<android.graphics.Bitmap>>(emptyList()) }

    val afspiller = remember {
        ExoPlayer.Builder(context).build().apply {
            volume = 0f
            repeatMode = Player.REPEAT_MODE_ONE
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            // Forlades trinnet midt i et træk (finger to rammer Videre/Annuller),
            // må scrubber-flaget ikke blive hængende og fryse næste besøg.
            model.scrubber = false
            afspiller.release()
        }
    }

    // Løkken låses til det valgte vindue gennem klipningen, men KUN når der ikke
    // scrubbes: under trækket ville hvert delta ellers genopbygge afspilleren og
    // overtrumfe pausen fra onDragStart, så intet billede nogensinde frøs.
    LaunchedEffect(kilde, model.trimStartMs, model.trimLaengdeMs, model.scrubber) {
        if (model.scrubber) return@LaunchedEffect
        afspiller.setMediaItem(
            MediaItem.Builder().setUri(kilde).setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(model.trimStartMs)
                    .setEndPositionMs(model.trimStartMs + model.trimLaengdeMs)
                    .build()
            ).build()
        )
        afspiller.prepare()
        afspiller.play()
    }

    LaunchedEffect(kilde) {
        strimmel = withContext(Dispatchers.IO) {
            VideoExport.filmstrimmel(context, kilde, model.videoVarighedMs)
        }
    }

    Column(Modifier.fillMaxSize().background(baggrund)) {
        ComposerNavBar(
            titel = model.title,
            annullerLabel = model.labels.or("cancel", "Annuller"),
            handlingLabel = model.labels.or("next", "Videre"),
            handlingAktiv = true,
            arbejder = false,
            baggrund = baggrund,
            blæk = blæk,
            topPad = topPad,
            visSkillelinje = true,
            onCancel = onCancel,
            onAction = onNext,
        )

        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val h = this@BoxWithConstraints.maxHeight
            AndroidView(
                modifier = Modifier.fillMaxWidth().height(h * 0.44f).background(baggrund),
                factory = { ctx ->
                    PlayerView(ctx).apply {
                        useController = false
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        setBackgroundColor(android.graphics.Color.TRANSPARENT)
                        player = afspiller
                    }
                },
            )
        }

        Spacer(Modifier.weight(1f))

        val hint = model.labels.or("trimHint", "")
        if (hint.isNotBlank()) {
            Text(
                hint,
                color = blæk.copy(alpha = 0.6f),
                fontSize = 13.sp,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 12.dp),
            )
        }

        BoxWithConstraints(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 0.dp),
        ) {
            val strimmelB = with(tæthed) { this@BoxWithConstraints.maxWidth.toPx() }
            val andel = model.trimLaengdeMs.toFloat() / max(10L, model.videoVarighedMs).toFloat()
            val vinduesB = min(strimmelB, strimmelB * andel)
            val vandring = max(1f, strimmelB - vinduesB)
            val spænd = max(1L, model.videoVarighedMs - model.trimLaengdeMs)
            val x = (model.trimStartMs.toFloat() / spænd.toFloat()) * (strimmelB - vinduesB)

            Row(
                Modifier.fillMaxWidth().height(56.dp).clip(RoundedCornerShape(8.dp))
                    .background(blæk.copy(alpha = 0.15f)),
            ) {
                if (strimmel.isEmpty()) {
                    Spacer(Modifier.weight(1f))
                } else {
                    strimmel.forEach { bm ->
                        Image(
                            bitmap = bm.asImageBitmap(),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.weight(1f).fillMaxHeight(),
                        )
                    }
                }
            }

            var grund by remember { mutableLongStateOf(0L) }
            var samlet by remember { mutableFloatStateOf(0f) }
            Box(
                Modifier
                    .offset { androidx.compose.ui.unit.IntOffset(x.toInt(), 0) }
                    .width(with(tæthed) { vinduesB.toDp() })
                    .height(56.dp)
                    .border(3.dp, Color.White, RoundedCornerShape(8.dp))
                    .pointerInput(model.videoVarighedMs, vandring) {
                        detectDragGestures(
                            onDragStart = {
                                grund = model.trimStartMs
                                samlet = 0f
                                // Billedet fryser mens man scrubber, så man kan se hvor man er
                                model.scrubber = true
                                afspiller.pause()
                            },
                            onDragEnd = { model.scrubber = false },
                            onDragCancel = { model.scrubber = false },
                        ) { _, træk ->
                            // detectDragGestures giver et DELTA pr. hændelse, ikke den samlede
                            // flytning som på iOS. Derfor lægges det sammen her.
                            samlet += træk.x
                            val dxMs = (samlet / vandring * spænd).toLong()
                            model.trimStartMs = (grund + dxMs).coerceIn(0L, spænd)
                        }
                    },
            )
        }

        Spacer(Modifier.height(bottomPad + 16.dp))
    }
}
