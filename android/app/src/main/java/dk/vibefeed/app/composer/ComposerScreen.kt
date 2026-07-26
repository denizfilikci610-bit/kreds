package dk.vibefeed.app.composer

import android.Manifest
import android.content.Context
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

private val BRAND = Color(0xFFE0402F)
private val SORT = Color(0xFF000000)

/**
 * Den native medie-komposer, bygget efter iOS-forlægget: kameraet først med en vælger mellem
 * minde og story under udløseren, galleriet lige ved siden af, og til sidst billedteksten med
 * kreds-vælgeren øverst.
 *
 * Web ejer stadig flowet. Herfra kommer kun mediet, billedteksten og destinationen tilbage.
 */
@Composable
fun ComposerScreen(
    model: ComposerModel,
    topPad: Dp,
    bottomPad: Dp,
    onShare: (bytes: ByteArray, isVideo: Boolean, caption: String, dest: String) -> Unit,
    onCancel: () -> Unit,
    onDenied: () -> Unit,
) {
    val context = LocalContext.current
    val cam = remember { CameraState() }

    // Appen tegner kant til kant, og Compose kender ikke systemets indhak, fordi
    // MainActivity selv har taget dem. Derfor får skærmen dem her, så knapperne ikke
    // lander under uret eller bag hjemme-streget.
    CompositionLocalProvider(LocalSafeArea provides SafeArea(topPad, bottomPad)) {
        Box(Modifier.fillMaxSize().background(SORT)) {
            when (model.step) {
                Step.CAMERA -> CameraStep(
                    model = model,
                    cam = cam,
                    topPad = topPad,
                    bottomPad = bottomPad,
                    onCancel = onCancel,
                    onGallery = { model.step = Step.GALLERY },
                )
                Step.GALLERY -> GalleryStep(model, onCancel, onDenied)
                Step.CROP -> CropStep(model, context, topPad, bottomPad)
                Step.CAPTION -> CaptionStep(model, context, onShare)
            }
        }
    }
}

/** Systemets indhak, videregivet fra MainActivity. */
data class SafeArea(val top: Dp, val bottom: Dp)

val LocalSafeArea = androidx.compose.runtime.compositionLocalOf { SafeArea(0.dp, 0.dp) }

/* ============================================================ Galleri */

@Composable
private fun GalleryStep(model: ComposerModel, onCancel: () -> Unit, onDenied: () -> Unit) {
    val context = LocalContext.current
    var granted by remember { mutableStateOf(harMedieAdgang(context)) }
    var items by remember { mutableStateOf<List<Picked>>(emptyList()) }

    val ask = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { res ->
        granted = res.values.any { it }
        // Uden adgang til billederne kan komposeren ikke bruges. Web overtager med sin egen
        // filvælger, præcis som iOS gør (window.vfMemoryFallback).
        if (!granted) onDenied()
    }
    LaunchedEffect(Unit) { if (!granted) ask.launch(medieTilladelser()) }
    LaunchedEffect(granted) {
        if (granted) {
            items = withContext(Dispatchers.IO) { Media.recent(context) }
            model.seneste = items
        }
    }

    Column(Modifier.fillMaxSize().background(SORT)) {
        Toplinje(
            titel = model.title,
            annuller = model.labels.or("cancel", "Annuller"),
            onCancel = onCancel,
            kameraKnap = { model.step = Step.CAMERA },
        )
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier.fillMaxSize(),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(items) { item ->
                Box(
                    Modifier.aspectRatio(1f).background(Color(0xFF1A1A1A)).clickable {
                        model.picked = item
                        // Billeder skal beskæres, som på iOS. Video går direkte videre, indtil
                        // video-beskæreren er bygget.
                        model.step = if (item.isVideo) Step.CAPTION else Step.CROP
                    }
                ) {
                    AsyncImage(
                        model = item.uri,
                        contentDescription = null,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (item.isVideo) {
                        Text(
                            "▶",
                            color = Color.White,
                            fontSize = 15.sp,
                            modifier = Modifier.align(Alignment.BottomStart).padding(6.dp),
                        )
                    }
                }
            }
        }
    }
}

/* ============================================================ Beskærer */

@Composable
private fun CropStep(
    model: ComposerModel,
    context: Context,
    topPad: Dp,
    bottomPad: Dp,
) {
    val valgt = model.picked ?: return
    var billede by remember(valgt.uri) { mutableStateOf<android.graphics.Bitmap?>(null) }

    LaunchedEffect(valgt.uri) {
        billede = withContext(Dispatchers.IO) { Media.loadForCrop(context, valgt.uri) }
    }

    val b = billede
    if (b == null) {
        Box(Modifier.fillMaxSize().background(Color.Black))
        return
    }

    CropScreen(
        billede = b.asImageBitmap(),
        erStory = model.isStory,
        startFormat = Format.STAAENDE,
        titel = model.labels.or("fit", "Tilpas udsnittet"),
        formatLabel = model.labels.or("fit", "Tilpas udsnittet"),
        annullerLabel = model.labels.or("cancel", "Annuller"),
        brugLabel = model.labels.or("next", "Videre"),
        topPad = topPad,
        bottomPad = bottomPad,
        onCancel = { model.step = if (valgt.uri.scheme == "file") Step.CAMERA else Step.GALLERY },
        onDone = { ud ->
            model.cropped = ud
            model.step = Step.CAPTION
        },
    )
}

/* ============================================================ Billedtekst */

@Composable
private fun CaptionStep(
    model: ComposerModel,
    context: Context,
    onShare: (ByteArray, Boolean, String, String) -> Unit,
) {
    val valgt = model.picked ?: return
    var arbejder by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(SORT)) {
        Toplinje(
            titel = model.title,
            annuller = model.labels.or("cancel", "Annuller"),
            onCancel = { model.step = Step.CROP },
        )

        // Kreds-vælgeren ligger ØVERST, som ejeren bad om på iOS
        Text(
            model.labels.or("destLabel", "Del til"),
            color = Color(0xFFBBBBBB),
            fontSize = 13.sp,
            modifier = Modifier.padding(start = 16.dp, top = 6.dp, bottom = 6.dp),
        )
        Row(
            Modifier
                .padding(horizontal = 12.dp)
                .horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Chip(model.labels.or("allLabel", "Hele kredsen"), model.dest == "all") {
                model.dest = "all"
            }
            model.feeds.forEach { f ->
                Chip(f.name, model.dest == f.id) { model.dest = f.id }
            }
        }

        Box(
            Modifier.weight(1f).fillMaxWidth().padding(top = 12.dp),
            contentAlignment = Alignment.Center,
        ) {
            val beskaaret = model.cropped
            if (beskaaret != null) {
                androidx.compose.foundation.Image(
                    bitmap = beskaaret.asImageBitmap(),
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            } else {
                AsyncImage(
                    model = valgt.uri,
                    contentDescription = null,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        BasicTextField(
            value = model.caption,
            onValueChange = { model.caption = it },
            textStyle = TextStyle(color = Color.White, fontSize = 16.sp),
            cursorBrush = androidx.compose.ui.graphics.SolidColor(BRAND),
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            decorationBox = { inner ->
                if (model.caption.isEmpty()) {
                    Text(
                        model.labels.or("captionPlaceholder", "Skriv en tekst"),
                        color = Color(0xFF777777),
                        fontSize = 16.sp,
                    )
                }
                inner()
            },
        )

        Box(
            Modifier
                .fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, top = 16.dp)
                .padding(bottom = LocalSafeArea.current.bottom + 16.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(if (arbejder || model.sharing) Color(0xFF7A2A20) else BRAND)
                .clickable(enabled = !arbejder && !model.sharing) {
                    arbejder = true
                    val (w, h) = model.target()
                    val færdig = model.cropped
                    Thread {
                        val bytes = when {
                            valgt.isVideo -> Media.readBytes(context, valgt.uri)
                            // Beskæreren har allerede lavet det endelige billede i det
                            // valgte format. Så skal det ikke beskæres én gang til.
                            færdig != null -> Media.encode(færdig)
                            else -> Media.prepareImage(context, valgt.uri, w, h)
                        }
                        android.os.Handler(android.os.Looper.getMainLooper()).post {
                            arbejder = false
                            if (bytes != null) {
                                onShare(bytes, valgt.isVideo, model.caption, model.dest)
                            }
                        }
                    }.start()
                }
                .padding(vertical = 15.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(model.shareLabel, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        }
    }
}

/* ============================================================ Smådele */

@Composable
private fun Toplinje(
    titel: String,
    annuller: String,
    onCancel: () -> Unit,
    kameraKnap: (() -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(top = LocalSafeArea.current.top)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            annuller,
            color = Color.White,
            fontSize = 16.sp,
            modifier = Modifier.clickable { onCancel() },
        )
        Spacer(Modifier.weight(1f))
        Text(titel, color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
        Spacer(Modifier.weight(1f))
        if (kameraKnap != null) {
            Text("◎", color = Color.White, fontSize = 20.sp,
                modifier = Modifier.clickable { kameraKnap() })
        } else {
            Spacer(Modifier.width(56.dp))
        }
    }
}

@Composable
private fun Tilstand(tekst: String, valgt: Boolean, onClick: () -> Unit) {
    Text(
        tekst,
        color = if (valgt) Color.White else Color(0xFF9A9A9A),
        fontWeight = if (valgt) FontWeight.SemiBold else FontWeight.Normal,
        fontSize = 15.sp,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (valgt) Color(0x33FFFFFF) else Color.Transparent)
            .clickable { onClick() }
            .padding(horizontal = 16.dp, vertical = 7.dp),
    )
}

@Composable
private fun Chip(tekst: String, valgt: Boolean, onClick: () -> Unit) {
    Text(
        tekst,
        color = if (valgt) Color.Black else Color.White,
        fontSize = 14.sp,
        fontWeight = if (valgt) FontWeight.SemiBold else FontWeight.Normal,
        modifier = Modifier
            .clip(RoundedCornerShape(999.dp))
            .background(if (valgt) Color.White else Color(0xFF262626))
            .clickable { onClick() }
            .padding(horizontal = 14.dp, vertical = 8.dp),
    )
}

@Composable
private fun RundKnap(tegn: String, størrelse: androidx.compose.ui.unit.Dp, onClick: () -> Unit) {
    Box(
        Modifier.size(størrelse).clip(CircleShape).background(Color(0x33FFFFFF))
            .clickable { onClick() },
        contentAlignment = Alignment.Center,
    ) {
        Text(tegn, color = Color.White, fontSize = 20.sp)
    }
}

/* ============================================================ Tilladelser */

private fun harTilladelse(context: Context, navn: String): Boolean =
    ContextCompat.checkSelfPermission(context, navn) == android.content.pm.PackageManager.PERMISSION_GRANTED

private fun medieTilladelser(): Array<String> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        arrayOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
    } else {
        arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
    }

private fun harMedieAdgang(context: Context): Boolean =
    medieTilladelser().any { harTilladelse(context, it) }
