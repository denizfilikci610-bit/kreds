package dk.vibefeed.app.comments

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.foundation.horizontalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage
import dk.vibefeed.app.bars.BRAND
import dk.vibefeed.app.bars.VfIcon
import dk.vibefeed.app.bars.VfIcons
import dk.vibefeed.app.composer.MentionCard
import dk.vibefeed.app.composer.Mentions
import dk.vibefeed.app.ui.VfGlassAvatar
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress
import org.json.JSONObject

/**
 * Kommentar-rækken og composeren, DELT mellem kommentar-arket (S4) og opslags-siden (S5).
 * De to skærme SKAL vise kommentarer ens, så delene bor ét sted.
 */

/** Den fælles composer-tilstand begge modeller bærer. */
interface CommentHost {
    var text: String
    var replyingToId: String?
    var replyingToHandle: String
    var deleteArmId: String?
    var focusToken: Int
    var scrollToken: Int
    val open: Boolean
    val postId: String
    val canPost: Boolean
    val emoji: List<String>
    val comments: List<CommentRow>
    val mentionables: List<MentionCard>
    val labels: CommentLabels
}

/**
 * Én kommentar-række.
 *
 * Fonts-finurligheden er en TRO KOPI af Swift-koden: mellemrummet og "@handle " har ingen
 * font og arver derfor systemets ~17 punkter, mens navn og tekst står i 14. Sådan ser
 * begge iOS-skærme ud, så sådan ser Android også ud.
 */
@Composable
fun KommentarRække(
    række: CommentRow,
    labels: CommentLabels,
    blæk: Color,
    fremhævAlpha: Float,
    armet: Boolean,
    indent: androidx.compose.ui.unit.Dp = 34.dp,
    onProfil: () -> Unit,
    onSvar: () -> Unit,
    onSlet: () -> Unit,
    onLike: () -> Unit,
) {
    val sekundær = blæk.copy(alpha = 0.6f)
    Box(
        Modifier
            .fillMaxWidth()
            // Fremhævningen spænder over HELE rækken, 8 dp fra kanterne uanset niveau:
            // indrykningen bor derfor INDE i formen, som på iPhone. Ellers startede
            // flashen på et indrykket svar 42 dp inde og var 34 dp smallere.
            .padding(horizontal = 8.dp)
            // Formen er ALTID der, kun alfaen skifter: det er dét der gør udtoningen mulig.
            .clip(RoundedCornerShape(14.dp))
            .background(blæk.copy(alpha = fremhævAlpha)),
    ) {
        Row(
            Modifier
                .padding(start = if (række.indent > 0) indent else 0.dp)
                .padding(horizontal = 8.dp)
                .padding(vertical = 8.dp),
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
                        withStyle(
                            SpanStyle(fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
                        ) { append(række.name) }
                        append("  ")
                        if (række.replyTo.isNotEmpty()) {
                            withStyle(SpanStyle(color = sekundær)) {
                                append("@${række.replyTo} ")
                            }
                        }
                        withStyle(SpanStyle(fontSize = 14.sp)) { append(række.text) }
                    },
                    fontSize = 17.sp,
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

/**
 * Composeren: mention-strip, svar-chip, emoji-bar og inputfelt. Fælles for begge skærme.
 * `send` bygger objektet med postId og kind og sender det over broen.
 */
@Composable
fun KommentarComposer(
    model: CommentHost,
    blæk: Color,
    bundPolstring: androidx.compose.ui.unit.Dp,
    send: (String, (JSONObject) -> Unit) -> Unit,
) {
    val sekundær = blæk.copy(alpha = 0.6f)
    val fokus = remember { FocusRequester() }

    // Første komposition tæller IKKE: focusToken ryddes ikke ved close, så en genåbning
    // af arket ville ellers rejse tastaturet uopfordret.
    var sidsteFokusToken by remember { mutableIntStateOf(model.focusToken) }
    LaunchedEffect(model.focusToken) {
        if (model.focusToken == sidsteFokusToken) return@LaunchedEffect
        sidsteFokusToken = model.focusToken
        if (model.canPost) runCatching { fokus.requestFocus() }
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

    // Hårstregen ligger på composerens ABSOLUTTE overkant som iOS' overlay, derfor
    // ingen top-polstring på selve Column'en. Bund-indhakket ligger på hele composeren,
    // UBETINGET som på iOS: også en ren læser (emoji-bar uden felt) skal fri af kanten.
    Column(
        Modifier.fillMaxWidth().padding(bottom = 10.dp + bundPolstring),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.fillMaxWidth().height(0.5.dp).background(blæk.copy(alpha = 0.1f)))

        // Mention-strip, kun med kandidater og kun når man overhovedet kan poste.
        // Vandret scroll: seks kandidater med lange handles løber ellers ud over kanten.
        val hits = if (model.canPost) Mentions.hits(model.text, model.mentionables) else emptyList()
        if (hits.isNotEmpty()) {
            Row(
                Modifier
                    .horizontalScroll(androidx.compose.foundation.rememberScrollState())
                    .padding(horizontal = 12.dp),
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
                        textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        modifier = Modifier
                            .weight(1f)
                            .vfPress(VfPress.BOUNCE) {
                                sendTekst(e)
                                model.replyingToId = null
                                model.replyingToHandle = ""
                                // Listen ruller mod bunden som efter et almindeligt svar
                                model.scrollToken++
                            },
                    )
                }
            }
        }

        if (model.canPost) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
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
                        keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                            capitalization =
                                androidx.compose.ui.text.input.KeyboardCapitalization.Sentences,
                        ),
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
