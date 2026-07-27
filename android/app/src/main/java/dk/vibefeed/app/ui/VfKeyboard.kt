package dk.vibefeed.app.ui

import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalFocusManager

/**
 * Trækker man NEDAD i en liste, glider tastaturet væk, som iOS'
 * scrollDismissesKeyboard(.interactively).
 *
 * Kun BRUGERENS træk tæller: et programmatisk animateScrollToItem (fx rul-til-bunden
 * efter egen kommentar) må ALDRIG smide tastaturet væk, derfor filtreres der på kilden.
 */
fun Modifier.vfSkjulTastaturVedTraek(): Modifier = composed {
    val fokus = LocalFocusManager.current
    nestedScroll(
        remember {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (source == NestedScrollSource.UserInput && available.y > 6f) {
                        fokus.clearFocus()
                    }
                    return Offset.Zero
                }
            }
        }
    )
}
