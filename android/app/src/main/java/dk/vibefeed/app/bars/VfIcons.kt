package dk.vibefeed.app.bars

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.size
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Ikonerne er de SAMME som web-appen tegner (IC-tabellen i js/feed.js), så den native
 * fanebjælke ikke pludselig har et andet hus eller et andet hjerte end resten af appen.
 * Alle er 24x24, stregtykkelse 1.9 med runde ender, præcis som .stroke i css/app.css.
 *
 * Cirkler er skrevet om til bue-kommandoer, for en sti kan indeholde dem, mens
 * PathParser ikke kender <circle>.
 */
data class VfIcon(val fyldt: List<String>, val streg: List<String>)

private const val TYKKELSE = 1.9f

object VfIcons {
    /** Aktiv fane bruger den fyldte variant, som i web-appen. */
    val Home = VfIcon(
        fyldt = listOf("M3.9 10.7 12 3.6l8.1 7.1V20a1 1 0 0 1-1 1h-4.7v-6.4H9.6V21H4.9a1 1 0 0 1-1-1Z"),
        streg = emptyList(),
    )
    val HomeOutline = VfIcon(
        fyldt = emptyList(),
        streg = listOf("M3.9 10.7 12 3.6l8.1 7.1V20a1 1 0 0 1-1 1h-4.7v-6.4H9.6V21H4.9a1 1 0 0 1-1-1Z"),
    )
    val Search = VfIcon(
        fyldt = emptyList(),
        streg = listOf(
            "M4 11 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0",
            "M16.5 16.5 21 21",
        ),
    )
    val Chat = VfIcon(
        fyldt = listOf("M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"),
        streg = emptyList(),
    )
    val ChatOutline = VfIcon(
        fyldt = emptyList(),
        streg = listOf("M12 3.3a8.7 8.7 0 0 0-7.4 13.2L3.4 20.6l4.2-1.1A8.7 8.7 0 1 0 12 3.3Z"),
    )

    /** Notifikations-fanen bruger et HJERTE i web-appen, ikke en klokke. */
    val Bell = VfIcon(
        fyldt = listOf("M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"),
        streg = emptyList(),
    )
    val BellOutline = VfIcon(
        fyldt = emptyList(),
        streg = listOf("M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"),
    )
    val Person = VfIcon(
        fyldt = listOf(
            "M8 8 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0",
            "M4.4 20.5c.8-4 3.9-6.1 7.6-6.1s6.8 2.1 7.6 6.1Z",
        ),
        streg = emptyList(),
    )
    val PersonOutline = VfIcon(
        fyldt = emptyList(),
        streg = listOf(
            "M8.3 8 a3.7 3.7 0 1 0 7.4 0 a3.7 3.7 0 1 0 -7.4 0",
            "M5 20c.8-3.7 3.6-5.6 7-5.6s6.2 1.9 7 5.6",
        ),
    )

    val Plus = VfIcon(fyldt = emptyList(), streg = listOf("M12 5v14", "M5 12h14"))
    val Close = VfIcon(fyldt = emptyList(), streg = listOf("M6 6 18 18", "M18 6 6 18"))
    val Photo = VfIcon(
        fyldt = listOf("M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm1.6 12h12.8l-4-5.2-3.1 3.9-2.1-2.5L5.6 17ZM8 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"),
        streg = emptyList(),
    )

    /** Den fyldte variant når fanen er aktiv, ellers omridset. */
    fun forTab(id: String, aktiv: Boolean): VfIcon = when (id) {
        "feed" -> if (aktiv) Home else HomeOutline
        "search" -> Search
        "chat" -> if (aktiv) Chat else ChatOutline
        "akt" -> if (aktiv) Bell else BellOutline
        else -> if (aktiv) Person else PersonOutline
    }
}

@Composable
fun VfIcon(ikon: VfIcon, farve: Color, storrelse: Dp) {
    val fyldte = remember(ikon) { ikon.fyldt.map { PathParser().parsePathString(it).toPath() } }
    val stregede = remember(ikon) { ikon.streg.map { PathParser().parsePathString(it).toPath() } }

    Canvas(Modifier.size(storrelse)) {
        val faktor = size.minDimension / 24f
        scale(faktor, faktor, pivot = Offset.Zero) {
            fyldte.forEach { drawPath(it, farve) }
            stregede.forEach {
                drawPath(
                    it,
                    farve,
                    style = Stroke(width = TYKKELSE, cap = StrokeCap.Round, join = StrokeJoin.Round),
                )
            }
        }
    }
}
