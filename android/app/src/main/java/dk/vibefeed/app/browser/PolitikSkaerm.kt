package dk.vibefeed.app.browser

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import dk.vibefeed.app.R
import dk.vibefeed.app.ui.VfPress
import dk.vibefeed.app.ui.vfPress

/**
 * I-app-fremviseren til politik- og vilkårssiderne, modstykket til iOS' pageSheet med
 * den bevidst indskrænkede browser (InAppBrowser.swift).
 *
 * FULDSKÆRM, ikke et ModalBottomSheet. Arket slugte trækket: Material3-arket driver sin
 * egen træk-gestus, og en AndroidView-WebView deltager ikke i Compose' nested scroll, så
 * et swipe i teksten flyttede siden ~15 px og snappede tilbage. Politikken kunne altså
 * ikke læses. Materiale 1.4.0 har ingen sheetGesturesEnabled at slå fra, så fladen er nu
 * en almindelig fuldskærms-side som appens øvrige native skærme. Den lukkes med Færdig,
 * med systemets tilbage-knap, eller ved at et link fører videre ind i appen.
 *
 * Reglerne for links, oversat fra iOS:
 * - Sprogskifte-links (siderne peger på hinandens sprogudgaver) bliver i arket.
 * - Ethvert ANDET vibefeed.dk-link LUKKER arket, så brugeren lander i appen.
 * - mailto åbner systemet, og arket bliver stående.
 * - Reelt eksterne links åbnes udenfor (Custom Tab), og arket bliver stående.
 */
private val POLITIK_SIDER = setOf("privacy.html", "privatliv.html", "terms.html", "vilkaar.html")

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun PolitikSkaerm(
    url: String,
    blæk: Color,
    baggrund: Color,
    topIndhak: Dp,
    onLuk: () -> Unit,
    onEksternt: (Uri) -> Unit,
) {
    var titel by remember { mutableStateOf("") }
    var webRef by remember { mutableStateOf<WebView?>(null) }

    val lukPaent: () -> Unit = { onLuk() }

    DisposableEffect(Unit) {
        onDispose {
            webRef?.destroy()
            webRef = null
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(baggrund)
            // Siden SKAL sluge tryk, ellers ruller feedet under den.
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
            ) {}
            .padding(top = topIndhak),
    ) {
        Column(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().height(56.dp)) {
                Text(
                    text = titel,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = blæk,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .align(Alignment.Center)
                        .fillMaxWidth()
                        .padding(horizontal = 72.dp),
                )
                Text(
                    text = androidx.compose.ui.res.stringResource(R.string.done),
                    fontSize = 17.sp,
                    color = Color(0xFFE0402F),
                    modifier = Modifier
                        .align(Alignment.CenterEnd)
                        .vfPress(VfPress.FADE, onClick = lukPaent)
                        .padding(end = 16.dp),
                )
            }
            Box(Modifier.fillMaxWidth().height(0.5.dp).background(blæk.copy(alpha = 0.12f)))

            AndroidView(
                modifier = Modifier.fillMaxSize(),
                factory = { ctx ->
                    WebView(ctx).apply {
                        settings.javaScriptEnabled = true
                        settings.domStorageEnabled = false
                        settings.textZoom = 100
                        webChromeClient = object : WebChromeClient() {
                            override fun onReceivedTitle(view: WebView, t: String?) {
                                titel = t ?: ""
                            }
                        }
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(
                                v: WebView,
                                request: WebResourceRequest,
                            ): Boolean {
                                // iframes skal have lov at leve deres eget liv.
                                if (!request.isForMainFrame) return false
                                // Kun rigtige klik, modstykket til iOS' .linkActivated.
                                if (request.isRedirect) return false
                                if (!request.hasGesture()) return false

                                val mål = request.url
                                val skema = mål.scheme?.lowercase() ?: ""
                                if (skema == "mailto") {
                                    runCatching {
                                        ctx.startActivity(Intent(Intent.ACTION_VIEW, mål))
                                    }
                                    return true
                                }
                                if (skema != "http" && skema != "https") {
                                    onEksternt(mål)
                                    return true
                                }
                                // Bevidst strengere host-normalisering end iOS'
                                // replacingOccurrences: kun et foranstillet www. fjernes.
                                val vaert = (mål.host ?: "").removePrefix("www.")
                                if (vaert == "vibefeed.dk") {
                                    val side = mål.lastPathSegment ?: ""
                                    return if (side in POLITIK_SIDER) {
                                        false // sprogskifte: bliv i arket
                                    } else {
                                        lukPaent() // alt andet internt: land i appen
                                        true
                                    }
                                }
                                onEksternt(mål)
                                return true
                            }
                        }
                        loadUrl(url)
                        webRef = this
                    }
                },
            )
        }
    }
}
