package dk.vibefeed.app.composer

import android.content.Context
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Crop
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.Transformer
import java.io.File
import kotlin.math.max
import kotlin.math.min

/**
 * Video-eksporten: klip, beskæring og målstørrelse i ét gennemløb.
 *
 * Det her er stedet Android går galt hvis man bare kopierer iOS. Media3s Crop bruger
 * normaliserede koordinater fra minus 1 til 1 med origo i MIDTEN og **Y opad**, mens vores
 * udsnit er 0 til 1 med origo øverst til venstre. En fortegnsfejl giver en spejlvendt
 * beskæring, og den er svær at få øje på indtil nogen poster en video på hovedet.
 */
@OptIn(UnstableApi::class)
object VideoExport {

    /** Vi venter aldrig i det uendelige. Hænger eksporten, skal spinneren stoppe. */
    const val TIMEOUT_MS = 90_000L

    data class Ordre(
        val kilde: Uri,
        val startMs: Long,
        val laengdeMs: Long,
        /** Udsnittet i 0 til 1 med top-venstre origo, eller null for hele billedet. */
        val udsnit: Udsnit?,
        val maalBredde: Int,
        val maalHoejde: Int,
    )

    data class Udsnit(val left: Float, val top: Float, val width: Float, val height: Float)

    /**
     * Kører eksporten. [færdig] kaldes med den færdige fil, eller null ved fejl.
     * Returnerer transformeren, så kalderen kan afbryde ved timeout.
     */
    fun start(
        context: Context,
        ordre: Ordre,
        færdig: (File?) -> Unit,
    ): Transformer {
        val ud = File(File(context.cacheDir, "captures").apply { mkdirs() }, "ud_${System.nanoTime()}.mp4")

        // Klemning som på iOS: start må aldrig lande på eller efter slutningen, og
        // længden skal være mindst et hundrededel sekund, ellers giver klippet ingen mening.
        val start = ordre.startMs.coerceAtLeast(0)
        val længde = ordre.laengdeMs.coerceAtLeast(100)

        val item = MediaItem.Builder()
            .setUri(ordre.kilde)
            .setClippingConfiguration(
                MediaItem.ClippingConfiguration.Builder()
                    .setStartPositionMs(start)
                    .setEndPositionMs(start + længde)
                    .build()
            )
            .build()

        val effekter = mutableListOf<Effect>()
        ordre.udsnit?.let { r ->
            // 0..1 med top-venstre origo  →  minus 1..1 med origo i midten og Y OPAD.
            // top bliver den STØRSTE værdi, netop fordi Y peger opad.
            val left = 2f * r.left - 1f
            val right = 2f * (r.left + r.width) - 1f
            val top = 1f - 2f * r.top
            val bottom = 1f - 2f * (r.top + r.height)
            effekter.add(Crop(left, right, bottom, top))
        }
        effekter.add(
            Presentation.createForWidthAndHeight(
                ordre.maalBredde, ordre.maalHoejde, Presentation.LAYOUT_SCALE_TO_FIT
            )
        )

        val redigeret = EditedMediaItem.Builder(item)
            .setEffects(Effects(emptyList(), effekter))
            .build()

        val transformer = Transformer.Builder(context)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, result: ExportResult) {
                    færdig(ud)
                }

                override fun onError(
                    composition: Composition,
                    result: ExportResult,
                    exception: ExportException,
                ) {
                    færdig(null)
                }
            })
            .build()

        transformer.start(redigeret, ud.absolutePath)
        return transformer
    }

    /**
     * Det centrerede udsnit der får kilden til at DÆKKE målet, i 0 til 1 med top-venstre
     * origo. Samme regnestykke som iOS bruger når et kamera-klip skal fylde 4:5 eller 9:16.
     */
    fun daekUdsnit(kildeB: Int, kildeH: Int, maalB: Int, maalH: Int): Udsnit? {
        if (kildeB <= 0 || kildeH <= 0) return null
        val kildeForhold = kildeB.toFloat() / kildeH
        val maalForhold = maalB.toFloat() / maalH
        return if (kildeForhold > maalForhold) {
            // Kilden er for bred: skær i siderne
            val b = maalForhold / kildeForhold
            Udsnit(left = (1f - b) / 2f, top = 0f, width = b, height = 1f)
        } else {
            // Kilden er for høj: skær i top og bund
            val h = kildeForhold / maalForhold
            Udsnit(left = 0f, top = (1f - h) / 2f, width = 1f, height = h)
        }
    }

    /** Videoens oprejste pixelmål og varighed, læst med metadata i stedet for at gætte. */
    fun mål(context: Context, uri: Uri): Triple<Int, Int, Long> {
        val r = android.media.MediaMetadataRetriever()
        return try {
            r.setDataSource(context, uri)
            fun tal(nøgle: Int) =
                r.extractMetadata(nøgle)?.toIntOrNull() ?: 0
            val b = tal(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)
            val h = tal(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)
            val rot = tal(android.media.MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)
            val varighed = r.extractMetadata(
                android.media.MediaMetadataRetriever.METADATA_KEY_DURATION
            )?.toLongOrNull() ?: 0L
            // Ved 90 og 270 grader byttes bredde og højde om, ellers regner alt forkert
            if (rot == 90 || rot == 270) Triple(h, b, varighed) else Triple(b, h, varighed)
        } catch (e: Exception) {
            Triple(0, 0, 0L)
        } finally {
            runCatching { r.release() }
        }
    }

    /** De otte miniaturer til filmstrimlen. 168 px er tre gange strimlens højde, som på iOS. */
    fun filmstrimmel(context: Context, uri: Uri, varighedMs: Long): List<android.graphics.Bitmap> {
        val r = android.media.MediaMetadataRetriever()
        return try {
            r.setDataSource(context, uri)
            (0 until 8).mapNotNull { i ->
                val us = (varighedMs * (i + 0.5) / 8.0 * 1000).toLong()
                runCatching {
                    r.getScaledFrameAtTime(
                        us, android.media.MediaMetadataRetriever.OPTION_CLOSEST_SYNC, 168, 168
                    )
                }.getOrNull()
            }
        } catch (e: Exception) {
            emptyList()
        } finally {
            runCatching { r.release() }
        }
    }
}
