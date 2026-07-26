package dk.vibefeed.app.composer

import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Upload af mediet direkte til Supabase Storage.
 *
 * Web udregner selv URL, bøtte og sti og sender dem i upload-ordren. Stories lander i den
 * private bøtte gennem præfikset priv/. Appen må ALDRIG gætte adressen selv: så ville et
 * skifte i web kræve en app-opdatering, og det er hele pointen med at web ejer flowet.
 */
object Uploader {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(120, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .build()

    /** Kaldes på en baggrundstråd. Returnerer true ved 2xx. */
    fun upload(order: JSONObject, bytes: ByteArray): Boolean {
        val url = order.optString("url").ifBlank { return false }
        val token = order.optString("token")
        val apikey = order.optString("apikey")
        val contentType = order.optString("contentType").ifBlank { "application/octet-stream" }

        val request = Request.Builder()
            .url(url)
            .post(bytes.toRequestBody(contentType.toMediaTypeOrNull()))
            .header("Authorization", "Bearer $token")
            .header("apikey", apikey)
            .header("Content-Type", contentType)
            .header("cache-control", "max-age=3600")
            .header("x-upsert", "false")
            .build()

        return runCatching {
            client.newCall(request).execute().use { it.isSuccessful }
        }.getOrDefault(false)
    }
}
