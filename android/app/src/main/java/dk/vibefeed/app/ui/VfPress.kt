package dk.vibefeed.app.ui

import androidx.compose.animation.core.AnimationSpec
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer

/**
 * SwiftUI `.easeOut` er cubic-bezier(0, 0, 0.58, 1).
 *
 * Compose' egen LinearOutSlowInEasing er (0, 0, 0.2, 1) og bremser langt hårdere, så den
 * ville give en synligt anden bevægelse end iPhone-appen. Konstanten deles derfor af alle
 * de native skærme.
 */
internal val EaseOut = CubicBezierEasing(0f, 0f, 0.58f, 1f)

/**
 * Appens seks tryk-animationer, oversat fra ios/VibeFeed/VFButtonStyles.swift.
 *
 * Princippet fra Swift-filen: hver stil bruger SAMME animation ved tryk-ned og slip, så
 * knappen kommer ind og ud ens. Variationen kommer af at forskellige slags knapper får
 * forskellige stilarter, så ikke alt i appen animerer på samme måde.
 *
 * Omregningen fra SwiftUI: spring(response = r, dampingFraction = d) bliver til
 * spring(dampingRatio = d, stiffness = (2π/r)²).
 */
enum class VfPress(val skala: Float, val alfa: Float) {
    /** Ikoner: luk, blitz, vend kamera, tilbage-pil, fane-ikoner, ⋯, kommentar-ikon. */
    SCALE(0.90f, 1f),

    /** Primære handlinger: Send, Del, Gem, Anmod, Brug, Slet permanent. */
    POP(0.88f, 1f),

    /** Tekst og navigation: Svar, Slet, Annuller svar, politik-link, faner. */
    FADE(0.96f, 0.55f),

    /** Piller: kreds-mærke, mention-chip, ikke-stemt poll-mulighed, segmenter. */
    CHIP(0.93f, 1f),

    /** Store flader: kommentar-rækker, liste-rækker, avatarer, glaskortets rækker. */
    CARD(0.985f, 0.7f),

    /** Legende: hjerter, emoji-reaktioner. */
    BOUNCE(0.80f, 1f);

    val spec: AnimationSpec<Float>
        get() = when (this) {
            SCALE -> spring(0.55f, 503.6f)
            POP -> spring(0.50f, 341.5f)
            FADE -> tween(160, easing = EaseOut)
            CHIP -> spring(0.62f, 438.6f)
            CARD -> tween(180, easing = EaseOut)
            BOUNCE -> spring(0.42f, 385.5f)
        }
}

/**
 * Tryk-animation plus klik i ét, som SwiftUIs knapstile.
 *
 * To ting SKAL være som her:
 * 1. `indication = null`. Materials ringvirkning hører ikke hjemme i denne app, og mønsteret
 *    er det samme som de native barer allerede bruger.
 * 2. `graphicsLayer` FØR `clickable`, så trykfeltet bliver liggende i det uskalerede
 *    rektangel. Det svarer til SwiftUI, hvor scaleEffect ikke flytter hit-testet.
 */
fun Modifier.vfPress(
    stil: VfPress,
    enabled: Boolean = true,
    onClick: () -> Unit,
): Modifier = composed {
    val kilde = remember { MutableInteractionSource() }
    val trykket by kilde.collectIsPressedAsState()
    val s by animateFloatAsState(if (trykket) stil.skala else 1f, stil.spec, label = "vfPressS")
    val a by animateFloatAsState(if (trykket) stil.alfa else 1f, stil.spec, label = "vfPressA")
    Modifier
        .graphicsLayer { scaleX = s; scaleY = s; alpha = a }
        .clickable(
            interactionSource = kilde,
            indication = null,
            enabled = enabled,
            onClick = onClick,
        )
}
