package dk.vibefeed.app.composer

import android.Manifest
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val BRAND = Color(0xFFE0402F)

/** Systemets indhak, videregivet fra MainActivity. */
data class SafeArea(val top: Dp, val bottom: Dp)

val LocalSafeArea = compositionLocalOf { SafeArea(0.dp, 0.dp) }

/**
 * Den native medie-komposer: kamera, galleri, beskærer og billedtekst.
 *
 * Web ejer flowet. Herfra kommer kun mediet, billedteksten og destinationen tilbage.
 * Baggrunden er appens temafarve, ikke sort. Kun kameraet har sit eget sorte chrome.
 */
@Composable
fun ComposerScreen(
    model: ComposerModel,
    baggrund: Color,
    blæk: Color,
    topPad: Dp,
    bottomPad: Dp,
    onShare: (bytes: ByteArray, isVideo: Boolean, caption: String, dest: String) -> Unit,
    onCancel: () -> Unit,
    onDenied: () -> Unit,
) {
    val context = LocalContext.current
    val cam = remember { CameraState() }

    CompositionLocalProvider(LocalSafeArea provides SafeArea(topPad, bottomPad)) {
        Box(
            Modifier.fillMaxSize()
                .background(if (model.step == Step.CAMERA) Color.Black else baggrund)
        ) {
            when (model.step) {
                Step.CAMERA -> CameraStep(
                    model = model,
                    cam = cam,
                    topPad = topPad,
                    bottomPad = bottomPad,
                    onCancel = onCancel,
                    onGallery = { model.step = Step.GALLERY },
                )

                Step.GALLERY -> GalleryStep(model, context, baggrund, blæk, topPad, onCancel, onDenied)
                Step.CROP -> CropStep(model, context, topPad, bottomPad)
                Step.CAPTION -> CaptionStep(model, context, baggrund, blæk, topPad, bottomPad, onShare)
            }
        }
    }
}

/* ============================================================ Galleri */

@Composable
private fun GalleryStep(
    model: ComposerModel,
    context: Context,
    baggrund: Color,
    blæk: Color,
    topPad: Dp,
    onCancel: () -> Unit,
    onDenied: () -> Unit,
) {
    var adgang by remember { mutableStateOf(medieAdgang(context)) }
    var items by remember { mutableStateOf<List<Picked>>(emptyList()) }
    var genhent by remember { mutableIntStateOf(0) }

    val spørg = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        adgang = medieAdgang(context)
        genhent += 1
    }
    LaunchedEffect(Unit) { if (adgang == Adgang.NÆGTET) spørg.launch(medieTilladelser()) }
    LaunchedEffect(adgang, genhent) {
        if (adgang != Adgang.NÆGTET) {
            items = withContext(Dispatchers.IO) { Media.recent(context) }
            model.seneste = items
        }
    }

    Column(Modifier.fillMaxSize().background(baggrund)) {
        ComposerNavBar(
            titel = model.title,
            annullerLabel = model.labels.or("cancel", "Annuller"),
            handlingLabel = model.labels.or("next", "Videre"),
            handlingAktiv = model.valgt != null && !model.forbereder,
            arbejder = model.forbereder,
            baggrund = baggrund,
            blæk = blæk,
            topPad = topPad,
            visSkillelinje = true,
            onCancel = {
                // Minde og story går tilbage til kameraet. En tanke lukker helt.
                if (model.purpose == Purpose.COMPOSE) onCancel() else model.step = Step.CAMERA
            },
            onAction = { videre(model) },
        )

        if (adgang == Adgang.NÆGTET) {
            NægtetGalleri(model, blæk, onSettings = { åbnIndstillinger(context) }, onFallback = onDenied)
            return@Column
        }

        // Forhåndsvisning af det valgte. Letterboxen er temafarven, bevidst ikke sort.
        model.valgt?.let { v ->
            BoxWithConstraints(Modifier.fillMaxWidth().weight(0.38f)) {
                Box(
                    Modifier.fillMaxSize().background(baggrund),
                    contentAlignment = Alignment.Center,
                ) {
                    AsyncImage(
                        model = v.uri,
                        contentDescription = null,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.fillMaxSize(),
                    )
                    if (v.isVideo) {
                        Text("▶", color = Color.White.copy(alpha = 0.85f), fontSize = 34.sp)
                    }
                }
            }
        }

        if (adgang == Adgang.BEGRÆNSET) {
            Row(
                Modifier.fillMaxWidth().background(blæk.copy(alpha = 0.08f))
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    model.labels.or("limited", "Du har kun givet adgang til udvalgte billeder."),
                    color = blæk.copy(alpha = 0.7f), fontSize = 12.sp,
                )
                Spacer(Modifier.weight(1f))
                Text(
                    model.labels.or("manage", "Administrer"),
                    color = BRAND, fontSize = 12.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.clickable { spørg.launch(medieTilladelser()) },
                )
            }
        }

        LazyVerticalGrid(
            columns = GridCells.Fixed(4),
            modifier = Modifier.fillMaxWidth().weight(1f),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            items(items) { item ->
                GalleriCelle(item, valgt = model.valgt?.uri == item.uri, blæk = blæk) {
                    // Gitteret fryses mens et medie hentes, ellers kunne man vælge et andet
                    // og få det forkerte med videre i beskæreren.
                    if (!model.forbereder) model.valgt = item
                }
            }
        }
    }
}

@Composable
private fun GalleriCelle(item: Picked, valgt: Boolean, blæk: Color, onClick: () -> Unit) {
    Box(
        Modifier
            .aspectRatio(1f)
            .background(blæk.copy(alpha = 0.12f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) { onClick() },
    ) {
        AsyncImage(
            model = item.uri,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(),
        )
        if (item.isVideo) {
            val sek = (item.durationMs + 500) / 1000
            Text(
                String.format("%d:%02d", sek / 60, sek % 60),
                color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(4.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(Color.Black.copy(alpha = 0.4f))
                    .padding(horizontal = 4.dp, vertical = 1.dp),
            )
        }
        if (valgt) Box(Modifier.fillMaxSize().border(3.dp, BRAND))
    }
}

@Composable
private fun NægtetGalleri(
    model: ComposerModel,
    blæk: Color,
    onSettings: () -> Unit,
    onFallback: () -> Unit,
) {
    Column(
        Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            model.labels.or("denied", "Giv adgang til dine billeder for at vælge et minde."),
            color = blæk.copy(alpha = 0.7f), fontSize = 15.sp, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 30.dp),
        )
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier.clip(RoundedCornerShape(12.dp)).background(BRAND)
                .clickable { onSettings() }
                .padding(horizontal = 22.dp, vertical = 11.dp),
        ) {
            Text(
                model.labels.or("settings", "Åbn indstillinger"),
                color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold,
            )
        }
        Spacer(Modifier.height(14.dp))
        // Brugeren må aldrig strande: web overtager med sin egen filvælger
        Text(
            model.labels.or("cancel", "Annuller"),
            color = blæk.copy(alpha = 0.6f), fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clickable { onFallback() },
        )
    }
}

/** Videre-knappen: billeder til beskæreren, video videre i sit eget spor. */
private fun videre(model: ComposerModel) {
    val v = model.valgt ?: return
    if (model.forbereder) return
    model.picked = v
    // Trim-trinnet er endnu ikke bygget, så video går direkte til billedteksten.
    model.step = if (v.isVideo) Step.CAPTION else Step.CROP
}

/* ============================================================ Beskærer */

@Composable
private fun CropStep(model: ComposerModel, context: Context, topPad: Dp, bottomPad: Dp) {
    val valgt = model.picked ?: return
    var billede by remember(valgt.uri) { mutableStateOf<android.graphics.Bitmap?>(null) }

    LaunchedEffect(valgt.uri) {
        model.forbereder = true
        billede = withContext(Dispatchers.IO) { Media.loadForCrop(context, valgt.uri) }
        model.forbereder = false
    }

    val b = billede
    if (b == null) {
        Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = BRAND, strokeWidth = 2.dp)
        }
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
    baggrund: Color,
    blæk: Color,
    topPad: Dp,
    bottomPad: Dp,
    onShare: (ByteArray, Boolean, String, String) -> Unit,
) {
    val valgt = model.picked ?: return
    var arbejder by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().background(baggrund)) {
        ComposerNavBar(
            titel = model.title,
            annullerLabel = model.labels.or("cancel", "Annuller"),
            handlingLabel = model.shareLabel,
            handlingAktiv = !arbejder && !model.sharing,
            arbejder = arbejder || model.sharing,
            baggrund = baggrund,
            blæk = blæk,
            topPad = topPad,
            // Bevidst ingen streg her: renere look om kreds-vælgeren
            visSkillelinje = false,
            onCancel = {
                // Ét trin tilbage ad gangen, i den rækkefølge iOS bruger
                model.step = when {
                    model.cropped != null -> Step.CROP
                    valgt.uri.scheme == "file" -> Step.CAMERA
                    else -> Step.GALLERY
                }
            },
            onAction = {
                if (arbejder || model.sharing) return@ComposerNavBar
                arbejder = true
                val færdig = model.cropped
                Thread {
                    val bytes = when {
                        valgt.isVideo -> Media.readBytes(context, valgt.uri)
                        // Beskæreren har allerede lavet det endelige billede i det valgte format
                        færdig != null -> Media.encode(færdig, 88)
                        else -> {
                            val (w, h) = model.target()
                            Media.prepareImage(context, valgt.uri, w, h)
                        }
                    }
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        arbejder = false
                        if (bytes != null) onShare(bytes, valgt.isVideo, model.caption, model.dest)
                    }
                }.start()
            },
        )

        // Kreds-vælgeren ØVERST, for både minde og story
        Text(
            model.labels.or("destLabel", "Del til").uppercase(),
            color = blæk.copy(alpha = 0.6f),
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            letterSpacing = 0.4.sp,
            modifier = Modifier.padding(start = 16.dp, top = 14.dp, bottom = 8.dp),
        )
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                DestPille(model.labels.or("allLabel", "Hele kredsen"), model.dest == "all", blæk, baggrund) {
                    model.dest = "all"
                }
            }
            items(model.feeds) { f ->
                DestPille(f.name, model.dest == f.id, blæk, baggrund) { model.dest = f.id }
            }
        }

        if (model.isStory) {
            // Story: billedet fylder resten, intet tekstfelt, ingen scroll
            Box(
                Modifier.weight(1f).fillMaxWidth().padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Preview(model, valgt, Modifier.fillMaxSize())
            }
            Spacer(Modifier.height(bottomPad))
        } else {
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).imePadding()) {
                BoxWithConstraints(Modifier.fillMaxWidth().padding(top = 14.dp)) {
                    Box(
                        Modifier.fillMaxWidth().height(this@BoxWithConstraints.maxHeight * 0.40f),
                        contentAlignment = Alignment.Center,
                    ) {
                        Preview(model, valgt, Modifier.fillMaxSize())
                    }
                }

                BasicTextField(
                    value = model.caption,
                    onValueChange = { model.caption = it },
                    textStyle = TextStyle(color = blæk, fontSize = 16.sp),
                    cursorBrush = SolidColor(BRAND),
                    maxLines = 5,
                    modifier = Modifier.fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(top = 14.dp, bottom = 12.dp),
                    decorationBox = { indre ->
                        if (model.caption.isEmpty()) {
                            Text(
                                model.labels.or("captionPlaceholder", "Skriv en tekst"),
                                color = blæk.copy(alpha = 0.45f),
                                fontSize = 16.sp,
                            )
                        }
                        indre()
                    },
                )

                MentionStrip(model, blæk)
                Spacer(Modifier.height(bottomPad))
            }
        }
    }
}

@Composable
private fun Preview(model: ComposerModel, valgt: Picked, modifier: Modifier) {
    val beskåret = model.cropped
    if (beskåret != null) {
        Image(
            bitmap = beskåret.asImageBitmap(),
            contentDescription = null,
            contentScale = ContentScale.Fit,
            modifier = modifier,
        )
    } else {
        Box(modifier, contentAlignment = Alignment.Center) {
            AsyncImage(
                model = valgt.uri,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
            if (valgt.isVideo) {
                Text("▶", color = Color.White.copy(alpha = 0.85f), fontSize = 34.sp)
            }
        }
    }
}

@Composable
private fun DestPille(
    tekst: String,
    valgt: Boolean,
    blæk: Color,
    baggrund: Color,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .height(34.dp)
            .clip(CircleShape)
            .then(
                if (valgt) Modifier.background(blæk)
                else Modifier.border(1.5.dp, blæk.copy(alpha = 0.2f), CircleShape)
            )
            .clickable { onClick() }
            .padding(horizontal = 15.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            tekst,
            color = if (valgt) baggrund else blæk,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
        )
    }
}

/** Forslag mens man skriver et @-token. Følger den valgte destination. */
@Composable
private fun MentionStrip(model: ComposerModel, blæk: Color) {
    val træf = remember(model.caption, model.dest, model.mentionables) {
        Mentions.hits(model.caption, model.aktuelleMentions)
    }
    if (træf.isEmpty()) return

    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.padding(bottom = 8.dp),
    ) {
        items(træf) { kort ->
            Row(
                Modifier
                    .clip(CircleShape)
                    .background(blæk.copy(alpha = 0.08f))
                    .border(1.dp, blæk.copy(alpha = 0.10f), CircleShape)
                    .clickable { model.caption = Mentions.insert(model.caption, kort.handle) }
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                MentionAvatar(kort)
                Text("@${kort.handle}", color = blæk, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@Composable
private fun MentionAvatar(kort: MentionCard) {
    if (!kort.avatarUrl.isNullOrBlank()) {
        AsyncImage(
            model = kort.avatarUrl,
            contentDescription = null,
            contentScale = ContentScale.Crop,
            modifier = Modifier.size(22.dp).clip(CircleShape),
        )
        return
    }
    val farver = kort.gradient.mapNotNull { hexTilFarve(it) }
    Box(
        Modifier.size(22.dp).clip(CircleShape).background(
            if (farver.size >= 2) Brush.verticalGradient(farver) else SolidColor(BRAND)
        ),
        contentAlignment = Alignment.Center,
    ) {
        Text(kort.initials, color = Color.White, fontSize = 8.sp, fontWeight = FontWeight.Bold)
    }
}

private fun hexTilFarve(hex: String): Color? = runCatching {
    Color(android.graphics.Color.parseColor(if (hex.startsWith("#")) hex else "#$hex"))
}.getOrNull()

/* ============================================================ Tilladelser */

enum class Adgang { FULD, BEGRÆNSET, NÆGTET }

private fun har(context: Context, navn: String) =
    androidx.core.content.ContextCompat.checkSelfPermission(context, navn) ==
        android.content.pm.PackageManager.PERMISSION_GRANTED

fun medieTilladelser(): Array<String> = when {
    Build.VERSION.SDK_INT >= 34 -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
        Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,
    )
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> arrayOf(
        Manifest.permission.READ_MEDIA_IMAGES,
        Manifest.permission.READ_MEDIA_VIDEO,
    )
    else -> arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
}

/**
 * Fra Android 14 findes iOS' "begrænsede" tilstand: brugeren har kun sluppet udvalgte
 * billeder ind, og så skal banneret med Administrer vises.
 */
fun medieAdgang(context: Context): Adgang = when {
    Build.VERSION.SDK_INT >= 34 -> when {
        har(context, Manifest.permission.READ_MEDIA_IMAGES) -> Adgang.FULD
        har(context, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) -> Adgang.BEGRÆNSET
        else -> Adgang.NÆGTET
    }
    Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
        if (har(context, Manifest.permission.READ_MEDIA_IMAGES)) Adgang.FULD else Adgang.NÆGTET
    else ->
        if (har(context, Manifest.permission.READ_EXTERNAL_STORAGE)) Adgang.FULD else Adgang.NÆGTET
}

private fun åbnIndstillinger(context: Context) {
    runCatching {
        context.startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", context.packageName, null),
            )
        )
    }
}
