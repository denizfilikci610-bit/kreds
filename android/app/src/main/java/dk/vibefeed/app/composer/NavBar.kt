package dk.vibefeed.app.composer

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

private val BRAND = Color(0xFFE0402F)

/**
 * Komposerens navigationslinje, fælles for galleri, trim, beskærer og billedtekst.
 *
 * 48 dp høj med 16 dp vandret polstring, Annuller til venstre der går ÉT trin tilbage,
 * titlen i midten og handlingen til højre. Skillelinjen vises alle steder undtagen på
 * billedtekst-trinnet, hvor et renere look om kreds-vælgeren er et bevidst valg.
 */
@Composable
fun ComposerNavBar(
    titel: String,
    annullerLabel: String,
    handlingLabel: String,
    handlingAktiv: Boolean,
    arbejder: Boolean,
    baggrund: Color,
    blæk: Color,
    topPad: Dp,
    visSkillelinje: Boolean,
    onCancel: () -> Unit,
    onAction: () -> Unit,
) {
    Column(Modifier.background(baggrund).padding(top = topPad)) {
        Row(
            Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            // Annuller er DØD mens der arbejdes: at bakke ud midt i en eksport kunne
            // ellers give to opslag (gå tilbage, frem, Del igen mens eksport 1 kører).
            Text(
                annullerLabel,
                color = blæk.copy(alpha = if (arbejder) 0.4f else 1f),
                fontSize = 16.sp,
                modifier = Modifier.clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    enabled = !arbejder,
                ) { onCancel() },
            )
            Spacer(Modifier.weight(1f))
            Text(titel, color = blæk, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Spacer(Modifier.weight(1f))

            Box(contentAlignment = Alignment.Center) {
                // Usynlig men pladsholdende, så titlen bliver stående i midten
                Text(handlingLabel, fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.Transparent)
                when {
                    arbejder -> CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = BRAND,
                    )
                    handlingLabel.isNotBlank() -> Text(
                        handlingLabel,
                        color = if (handlingAktiv) BRAND else blæk.copy(alpha = 0.4f),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.clickable(
                            enabled = handlingAktiv,
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                        ) { onAction() },
                    )
                }
            }
        }
        if (visSkillelinje) HorizontalDivider(color = blæk.copy(alpha = 0.16f))
    }
}
