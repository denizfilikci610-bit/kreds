package dk.vibefeed.app.notif

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.google.firebase.messaging.FirebaseMessaging
import dk.vibefeed.app.MainActivity
import dk.vibefeed.app.R
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

/**
 * Modstykket til ios/VibeFeed/NotifManager.swift: binder webbens login til systemets
 * notifikationer.
 *
 * Web poster {type:"creds", secret, lang} efter login. Hemmeligheden er et per-enhed-token
 * der KUN kan læse notifikations-resuméer. Har enheden et FCM-token, pusher serveren selv;
 * baggrunds-pollen hvert kvarter er udelukkende sikkerhedsnettet for enheder uden push
 * (fx uden Play-tjenester), for ellers kom hver notifikation to gange.
 *
 * Ingen Application-klasse, med vilje: kanalen sikres i stedet øverst i både tjenesten og
 * workeren, for FCM starter ofte en helt frisk proces.
 */
object VfNotifikationer {

    const val KANAL = "vf_default"
    const val ACTION_TAP = "dk.vibefeed.app.NOTIF"
    const val EXTRA_PAYLOAD = "vf_payload"
    const val POLL_ARBEJDE = "vf_poll"

    private const val PREFS = "vf_notif"
    private const val NOEGLE_SECRET = "vf_device_secret"
    private const val NOEGLE_SIDST = "vf_last_check"
    private const val NOEGLE_SPROG = "vf_lang"
    private const val NOEGLE_TOKEN = "vf_push_token"
    private const val NOEGLE_NOTIF_ID = "vf_notif_id"

    private const val REGISTER_URL =
        "https://iduotqxkohuezxkveawc.supabase.co/functions/v1/register-push"
    const val POLL_URL =
        "https://iduotqxkohuezxkveawc.supabase.co/functions/v1/notif-poll"

    /** Fire and forget med 20 sekunders loft, som iOS' URLSession-kald. */
    val http: OkHttpClient = OkHttpClient.Builder()
        .callTimeout(20, TimeUnit.SECONDS)
        .build()

    fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun secret(ctx: Context): String = prefs(ctx).getString(NOEGLE_SECRET, "") ?: ""
    fun pushToken(ctx: Context): String = prefs(ctx).getString(NOEGLE_TOKEN, "") ?: ""
    fun sprog(ctx: Context): String = prefs(ctx).getString(NOEGLE_SPROG, "da") ?: "da"
    fun sidstTjekket(ctx: Context): String? = prefs(ctx).getString(NOEGLE_SIDST, null)

    fun gemVandmaerke(ctx: Context, now: String) {
        prefs(ctx).edit().putString(NOEGLE_SIDST, now).apply()
    }

    /**
     * {type:"creds"}: gem hemmeligheden, sæt vandmærket til NU (så pollen aldrig graver
     * bagud ved første login) og gem HELE sprogkoden ("de", "zh-hans"), aldrig kun en/da.
     * `userId` læses aldrig, `consent` ignoreres bevidst.
     *
     * Rækkefølgen bagefter er tilladelse, poll-planlægning, backend-registrering. Selve
     * token-hentningen må KUN ske når tilladelsen er givet, det styrer aktiviteten.
     */
    fun onCreds(ctx: Context, json: JSONObject): Boolean {
        val secret = json.opt("secret") as? String ?: return false
        if (secret.isEmpty()) return false
        val e = prefs(ctx).edit()
            .putString(NOEGLE_SECRET, secret)
            .putString(NOEGLE_SIDST, isoNu())
        (json.opt("lang") as? String)?.takeIf { it.isNotEmpty() }?.let {
            e.putString(NOEGLE_SPROG, it)
        }
        e.apply()
        planlaegPoll(ctx)
        registrerHosBackend(ctx)
        return true
    }

    /**
     * {type:"logout"}: hemmeligheden og vandmærket ryddes, push-tokenet bliver BEVIDST
     * stående (det er enhedens, ikke brugerens). Pollen aflyses; på iOS dør kæden af sig
     * selv via guard'en i scheduleRefresh, her skal den aflyses aktivt.
     */
    fun onLogout(ctx: Context) {
        prefs(ctx).edit().remove(NOEGLE_SECRET).remove(NOEGLE_SIDST).apply()
        WorkManager.getInstance(ctx).cancelUniqueWork(POLL_ARBEJDE)
    }

    /**
     * Henter FCM-tokenet. Fejl-lytteren er OBLIGATORISK: uden den kan et forældet token
     * permanent slå pollen fra, og enheden ender helt uden notifikationer. Kan Firebase
     * slet ikke initialiseres (google-services.json mangler endnu), ryddes tokenet også,
     * og appen kører videre på pollen alene.
     */
    fun hentOgRegistrerToken(ctx: Context) {
        runCatching {
            FirebaseMessaging.getInstance().token
                .addOnSuccessListener { token ->
                    prefs(ctx).edit().putString(NOEGLE_TOKEN, token).apply()
                    registrerHosBackend(ctx)
                }
                .addOnFailureListener {
                    prefs(ctx).edit().remove(NOEGLE_TOKEN).apply()
                }
        }.onFailure {
            prefs(ctx).edit().remove(NOEGLE_TOKEN).apply()
        }
    }

    /** FCM-tokenet roterede. Kaldes af tjenestens onNewToken. */
    fun nytToken(ctx: Context, token: String) {
        prefs(ctx).edit().putString(NOEGLE_TOKEN, token).apply()
        registrerHosBackend(ctx)
    }

    /**
     * {secret, token, lang} til register-push, PRÆCIS som iOS og INTET andet: funktionen
     * ligger ikke i repoet, og en klient må ikke ensidigt udvide en kontrakt den ikke kan
     * læse. No-op indtil BÅDE hemmeligheden og tokenet findes; derfor kaldes den tre
     * steder: ved creds, ved token, og ved hver app-aktivering.
     */
    fun registrerHosBackend(ctx: Context) {
        val secret = secret(ctx)
        val token = pushToken(ctx)
        if (secret.isEmpty() || token.isEmpty()) return
        val body = JSONObject()
            .put("secret", secret)
            .put("token", token)
            .put("lang", sprog(ctx))
            .toString()
            .toRequestBody("application/json".toMediaTypeOrNull())
        val req = Request.Builder().url(REGISTER_URL).post(body).build()
        runCatching {
            http.newCall(req).enqueue(object : okhttp3.Callback {
                override fun onFailure(call: okhttp3.Call, e: java.io.IOException) = Unit
                override fun onResponse(call: okhttp3.Call, response: okhttp3.Response) {
                    response.close()
                }
            })
        }
    }

    /**
     * App åbnet: notifikationerne er "set". Serveren nulstiller badge-kolonnen ved
     * registreringen, og lokalt tømmes skyggen. Det er IKKE iOS-adfærden (dér bliver
     * listen liggende i Notification Center), men på Android ER skyggen kilden til
     * prikken, så der findes ingen anden vej. Bevidst afvejning.
     */
    fun appAktiveret(ctx: Context) {
        runCatching { NotificationManagerCompat.from(ctx).cancelAll() }
        registrerHosBackend(ctx)
    }

    /**
     * Kvarters-pollen. Periodisk arbejde kø'er sig selv, og KEEP gør gentagne kald
     * harmløse. 15 minutter er både iOS' interval og WorkManagers minimum.
     */
    fun planlaegPoll(ctx: Context) {
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
            POLL_ARBEJDE,
            ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<VfPollWorker>(15, TimeUnit.MINUTES).build(),
        )
    }

    // ------------------------------------------------------------ selve notifikationen

    @Volatile
    private var kanalKlar = false

    /**
     * En NotificationChannel er UÆNDERLIG efter oprettelse, så vigtigheden skal være
     * rigtig første gang: uden IMPORTANCE_HIGH ingen heads-up, altså intet modstykke
     * til iOS' banner.
     */
    fun sikrKanal(ctx: Context) {
        if (kanalKlar) return
        val kanal = NotificationChannel(KANAL, "VibeFeed", NotificationManager.IMPORTANCE_HIGH)
        kanal.lightColor = 0xFFE0402F.toInt()
        kanal.enableLights(true)
        kanal.enableVibration(true)
        kanal.setShowBadge(true)
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.createNotificationChannel(kanal)
        kanalKlar = true
    }

    /**
     * Viser en notifikation med deep-link-payload i ÉN String-extra. Payloaden er bygget
     * generisk af afsenderen (alle felter minus title/body), så nye serverfelter aldrig
     * kræver en app-opdatering.
     *
     * Id kommer fra en tæller i prefs, fordi FCM ofte starter en frisk proces, og
     * requestCode = id plus UPDATE_CURRENT, ellers deler to notifikationer extras.
     */
    fun visNotifikation(ctx: Context, titel: String, tekst: String, payloadJson: String) {
        sikrKanal(ctx)
        val p = prefs(ctx)
        val id = p.getInt(NOEGLE_NOTIF_ID, 0) + 1
        p.edit().putInt(NOEGLE_NOTIF_ID, id).apply()

        val tap = Intent(ctx, MainActivity::class.java)
            .setAction(ACTION_TAP)
            .putExtra(EXTRA_PAYLOAD, payloadJson)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val pending = PendingIntent.getActivity(
            ctx,
            id,
            tap,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notif = NotificationCompat.Builder(ctx, KANAL)
            .setSmallIcon(R.drawable.ic_notif)
            .setColor(0xFFE0402F.toInt())
            .setContentTitle(titel)
            .setContentText(tekst)
            .setStyle(NotificationCompat.BigTextStyle().bigText(tekst))
            .setAutoCancel(true)
            .setGroup("vf")
            .setContentIntent(pending)
            .build()

        // Uden POST_NOTIFICATIONS-tilladelsen kaster notify. Så er notifikationen tabt,
        // og det er det rigtige: brugeren har sagt nej.
        runCatching { NotificationManagerCompat.from(ctx).notify(id, notif) }
    }

    fun isoNu(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date())
    }

    fun isoFor24TimerSiden(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
        fmt.timeZone = TimeZone.getTimeZone("UTC")
        return fmt.format(Date(System.currentTimeMillis() - 24L * 3600 * 1000))
    }
}
