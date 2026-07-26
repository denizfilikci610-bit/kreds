package dk.vibefeed.app.notif

import android.content.Context
import androidx.work.Worker
import androidx.work.WorkerParameters
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

/**
 * Kvarters-pollen mod notif-poll, sikkerhedsnettet for enheder uden push.
 *
 * Har enheden et aktivt push-token, leverer FCM allerede alle hændelserne (der findes en
 * push-trigger for hver type), så at polle oveni ville give præcis samme notifikation to
 * gange. Derfor springes der over med det samme når tokenet findes.
 *
 * Resultatet er ALTID success: periodisk arbejde kører igen om et kvarter uanset hvad,
 * og retry/failure ville kun forstyrre den kadence.
 */
class VfPollWorker(ctx: Context, params: WorkerParameters) : Worker(ctx, params) {

    @Volatile
    private var kald: Call? = null

    override fun doWork(): Result {
        val ctx = applicationContext
        VfNotifikationer.sikrKanal(ctx)

        if (VfNotifikationer.pushToken(ctx).isNotEmpty()) return Result.success()
        val secret = VfNotifikationer.secret(ctx)
        if (secret.isEmpty()) return Result.success()

        val since = VfNotifikationer.sidstTjekket(ctx) ?: VfNotifikationer.isoFor24TimerSiden()
        val body = JSONObject()
            .put("secret", secret)
            .put("since", since)
            .put("lang", VfNotifikationer.sprog(ctx))
            .toString()
            .toRequestBody("application/json".toMediaTypeOrNull())

        val req = Request.Builder().url(VfNotifikationer.POLL_URL).post(body).build()
        val c = VfNotifikationer.http.newCall(req)
        kald = c

        runCatching {
            c.execute().use { res ->
                if (!res.isSuccessful) return Result.success()
                val json = JSONObject(res.body?.string() ?: return Result.success())
                val events = json.optJSONArray("events")
                val antal = minOf(events?.length() ?: 0, 5)
                for (i in 0 until antal) {
                    val ev = events?.optJSONObject(i) ?: continue
                    val tekst = ev.opt("text") as? String ?: continue
                    // Deep-link-nøglerne videre som de er, nil-sikkert: ældre
                    // notif-poll-udgaver sender hverken kind, pid, fid eller cid.
                    val payload = JSONObject()
                    for (key in listOf("kind", "pid", "fid", "cid")) {
                        val v = ev.opt(key)
                        if (v is String || v is Number) payload.put(key, v)
                    }
                    VfNotifikationer.visNotifikation(ctx, "VibeFeed", tekst, payload.toString())
                }
                // Vandmærket skrives KUN ved succes og kun med serverens eget "now",
                // aldrig et optimistisk eller lokalt klokkeslæt.
                (json.opt("now") as? String)?.let { VfNotifikationer.gemVandmaerke(ctx, it) }
            }
        }
        return Result.success()
    }

    override fun onStopped() {
        kald?.cancel()
    }
}
