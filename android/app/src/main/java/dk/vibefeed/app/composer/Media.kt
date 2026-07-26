package dk.vibefeed.app.composer

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.provider.MediaStore
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import kotlin.math.max

/**
 * Læsning af billedbiblioteket og klargøring af det valgte medie.
 *
 * Vi bruger MediaStore direkte i stedet for systemets fotovælger, fordi komposeren skal se ud
 * som på iOS: et gitter man bladrer i, med kameraet lige ved siden af. Det koster til gengæld
 * læse-tilladelsen, som fotovælgeren ellers slap for.
 */
object Media {

    /** Seneste billeder og videoer, nyeste først, som i iOS-galleriet. */
    fun recent(context: Context, limit: Int = 300): List<Picked> {
        val out = mutableListOf<Picked>()
        val uri = MediaStore.Files.getContentUri("external")
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
            MediaStore.Files.FileColumns.DURATION,
        )
        val selection = "${MediaStore.Files.FileColumns.MEDIA_TYPE} in (?, ?)"
        val args = arrayOf(
            MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE.toString(),
            MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO.toString(),
        )
        val order = "${MediaStore.Files.FileColumns.DATE_MODIFIED} DESC"

        context.contentResolver.query(uri, projection, selection, args, order)?.use { c ->
            val idCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val typeCol = c.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MEDIA_TYPE)
            val durCol = c.getColumnIndex(MediaStore.Files.FileColumns.DURATION)
            while (c.moveToNext() && out.size < limit) {
                val id = c.getLong(idCol)
                val isVideo = c.getInt(typeCol) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO
                val dur = if (durCol >= 0) c.getLong(durCol) else 0L
                out.add(Picked(ContentUris.withAppendedId(uri, id), isVideo, dur))
            }
        }
        return out
    }

    /**
     * Skalerer og beskærer et billede til målet, midterstillet, og koder det som JPEG.
     *
     * iOS lader brugeren panorere og zoome i beskæreren. Den kommer, men indtil da er et
     * midterbeskåret udsnit det samme som iOS bruger som udgangspunkt, så et billede aldrig
     * bliver trykket skævt.
     */
    fun prepareImage(context: Context, uri: Uri, targetW: Int, targetH: Int): ByteArray? {
        val bitmap = decodeOriented(context, uri, max(targetW, targetH) * 2) ?: return null

        val srcRatio = bitmap.width.toFloat() / bitmap.height
        val dstRatio = targetW.toFloat() / targetH
        val crop = if (srcRatio > dstRatio) {
            val w = (bitmap.height * dstRatio).toInt().coerceAtMost(bitmap.width)
            Bitmap.createBitmap(bitmap, (bitmap.width - w) / 2, 0, w, bitmap.height)
        } else {
            val h = (bitmap.width / dstRatio).toInt().coerceAtMost(bitmap.height)
            Bitmap.createBitmap(bitmap, 0, (bitmap.height - h) / 2, bitmap.width, h)
        }
        val scaled = Bitmap.createScaledBitmap(crop, targetW, targetH, true)

        return ByteArrayOutputStream().use { out ->
            scaled.compress(Bitmap.CompressFormat.JPEG, 90, out)
            out.toByteArray()
        }
    }

    /** Video sendes som den er. Trim og beskæring kommer i næste runde. */
    fun readBytes(context: Context, uri: Uri): ByteArray? =
        runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
            .getOrNull()

    /**
     * Afkoder billedet i en fornuftig størrelse og retter det op efter EXIF. Uden det ligger
     * et billede taget på højkant ned på siden, hvilket er den klassiske Android-fælde.
     */
    private fun decodeOriented(context: Context, uri: Uri, maxEdge: Int): Bitmap? {
        val resolver = context.contentResolver

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        if (bounds.outWidth <= 0) return null

        var sample = 1
        while (max(bounds.outWidth, bounds.outHeight) / sample > maxEdge) sample *= 2

        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = resolver.openInputStream(uri)?.use {
            BitmapFactory.decodeStream(it, null, opts)
        } ?: return null

        val rotation = runCatching {
            resolver.openInputStream(uri)?.use { stream ->
                when (ExifInterface(stream).getAttributeInt(
                    ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
                )) {
                    ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                    ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                    ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                    else -> 0f
                }
            } ?: 0f
        }.getOrDefault(0f)

        if (rotation == 0f) return bitmap
        val m = Matrix().apply { postRotate(rotation) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
    }
}
