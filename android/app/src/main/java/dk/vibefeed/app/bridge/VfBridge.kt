package dk.vibefeed.app.bridge

import android.net.Uri
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Broen mellem web-koden og de native skærme.
 *
 * iOS bruger WKWebViews egen `window.webkit.messageHandlers.vibefeed`. Web-koden kalder den
 * bare som en almindelig funktion og spørger aldrig om den er ægte, så Android kan definere
 * den selv. Derfor genbruges HELE den eksisterende kontrakt uden at ændre en linje web-kode.
 *
 * To ting er afgørende:
 *
 * 1. Shimmen og capability-flagene skal injiceres ved DOKUMENTSTART. js/main.js læser flagene
 *    mens filen kører, og et flag der ankommer i onPageFinished bliver aldrig set.
 * 2. Vi bruger addWebMessageListener frem for addJavascriptInterface. Den håndhæver tilladte
 *    oprindelser i selve platformen i stedet for at eksponere et Java-objekt for alt
 *    JavaScript, og den leverer beskeden på UI-tråden, hvor de native skærme bor.
 */
class VfBridge(
    private val web: WebView,
    private val allowedOrigins: Set<String>,
    private val onMessage: (type: String, json: JSONObject) -> Unit,
) {

    /** Flagene web læser for at vide hvad appen kan. Kun dem vi FAKTISK betjener må med. */
    private val capabilities = mutableSetOf<String>()

    val isSupported: Boolean
        get() = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    /**
     * Slår broen til. Kaldes ÉN gang, før den første indlæsning.
     *
     * Sætter man et flag uden at kunne betjene beskeden bagefter, står web og venter for
     * evigt. Derfor bestemmer [capabilities] hvad der loves, og listen udvides først når en
     * skærm er færdig.
     */
    fun install(capabilities: Set<String>) {
        if (!isSupported) return
        this.capabilities.clear()
        this.capabilities.addAll(capabilities)

        WebViewCompat.addWebMessageListener(
            web,
            HANDLER,
            allowedOrigins,
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView,
                    message: WebMessageCompat,
                    sourceOrigin: Uri,
                    isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy,
                ) {
                    if (!isMainFrame) return
                    val raw = message.data ?: return
                    val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
                    // Web sender også beskeder vi aldrig skal gøre noget ved (fsheet, msheet,
                    // ads, consent). En ukendt type må aldrig kaste, kun ignoreres.
                    val type = json.optString("type").ifBlank { return }
                    onMessage(type, json)
                }
            },
        )

        WebViewCompat.addDocumentStartJavaScript(web, shim(), allowedOrigins)
    }

    private fun shim(): String {
        val flags = capabilities.joinToString(" ") { "window.$it = true;" }
        return """
            (function () {
              window.webkit = window.webkit || {};
              window.webkit.messageHandlers = window.webkit.messageHandlers || {};
              window.webkit.messageHandlers.vibefeed = {
                postMessage: function (o) {
                  try { $HANDLER.postMessage(JSON.stringify(o)); } catch (e) {}
                }
              };
              $flags
            })();
        """.trimIndent()
    }

    /**
     * Native til web. Skal på UI-tråden, og strengene skal quotes ordentligt: en billedtekst
     * med et citationstegn eller et linjeskift ville ellers ødelægge udtrykket.
     *
     * Værnet `window.f &&` er ikke pynt. Funktionerne findes først når js/main.js har kørt,
     * og en besked der ankommer før det, ville kaste i stedet for at blive tabt i stilhed.
     */
    fun call(fn: String, vararg args: Any?) {
        val list = args.joinToString(",") { encode(it) }
        val js = "window.$fn && window.$fn($list)"
        web.post { web.evaluateJavascript(js, null) }
    }

    private fun encode(v: Any?): String = when (v) {
        null -> "null"
        is String -> JSONObject.quote(v)
        is Boolean, is Int, is Long, is Double -> v.toString()
        is JSONObject -> v.toString()
        else -> JSONObject.quote(v.toString())
    }

    private companion object {
        const val HANDLER = "vfAndroidBridge"
    }
}
