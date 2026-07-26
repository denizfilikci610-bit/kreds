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
import dk.vibefeed.app.bridge.VfBridge
import org.json.JSONObject
import java.io.File

/**
 * VibeFeed på Android er den samme app som på iOS: én WebView på det live site.
 * Al logik bor i web-koden på vibefeed.dk, og denne skal leverer kun de fire ting
 * et WebView ikke kan selv: tilbage-navigation, filvalg, ruter for eksterne links
 * og systemets indhak omkring indholdet.
 *
 * Vi sætter med vilje INGEN window.__vf-flag. De flag fortæller web-koden at der
 * findes native erstatninger, og fx __vfNative ville skjule både fanebjælken og
 * kreds-baren (css/app.css body.native) uden at give noget i stedet.
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

    /** Systemets indhak, som siden får at vide gennem window.__vfInsets. */
    private var safeArea: Insets = Insets.NONE

    /** Besked-broen til web, den samme kontrakt som iOS bruger. */
    private var bridge: VfBridge? = null

    private val filePicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            deliverFiles(result.resultCode, result.data)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)

        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
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
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        linkFrom(intent)?.let { web.loadUrl(it) }
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
                    openOutside(request.url)
                    v.destroy()
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
        bridge = VfBridge(
            web = web,
            allowedOrigins = INTERNAL_HOSTS.map { "https://$it" }.toSet(),
            onMessage = ::onBridgeMessage,
        )
        bridge?.install(emptySet())
    }

    private fun onBridgeMessage(type: String, json: JSONObject) {
        // Endnu ingen native skærme at sende beskederne videre til. Ukendte typer må aldrig
        // kaste, kun ignoreres, præcis som Swift gør.
        if (BuildConfig.DEBUG) {
            // Kun feltnavne. Beskeder som creds bærer et enheds-token, og det har intet
            // at gøre i enhedens log.
            android.util.Log.d("VibeFeed", "bro: $type felter=${json.keys().asSequence().toList()}")
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
                web.evaluateJavascript(
                    "(window.__vfAndroidBack && window.__vfAndroidBack()) === true"
                ) { handled ->
                    if (handled == "true") return@evaluateJavascript
                    if (web.canGoBack()) {
                        web.goBack()
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
        for (name in listOf("safe-area.js", "back.js", "compose-buttons.js")) {
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
