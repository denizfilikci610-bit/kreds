package dk.vibefeed.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.view.View
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dk.vibefeed.app.bars.KredsBarModel
import dk.vibefeed.app.bars.NativeComposeButtons
import dk.vibefeed.app.bars.NativeKredsBar
import dk.vibefeed.app.bars.NativeTabBar
import dk.vibefeed.app.bars.TabBarModel
import dk.vibefeed.app.bridge.VfBridge
import dk.vibefeed.app.composer.ComposerModel
import dk.vibefeed.app.composer.ComposerScreen
import dk.vibefeed.app.composer.Purpose
import dk.vibefeed.app.browser.PolitikSkaerm
import dk.vibefeed.app.comments.CommentsModel
import dk.vibefeed.app.comments.CommentsSheetHost
import dk.vibefeed.app.composer.Uploader
import dk.vibefeed.app.notif.VfNotifikationer
import dk.vibefeed.app.pages.ListPageHost
import dk.vibefeed.app.pages.ListPageModel
import dk.vibefeed.app.post.PostPageHost
import dk.vibefeed.app.post.PostPageModel
import dk.vibefeed.app.sheets.GlassSheetHost
import dk.vibefeed.app.sheets.SheetModel
import org.json.JSONObject
import java.io.File

/**
 * VibeFeed på Android er den samme app som på iOS: én WebView på det live site plus
 * et lag native skærme ovenpå. Al forretningslogik og alle 32 sprog bor i web-koden på
 * vibefeed.dk, og de to sider taler sammen over den samme besked-bro som iOS bruger.
 *
 * Appen leverer: navigation (fanebjælke og kreds-bar), medie-komposeren med kamera og
 * galleri, filvalg for webbens egne felter, ruter for eksterne links, systemets indhak
 * og tilbage-knappen.
 */
class MainActivity : AppCompatActivity() {

    private companion object {
        const val START_URL = "https://vibefeed.dk"

        /** Samme liste som ios/VibeFeed/WebView.swift: alt andet åbnes uden for appen. */
        val INTERNAL_HOSTS = setOf(
            "vibefeed.dk",
            "www.vibefeed.dk",
            "kreds-sepia.vercel.app",
            "iduotqxkohuezxkveawc.supabase.co"
        )
    }

    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private lateinit var errorView: View

    /** Sat mens systemets filvælger er fremme. MÃ… altid besvares, ellers dør input-feltet. */
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    /** Filen kamera-appen skriver til, når web beder om capture="environment". */
    private var cameraOutput: Uri? = null

    /**
     * Systemets indhak, som siden får at vide gennem window.__vfInsets.
     *
     * SKAL være Compose-tilstand. Som almindelig var opdagede de native barer aldrig at
     * indhakkene kom, og lagde sig derfor efter nul: kreds-baren oven i ordmærket og
     * fanebjælken helt nede på kanten.
     */
    private var safeArea by mutableStateOf(Insets.NONE)

    /** Besked-broen til web, den samme kontrakt som iOS bruger. */
    private var bridge: VfBridge? = null

    /** De native skærme lægger sig her, oven på webviewet. */
    private lateinit var overlay: ComposeView

    /** Den native medie-komposer (minder og stories). */
    private val composer = ComposerModel()

    /** De to native barer, drevet af web over broen. */
    private val tabBar = TabBarModel()
    private val kredsBar = KredsBarModel()

    /** Glaskortet: appens ti handlings-menuer, drevet af web over broen. */
    private val sheet = SheetModel()

    /** Liste-siden: Venner og Kredse med faner og søgning. */
    private val listPage = ListPageModel()

    /** Kommentar-arket for minder. */
    private val comments = CommentsModel()

    /** Opslags-siden for tanker. */
    private val postPage = PostPageModel()

    /** Sat når broen kan bære de native barer. Uden dem må __vfNative aldrig sættes. */
    private var nativeBars = false

    /** Brugerens sprogvalg, meldt af web i creds-beskeden. Styrer den native søgetekst. */
    private var lang = "da"

    /** Politik-fremviseren (i-app-ark). Sat = åben. */
    private var politikUrl by mutableStateOf<String?>(null)

    // Tap-to-open fra en notifikation: single flight med frisk budget per payload.
    // 60 forsøg à 500 ms er nok til en kold start; web venter derefter selv på sin boot.
    private var ventendeTap: String? = null
    private var forsoegTilbage = 0
    private var leveringKoerer = false

    private val filePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            deliverFiles(result.resultCode, result.data)
        }

    /** POST_NOTIFICATIONS. Tokenet hentes KUN når der er sagt ja, som på iOS. */
    private val notifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { givet ->
            if (givet) VfNotifikationer.hentOgRegistrerToken(applicationContext)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        overlay = findViewById(R.id.native_overlay)
        errorView = findViewById(R.id.error)
        findViewById<Button>(R.id.retry).setOnClickListener { reload() }

        applySystemBars()
        applyThemeColors()
        configureWebView()
        installBridge()
        registerBackHandling()

        if (savedInstanceState == null) {
            web.loadUrl(linkFrom(intent) ?: START_URL)
        } else {
            web.restoreState(savedInstanceState)
        }

        // Startet af et notifikations-tap (kold start): payloaden venter til web er klar.
        tapFrom(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        linkFrom(intent)?.let { web.loadUrl(it) }
        tapFrom(intent)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Aktiviteten genskabes ikke ved lys/mørk-skift (configChanges), så farverne
        // bag systembjælkerne skal følge med i hånden. Selve siden klarer sig selv
        // gennem prefers-color-scheme.
        applyThemeColors()
    }

    override fun onPause() {
        super.onPause()
        web.onPause()
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        // Appen er fremme: notifikationerne er "set". Skyggen tømmes og serverens
        // badge-tæller nulstilles gennem registreringen.
        VfNotifikationer.appAktiveret(applicationContext)
    }

    override fun onDestroy() {
        // Et WebView der stadig hænger i view-træet lækker aktiviteten
        (web.parent as? android.view.ViewGroup)?.removeView(web)
        web.destroy()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- systemets kanter

    /**
     * Appen fylder HELE skærmen, som på iPhone: feedet flyder ind under uret og hjemme-
     * streget, og barerne lægger sig neden under dem.
     *
     * Web-koden gør det med env(safe-area-inset-*) 31 steder i css/app.css, og et WebView
     * rapporterer altid nul. Derfor polstrer vi ikke, men melder de rigtige indhak videre
     * til siden (assets/safe-area.js skriver reglerne om med de målte tal).
     *
     * Kun tastaturet polstres. Der SKAL selve fladen krympe, ellers ligger chat-feltet bag
     * tastaturet. Mens det er oppe, er der ingen navigationsbjælke at tage hensyn til, så
     * bund-indhakket meldes som nul.
     */
    private fun applySystemBars() {
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(0, 0, 0, ime.bottom)
            safeArea = Insets.of(
                maxOf(bars.left, cutout.left),
                maxOf(bars.top, cutout.top),
                maxOf(bars.right, cutout.right),
                if (ime.bottom > 0) 0 else bars.bottom
            )
            pushSafeArea()
            WindowInsetsCompat.CONSUMED
        }
    }

    /**
     * Punkter i Android er ikke det samme som CSS-pixels. Siden står på initial-scale=1,
     * så én CSS-px er én dp, og indhakkene skal derfor divideres med skærmens tæthed.
     */
    private fun pushSafeArea() {
        val d = resources.displayMetrics.density
        fun css(v: Int) = (v / d).toInt()
        web.evaluateJavascript(
            "window.__vfInsets && window.__vfInsets(" +
                "${css(safeArea.top)},${css(safeArea.right)}," +
                "${css(safeArea.bottom)},${css(safeArea.left)})",
            null
        )
    }

    private fun applyThemeColors() {
        val bg = ContextCompat.getColor(this, R.color.vf_bg)
        root.setBackgroundColor(bg)
        web.setBackgroundColor(bg)
        val light = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) !=
            Configuration.UI_MODE_NIGHT_YES
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    // ---------------------------------------------------------------- selve webviewet

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        web.settings.apply {
            javaScriptEnabled = true
            // Supabase gemmer login-sessionen i localStorage. Uden den her bliver man
            // logget ud hver gang appen lukkes.
            domStorageEnabled = true
            javaScriptCanOpenWindowsAutomatically = true
            setSupportMultipleWindows(true)
            // Video i lightbox og stories skal kunne starte uden et ekstra tryk
            mediaPlaybackRequiresUserGesture = false
            // Respektér sidens egen viewport-meta (viewport-fit=cover, interactive-widget)
            useWideViewPort = true
            loadWithOverviewMode = false
            // Systemets skriftskalering ville strække et layout der er bygget i faste px
            textZoom = 100
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString VibeFeedAndroid/${BuildConfig.VERSION_NAME}"
        }

        // Uden det her rapporterer WebViewet altid prefers-color-scheme: light,
        // og appen ville stå i lyst tema på en telefon i mørkt tema.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.settings, true)
        }

        // Pull to refresh er webbens egen (js/pullrefresh.js). Androids gummibånd
        // ovenpå ville slås med den.
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false

        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)

        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)

        web.webViewClient = VibeFeedWebViewClient()
        web.webChromeClient = VibeFeedChromeClient()
    }

    private inner class VibeFeedWebViewClient : WebViewClient() {

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            val url = request.url
            if (isInternal(url)) return false
            openOutside(url)
            return true
        }

        override fun onPageFinished(view: WebView, url: String?) {
            injectScripts(view)
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            // Kun hvis det er selve siden der fejler. Et enkelt billede der ikke kan
            // hentes må ikke smide en fejlskærm op over en app der kører fint.
            if (request.isForMainFrame) showError()
        }
    }

    private inner class VibeFeedChromeClient : WebChromeClient() {

        override fun onShowFileChooser(
            webView: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams
        ): Boolean = openFileChooser(callback, params)

        /**
         * target=_blank, fx politik- og vilkårslinkene på login-skærmen. WebViewet
         * giver os ikke adressen direkte, så vi lader et midlertidigt WebView fange
         * det første navigationsforsøg og åbner adressen selv.
         */
        override fun onCreateWindow(
            view: WebView,
            isDialog: Boolean,
            isUserGesture: Boolean,
            resultMsg: android.os.Message
        ): Boolean {
            val sniffer = WebView(this@MainActivity)
            sniffer.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(
                    v: WebView,
                    request: WebResourceRequest
                ): Boolean {
                    val url = request.url
                    val skema = url.scheme?.lowercase()
                    // Politik- og vilkårssiderne åbner i i-app-arket, som på iPhone.
                    // Alt andet (og alle ikke-http-skemaer, tjekket FØRST) går udenfor.
                    // Forkontrollen er broen (nativeBars), ikke forgrunds-tilstanden.
                    if (nativeBars && (skema == "http" || skema == "https") && isInternal(url)) {
                        politikUrl = url.toString()
                    } else {
                        openOutside(url)
                    }
                    // Aldrig rive et WebView ned midt i dets eget callback.
                    v.post { v.destroy() }
                    return true
                }
            }
            (resultMsg.obj as WebView.WebViewTransport).webView = sniffer
            resultMsg.sendToTarget()
            return true
        }
    }

    private fun isInternal(url: Uri): Boolean {
        val scheme = url.scheme?.lowercase() ?: return false
        if (scheme != "http" && scheme != "https") return false
        return INTERNAL_HOSTS.contains(url.host?.lowercase())
    }

    /**
     * Alt der ikke er VibeFeed selv. Websider vises i en Custom Tab (browseren inde i
     * appen, tilbage-knappen fører tilbage til VibeFeed), og alt andet, fx mailto: og
     * tel:, sendes til den app der håndterer den slags.
     */
    private fun openOutside(url: Uri) {
        val scheme = url.scheme?.lowercase()
        try {
            if (scheme == "http" || scheme == "https") {
                CustomTabsIntent.Builder()
                    .setShowTitle(true)
                    .build()
                    .launchUrl(this, url)
            } else {
                startActivity(Intent(Intent.ACTION_VIEW, url))
            }
        } catch (_: ActivityNotFoundException) {
            // Ingen app kan åbne det. Bedre at gøre ingenting end at gå ned.
        }
    }

    private fun linkFrom(intent: Intent?): String? {
        val data = intent?.data ?: return null
        return if (intent.action == Intent.ACTION_VIEW && isInternal(data)) data.toString() else null
    }

    private fun reload() {
        errorView.visibility = View.GONE
        web.visibility = View.VISIBLE
        web.loadUrl(START_URL)
    }

    private fun showError() {
        web.visibility = View.GONE
        errorView.visibility = View.VISIBLE
    }

    // ---------------------------------------------------------------- broen til web

    /**
     * Slår besked-broen til, den samme som iOS bruger. Flagene fortæller web hvilke skærme
     * appen kan overtage, og de må KUN indeholde det vi rent faktisk betjener: lover vi noget
     * vi ikke svarer på, står web og venter for evigt.
     *
     * __vfNative er den farligste af dem. Den får js/main.js til at sætte body.native, og så
     * skjuler css/app.css BÅDE fanebjælken og kreds-baren, fordi iOS leverer dem nativt. Den
     * må derfor først med den dag begge findes native på Android.
     */
    private fun installBridge() {
        val b = VfBridge(
            web = web,
            allowedOrigins = INTERNAL_HOSTS.map { "https://$it" }.toSet(),
            onMessage = ::onBridgeMessage,
        )
        bridge = b
        // __vfNative er nøglen: den skjuler web-barerne (css/app.css:957) OG definerer hele
        // retur-fladen, window.vfTab, vfKreds, vfMemory og resten, i js/main.js:71. Den må
        // derfor først sættes nu, hvor både fanebjælken og kreds-baren findes native.
        b.install(
            if (b.isSupported) {
                setOf(
                    "__vfNative", "__vfPhotoLib", "__vfComposeCamera",
                    "__vfGlassCard", "__vfListPage", "__vfComments", "__vfPostPage",
                )
            } else {
                emptySet()
            }
        )
        nativeBars = b.isSupported
        overlay.setContent { NativeOverlay() }
        if (nativeBars) overlay.visibility = View.VISIBLE
    }

    private fun onBridgeMessage(type: String, json: JSONObject) {
        when (type) {
            "tab" -> tabBar.apply(json)
            "kreds" -> kredsBar.apply(json)
            "creds" -> onCreds(json)
            "logout" -> VfNotifikationer.onLogout(applicationContext)
            "photolib" -> onPhotoLib(json)
            "sheet" -> onSheet(json)
            "listpage" -> onListPage(json)
            "comments" -> onComments(json)
            "postpage" -> onPostPage(json)
            "share" -> onShare(json)
            // Web sender også beskeder appen aldrig skal gøre noget ved (fsheet, msheet,
            // ads, consent, creds). En ukendt type må aldrig kaste, kun ignoreres.
            else -> Unit
        }
    }

    /**
     * Rækkefølgen her er bindende: upload-ordren skal tjekkes FØR kvitteringen og før
     * åbningen, ellers går ordren tabt fordi beskederne deler samme type.
     */
    private fun onPhotoLib(json: JSONObject) {
        json.optJSONObject("upload")?.let { order ->
            val bytes = composer.pendingBytes
            if (bytes == null) {
                bridge?.call("vfMemoryUploadFailed")
                return
            }
            Thread {
                val ok = Uploader.upload(order, bytes)
                runOnUiThread {
                    composer.pendingBytes = null
                    bridge?.call(if (ok) "vfMemoryUploaded" else "vfMemoryUploadFailed")
                }
            }.start()
            return
        }

        val result = json.optString("result")
        if (result.isNotBlank()) {
            composer.result(result)
            if (!composer.open) hideOverlay()
            return
        }

        if (json.optBoolean("open")) {
            composer.start(json)
            showOverlay()
        }
    }

    /**
     * Glaskortet. Web ejer flowet: den poster enten det næste kort eller close, og kortet
     * lukker sig aldrig selv.
     *
     * Fokus skal ryddes når et kort ankommer: root er polstret med tastaturets højde, så et
     * åbent tastatur ville skubbe kortet for højt op. Chat-menuens "rediger" sætter selv
     * fokus tilbage bagefter, så intet går tabt.
     */
    private fun onSheet(json: JSONObject) {
        sheet.apply(json)
        if (json.opt("close") != true) web.clearFocus()
        if (sheet.request != null) showOverlay() else hideOverlay()
    }

    /**
     * {type:"creds"} efter login og ved hvert sprogskifte: sproget til kreds-barens
     * søgetekst, og hele notifikations-kæden. Tilladelsen spørges her, samme øjeblik som
     * iOS spørger, og tokenet hentes KUN når der allerede er (eller lige er blevet) sagt ja.
     */
    private fun onCreds(json: JSONObject) {
        lang = json.optString("lang").ifBlank { lang }
        if (!VfNotifikationer.onCreds(applicationContext, json)) return
        if (Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            VfNotifikationer.hentOgRegistrerToken(applicationContext)
        } else {
            notifPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    // ------------------------------------------------- notifikations-tap (deep link)

    /** Egen action og extras, aldrig en data-URI, så App Links-filteret ikke forveksles. */
    private fun tapFrom(intent: Intent?) {
        if (intent?.action != VfNotifikationer.ACTION_TAP) return
        val payload = intent.getStringExtra(VfNotifikationer.EXTRA_PAYLOAD) ?: return
        // En nyere payload afløser en uleveret ældre og får sit EGET friske budget.
        ventendeTap = payload
        forsoegTilbage = 60
        if (!leveringKoerer) {
            leveringKoerer = true
            leverTap()
        }
    }

    /**
     * Leveringsløkken. VfBridge.call duer ikke her, den smider returværdien væk; udtrykket
     * er iOS' eksakte: sandheden kommer fra komma-operatoren, ikke fra vfOpenNotif selv
     * (den er async og returnerer undefined). JSON for en boolean har ingen anførselstegn,
     * så alt andet end "true", herunder null, betyder "prøv igen".
     */
    private fun leverTap() {
        val json = ventendeTap ?: run { leveringKoerer = false; return }
        val udtryk = "window.vfOpenNotif ? (window.vfOpenNotif($json), true) : false"
        web.evaluateJavascript(udtryk) { v ->
            if (v == "true") {
                if (ventendeTap == json) ventendeTap = null
                leverTap() // der kan være landet en nyere imens
            } else if (forsoegTilbage > 0) {
                forsoegTilbage--
                web.postDelayed({ leverTap() }, 500)
            } else {
                ventendeTap = null
                leveringKoerer = false
            }
        }
    }

    /** Liste-siden. Må ikke rive komposeren væk når den lukker. */
    private fun onListPage(json: JSONObject) {
        listPage.apply(json)
        if (listPage.open) showOverlay() else if (!composer.open) hideOverlay()
    }

    /** Kommentar-arket. Samme regel: må ikke rive komposeren væk. */
    private fun onComments(json: JSONObject) {
        comments.apply(json)
        if (comments.open) showOverlay() else if (!composer.open) hideOverlay()
    }

    /** Opslags-siden. Et close kan komme uopfordret (opslaget forsvandt, logout). */
    private fun onPostPage(json: JSONObject) {
        postPage.apply(json)
        if (postPage.open) showOverlay() else if (!composer.open) hideOverlay()
    }

    /**
     * navigator.share-shimmen (assets/share.js): åbn Androids dele-ark med det indhold
     * web ville have delt gennem iPhonens navigator.share.
     */
    private fun onShare(json: JSONObject) {
        val tekst = listOf(json.optString("text"), json.optString("url"))
            .filter { it.isNotBlank() }
            .joinToString("\n")
        if (tekst.isBlank()) return
        val del = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, tekst)
        json.optString("title").takeIf { it.isNotBlank() }?.let {
            del.putExtra(Intent.EXTRA_SUBJECT, it)
        }
        runCatching { startActivity(Intent.createChooser(del, null)) }
    }

    // ---------------------------------------------------------------- native skærme

    /**
     * De native skærme, lagt oven på webviewet i samme fuldskærms-koordinatsystem som på iOS.
     * Alt der ikke er en bar eller et ark lader trykket gå videre ned i webviewet.
     */
    @Composable
    private fun NativeOverlay() {
        val d = resources.displayMetrics.density
        val top = (safeArea.top / d).dp
        val bottom = (safeArea.bottom / d).dp
        val ink = Color(ContextCompat.getColor(this, R.color.vf_ink))
        val bg = Color(ContextCompat.getColor(this, R.color.vf_bg))

        Box(Modifier.fillMaxSize()) {
            if (nativeBars) {
                NativeKredsBar(
                    model = kredsBar,
                    ink = ink,
                    surface = bg,
                    background = bg,
                    topInset = top,
                    søgTekst = if (lang == "da") "Søg i dine kredse …" else "Search your circles …",
                    onTap = { id -> bridge?.call("vfKreds", id) },
                )
                Box(Modifier.align(Alignment.BottomCenter)) {
                    NativeTabBar(
                        model = tabBar,
                        ink = ink,
                        surface = bg,
                        bottomInset = bottom,
                        onTap = { id -> bridge?.call("vfTab", id) },
                    )
                }
                Box(Modifier.align(Alignment.BottomEnd)) {
                    NativeComposeButtons(
                        model = tabBar,
                        bottomInset = bottom,
                        onTap = { id -> bridge?.call("vfTab", id) },
                    )
                }
            }
            // Liste-siden ligger over barerne (web skjuler dem selv via nativeSheetOpen)
            // men under glaskortet og komposeren.
            ListPageHost(
                model = listPage,
                blæk = ink,
                baggrund = bg,
                topIndhak = top,
                bundIndhak = bottom,
                onEvent = { obj -> bridge?.call("vfListPage", obj) },
            )
            // Opslags-siden ligger UNDER glaskortet: ⋯ på andres opslag skal kunne lægge
            // menuen OVENPÅ siden, ellers er den død (web lukker bevidst ikke siden).
            PostPageHost(
                model = postPage,
                blæk = ink,
                baggrund = bg,
                topIndhak = top,
                bundIndhak = bottom,
                onEvent = { obj -> bridge?.call("vfPostPage", obj) },
            )
            // Glaskortet ligger OVER barerne (scrimen skal dæmpe dem) men UNDER komposeren,
            // præcis som på iPhone. Det må IKKE ligge inde i if (nativeBars).
            GlassSheetHost(
                model = sheet,
                blæk = ink,
                overflade = bg,
                topIndhak = top,
                bundIndhak = bottom,
                onAction = { a -> bridge?.call("vfSheet", a) },
            )
            // Kommentar-arket tegnes efter både barerne (de skjules af web med op til
            // 120 ms forsinkelse) og glaskortet: på iPhone ligger bundarkene over kortet.
            CommentsSheetHost(
                model = comments,
                blæk = ink,
                overflade = bg,
                bundIndhak = bottom,
                onEvent = { obj -> bridge?.call("vfComments", obj) },
            )
            if (composer.open) Composer(top, bottom)

            // Politik-arket tegner i sit eget vindue og ligger derfor altid øverst.
            politikUrl?.let { url ->
                PolitikSkaerm(
                    url = url,
                    blæk = ink,
                    baggrund = bg,
                    topIndhak = top,
                    onLuk = { politikUrl = null },
                    onEksternt = ::openOutside,
                )
            }
        }
    }

    @Composable
    private fun Composer(top: Dp, bottom: Dp) {
        ComposerScreen(
            model = composer,
            baggrund = Color(ContextCompat.getColor(this, R.color.vf_bg)),
            blæk = Color(ContextCompat.getColor(this, R.color.vf_ink)),
            topPad = top,
            bottomPad = bottom,
            onShare = { bytes, isVideo, caption, dest ->
                composer.pendingBytes = bytes
                composer.sharing = true
                val obj = JSONObject()
                    .put("isVideo", isVideo)
                    .put("caption", caption)
                    .put("dest", dest)
                    .put("ext", if (isVideo) "mp4" else "jpg")
                    .put("mime", if (isVideo) "video/mp4" else "image/jpeg")
                    .put("forCompose", composer.purpose == Purpose.COMPOSE)
                    .put("isStory", composer.isStory)
                bridge?.call("vfMemory", obj)
            },
            onCancel = {
                composer.close()
                hideOverlay()
                bridge?.call("vfMemoryCancel")
            },
            onDenied = {
                composer.close()
                hideOverlay()
                bridge?.call("vfMemoryFallback")
            },
        )
    }

    private fun showOverlay() {
        overlay.visibility = View.VISIBLE
    }

    /** Barerne og de åbne native flader bliver liggende; kun komposeren forsvinder. */
    private fun hideOverlay() {
        overlay.visibility =
            if (nativeBars || sheet.request != null || listPage.open ||
                comments.open || postPage.open
            ) {
                View.VISIBLE
            } else {
                View.GONE
            }
    }

    // ---------------------------------------------------------------- tilbage

    /**
     * Web-appen laver aldrig historik-indgange (kun replaceState), så WebViewets egen
     * canGoBack er næsten altid falsk. Uden det her ville tilbage lukke appen midt i en
     * chat-tråd. assets/back.js lukker i stedet det øverste åbne lag i siden.
     */
    private fun registerBackHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                // Politik-arket ligger i sit eget vindue, allerøverst.
                if (politikUrl != null) {
                    politikUrl = null
                    return
                }
                // Den native komposer ligger øverst og skal lukkes først
                if (composer.open) {
                    composer.close()
                    hideOverlay()
                    bridge?.call("vfMemoryCancel")
                    return
                }
                // Glaskortet: tilbage svarer til et tryk på scrimen. Web lukker kortet.
                // Gennem samme lås som knapperne, så tilbage ikke kan sende __cancel oven
                // i en handling der allerede er på vej.
                if (sheet.request != null) {
                    if (sheet.lås()) bridge?.call("vfSheet", "__cancel")
                    return
                }
                // Kommentar-arket: dismiss er en rundtur, og web ekkoer close. Svarer web
                // ikke (opslaget kan være væk af web-cachen), lukker nødværnet lokalt,
                // ellers føles tilbage-knappen død.
                if (comments.open) {
                    bridge?.call("vfComments", JSONObject()
                        .put("kind", "dismiss").put("postId", comments.postId))
                    overlay.postDelayed({ if (comments.open) comments.lukLokalt() }, 600)
                    return
                }
                // Opslags-siden: glid ud først, dismiss bagefter, som chevronen.
                if (postPage.open) {
                    postPage.exit()
                    return
                }
                // Liste-siden: glid ud først, dismiss bagefter (samme vej som pilen).
                if (listPage.open) {
                    listPage.exit()
                    return
                }
                web.evaluateJavascript(
                    "(window.__vfAndroidBack && window.__vfAndroidBack()) === true"
                ) { handled ->
                    if (handled == "true") return@evaluateJavascript
                    if (web.canGoBack()) {
                        web.goBack()
                        return@evaluateJavascript
                    }
                    // Web-fanebjælken er skjult af body.native, så back.js kan ikke selv
                    // skifte fane. Står vi et andet sted end feedet, fører tilbage derhen.
                    if (nativeBars && tabBar.active != "feed") {
                        tabBar.active = "feed"
                        bridge?.call("vfTab", "feed")
                        return@evaluateJavascript
                    }
                    // Vi er på forsiden. Læg appen i baggrunden i stedet for at lukke
                    // den, så sessionen og hele siden stadig er varm næste gang.
                    moveTaskToBack(true)
                }
            }
        })
    }

    /**
     * De to stumper web-kode appen selv lægger oven på siden. De bor i assets og ikke i
     * js/ på vibefeed.dk, fordi web-koden deles med iOS-appen i App Store.
     *
     * back.js gør tilbage-knappen til navigation i stedet for en udgang, og
     * compose-buttons.js tegner de to flydende opret-knapper som iOS har i sin
     * native fanebjælke, men som web-fanebjælken ikke har.
     */
    private fun injectScripts(view: WebView) {
        // safe-area.js FØRST: den skriver sidens egne env()-regler om, og de to andre
        // lag læner sig op ad de variabler den sætter.
        val lag = if (nativeBars) listOf("safe-area.js", "back.js", "share.js")
        else listOf("safe-area.js", "back.js", "compose-buttons.js", "share.js")
        for (name in lag) {
            val js = runCatching {
                assets.open(name).bufferedReader().use { it.readText() }
            }.getOrNull() ?: continue
            view.evaluateJavascript(js, null)
        }
        pushSafeArea()
    }

    // ---------------------------------------------------------------- filvalg

    /**
     * Uden det her gør <input type="file"> ingenting i et Android WebView, og så kan
     * man hverken poste et minde, skifte profilbillede eller sende et billede i chatten.
     */
    private fun openFileChooser(
        callback: ValueCallback<Array<Uri>>,
        params: WebChromeClient.FileChooserParams
    ): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        cameraOutput = null

        val accept = params.acceptTypes.filter { it.isNotBlank() }
        val wantsVideo = accept.any { it.startsWith("video/") }
        val wantsImage = accept.isEmpty() || accept.any { it.startsWith("image/") }
        val multiple = params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE

        // capture="environment" betyder at siden beder om kameraet, ikke om biblioteket
        val intent = (if (params.isCaptureEnabled) cameraIntent(wantsVideo && !wantsImage) else null)
            ?: pickerIntent(accept, multiple)

        return try {
            filePicker.launch(intent)
            true
        } catch (_: ActivityNotFoundException) {
            fileCallback?.onReceiveValue(null)
            fileCallback = null
            false
        }
    }

    /**
     * Beder siden kun om billeder og video, bruger vi Androids egen fotovælger. Den er
     * den brugerne kender, og den kræver ingen tilladelse: den viser kun det man vælger.
     * Falder tilbage til den almindelige dokumentvælger på ældre telefoner.
     */
    private fun pickerIntent(accept: List<String>, multiple: Boolean): Intent {
        val onlyMedia = accept.isNotEmpty() &&
            accept.all { it.startsWith("image/") || it.startsWith("video/") }
        if (onlyMedia && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val images = accept.any { it.startsWith("image/") }
            val videos = accept.any { it.startsWith("video/") }
            val picker = Intent(MediaStore.ACTION_PICK_IMAGES).apply {
                // Ingen type betyder billeder OG video
                if (images != videos) type = if (images) "image/*" else "video/*"
                if (multiple) putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, 20)
            }
            if (picker.resolveActivity(packageManager) != null) return picker
        }
        return contentIntent(accept, multiple)
    }

    private fun contentIntent(accept: List<String>, multiple: Boolean): Intent =
        Intent(Intent.ACTION_GET_CONTENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = if (accept.size == 1) accept.first() else "*/*"
            if (accept.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, accept.toTypedArray())
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)
        }

    private fun cameraIntent(video: Boolean): Intent? {
        val action = if (video) MediaStore.ACTION_VIDEO_CAPTURE else MediaStore.ACTION_IMAGE_CAPTURE
        val intent = Intent(action)
        // Ingen kamera-app: sig fra med det samme, så vi ikke efterlader en tom fil
        if (intent.resolveActivity(packageManager) == null) return null

        val dir = File(cacheDir, "captures").apply { mkdirs() }
        val file = File.createTempFile(
            if (video) "vid_" else "img_",
            if (video) ".mp4" else ".jpg",
            dir
        )
        val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
        cameraOutput = uri
        return intent.apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        }
    }

    private fun deliverFiles(resultCode: Int, data: Intent?) {
        val callback = fileCallback ?: return
        fileCallback = null

        if (resultCode != Activity.RESULT_OK) {
            // Fortrudt. Svaret SKAL sendes, ellers reagerer input-feltet aldrig igen.
            callback.onReceiveValue(null)
            cameraOutput = null
            return
        }

        val uris = mutableListOf<Uri>()
        data?.clipData?.let { clip ->
            for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
        }
        data?.data?.let { if (uris.isEmpty()) uris.add(it) }
        // Kamera-appen returnerer typisk ingen data: resultatet ligger i filen vi udpegede
        if (uris.isEmpty()) cameraOutput?.let { uris.add(it) }
        cameraOutput = null

        callback.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
    }
}
