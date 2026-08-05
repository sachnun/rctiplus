package com.rctiplus.tv

import android.app.Activity
import android.os.Bundle
import android.view.KeyEvent
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView

/**
 * Playback screen. Full-screen media3 [PlayerView] with its built-in TV
 * controller (play/pause/seek/ff/rw). The proxy serves absolute HTTPS HLS
 * playlists whose inner URLs are relative `/h/...` — same-origin — so plain
 * ExoPlayer HLS works with zero extra configuration. Redirects (the proxy's
 * live token self-heal) are followed automatically.
 */
@UnstableApi
class PlayerActivity : Activity() {

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_TITLE = "title"
    }

    private lateinit var playerView: PlayerView
    private var player: ExoPlayer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        playerView = findViewById(R.id.player_view)
        val url = intent.getStringExtra(EXTRA_URL) ?: return

        val exo = ExoPlayer.Builder(this).build()
        exo.setMediaItem(MediaItem.fromUri(url))
        exo.playWhenReady = true
        exo.prepare()
        player = exo
        playerView.player = exo
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        // OK / media play-pause toggles playback when the controller isn't focused.
        val isToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
            (keyCode == KeyEvent.KEYCODE_DPAD_CENTER && !playerView.isControllerFullyVisible)
        if (isToggle) {
            val exo = player
            if (exo != null) {
                if (exo.isPlaying) exo.pause() else exo.play()
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onDestroy() {
        playerView.player = null
        player?.release()
        player = null
        super.onDestroy()
    }
}