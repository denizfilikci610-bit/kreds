package dk.vibefeed.app.notif

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONObject

/**
 * Tager imod FCM-beskeder. Serveren sender RENT data ("kun data" er et hårdt krav):
 * sender den én gang en notification-blok, tegner systemet selv notifikationen i
 * baggrunden, onMessageReceived springes over, og vi mister både udseendet og
 * deep-linket.
 *
 * Payloaden bygges generisk over msg.data MINUS title og body (de bor i selve
 * notifikationen, som "aps" gør på iOS), så nye serverfelter aldrig kræver en
 * app-opdatering.
 */
class VfMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(msg: RemoteMessage) {
        VfNotifikationer.sikrKanal(this)
        val data = msg.data
        if (data.isEmpty()) return

        val titel = data["title"] ?: "VibeFeed"
        val tekst = data["body"] ?: return

        val payload = JSONObject()
        for ((k, v) in data) {
            if (k == "title" || k == "body") continue
            payload.put(k, v)
        }

        VfNotifikationer.visNotifikation(this, titel, tekst, payload.toString())
    }

    /** FCM-tokenet roterer. Gem og gen-registrér med det samme. */
    override fun onNewToken(token: String) {
        VfNotifikationer.nytToken(this, token)
    }
}
