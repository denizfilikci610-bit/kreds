package dk.vibefeed.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.SubcomposeAsyncImage

/**
 * Den FLADE avatar, som glaskortets preview-header bruger.
 *
 * Den er med vilje ikke den samme som profilernes GlassAvatar: sheet-payloaden bærer ingen
 * gradient-farver, kun en URL og initialer, så der er intet at tegne chippen af.
 *
 * De to grå cirkler har FORSKELLIG alfa, og det er ikke en smutter i Swift-koden:
 * mens billedet hentes vises en tom cirkel på 0,2, mens cirklen med initialer står på 0,25.
 *
 * Én bevidst afvigelse fra iOS: dér peger AsyncImage samme placeholder på både hentning og
 * fejl, så en udløbet signeret URL ender som en flad grå cirkel UDEN bogstaver. Her får
 * fejl-tilfældet initialerne, som var meningen.
 */
@Composable
fun VfPlainAvatar(
    url: String,
    initialer: String,
    blæk: Color,
    størrelse: Dp = 38.dp,
) {
    val form = Modifier.size(størrelse).clip(CircleShape)

    if (url.isEmpty()) {
        InitialCirkel(form, initialer, blæk, størrelse)
        return
    }

    SubcomposeAsyncImage(
        model = url,
        contentDescription = null,
        modifier = form,
        contentScale = ContentScale.Crop,
        loading = { Box(Modifier.fillMaxSize().background(blæk.copy(alpha = 0.2f))) },
        error = { InitialCirkel(Modifier.fillMaxSize(), initialer, blæk, størrelse) },
    )
}

/**
 * Initialerne kan være tomme, når navnet kun består af emoji. En tom grå cirkel er det
 * rigtige svar dér, præcis som på iPhone.
 */
@Composable
private fun InitialCirkel(
    modifier: Modifier,
    initialer: String,
    blæk: Color,
    størrelse: Dp,
) {
    Box(
        modifier.clip(CircleShape).background(blæk.copy(alpha = 0.25f)),
        contentAlignment = Alignment.Center,
    ) {
        if (initialer.isNotEmpty()) {
            Text(
                text = initialer,
                fontSize = if (størrelse >= 38.dp) 14.sp else 12.sp,
                fontWeight = FontWeight.Bold,
                color = blæk,
            )
        }
    }
}
