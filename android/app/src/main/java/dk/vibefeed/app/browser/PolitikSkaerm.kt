package dk.vibefeed.app.browser

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebChromeClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import kotlinx.coroutines.launch

/**
 * I-app-fremviseren til politik- og vilkårssiderne, modstykket til iOS' pageSheet med
 * den bevidst indskrænkede browser (InAppBrowser.swift).
 *
 * Reglerne for links, oversat fra iOS:
 * - Sprogskifte-links (siderne peger på hinandens sprogudgaver) bliver i arket.
 * - Ethvert ANDET vibefeed.dk-link LUKKER arket, så brugeren lander i appen.
 * - mailto åbner systemet, og arket bliver stående.
 * - Reelt eksterne links åbnes udenfor (Custom Tab), og arket bliver stående.
 */
private val POLITIK_SIDER = setOf("privacy.html", "privatliv.html", "terms.html", "vilkaar.html")

@SuppressLint("SetJavaScriptEnabled")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PolitikSkaerm(
    url: String,
    blæk: Color,
    baggrund: Color,
    topIndhak: Dp,
    onLuk: () -> Unit,
    onEksternt: (Uri) -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scope = rememberCoroutineScope()
    var titel by remember { mutableStateOf("") }
    var webRef by remember { mutableStateOf<WebView?>(null) }

    // Luk med animation: hide() er suspend, og lukningen må først ske BAGEFTER,
    // ellers hopper arket væk uden bevægelse.
    val lukPaent: () -> Unit = {
        scope.launch { sheetState.hide() }.invokeOnCompletion { onLuk() }
    }

    DisposableEffect(Unit) {
        onDispose {
            webRef?.destroy()
            webRef = null
        }
    }

    ModalBottomSheet(
        onDismissRequest = onLuk,
        sheetState = sheetState,
        dragHandle = null,
        shape = RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp),
        containerColor = baggrund,
        // Arket tegner i sit eget vindue og arver ikke edge-to-edge, så indhakket
        // kommer fra aktivitetens safeArea, ikke fra WindowInsets herinde.
        modifier = Modifier.padding(top = topIndhak + 10.dp),
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
