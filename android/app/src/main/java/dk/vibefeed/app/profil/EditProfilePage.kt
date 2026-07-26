package dk.vibefeed.app.profil

import android.graphics.Bitmap
import android.util.Base64
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.input.pointer.util.addPointerInputChange
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import dk.vibefeed.app.bars.BRAND
import dk.vibefeed.app.bars.VfIcon
import dk.vibefeed.app.bars.VfIcons
import dk.vibefeed.app.composer.Media
import dk.vibefeed.app.composer.ProfilCropScreen
import dk.vibefeed.app.ui.EaseOut
import dk.vibefeed.app.ui.VfGlassAvatar
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Rediger profil som fuldskærms-side. "Gem gør alt": billeder stages ved Brug (vfAvatar/
 * vfBanner over broen) og selve gemningen sker først ved Gem. Siden lukker først når web
 * ekkoer close, med nødværnet i MainActivity.
 */
@Composable
fun EditProfilePageHost(
    model: EsheetModel,
    blæk: Color,
    baggrund: Color,
    topIndhak: Dp,
    bundIndhak: Dp,
    onEvent: (JSONObject) -> Unit,
    onAvatar: (String) -> Unit,
    onBanner: (String) -> Unit,
    onPolitik: (String) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val breddePx = constraints.maxWidth.toFloat()
        val dragX = remember { Animatable(breddePx) }
        var synlig by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        val ctx = LocalContext.current.applicationContext

        // Beskæreren: hvilken flade der beskæres til, og billedet der er hentet ind.
        var cropBillede by remember { mutableStateOf<ImageBitmap?>(null) }
        var cropErAvatar by remember { mutableStateOf(true) }

        // Tilbage-knappen skal kun lukke BESKÆREREN når den er fremme, aldrig hele
        // siden: ellers kasseres alle stagede ændringer. Modellen bærer signalet.
        LaunchedEffect(cropBillede) { model.cropperAaben = cropBillede != null }
        LaunchedEffect(model.cropLukTick) {
            if (model.cropLukTick > 0) cropBillede = null
        }

        fun glidUd(hurtigt: Boolean) {
            scope.launch {
                dragX.animateTo(breddePx, tween(if (hurtigt) 200 else 280, easing = EaseOut))
                synlig = false
                onEvent(JSONObject().put("kind", "dismiss"))
            }
        }

        LaunchedEffect(model.open) {
            if (model.open) {
                synlig = true
                cropBillede = null
                dragX.snapTo(breddePx) // nulstil eksplicit ved hver åbning
                dragX.animateTo(0f, tween(280, easing = EaseOut))
            } else if (synlig && dragX.value == 0f) {
                dragX.animateTo(breddePx, tween(280, easing = EaseOut))
                synlig = false
            }
        }

        LaunchedEffect(model.exitTick) {
            if (model.exitTick > 0 && synlig) glidUd(hurtigt = false)
        }

        if (!synlig) return@BoxWithConstraints

        val density = LocalDensity.current
        val greb18 = with(density) { 18.dp.toPx() }
        val luk90 = with(density) { 90.dp.toPx() }
        val fart1000 = with(density) { 1000.dp.toPx() }

        Box(
            Modifier
                .fillMaxSize()
                .offset { IntOffset(max(0f, dragX.value).roundToInt(), 0) }
                .background(baggrund)
                // Siden skal sluge tryk, ellers ruller webviewet under den.
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) {}
                .pointerInput(cropBillede != null) {
                    // Swipe-tilbage, helt slukket mens beskæreren er fremme (dér panorerer
                    // trækket). Lukker swipet mens slet-trinnet er fremme, går siden bare
                    // ét trin tilbage og bliver stående.
                    if (cropBillede != null) return@pointerInput
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
                                if (model.deleteStep) {
                                    model.deleteStep = false
                                    scope.launch { dragX.snapTo(0f) }
                                } else {
                                    glidUd(hurtigt = true)
                                }
                            } else {
                                scope.launch { dragX.animateTo(0f, spring(0.85f, 440f)) }
                            }
                        },
                        onDragCancel = { iGang = false },
                    )
                },
        ) {
            SideIndhold(
                model = model,
                blæk = blæk,
                baggrund = baggrund,
                topIndhak = topIndhak,
                onEvent = onEvent,
                onPolitik = onPolitik,
                onTilbage = {
                    if (model.deleteStep) model.deleteStep = false else model.exit()
                },
                onVaelg = { erAvatar, uri ->
                    // Hent, dekod og nedskaler på en baggrundstråd. Fejler noget, sker
                    // der INTET, som på iPhone.
                    scope.launch {
                        val bmp = withContext(Dispatchers.IO) {
                            runCatching { Media.loadForCrop(ctx, uri) }.getOrNull()
                        } ?: return@launch
                        cropErAvatar = erAvatar
                        cropBillede = bmp.asImageBitmap()
                    }
                },
            )

            // Beskæreren ligger i SAMME container og følger derfor dragX. Ind og ud er
            // ren opacitet over 200 ms.
            AnimatedVisibility(
                visible = cropBillede != null,
                enter = fadeIn(tween(200, easing = EaseOut)),
                exit = fadeOut(tween(200, easing = EaseOut)),
            ) {
                cropBillede?.let { billede ->
                    ProfilCropScreen(
                        billede = billede,
                        forhold = if (cropErAvatar) 1f else 1280f / 432f,
                        cirkulaer = cropErAvatar,
                        maalB = if (cropErAvatar) 1024 else 1280,
                        maalH = if (cropErAvatar) 1024 else 432,
                        titel = if (cropErAvatar) model.picLabel else model.bannerLabel,
                        annullerLabel = model.cancelLabel,
                        brugLabel = model.useLabel,
                        topPad = topIndhak,
                        // Det ægte bund-indhak, som minde-beskæreren: 16 dp fast lagde
                        // knapperne under hjemme-streget på kant-til-kant-skærme.
                        bottomPad = maxOf(bundIndhak, 16.dp),
                        onCancel = { cropBillede = null },
                        onDone = { bitmap ->
                            scope.launch {
                                // Komprimér i billedets EGNE mål, kvalitet 82, NO_WRAP:
                                // linjeskift ødelægger data-URL'en. IKKE iOS' utilsigtede
                                // retina-oppustning.
                                val dataUrl = withContext(Dispatchers.IO) {
                                    val ud = ByteArrayOutputStream()
                                    bitmap.compress(Bitmap.CompressFormat.JPEG, 82, ud)
                                    "data:image/jpeg;base64," +
                                        Base64.encodeToString(ud.toByteArray(), Base64.NO_WRAP)
                                }
                                if (cropErAvatar) {
                                    model.pickedAvatar = bitmap
                                    onAvatar(dataUrl)
                                } else {
                                    model.pickedBanner = bitmap
                                    onBanner(dataUrl)
                                }
                                cropBillede = null
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
private fun SideIndhold(
    model: EsheetModel,
    blæk: Color,
    baggrund: Color,
    topIndhak: Dp,
    onEvent: (JSONObject) -> Unit,
    onPolitik: (String) -> Unit,
    onTilbage: () -> Unit,
    onVaelg: (Boolean, android.net.Uri) -> Unit,
) {
    val sekundær = blæk.copy(alpha = 0.6f)
    val fokus = LocalFocusManager.current

    var vaelgerErAvatar by remember { mutableStateOf(true) }
    val vaelger = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) onVaelg(vaelgerErAvatar, uri)
    }
    val aabnVaelger: (Boolean) -> Unit = { erAvatar ->
        vaelgerErAvatar = erAvatar
        vaelger.launch(
            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
        )
    }

    val canSave = model.name.trim().isNotEmpty()
    val gem: () -> Unit = {
        if (canSave && !model.saving) {
            fokus.clearFocus()
            model.saving = true
            onEvent(
                JSONObject()
                    .put("kind", "save")
                    .put("name", model.name.trim().take(model.nameMaxLength))
                    .put("bio", model.bio.take(model.bioMaxLength))
                    .put("share", model.share)
                    .put("lang", model.lang)
                    .put("consent", model.consent)
            )
        }
    }

    Column(Modifier.fillMaxSize()) {
        // Header: titel eller delSure, tilbage-pil, Gem med spinner på samme plads.
        Box(
            Modifier
                .fillMaxWidth()
                .padding(top = topIndhak)
                .height(52.dp)
                .padding(horizontal = 12.dp),
        ) {
            Text(
                if (model.deleteStep) model.delSure else model.title,
                fontSize = 16.sp,
                fontWeight = FontWeight.Bold,
                color = blæk,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .align(Alignment.Center)
                    .fillMaxWidth()
                    .padding(horizontal = 84.dp),
            )
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .vfPress(VfPress.SCALE, onClick = onTilbage)
                    .padding(6.dp),
            ) {
                VfIcon(VfIcons.ChevronLeft, blæk, 20.dp)
            }
            if (!model.deleteStep) {
                Box(Modifier.align(Alignment.CenterEnd)) {
                    Text(
                        model.saveLabel,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = BRAND,
                        modifier = Modifier
                            .alpha(if (model.saving) 0f else if (canSave) 1f else 0.45f)
                            .vfPress(VfPress.POP, enabled = canSave && !model.saving, onClick = gem)
                            .padding(vertical = 6.dp),
                    )
                    if (model.saving) {
                        CircularProgressIndicator(
                            color = BRAND,
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(18.dp).align(Alignment.Center),
                        )
                    }
                }
            }
        }

        if (model.deleteStep) {
            SletTrin(model, blæk, onEvent)
            return@Column
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .imePadding(),
        ) {
            // Avatar-blokken. De fire flader er billedvælgere UDEN tryk-animation.
            Column(
                Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 22.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .height(92.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(blæk.copy(alpha = 0.06f))
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { aabnVaelger(false) },
                    contentAlignment = Alignment.Center,
                ) {
                    val valgt = model.pickedBanner
                    when {
                        valgt != null -> Image(
                            valgt.asImageBitmap(),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.fillMaxSize(),
                        )
                        model.bannerUrl.isNotEmpty() -> SubcomposeAsyncImage(
                            model = model.bannerUrl,
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            loading = {
                                Box(Modifier.fillMaxSize().background(blæk.copy(alpha = 0.06f)))
                            },
                            modifier = Modifier.fillMaxSize(),
                        )
                        else -> Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            VfIcon(VfIcons.Photo, sekundær, 14.dp)
                            Text(
                                model.bannerLabel,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = sekundær,
                            )
                        }
                    }
                }
                Text(
                    model.bannerLabel,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = BRAND,
                    modifier = Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { aabnVaelger(false) },
                )

                Box(
                    Modifier
                        .padding(top = 8.dp)
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { aabnVaelger(true) },
                ) {
                    val valgt = model.pickedAvatar
                    if (valgt != null) {
                        Image(
                            valgt.asImageBitmap(),
                            contentDescription = null,
                            contentScale = ContentScale.Crop,
                            modifier = Modifier.size(96.dp).clip(CircleShape),
                        )
                    } else {
                        VfGlassAvatar(
                            model.avatar.avatarUrl,
                            model.avatar.initials,
                            model.avatar.gradient,
                            96.dp,
                        )
                    }
                }
                Text(
                    model.picLabel,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = BRAND,
                    modifier = Modifier.clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                    ) { aabnVaelger(true) },
                )
            }

            Haarstreg(blæk)

            // Navn: hård afkortning mens man skriver.
            FormRaekke(model.nameLabel, blæk, sidste = false) {
                BasicTextField(
                    value = model.name,
                    onValueChange = { model.name = it.take(model.nameMaxLength) },
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 16.sp, color = blæk),
                    cursorBrush = SolidColor(BRAND),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { felt ->
                        if (model.name.isEmpty()) {
                            Text(model.namePlaceholder, fontSize = 16.sp, color = sekundær)
                        }
                        felt()
                    },
                )
            }

            // Brugernavn: låst, mentions og venskaber peger på det.
            if (model.handle.isNotEmpty()) {
                FormRaekke(model.handleLabel, blæk, sidste = false) {
                    Text("@${model.handle}", fontSize = 16.sp, color = sekundær)
                }
            }

            FormRaekke(model.bioLabel, blæk, sidste = true) {
                BasicTextField(
                    value = model.bio,
                    onValueChange = { model.bio = it.take(model.bioMaxLength) },
                    minLines = 1,
                    maxLines = 5,
                    textStyle = TextStyle(fontSize = 16.sp, color = blæk),
                    cursorBrush = SolidColor(BRAND),
                    modifier = Modifier.fillMaxWidth(),
                    decorationBox = { felt ->
                        if (model.bio.isEmpty()) {
                            Text(model.bioPlaceholder, fontSize = 16.sp, color = sekundær)
                        }
                        felt()
                    },
                )
            }

            Haarstreg(blæk)

            // Del min aktivitet. activityLabel tegnes ALDRIG, rækken har ingen overskrift.
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 13.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(
                    Modifier.weight(1f),
                    verticalArrangement = Arrangement.spacedBy(3.dp),
                ) {
                    Text(model.shareLabel, fontSize = 16.sp, color = blæk)
                    Text(model.shareNote, fontSize = 12.5.sp, color = sekundær)
                }
                Spacer(Modifier.width(14.dp))
                Switch(
                    checked = model.share,
                    onCheckedChange = { model.share = it },
                    colors = SwitchDefaults.colors(checkedTrackColor = BRAND),
                )
            }
            Haarstreg(blæk)

            SektionsEtiket(model.langLabel, sekundær)
            SprogVaelger(model, blæk, baggrund)

            // Privatliv (reklame-samtykke): kun når adsOn, altså aldrig i dag.
            if (model.adsOn) {
                SektionsEtiket(model.privacyLabel, sekundær)
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Segment(model.adsPersonalLabel, model.consent == "personal", blæk, baggrund, Modifier.weight(1f)) {
                        model.consent = "personal"
                    }
                    Segment(model.adsLimitedLabel, model.consent != "personal", blæk, baggrund, Modifier.weight(1f)) {
                        model.consent = "limited"
                    }
                }
            }

            // Politik-linket åbner i-app-fremviseren OVEN PÅ siden; alt staget består.
            Text(
                model.policyLabel,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
                color = sekundær,
                textDecoration = TextDecoration.Underline,
                modifier = Modifier
                    .padding(start = 16.dp, top = 14.dp)
                    .vfPress(VfPress.FADE) {
                        if (model.policyUrl.isNotEmpty()) onPolitik(model.policyUrl)
                    },
            )

            Box(Modifier.padding(top = 18.dp)) { Haarstreg(blæk) }
            Text(
                model.deleteOpenLabel,
                fontSize = 16.sp,
                fontWeight = FontWeight.SemiBold,
                color = BRAND,
                modifier = Modifier
                    .fillMaxWidth()
                    .vfPress(VfPress.FADE) {
                        model.deleteStep = true
                        // Trinnet TØMMER bekræftelses-feltet; annuller gør ikke.
                        sletFelt = ""
                    }
                    .padding(horizontal = 16.dp, vertical = 14.dp),
            )

            Spacer(Modifier.height(30.dp))
        }
    }
}

/** Bekræftelses-feltet deles mellem åbninger af trinnet, som iOS' @State. */
private var sletFelt by mutableStateOf("")

@Composable
private fun SletTrin(model: EsheetModel, blæk: Color, onEvent: (JSONObject) -> Unit) {
    val sekundær = blæk.copy(alpha = 0.6f)
    // "SLET" er HARDKODET på alle 32 sprog, også engelsk. Trim kun mellemrum, versalfølsomt.
    val klar = sletFelt.trim(' ') == "SLET" && !model.deleting

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .imePadding()
            .padding(top = 24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            model.delText,
            fontSize = 14.sp,
            color = sekundær,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 20.dp),
        )
        Box(
            Modifier
                .padding(horizontal = 24.dp)
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(blæk.copy(alpha = 0.06f))
                .padding(horizontal = 16.dp, vertical = 13.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (sletFelt.isEmpty()) {
                Text("SLET", fontSize = 17.sp, fontWeight = FontWeight.Bold, color = sekundær)
            }
            BasicTextField(
                value = sletFelt,
                onValueChange = { sletFelt = it },
                singleLine = true,
                textStyle = TextStyle(
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                    color = blæk,
                    textAlign = TextAlign.Center,
                ),
                cursorBrush = SolidColor(BRAND),
                keyboardOptions = KeyboardOptions(
                    capitalization = KeyboardCapitalization.Characters,
                    autoCorrectEnabled = false,
                ),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Box(
            Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth()
                .alpha(if (klar) 1f else 0.45f)
                .clip(RoundedCornerShape(14.dp))
                .background(BRAND)
                .vfPress(VfPress.POP, enabled = klar) {
                    model.deleting = true
                    onEvent(JSONObject().put("kind", "delete"))
                }
                .padding(vertical = 14.dp),
            contentAlignment = Alignment.Center,
        ) {
            if (model.deleting) {
                CircularProgressIndicator(
                    color = Color.White,
                    strokeWidth = 2.dp,
                    modifier = Modifier.size(18.dp),
                )
            } else {
                Text(model.delBtn, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White)
            }
        }
        Text(
            model.cancelLabel,
            fontSize = 14.sp,
            fontWeight = FontWeight.SemiBold,
            color = sekundær,
            modifier = Modifier
                .vfPress(VfPress.FADE) { model.deleteStep = false }
                .padding(vertical = 4.dp),
        )
        Spacer(Modifier.weight(1f))
    }
}

@Composable
private fun Haarstreg(blæk: Color) {
    Box(Modifier.fillMaxWidth().height(0.5.dp).background(blæk.copy(alpha = 0.12f)))
}

/**
 * Formularrække: etiket med fast bredde 108 dp, værdi-kolonne med hårstreg INDE i
 * kolonnen (136 dp fra venstre kant), i modsætning til sektions-stregerne kant til kant.
 */
@Composable
private fun FormRaekke(
    etiket: String,
    blæk: Color,
    sidste: Boolean,
    indhold: @Composable () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, top = 13.dp, end = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(etiket, fontSize = 16.sp, color = blæk, modifier = Modifier.width(108.dp))
        Column(Modifier.weight(1f)) {
            Box(Modifier.padding(bottom = 12.dp)) { indhold() }
            if (!sidste) Haarstreg(blæk)
        }
    }
}

@Composable
private fun SektionsEtiket(tekst: String, farve: Color) {
    Text(
        tekst.uppercase(),
        fontSize = 12.sp,
        fontWeight = FontWeight.Bold,
        color = farve,
        letterSpacing = 0.4.sp,
        modifier = Modifier.padding(start = 16.dp, top = 18.dp, bottom = 6.dp),
    )
}

/** Sprogvælgeren: menu ved flere end 2 sprog, ellers to segmenter. INGEN tryk-animation. */
@Composable
private fun SprogVaelger(model: EsheetModel, blæk: Color, baggrund: Color) {
    val sekundær = blæk.copy(alpha = 0.6f)
    var aaben by remember { mutableStateOf(false) }

    if (model.langs.size <= 2) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Segment(model.langDaLabel, model.lang == "da", blæk, baggrund, Modifier.weight(1f)) {
                model.lang = "da"
            }
            Segment(model.langEnLabel, model.lang == "en", blæk, baggrund, Modifier.weight(1f)) {
                model.lang = "en"
            }
        }
        return
    }

    val aktivNavn = model.langs.firstOrNull { it.first == model.lang }?.second ?: model.lang
    Box(Modifier.padding(horizontal = 16.dp)) {
        // Fuldbredde-bjælke med chevronen skubbet ud til højre kant, som iOS' HStack
        // med Spacer. En indholdsbred chip lignede en anden kontrol.
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(12.dp))
                .background(blæk.copy(alpha = 0.06f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                ) { aaben = true }
                .padding(horizontal = 14.dp, vertical = 12.dp),
        ) {
            Text(aktivNavn, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = blæk)
            Spacer(Modifier.weight(1f))
            Box(Modifier.alpha(0.6f)) { VfIcon(VfIcons.ChevronRight, blæk, 12.dp) }
        }
        androidx.compose.material3.DropdownMenu(
            expanded = aaben,
            onDismissRequest = { aaben = false },
            containerColor = baggrund,
        ) {
            model.langs.forEach { (kode, navn) ->
                androidx.compose.material3.DropdownMenuItem(
                    text = {
                        Text(
                            navn,
                            fontSize = 14.sp,
                            fontWeight = if (kode == model.lang) FontWeight.Bold else FontWeight.Normal,
                            color = blæk,
                        )
                    },
                    onClick = {
                        model.lang = kode
                        aaben = false
                    },
                )
            }
        }
    }
}

@Composable
private fun Segment(
    tekst: String,
    valgt: Boolean,
    blæk: Color,
    baggrund: Color,
    modifier: Modifier,
    onTap: () -> Unit,
) {
    val form = RoundedCornerShape(12.dp)
    Box(
        modifier
            .clip(form)
            .background(if (valgt) blæk else Color.Transparent)
            .border(1.5.dp, if (valgt) Color.Transparent else blæk.copy(alpha = 0.18f), form)
            .vfPress(VfPress.CHIP, onClick = onTap)
            .padding(vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) {
        // Valgt tekst står i BAGGRUNDSFARVEN, omvendt kontrast, ikke hvid.
        Text(
            tekst,
            fontSize = 14.sp,
            fontWeight = FontWeight.Bold,
            color = if (valgt) baggrund else blæk,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
