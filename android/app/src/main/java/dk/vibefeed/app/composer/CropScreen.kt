package dk.vibefeed.app.composer

import android.graphics.Bitmap
import android.graphics.Canvas as AndroidCanvas
import android.graphics.Paint
import android.graphics.RectF
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

private val BRAND = Color(0xFFE0402F)

/** De tre minde-formater fra iOS. Story har intet valg, den er altid 9:16. */
enum class Format(val forhold: Float, val bredde: Int, val hoejde: Int) {
    KVADRAT(1f, 1080, 1080),
    STAAENDE(1080f / 1350f, 1080, 1350),
    LIGGENDE(1080f / 566f, 1080, 566),
    STORY(1080f / 1920f, 1080, 1920),
}

/**
 * Den interaktive beskærer, bygget efter CropView.swift.
 *
 * Billedet KLIPPES til rammen, så man panorerer indeni i stedet for at se det flyde udenfor,
 * og det kan aldrig trækkes så langt at der kommer en tom kant. Tredjedels-gitteret toner kun
 * frem mens man justerer, som i en rigtig beskærer.
 */
@Composable
fun CropScreen(
    billede: ImageBitmap,
    erStory: Boolean,
    startFormat: Format,
    titel: String,
    formatLabel: String,
    annullerLabel: String,
    brugLabel: String,
    topPad: androidx.compose.ui.unit.Dp,
    bottomPad: androidx.compose.ui.unit.Dp,
    onCancel: () -> Unit,
    onDone: (Bitmap) -> Unit,
) {
    var format by remember { mutableStateOf(if (erStory) Format.STORY else startFormat) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var justerer by remember { mutableStateOf(false) }
    // Visningen og eksporten SKAL regne med de samme tal, ellers passer udsnittet ikke med
    // det man så. Derfor gemmes rammen og skalaen her, når layoutet har målt dem.
    var rammeB by remember { mutableFloatStateOf(0f) }
    var rammeH by remember { mutableFloatStateOf(0f) }
    var skala by remember { mutableFloatStateOf(1f) }
    var brugtOffset by remember { mutableStateOf(Offset.Zero) }
    val gitter by animateFloatAsState(if (justerer) 1f else 0f, tween(250), label = "gitter")

    // Formatskift må ikke efterlade et udsnit der ikke dækker den nye ramme
    LaunchedEffect(format) { zoom = 1f; offset = Offset.Zero }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val tæthed = LocalDensity.current
            val fladeB = with(tæthed) { maxWidth.toPx() }
            val fladeH = with(tæthed) { maxHeight.toPx() }
            val margen = with(tæthed) { 24.dp.toPx() }

            // Samme rammeberegning som iOS: bredden minus 24, højst 72 procent af højden
            val maxB = fladeB - margen
            val maxH = fladeH * 0.72f
            var rB = maxB
            var rH = rB / format.forhold
            if (rH > maxH) { rH = maxH; rB = rH * format.forhold }
            val rammeBredde = rB
            val rammeHoejde = rH

            val imgB = billede.width.toFloat()
            val imgH = billede.height.toFloat()
            val dæk = max(rammeBredde / imgB, rammeHoejde / imgH)
            val t = dæk * zoom

            // Læser zoom ved KALDSTID: gestus-coroutinen holder en gammel klem-lukning
            // (pointerInput genstarter kun ved nyt billede), og en frosset t klemte
            // panoreringen efter zoomens GAMLE grænser.
            fun klem(o: Offset): Offset {
                val tt = dæk * zoom
                val maxX = max(0f, (imgB * tt - rammeBredde) / 2f)
                val maxY = max(0f, (imgH * tt - rammeHoejde) / 2f)
                return Offset(min(maxX, max(-maxX, o.x)), min(maxY, max(-maxY, o.y)))
            }

            val faktisk = klem(offset)
            rammeB = rammeBredde; rammeH = rammeHoejde; skala = t; brugtOffset = faktisk
            val midte = Offset(fladeB / 2f, fladeH / 2f)

            Canvas(
                Modifier
                    .fillMaxSize()
                    .pointerInput(format, billede) {
                        detectTransformGestures { _, pan, zoomChange, _ ->
                            justerer = true
                            zoom = min(5f, max(1f, zoom * zoomChange))
                            offset = klem(offset + pan)
                        }
                    }
                    .pointerInput(format, billede) {
                        detectTapGestures(onDoubleTap = {
                            // Dobbelttryk skifter mellem 1 og 2, som i Fotos
                            zoom = if (zoom > 1.01f) 1f else 2f
                            offset = Offset.Zero
                        })
                    },
            ) {
                val r = Rect(
                    midte.x - rammeBredde / 2f, midte.y - rammeHoejde / 2f,
                    midte.x + rammeBredde / 2f, midte.y + rammeHoejde / 2f,
                )
                val hjørne = 6.dp.toPx()
                val ramme = Path().apply { addRoundRect(androidx.compose.ui.geometry.RoundRect(r, androidx.compose.ui.geometry.CornerRadius(hjørne))) }

                clipPath(ramme) {
                    drawImage(
                        image = billede,
                        dstOffset = IntOffset(
                            (midte.x - imgB * t / 2f + faktisk.x).roundToInt(),
                            (midte.y - imgH * t / 2f + faktisk.y).roundToInt(),
                        ),
                        dstSize = IntSize((imgB * t).roundToInt(), (imgH * t).roundToInt()),
                    )
                }

                // Pynten: tynd ramme, gitter kun mens man justerer, kraftige L-hjørner
                drawPath(ramme, Color.White.copy(alpha = 0.4f), style = Stroke(1.dp.toPx()))
                if (gitter > 0f) tegnGitter(r, gitter)
                tegnHjørner(r)
            }
        }

        Column(Modifier.fillMaxSize().padding(top = topPad, bottom = bottomPad)) {
            Text(
                titel,
                color = Color.White,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 16.dp),
            )
            Spacer(Modifier.weight(1f))

            // Format-vælgeren. Story har kun ét format, så den vises ikke der.
            if (!erStory) {
                Text(
                    formatLabel,
                    color = Color.White,
                    fontSize = 15.sp,
                    modifier = Modifier.align(Alignment.CenterHorizontally).padding(bottom = 10.dp),
                )
                Row(
                    Modifier
                        .align(Alignment.CenterHorizontally)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.12f))
                        .border(1.dp, Color.White.copy(alpha = 0.16f), CircleShape)
                        .padding(3.dp),
                ) {
                    FormatPille(Format.KVADRAT, format) { format = it }
                    FormatPille(Format.STAAENDE, format) { format = it }
                    FormatPille(Format.LIGGENDE, format) { format = it }
                }
                Spacer(Modifier.height(18.dp))
            }

            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CropKnapPublic(annullerLabel, false, Modifier.weight(1f), onCancel)
                CropKnapPublic(brugLabel, true, Modifier.weight(1f)) {
                    onDone(beskær(billede, format, rammeB, rammeH, skala, brugtOffset))
                }
            }
        }
    }

    // Beskæringen skal bruge de samme tal som visningen, så de gemmes her
    LaunchedEffect(zoom, offset, format) { justerer = true }
    LaunchedEffect(zoom, offset) {
        kotlinx.coroutines.delay(260)
        justerer = false
    }
}

/**
 * Profil-beskæreren til Rediger profil: frit forhold, evt. cirkulær maske, faste mål og
 * INGEN format-piller. Deler ramme-, klemme- og beskæringsformlerne med minde-beskæreren,
 * plus den animerede dobbelttryk-zoom fra iOS (250 ms).
 */
@Composable
fun ProfilCropScreen(
    billede: ImageBitmap,
    forhold: Float,
    cirkulaer: Boolean,
    maalB: Int,
    maalH: Int,
    titel: String,
    annullerLabel: String,
    brugLabel: String,
    topPad: androidx.compose.ui.unit.Dp,
    bottomPad: androidx.compose.ui.unit.Dp,
    onCancel: () -> Unit,
    onDone: (Bitmap) -> Unit,
) {
    var zoom by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var justerer by remember { mutableStateOf(false) }
    var zoomMål by remember { mutableStateOf<Float?>(null) }
    var rammeB by remember { mutableFloatStateOf(0f) }
    var rammeH by remember { mutableFloatStateOf(0f) }
    var skala by remember { mutableFloatStateOf(1f) }
    var brugtOffset by remember { mutableStateOf(Offset.Zero) }
    val gitter by animateFloatAsState(if (justerer) 1f else 0f, tween(250), label = "gitter")

    // Dobbelttryk: animer zoom og position over 250 ms, som iOS. Træk og knib skriver
    // stadig direkte.
    LaunchedEffect(zoomMål) {
        val mål = zoomMål ?: return@LaunchedEffect
        val startZoom = zoom
        val startOffset = offset
        androidx.compose.animation.core.animate(
            0f, 1f,
            animationSpec = tween(250, easing = androidx.compose.animation.core.FastOutSlowInEasing),
        ) { f, _ ->
            zoom = startZoom + (mål - startZoom) * f
            offset = Offset(startOffset.x * (1f - f), startOffset.y * (1f - f))
        }
        zoomMål = null
    }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val tæthed = LocalDensity.current
            val fladeB = with(tæthed) { maxWidth.toPx() }
            val fladeH = with(tæthed) { maxHeight.toPx() }
            val margen = with(tæthed) { 24.dp.toPx() }

            val maxB = fladeB - margen
            val maxH = fladeH * 0.72f
            var rB = maxB
            var rH = rB / forhold
            if (rH > maxH) { rH = maxH; rB = rH * forhold }
            val rammeBredde = rB
            val rammeHoejde = rH

            val imgB = billede.width.toFloat()
            val imgH = billede.height.toFloat()
            val dæk = max(rammeBredde / imgB, rammeHoejde / imgH)
            val t = dæk * zoom

            // Læser zoom ved KALDSTID: gestus-coroutinen holder en gammel klem-lukning
            // (pointerInput genstarter kun ved nyt billede), og en frosset t klemte
            // panoreringen efter zoomens GAMLE grænser.
            fun klem(o: Offset): Offset {
                val tt = dæk * zoom
                val maxX = max(0f, (imgB * tt - rammeBredde) / 2f)
                val maxY = max(0f, (imgH * tt - rammeHoejde) / 2f)
                return Offset(min(maxX, max(-maxX, o.x)), min(maxY, max(-maxY, o.y)))
            }

            val faktisk = klem(offset)
            rammeB = rammeBredde; rammeH = rammeHoejde; skala = t; brugtOffset = faktisk
            val midte = Offset(fladeB / 2f, fladeH / 2f)

            Canvas(
                Modifier
                    .fillMaxSize()
                    .pointerInput(billede) {
                        detectTransformGestures { _, pan, zoomChange, _ ->
                            justerer = true
                            zoom = min(5f, max(1f, zoom * zoomChange))
                            offset = klem(offset + pan)
                        }
                    }
                    .pointerInput(billede) {
                        detectTapGestures(onDoubleTap = {
                            zoomMål = if (zoom > 1.01f) 1f else 2f
                        })
                    },
            ) {
                val r = Rect(
                    midte.x - rammeBredde / 2f, midte.y - rammeHoejde / 2f,
                    midte.x + rammeBredde / 2f, midte.y + rammeHoejde / 2f,
                )
                val ramme = if (cirkulaer) {
                    Path().apply { addOval(r) }
                } else {
                    Path().apply {
                        addRoundRect(
                            androidx.compose.ui.geometry.RoundRect(
                                r,
                                androidx.compose.ui.geometry.CornerRadius(6.dp.toPx()),
                            )
                        )
                    }
                }

                clipPath(ramme) {
                    drawImage(
                        image = billede,
                        dstOffset = IntOffset(
                            (midte.x - imgB * t / 2f + faktisk.x).roundToInt(),
                            (midte.y - imgH * t / 2f + faktisk.y).roundToInt(),
                        ),
                        dstSize = IntSize((imgB * t).roundToInt(), (imgH * t).roundToInt()),
                    )
                }

                if (cirkulaer) {
                    // KUN cirkel-stregen: intet gitter, ingen hjørner.
                    drawPath(ramme, Color.White.copy(alpha = 0.9f), style = Stroke(2.dp.toPx()))
                } else {
                    drawPath(ramme, Color.White.copy(alpha = 0.4f), style = Stroke(1.dp.toPx()))
                    if (gitter > 0f) tegnGitter(r, gitter)
                    tegnHjørner(r)
                }
            }
        }

        Column(Modifier.fillMaxSize().padding(top = topPad, bottom = bottomPad)) {
            Text(
                titel,
                color = Color.White,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.CenterHorizontally).padding(top = 16.dp),
            )
            Spacer(Modifier.weight(1f))
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CropKnapPublic(annullerLabel, false, Modifier.weight(1f), onCancel)
                CropKnapPublic(brugLabel, true, Modifier.weight(1f)) {
                    onDone(beskærTilMaal(billede, maalB, maalH, rammeB, rammeH, skala, brugtOffset))
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

/** Som [beskær], men med frie mål i stedet for minde-formaterne. */
private fun beskærTilMaal(
    billede: ImageBitmap,
    maalB: Int,
    maalH: Int,
    rammeB: Float,
    rammeH: Float,
    t: Float,
    offset: Offset,
): Bitmap {
    val kilde = billede.asAndroidBitmap()
    val ud = Bitmap.createBitmap(maalB, maalH, Bitmap.Config.ARGB_8888)
    if (rammeB <= 0f || rammeH <= 0f || t <= 0f) return ud

    val synligB = rammeB / t
    val synligH = rammeH / t
    val cx = kilde.width / 2f - offset.x / t
    val cy = kilde.height / 2f - offset.y / t
    val vx = cx - synligB / 2f
    val vy = cy - synligH / 2f
    val k = maalB / synligB

    val lærred = AndroidCanvas(ud)
    val maling = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true }
    lærred.drawBitmap(
        kilde,
        null,
        RectF(-vx * k, -vy * k, (-vx + kilde.width) * k, (-vy + kilde.height) * k),
        maling,
    )
    return ud
}

/**
 * Selve udsnittet, med præcis de samme formler som cropped() i CropView.swift: det synlige
 * område regnes tilbage til billedets egne koordinater og tegnes skaleret ind i målet.
 */
private fun beskær(
    billede: ImageBitmap,
    format: Format,
    rammeB: Float,
    rammeH: Float,
    t: Float,
    offset: Offset,
): Bitmap {
    val kilde = billede.asAndroidBitmap()
    val ud = Bitmap.createBitmap(format.bredde, format.hoejde, Bitmap.Config.ARGB_8888)
    if (rammeB <= 0f || rammeH <= 0f || t <= 0f) return ud

    val synligB = rammeB / t
    val synligH = rammeH / t
    val cx = kilde.width / 2f - offset.x / t
    val cy = kilde.height / 2f - offset.y / t
    val vx = cx - synligB / 2f
    val vy = cy - synligH / 2f
    val k = format.bredde / synligB

    val lærred = AndroidCanvas(ud)
    val maling = Paint(Paint.ANTI_ALIAS_FLAG).apply { isFilterBitmap = true }
    lærred.drawBitmap(
        kilde,
        null,
        RectF(-vx * k, -vy * k, (-vx + kilde.width) * k, (-vy + kilde.height) * k),
        maling,
    )
    return ud
}

@androidx.compose.runtime.Composable
private fun FormatPille(f: Format, valgt: Format, onClick: (Format) -> Unit) {
    val on = f == valgt
    Box(
        Modifier
            .size(60.dp, 44.dp)
            .clip(CircleShape)
            .background(if (on) BRAND else Color.Transparent)
            .clickable { onClick(f) },
        contentAlignment = Alignment.Center,
    ) {
        FormatIkonPublic(f, if (on) Color.White else Color.White.copy(alpha = 0.6f))
    }
}

@androidx.compose.runtime.Composable
fun FormatIkonPublic(f: Format, farve: Color) {
    val b: Float
    val h: Float
    when (f) {
        Format.KVADRAT -> { b = 19f; h = 19f }
        Format.STAAENDE -> { b = 15f; h = 19f }
        else -> { b = 21f; h = 12f }
    }
    Canvas(Modifier.size(b.dp, h.dp)) {
        drawRoundRect(
            color = farve,
            cornerRadius = androidx.compose.ui.geometry.CornerRadius(2.dp.toPx()),
            style = Stroke(2.dp.toPx()),
        )
    }
}

@androidx.compose.runtime.Composable
fun CropKnapPublic(tekst: String, primær: Boolean, modifier: Modifier, onClick: () -> Unit) {
    // vfPress FORREST så hele pillen skalerer, og ingen Material-ripple: Brug = POP,
    // Annuller = FADE, som specens knap-tabel kræver.
    Box(
        modifier
            .vfPress(if (primær) VfPress.POP else VfPress.FADE) { onClick() }
            .clip(CircleShape)
            .background(if (primær) BRAND else Color.White.copy(alpha = 0.14f))
            .then(
                if (primær) Modifier
                else Modifier.border(1.dp, Color.White.copy(alpha = 0.16f), CircleShape)
            )
            .padding(vertical = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            tekst,
            color = Color.White,
            fontSize = 16.sp,
            fontWeight = if (primær) FontWeight.Bold else FontWeight.SemiBold,
        )
    }
}

private fun DrawScope.tegnGitter(r: Rect, alfa: Float) {
    val farve = Color.White.copy(alpha = 0.55f * alfa)
    val tykkelse = 0.75.dp.toPx()
    for (i in 1..2) {
        val x = r.left + r.width * i / 3f
        drawLine(farve, Offset(x, r.top), Offset(x, r.bottom), tykkelse)
        val y = r.top + r.height * i / 3f
        drawLine(farve, Offset(r.left, y), Offset(r.right, y), tykkelse)
    }
}

private fun DrawScope.tegnHjørner(r: Rect) {
    val L = min(26.dp.toPx(), min(r.width, r.height) / 3f)
    val p = Path().apply {
        moveTo(r.left, r.top + L); lineTo(r.left, r.top); lineTo(r.left + L, r.top)
        moveTo(r.right - L, r.top); lineTo(r.right, r.top); lineTo(r.right, r.top + L)
        moveTo(r.right, r.bottom - L); lineTo(r.right, r.bottom); lineTo(r.right - L, r.bottom)
        moveTo(r.left + L, r.bottom); lineTo(r.left, r.bottom); lineTo(r.left, r.bottom - L)
    }
    drawPath(p, Color.White, style = Stroke(3.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
}
