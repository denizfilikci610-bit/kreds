package dk.vibefeed.app.post

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView

/**
 * Den loopende, lydløse video på opslags-siden, som iOS' LoopVideo.
 *
 * Nøglet KUN på url-strengen: nøgles der på post-objektet, genstarter videoen ved HVER
 * feed-render bagved, altså mange gange i minuttet.
 */
@Composable
fun LoopVideo(url: String, modifier: Modifier = Modifier) {
    val ctx = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(ctx).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            repeatMode = Player.REPEAT_MODE_ALL
            volume = 0f
            playWhenReady = true
            prepare()
        }
    }
    DisposableEffect(url) {
        onDispose { player.release() }
    }
    AndroidView(
        modifier = modifier,
        factory = { c ->
            PlayerView(c).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
            }
        },
        update = { it.player = player },
    )
}
