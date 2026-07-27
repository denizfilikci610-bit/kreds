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
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlin.math.max
import kotlin.math.min

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

    // Som iOS: fotoadgangen spørges og biblioteket hentes STRAKS ved åbning, mens
    // kameraet vises. Så er gitteret fyldt i samme øjeblik galleriet åbnes, og kameraets
    // 48 dp-miniature kan vise det nyeste billede fra første besøg.
    val bibliotekSpørg = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        if (medieAdgang(context) != Adgang.NÆGTET) {
            Thread { model.seneste = Media.recent(context) }.start()
        }
    }
    LaunchedEffect(model.open) {
        if (!model.open) return@LaunchedEffect
        if (medieAdgang(context) == Adgang.NÆGTET) {
            bibliotekSpørg.launch(medieTilladelser())
        } else {
            model.seneste = withContext(Dispatchers.IO) { Media.recent(context) }
        }
    }

    // Tankens "upload straks": intet beskærings- eller billedtekst-trin. Billeder
    // nedskaleres til 1440/JPEG 87. Videoer går ALTID gennem eksporten som på iPhone,
    // også uden klip: re-encodningen til H.264/AAC er en del af kontrakten, en rå fil
    // fra galleriet kunne være HEVC eller noget andet feedet ikke kan afspille.
    LaunchedEffect(model.uploadStraks) {
        if (!model.uploadStraks) return@LaunchedEffect
        val p = model.picked ?: run { model.uploadStraks = false; return@LaunchedEffect }
        if (!p.isVideo) {
            val bytes = withContext(Dispatchers.IO) { Media.prepareCompose(context, p.uri) }
            model.uploadStraks = false
            if (bytes != null && model.open) onShare(bytes, false, "", model.dest)
            return@LaunchedEffect
        }
        eksporterVideo(
            model, context, p,
            udsnitOgMaal = false, // kun klip: ingen beskæring, videoens egne mål
        ) { bytes ->
            model.uploadStraks = false
            if (bytes != null && model.open) onShare(bytes, true, "", model.dest)
        }
    }

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

                Step.TRIM -> TrimStep(
                    model = model,
                    baggrund = baggrund,
                    blæk = blæk,
                    topPad = topPad,
                    bottomPad = bottomPad,
                    onCancel = { model.step = Step.GALLERY },
                    onNext = { efterVideo(model) },
                )

                Step.CROP -> CropStep(model, context, topPad, bottomPad)

                Step.VIDEOCROP -> {
                    val v = model.picked
                    if (v != null) {
                        VideoCropScreen(
                            kilde = v.uri,
                            videoBredde = model.videoBredde,
                            videoHoejde = model.videoHoejde,
                            startMs = model.trimStartMs,
                            laengdeMs = model.trimLaengdeMs,
                            erStory = model.isStory,
                            startFormat = Format.STAAENDE,
                            formatLabel = model.labels.or("fit", "Tilpas udsnittet"),
                            annullerLabel = model.labels.or("cancel", "Annuller"),
                            brugLabel = model.labels.or("next", "Videre"),
                            topPad = topPad,
                            bottomPad = bottomPad,
                            onCancel = {
                                model.step = if (model.visTrim) Step.TRIM else Step.GALLERY
                            },
                            onDone = { format, udsnit ->
                                model.videoFormat = format
                                model.videoUdsnit = udsnit
                                model.step = Step.CAPTION
                            },
                        )
                    }
                }
                Step.CAPTION -> CaptionStep(model, context, baggrund, blæk, topPad, bottomPad, onShare)
            }

            // Tankens straks-upload: en rolig spinner over kameraet mens der kodes og sendes.
            if (model.uploadStraks || (model.sharing && model.purpose == Purpose.COMPOSE)) {
                Box(
                    Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.45f)),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(color = BRAND, strokeWidth = 2.dp)
                }
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
            onAction = { videre(model, context) },
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

/** Videre-knappen: billeder til beskæreren, video ad sit eget spor gennem trim. */
private fun videre(model: ComposerModel, context: Context) {
    val v = model.valgt ?: return
    if (model.forbereder) return
    model.picked = v
    // Rester fra et TIDLIGERE valg må aldrig overleve: ellers viser billedteksten
    // billede A's udsnit efter man har fortrudt og valgt video B (iOS nulstiller i goNext).
    model.cropped = null
    model.videoUdsnit = null
    // En tanke: intet beskærings-trin, billedet uploades straks (maks 1440, JPEG 87).
    if (!v.isVideo && model.purpose == Purpose.COMPOSE) {
        model.uploadStraks = true
        return
    }
    if (!v.isVideo) { model.step = Step.CROP; return }

    // Varigheden kender vi allerede fra MediaStore. Målene læses så beskæreren og
    // eksporten regner på videoens OPREJSTE mål, men IKKE på main-tråden: for et
    // cloud-medie (Google Fotos) kan setDataSource blokere i sekunder.
    model.forbereder = true
    Thread {
        val (b, h, meta) = VideoExport.mål(context, v.uri)
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            model.forbereder = false
            if (model.picked !== v || !model.open) return@post
            val varighed = if (v.durationMs > 0) v.durationMs else meta
            model.videoBredde = if (b > 0) b else 1080
            model.videoHoejde = if (h > 0) h else 1920
            model.videoVarighedMs = varighed
            model.trimStartMs = 0L
            model.trimLaengdeMs = min(MAKS_VIDEO_MS, max(100L, varighed))
            model.visTrim = varighed > TRIM_GRAENSE_MS
            if (model.visTrim) model.step = Step.TRIM else efterVideo(model)
        }
    }.start()
}

/** Efter trim: en tanke uploader straks, en story går til billedteksten, et minde beskæres. */
private fun efterVideo(model: ComposerModel) {
    if (model.purpose == Purpose.COMPOSE) {
        model.uploadStraks = true
        return
    }
    model.step = if (model.isStory) Step.CAPTION else Step.VIDEOCROP
}

/* ============================================================ Beskærer */

@Composable
private fun CropStep(model: ComposerModel, context: Context, topPad: Dp, bottomPad: Dp) {
    val valgt = model.picked ?: return
    var billede by remember(valgt.uri) { mutableStateOf<android.graphics.Bitmap?>(null) }

    LaunchedEffect(valgt.uri) {
        model.forbereder = true
        val b = withContext(Dispatchers.IO) { Media.loadForCrop(context, valgt.uri) }
        model.forbereder = false
        // Kan billedet ikke afkodes (korrupt fil, dødt cloud-medie), må brugeren ALDRIG
        // strande på en evig spinner uden knapper: tilbage til der hvor valget kom fra.
        if (b == null) {
            model.step = if (valgt.uri.scheme == "file") Step.CAMERA else Step.GALLERY
        } else {
            billede = b
        }
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
                // Ét trin tilbage ad gangen, i PRÆCIS iOS' rækkefølge: kamera-medie først,
                // så beskåret billede, så beskåret video, så trim, ellers galleriet.
                model.step = when {
                    valgt.uri.scheme == "file" -> Step.CAMERA
                    model.cropped != null -> Step.CROP
                    model.videoUdsnit != null -> Step.VIDEOCROP
                    model.visTrim -> Step.TRIM
                    else -> Step.GALLERY
                }
            },
            onAction = {
                if (arbejder || model.sharing) return@ComposerNavBar
                arbejder = true
                val færdig = model.cropped
                if (valgt.isVideo) {
                    // Video skal ALTID gennem eksporten: klip til trim-vinduet, brugerens
                    // eller det automatiske udsnit, og målstørrelsen. Rå bytes var fejlen
                    // der sendte et 30-sekunders klip uklippet.
                    eksporterVideo(model, context, valgt) { bytes ->
                        arbejder = false
                        if (bytes != null && model.open) {
                            onShare(bytes, true, model.caption, model.dest)
                        }
                    }
                    return@ComposerNavBar
                }
                Thread {
                    val bytes = when {
                        // Beskæreren har allerede lavet det endelige billede i det valgte format
                        færdig != null -> Media.encode(færdig, 88)
                        // Kamera-foto: beskæres automatisk efter motivets orientering,
                        // vandret motiv bliver liggende, ellers 4:5, som på iPhone.
                        valgt.uri.scheme == "file" -> {
                            val (bw, bh) = Media.orientedBounds(context, valgt.uri) ?: (1080 to 1350)
                            val (w, h) = model.kameraTarget(bw, bh)
                            Media.prepareImage(context, valgt.uri, w, h)
                        }
                        else -> {
                            val (w, h) = model.target()
                            Media.prepareImage(context, valgt.uri, w, h)
                        }
                    }
                    android.os.Handler(android.os.Looper.getMainLooper()).post {
                        arbejder = false
                        // Lukkede brugeren komposeren mens der blev kodet (tilbage-knappen),
                        // må det sene resultat ALDRIG poste et opslag.
                        if (bytes != null && model.open) {
                            onShare(bytes, false, model.caption, model.dest)
                        }
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
                // Højden SKAL komme fra skærmen: inde i en scroll-kolonne er maxHeight
                // uendelig, så en procent af den kollapsede forhåndsvisningen til nul.
                val skærmHøjde = androidx.compose.ui.platform.LocalConfiguration
                    .current.screenHeightDp.dp
                Box(
                    Modifier.fillMaxWidth()
                        .padding(top = 14.dp)
                        .height(skærmHøjde * 0.40f),
                    contentAlignment = Alignment.Center,
                ) {
                    Preview(model, valgt, Modifier.fillMaxSize())
                }

                // TextFieldValue, ikke String: ellers hopper markøren til position 0
                // når en mention-chip skriver teksten om. Fælden fra spec'en.
                var felt by remember {
                    mutableStateOf(
                        androidx.compose.ui.text.input.TextFieldValue(
                            model.caption,
                            androidx.compose.ui.text.TextRange(model.caption.length),
                        )
                    )
                }
                BasicTextField(
                    value = felt,
                    onValueChange = { felt = it; model.caption = it.text },
                    textStyle = TextStyle(color = blæk, fontSize = 16.sp),
                    cursorBrush = SolidColor(BRAND),
                    maxLines = 5,
                    keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                        capitalization = androidx.compose.ui.text.input.KeyboardCapitalization.Sentences,
                    ),
                    modifier = Modifier.fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .padding(top = 14.dp, bottom = 12.dp),
                    decorationBox = { indre ->
                        if (felt.text.isEmpty()) {
                            Text(
                                model.labels.or("captionPlaceholder", "Skriv en tekst"),
                                color = blæk.copy(alpha = 0.45f),
                                fontSize = 16.sp,
                            )
                        }
                        indre()
                    },
                )

                MentionStrip(model, blæk) { nyTekst ->
                    felt = androidx.compose.ui.text.input.TextFieldValue(
                        nyTekst,
                        androidx.compose.ui.text.TextRange(nyTekst.length),
                    )
                    model.caption = nyTekst
                }
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
    } else if (valgt.isVideo) {
        // Videoen SPILLER i loop med lyd, som på iPhone; et stillbillede med ▶ var
        // ikke en forhåndsvisning.
        VideoLoopPreview(valgt.uri, modifier)
    } else {
        Box(modifier, contentAlignment = Alignment.Center) {
            AsyncImage(
                model = valgt.uri,
                contentDescription = null,
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun VideoLoopPreview(uri: android.net.Uri, modifier: Modifier) {
    val context = LocalContext.current
    val player = remember(uri) {
        androidx.media3.exoplayer.ExoPlayer.Builder(context).build().apply {
            setMediaItem(androidx.media3.common.MediaItem.fromUri(uri))
            repeatMode = androidx.media3.common.Player.REPEAT_MODE_ONE
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            androidx.media3.ui.PlayerView(ctx).apply {
                useController = false
                resizeMode = androidx.media3.ui.AspectRatioFrameLayout.RESIZE_MODE_FIT
                this.player = player
            }
        },
    )
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
private fun MentionStrip(model: ComposerModel, blæk: Color, onInsert: (String) -> Unit) {
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
                    .clickable { onInsert(Mentions.insert(model.caption, kort.handle)) }
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

/**
 * Eksporterer videoen: klip til det valgte vindue, brugerens udsnit, og målstørrelsen.
 *
 * Vagten på 90 sekunder gælder BÅDE galleri- og kamera-video. iOS har den kun på den ene
 * vej, og en hængende kamera-eksport lader derfor Del-spinneren stå for evigt der.
 */
private fun eksporterVideo(
    model: ComposerModel,
    context: Context,
    valgt: Picked,
    /** Falsk for en tanke: kun klip, ingen beskæring, videoens egne mål. */
    udsnitOgMaal: Boolean = true,
    færdig: (ByteArray?) -> Unit,
) {
    // En story-video fra galleriet beholder sine EGNE mål og beskæres ALDRIG, som iOS:
    // den trimmes kun. Kamera-story er allerede 9:16 gennem kameraTarget.
    val storyUdenBeskæring =
        model.isStory && valgt.uri.scheme != "file" && model.videoUdsnit == null

    val (b, h) = when {
        !udsnitOgMaal || storyUdenBeskæring -> model.videoBredde to model.videoHoejde
        model.videoUdsnit != null ->
            // Brugeren har selv beskåret: målet følger det format der blev valgt
            model.videoFormat.let { it.bredde to it.hoejde }
        valgt.uri.scheme == "file" ->
            // Kamera-klip uden beskæring: vandret motiv bliver liggende, ellers 4:5
            model.kameraTarget(model.videoBredde, model.videoHoejde)
        else -> model.target()
    }

    // Uden brugerudsnit laves et centreret dæk-udsnit, så intet strækkes
    val udsnit = if (!udsnitOgMaal || storyUdenBeskæring) null else model.videoUdsnit
        ?: VideoExport.daekUdsnit(model.videoBredde, model.videoHoejde, b, h)

    // Et sent resultat fra en lukket (eller lukket og genåbnet) komposer smides væk
    val seq = model.reqSeq
    val lever: (ByteArray?) -> Unit = { bytes ->
        færdig(if (model.reqSeq == seq) bytes else null)
    }

    var svaret = false
    val transformer = VideoExport.start(
        context,
        VideoExport.Ordre(
            kilde = valgt.uri,
            startMs = model.trimStartMs,
            laengdeMs = model.trimLaengdeMs,
            udsnit = udsnit,
            maalBredde = b,
            maalHoejde = h,
        ),
    ) { fil ->
        if (svaret) return@start
        svaret = true
        lever(fil?.readBytes())
    }

    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
        if (!svaret) {
            svaret = true
            runCatching { transformer.cancel() }
            lever(null)
        }
    }, VideoExport.TIMEOUT_MS)
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
