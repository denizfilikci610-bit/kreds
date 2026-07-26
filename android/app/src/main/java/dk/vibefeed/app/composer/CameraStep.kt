package dk.vibefeed.app.composer

import android.Manifest
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.FocusMeteringAction
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil.compose.AsyncImage
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.min

private val BRAND = Color(0xFFE0402F)

/** Video må højst vare 6 sekunder, samme grænse som iOS. */
private const val MAX_SEKUNDER = 6

/** Kameraets tilstand, holdt uden for compositionen så bindingen ikke genskabes hele tiden. */
class CameraState {
    var authorized by mutableStateOf(false)
    var zoom by mutableFloatStateOf(1f)
    var flashOn by mutableStateOf(false)
    var recording by mutableStateOf(false)
    var secondsLeft by mutableIntStateOf(MAX_SEKUNDER)
    var back by mutableStateOf(true)
}

/**
 * Kamera-trinnet, bygget efter MemoryCameraScreen i PhotoLibView.swift.
 *
 * Rammen er FAST: minde optages i 4:5, story i fuld skærm, og rammen skifter ALDRIG form
 * fordi telefonen drejes. Det er kun det færdige medie der bliver liggende, hvis man holder
 * telefonen vandret. Den regel kostede tre runder på iOS, så den kopieres bevidst.
 */
@Composable
fun CameraStep(
    model: ComposerModel,
    cam: CameraState,
    topPad: Dp,
    bottomPad: Dp,
    onCancel: () -> Unit,
    onGallery: () -> Unit,
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val density = LocalDensity.current

    var kamera by remember { mutableStateOf<Camera?>(null) }
    var billedeUd by remember { mutableStateOf<ImageCapture?>(null) }
    var videoUd by remember { mutableStateOf<VideoCapture<Recorder>?>(null) }
    var optagelse by remember { mutableStateOf<Recording?>(null) }
    var fokusPunkt by remember { mutableStateOf<Offset?>(null) }
    var previewView by remember { mutableStateOf<PreviewView?>(null) }

    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        cam.authorized = ok
    }
    LaunchedEffect(Unit) {
        cam.authorized = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        if (!cam.authorized) ask.launch(Manifest.permission.CAMERA)
    }

    // Fokus-firkanten forsvinder igen efter et sekund, som på iOS
    LaunchedEffect(fokusPunkt) {
        if (fokusPunkt != null) { delay(1000); fokusPunkt = null }
    }

    // Nedtællingen mens der optages. Ved nul stopper optagelsen af sig selv.
    LaunchedEffect(cam.recording) {
        if (!cam.recording) { cam.secondsLeft = MAX_SEKUNDER; return@LaunchedEffect }
        cam.secondsLeft = MAX_SEKUNDER
        while (cam.secondsLeft > 0 && cam.recording) {
            delay(1000)
            cam.secondsLeft -= 1
        }
        if (cam.recording) { optagelse?.stop(); optagelse = null }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(Color.Black)) {
        val bredde = maxWidth
        val rammeHøjde by animateDpAsState(
            targetValue = if (model.isStory) maxHeight else bredde * 5f / 4f,
            animationSpec = tween(400),
            label = "ramme",
        )
        val topMargenRå by animateDpAsState(
            targetValue = if (model.isStory) 0.dp else 106.dp,
            animationSpec = tween(400),
            label = "rammeTop",
        )
        val topMargen = topMargenRå.coerceAtLeast(0.dp)

        Box(
            Modifier
                .align(if (model.isStory) Alignment.Center else Alignment.TopCenter)
                .padding(top = topMargen)
                .size(bredde, rammeHøjde)
                .clip(RoundedCornerShape(0.dp)),
        ) {
            if (cam.authorized) {
                AndroidView(
                    modifier = Modifier
                        .fillMaxSize()
                        .pointerInput(Unit) {
                            detectTransformGestures { _, _, zoomChange, _ ->
                                cam.zoom = min(8f, max(1f, cam.zoom * zoomChange))
                                kamera?.cameraControl?.setZoomRatio(cam.zoom)
                            }
                        }
                        .pointerInput(previewView) {
                            detectTapGestures { p ->
                                fokusPunkt = p
                                val view = previewView ?: return@detectTapGestures
                                val fabrik = view.meteringPointFactory
                                val punkt = fabrik.createPoint(p.x, p.y)
                                kamera?.cameraControl?.startFocusAndMetering(
                                    FocusMeteringAction.Builder(punkt).setAutoCancelDuration(3, TimeUnit.SECONDS).build()
                                )
                            }
                        },
                    factory = { ctx ->
                        PreviewView(ctx).also {
                            it.scaleType = PreviewView.ScaleType.FILL_CENTER
                            previewView = it
                        }
                    },
                    update = { view ->
                        val future = ProcessCameraProvider.getInstance(context)
                        future.addListener({
                            val provider = future.get()
                            val preview = Preview.Builder().build()
                                .also { it.surfaceProvider = view.surfaceProvider }
                            val billede = ImageCapture.Builder()
                                .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                                .build()
                            val optager = Recorder.Builder()
                                .setQualitySelector(QualitySelector.from(Quality.FHD))
                                .build()
                            val video = VideoCapture.withOutput(optager)
                            val vælger = if (cam.back) CameraSelector.DEFAULT_BACK_CAMERA
                            else CameraSelector.DEFAULT_FRONT_CAMERA
                            runCatching {
                                provider.unbindAll()
                                kamera = provider.bindToLifecycle(
                                    lifecycleOwner, vælger, preview, billede, video,
                                )
                                billedeUd = billede
                                videoUd = video
                                kamera?.cameraControl?.setZoomRatio(cam.zoom)
                            }
                        }, ContextCompat.getMainExecutor(context))
                    },
                )
                fokusPunkt?.let { p ->
                    Box(
                        Modifier
                            .offset {
                                androidx.compose.ui.unit.IntOffset(
                                    (p.x - with(density) { 37.dp.toPx() }).toInt(),
                                    (p.y - with(density) { 37.dp.toPx() }).toInt(),
                                )
                            }
                            .size(74.dp)
                            .border(1.5.dp, Color.Yellow, RoundedCornerShape(4.dp)),
                    )
                }
            } else {
                NægtetPanel(model) { ask.launch(Manifest.permission.CAMERA) }
            }

            // Tynd ramme om optageområdet, kun for minder
            if (!model.isStory) {
                Box(Modifier.fillMaxSize().border(1.dp, Color.White.copy(alpha = 0.22f)))
            }
        }

        // Fade i top og bund, så kontrollerne kan læses
        Box(
            Modifier.align(Alignment.TopCenter).fillMaxWidth().height(130.dp)
                .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.55f), Color.Transparent)))
        )
        Box(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(165.dp)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.62f))))
        )

        Column(Modifier.fillMaxSize().padding(top = topPad, bottom = bottomPad)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IkonKnap("✕") { onCancel() }
                Spacer(Modifier.weight(1f))
                if (cam.recording) {
                    Row(
                        Modifier.clip(CircleShape).background(Color.Red)
                            .padding(horizontal = 11.dp, vertical = 5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Box(Modifier.size(8.dp).clip(CircleShape).background(Color.White))
                        Text(
                            "0:0${max(0, cam.secondsLeft)}",
                            color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Black,
                        )
                    }
                }
                Spacer(Modifier.weight(1f))
                IkonKnap(if (cam.flashOn) "⚡" else "⚡̸") { cam.flashOn = !cam.flashOn }
            }

            Spacer(Modifier.weight(1f))

            if (cam.zoom > 1.02f) {
                Pille(String.format("%.1fx", cam.zoom), Modifier.align(Alignment.CenterHorizontally))
                Spacer(Modifier.height(6.dp))
            }
            if (!cam.recording) {
                // iOS har den her hårdkodet på dansk. Vi lægger den i strings, så den
                // følger telefonens sprog i stedet for kun at virke for danskere.
                Pille(
                    androidx.compose.ui.res.stringResource(dk.vibefeed.app.R.string.camera_hint),
                    Modifier.align(Alignment.CenterHorizontally),
                )
                Spacer(Modifier.height(8.dp))
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 26.dp)
                    .padding(bottom = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (model.purpose == Purpose.COMPOSE) {
                    Spacer(Modifier.size(48.dp))
                } else {
                    GalleriGenvej(model, onGallery)
                }
                Spacer(Modifier.weight(1f))
                UdløserKnap(
                    optager = cam.recording,
                    aktiv = cam.authorized,
                    onFoto = {
                        val ud = billedeUd ?: return@UdløserKnap
                        ud.flashMode = if (cam.flashOn) ImageCapture.FLASH_MODE_ON else ImageCapture.FLASH_MODE_OFF
                        tagBillede(context, ud, model)
                    },
                    onStart = {
                        val ud = videoUd ?: return@UdløserKnap
                        // Lygten er video-blitzen: ImageCapture-blitzen virker ikke under optagelse
                        if (cam.flashOn) kamera?.cameraControl?.enableTorch(true)
                        optagelse = startOptagelse(context, ud, model) {
                            cam.recording = false
                            kamera?.cameraControl?.enableTorch(false)
                        }
                        cam.recording = true
                    },
                    onStop = {
                        optagelse?.stop()
                        optagelse = null
                    },
                )
                Spacer(Modifier.weight(1f))
                IkonKnap("⟳") {
                    cam.back = !cam.back
                    cam.zoom = 1f
                }
            }

            if (model.purpose != Purpose.COMPOSE) {
                Row(
                    Modifier.align(Alignment.CenterHorizontally).padding(bottom = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(26.dp),
                ) {
                    TilstandKnap(model.labels.or("modeMemory", "Minde"), !model.isStory) {
                        model.isStory = false
                    }
                    TilstandKnap(model.labels.or("modeStory", "Story"), model.isStory) {
                        model.isStory = true
                    }
                }
            }
        }
    }
}

/* ============================================================ smådele */

@Composable
private fun UdløserKnap(
    optager: Boolean,
    aktiv: Boolean,
    onFoto: () -> Unit,
    onStart: () -> Unit,
    onStop: () -> Unit,
) {
    val indreStørrelse by animateDpAsState(if (optager) 32.dp else 62.dp, tween(200), label = "indre")
    val radius by animateDpAsState(if (optager) 8.dp else 31.dp, tween(200), label = "radius")
    val ringFarve = if (optager) Color.Red else Color.White
    val indreFarve = if (optager) Color.Red else Color.White

    Box(
        Modifier
            .size(78.dp)
            .clip(CircleShape)
            .border(5.dp, ringFarve, CircleShape)
            .alpha(if (aktiv) 1f else 0.4f)
            .pointerInput(aktiv, optager) {
                if (!aktiv) return@pointerInput
                detectTapGestures(
                    onPress = {
                        // Hold i 0,32 sekund starter video. Slipper man før, bliver det et foto.
                        val sluppetHurtigt = withTimeoutOrNull(320L) { tryAwaitRelease() } != null
                        if (sluppetHurtigt) {
                            onFoto()
                        } else {
                            onStart()
                            tryAwaitRelease()
                            onStop()
                        }
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(indreStørrelse)
                .clip(RoundedCornerShape(radius))
                .background(indreFarve),
        )
    }
}

@Composable
private fun GalleriGenvej(model: ComposerModel, onGallery: () -> Unit) {
    Box(
        Modifier
            .size(48.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(Color.White.copy(alpha = 0.12f))
            .border(1.5.dp, Color.White.copy(alpha = 0.7f), RoundedCornerShape(10.dp))
            .clickable { onGallery() },
        contentAlignment = Alignment.Center,
    ) {
        val første = model.seneste.firstOrNull()
        if (første != null) {
            AsyncImage(
                model = første.uri,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(10.dp)),
            )
        } else {
            Text("🖼", fontSize = 20.sp)
        }
    }
}

@Composable
private fun IkonKnap(tegn: String, onClick: () -> Unit) {
    Box(
        Modifier.size(42.dp).clip(CircleShape).background(Color.Black.copy(alpha = 0.28f))
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(tegn, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun Pille(tekst: String, modifier: Modifier = Modifier) {
    Text(
        tekst,
        color = Color.White,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.4f))
            .padding(horizontal = 12.dp, vertical = 5.dp),
    )
}

@Composable
private fun TilstandKnap(tekst: String, valgt: Boolean, onClick: () -> Unit) {
    Text(
        tekst.uppercase(),
        color = if (valgt) Color.White else Color.White.copy(alpha = 0.5f),
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.7.sp,
        modifier = Modifier
            .clickable { onClick() }
            .padding(horizontal = 6.dp, vertical = 5.dp),
    )
}

@Composable
private fun NægtetPanel(model: ComposerModel, onAsk: () -> Unit) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("📷", fontSize = 42.sp)
        Spacer(Modifier.height(14.dp))
        Text(
            model.labels.or("denied", "Giv adgang til kameraet, eller vælg fra galleriet."),
            color = Color.White.copy(alpha = 0.85f),
            fontSize = 15.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 36.dp),
        )
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier.clip(RoundedCornerShape(12.dp)).background(BRAND)
                .clickable { onAsk() }
                .padding(horizontal = 22.dp, vertical = 11.dp),
        ) {
            Text(
                model.labels.or("settings", "Giv adgang"),
                color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
        }
    }
}

/* ============================================================ optagelse */

private fun tagBillede(context: Context, capture: ImageCapture, model: ComposerModel) {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val fil = File(dir, "foto_${System.nanoTime()}.jpg")
    capture.takePicture(
        ImageCapture.OutputFileOptions.Builder(fil).build(),
        ContextCompat.getMainExecutor(context),
        object : ImageCapture.OnImageSavedCallback {
            override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                model.picked = Picked(Uri.fromFile(fil), isVideo = false)
                model.step = Step.CROP
            }

            override fun onError(exc: ImageCaptureException) {
                // Slår optagelsen fejl, bliver vi i kameraet så brugeren kan prøve igen
            }
        },
    )
}

@androidx.annotation.OptIn(androidx.camera.video.ExperimentalPersistentRecording::class)
private fun startOptagelse(
    context: Context,
    videoUd: VideoCapture<Recorder>,
    model: ComposerModel,
    onFærdig: () -> Unit,
): Recording? {
    val dir = File(context.cacheDir, "captures").apply { mkdirs() }
    val fil = File(dir, "video_${System.nanoTime()}.mp4")
    val output = androidx.camera.video.FileOutputOptions.Builder(fil).build()
    return runCatching {
        videoUd.output.prepareRecording(context, output)
            .start(ContextCompat.getMainExecutor(context)) { event ->
                if (event is VideoRecordEvent.Finalize) {
                    onFærdig()
                    if (!event.hasError()) {
                        model.picked = Picked(Uri.fromFile(fil), isVideo = true)
                        // Video går direkte til billedteksten indtil video-beskæreren er bygget
                        model.step = Step.CAPTION
                    }
                }
            }
    }.getOrNull()
}
