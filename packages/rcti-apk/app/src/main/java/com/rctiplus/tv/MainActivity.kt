package com.rctiplus.tv

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.AbsListView
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ListView
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import com.rctiplus.tv.data.Api
import com.rctiplus.tv.data.Channel
import com.rctiplus.tv.data.ReplayItem
import com.rctiplus.tv.ui.MenuAdapter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Single, web-like screen: full-screen HLS video with a minimal chrome HUD
 * (channel/program label + Channels button) that fades out on idle, and a
 * left slide-in menu listing channels plus the replay schedule. Selecting a
 * channel plays its live feed and reloads its replay; picking a program
 * plays that catch-up (VOD) and dismisses the menu — just like the web app.
 */
@UnstableApi
class MainActivity : Activity() {

    private lateinit var playerView: PlayerView
    private lateinit var chrome: View
    private lateinit var nowLabel: TextView
    private lateinit var statusLabel: TextView
    private lateinit var channelsBtn: Button
    private lateinit var sidePanel: View
    private lateinit var backdrop: View
    private lateinit var menuList: ListView
    private lateinit var menuFooter: TextView

    private var player: ExoPlayer? = null

    private val channels: List<Channel> = Api.channels()
    private val channelRowViews = mutableListOf<View>()
    private var activeChannel = ""
    private var activeEpgId: Long? = null

    // Replay feed paging.
    private var replayChannel = ""
    private var replayOldest: String? = null
    private var replayDone = false
    private var replayBusy = false

    // Chrome HUD auto-hide.
    private val mainHandler = Handler(Looper.getMainLooper())
    private val hideChromeRunnable = Runnable { fadeChrome(false) }
    private var panelOpen = false

    private val menuAdapter = MenuAdapter(this)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Keep the screen on while the player window is visible: otherwise the
        // TV screensaver / idle sleep fires during a stream (no user input).
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        playerView = findViewById(R.id.player_view)
        chrome = findViewById(R.id.chrome)
        nowLabel = findViewById(R.id.now_label)
        statusLabel = findViewById(R.id.status_label)
        channelsBtn = findViewById(R.id.channels_btn)
        sidePanel = findViewById(R.id.side_panel)
        backdrop = findViewById(R.id.backdrop)
        menuList = findViewById(R.id.menu_list)
        menuFooter = layoutInflater.inflate(R.layout.menu_footer, menuList, false) as TextView

        menuFooter.text = getString(R.string.footer_loading_replay, "")
        menuList.addHeaderView(buildChannelsHeader(), null, false)
        // Static "REPLAY" section label (like the web sidebar), then the feed.
        val replayLabel = layoutInflater
            .inflate(R.layout.item_section_header, menuList, false) as TextView
        replayLabel.text = getString(R.string.section_replay)
        menuList.addHeaderView(replayLabel, null, false)
        menuList.addFooterView(menuFooter, null, false)

        menuAdapter.onProgramClick = { playEpisode(it) }
        menuList.adapter = menuAdapter
        // TV remote: D-pad must focus the rows themselves (not the list), so
        // OK activates the focused row — AbsListView defaults itemsCanFocus
        // to false, which would swallow DPAD focus.
        menuList.itemsCanFocus = true

        channelsBtn.setOnClickListener { setPanelOpen(!panelOpen) }
        backdrop.setOnClickListener { setPanelOpen(false) }
        menuList.setOnScrollListener(object : AbsListView.OnScrollListener {
            override fun onScroll(
                view: AbsListView, firstVisible: Int, visibleCount: Int, total: Int,
            ) {
                if (total > 0 && firstVisible + visibleCount >= total - 3) loadMoreReplay()
            }

            override fun onScrollStateChanged(view: AbsListView, scrollState: Int) {}
        })

        // Boot: auto-play the first channel's live feed (like the web).
        val exo = ExoPlayer.Builder(this).build()
        exo.playWhenReady = true
        exo.addListener(playerListener)
        player = exo
        playerView.player = exo
        if (channels.isNotEmpty()) {
            selectChannel(channels[0].slug, channels[0].name)
        } else {
            setStatus(getString(R.string.footer_empty), R.color.status_idle)
        }
    }

    override fun onDestroy() {
        mainHandler.removeCallbacks(hideChromeRunnable)
        scope.cancel()
        playerView.player = null
        player?.release()
        player = null
        super.onDestroy()
    }

    /* ----------------------------- channels menu --------------------------- */

    /** Header view holding one row per channel (index + uppercase name). */
    private fun buildChannelsHeader(): View {
        val container = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        channels.forEachIndexed { index, ch ->
            val row = LayoutInflater.from(this)
                .inflate(R.layout.row_channel, container, false)
            row.findViewById<TextView>(R.id.idx).text = "%02d".format(index + 1)
            row.findViewById<TextView>(R.id.title).text = ch.name.uppercase()
            row.setOnClickListener { selectChannel(ch.slug, ch.name) }
            bindChannelRow(row, index)
            channelRowViews.add(row)
            container.addView(row)
        }
        return container
    }

    private fun selectChannel(slug: String, name: String) {
        activeChannel = slug
        activeEpgId = null
        markActiveChannel()
        menuAdapter.setActive(null)
        play(Api.liveUrl(slug), name.uppercase())
        loadReplay(slug)
    }

    private fun markActiveChannel() {
        channelRowViews.forEachIndexed { index, row -> bindChannelRow(row, index) }
    }

    /** Paint a channel row's active accent (white strip + white text), like
        the web sidebar's `.row.active` (left border + white text). */
    private fun bindChannelRow(row: View, index: Int) {
        val active = channels[index].slug == activeChannel
        row.isSelected = active
        row.findViewById<View>(R.id.strip)
            .visibility = if (active) View.VISIBLE else View.GONE
        row.findViewById<TextView>(R.id.title)
            .setTextColor(getColor(if (active) R.color.white else R.color.text_primary))
        row.findViewById<TextView>(R.id.idx)
            .setTextColor(getColor(if (active) R.color.text_active else R.color.text_muted))
    }

    private fun playEpisode(item: ReplayItem) {
        activeEpgId = item.epgId
        menuAdapter.setActive(item.epgId)
        setPanelOpen(false)
        play(Api.replayUrl(item.epgId), item.title)
    }

    /* ------------------------------- playback ------------------------------ */

    private fun play(url: String, label: String) {
        nowLabel.text = label
        setStatus(getString(R.string.status_loading), R.color.status_buffering)
        player?.let { exo ->
            exo.playWhenReady = true
            exo.setMediaItem(MediaItem.fromUri(url))
            exo.prepare()
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onPlaybackStateChanged(playbackState: Int) {
            when (playbackState) {
                Player.STATE_BUFFERING ->
                    setStatus(getString(R.string.status_buffering), R.color.status_buffering)
                Player.STATE_READY -> {
                    val exo = player
                    if (exo == null || !exo.isPlaying) {
                        setStatus(getString(R.string.status_paused), R.color.status_idle)
                    }
                }
                Player.STATE_ENDED ->
                    setStatus(getString(R.string.status_done), R.color.status_idle)
            }
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            if (isPlaying) hideStatus()
        }

        override fun onPlayerError(error: PlaybackException) {
            val exo = player
            if (exo != null && exo.playbackState != Player.STATE_IDLE) {
                setStatus("Playback error: ${error.message}", R.color.status_error)
            }
        }
    }

    /* ------------------------------ replay feed ---------------------------- */

    private fun loadReplay(channel: String) {
        replayChannel = channel
        replayOldest = null
        replayDone = false
        replayBusy = false
        menuAdapter.clear()
        menuFooter.text = getString(R.string.footer_loading_replay, channel.uppercase())
        scope.launch {
            try {
                val items = Api.schedule(channel)
                if (items.isEmpty()) {
                    replayDone = true
                    menuFooter.text = getString(R.string.footer_empty)
                    return@launch
                }
                val byDate = items.groupBy { it.date }
                val dates = byDate.keys.sortedDescending() // YYYY-MM-DD: newest first
                dates.forEach { date -> menuAdapter.appendSection(date, byDate.getValue(date)) }
                replayOldest = dates.minOrNull()
                menuFooter.text = getString(R.string.footer_loading)
            } catch (e: Exception) {
                replayDone = true
                menuFooter.text = getString(R.string.replay_error, e.message)
            }
        }
    }

    private fun loadMoreReplay() {
        val before = replayOldest
        if (replayBusy || replayDone || before == null) return
        replayBusy = true
        scope.launch {
            try {
                val res = Api.historyPrev(before, replayChannel)
                if (res.items.isNotEmpty()) {
                    res.date?.let {
                        menuAdapter.appendSection(it, res.items)
                        replayOldest = it
                    }
                }
                replayDone = res.end
                menuFooter.text =
                    getString(if (res.end) R.string.footer_end else R.string.footer_loading)
            } catch (e: Exception) {
                replayDone = true
                menuFooter.text = getString(R.string.footer_error, e.message)
            } finally {
                replayBusy = false
            }
        }
    }

    /* ------------------------------ chrome HUD ----------------------------- */

    private fun setStatus(text: String, colorRes: Int) {
        statusLabel.text = text
        statusLabel.setTextColor(getColor(colorRes))
        statusLabel.visibility = View.VISIBLE
    }

    private fun hideStatus() {
        statusLabel.visibility = View.INVISIBLE
    }

    private fun fadeChrome(show: Boolean) {
        if (panelOpen && !show) return
        chrome.visibility = View.VISIBLE
        chrome.animate().cancel()
        chrome.animate()
            .alpha(if (show) 1f else 0f)
            .setDuration(200)
            .withEndAction {
                if (!show) chrome.visibility = View.GONE
            }
            .start()
        if (show) {
            mainHandler.removeCallbacks(hideChromeRunnable)
            mainHandler.postDelayed(hideChromeRunnable, CHROME_TIMEOUT_MS)
        }
    }

    private fun wakeChrome() {
        if (panelOpen) return
        fadeChrome(true)
    }

    /* ------------------------------- side panel ---------------------------- */

    private fun setPanelOpen(open: Boolean) {
        if (panelOpen == open) return
        panelOpen = open
        val panelWidth = sidePanel.width.takeIf { it > 0 }?.toFloat() ?: 320f
        if (open) {
            backdrop.visibility = View.VISIBLE
            backdrop.animate().cancel()
            backdrop.animate().alpha(1f).setDuration(200).start()
            sidePanel.animate().cancel()
            sidePanel.animate().translationX(0f).setDuration(200).start()
            focusMenu()
        } else {
            backdrop.animate().alpha(0f).setDuration(200)
                .withEndAction { backdrop.visibility = View.GONE }
                .start()
            sidePanel.animate().cancel()
            sidePanel.animate().translationX(-panelWidth).setDuration(200).start()
            // Drop focus from the (now off-screen) list so remote OK returns
            // to its playback-toggle role.
            menuList.clearFocus()
            wakeChrome()
        }
    }

    /** Move focus into the menu, landing on the active channel or program. */
    private fun focusMenu() {
        menuList.requestFocus()
        val headerCount = menuList.headerViewsCount
        val activePos = activeEpgId?.let { menuAdapter.positionOf(it) }
        if (activePos != null && activePos >= 0) {
            menuList.setSelection(headerCount + activePos)
        } else {
            val ci = channels.indexOfFirst { it.slug == activeChannel }
            menuList.setSelection(if (ci >= 0) ci else 0)
        }
    }

    /* ------------------------------ input/keys ----------------------------- */

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN) {
            if (event.keyCode == KeyEvent.KEYCODE_BACK && panelOpen) {
                setPanelOpen(false)
                return true
            }
            if (!panelOpen) wakeChrome()
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        // Dedicated remote menu key opens/closes the sidebar.
        if (keyCode == KeyEvent.KEYCODE_MENU) {
            setPanelOpen(!panelOpen)
            return true
        }
        // OK / play-pause toggles playback, but only when no other view is
        // focused — OK on a focused button/menu row must activate it instead
        // (standard TV remote behavior).
        val focus = currentFocus
        val nothingFocused = focus == null || focus === playerView
        val isToggle = keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
            (keyCode == KeyEvent.KEYCODE_DPAD_CENTER &&
                !playerView.isControllerFullyVisible && nothingFocused)
        if (isToggle) {
            player?.let { exo ->
                if (exo.isPlaying) exo.pause() else exo.play()
            }
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        // Touches land on the PlayerView (it consumes them), so the activity's
        // onTouchEvent never fires — use dispatchTouchEvent to wake the chrome.
        if (!panelOpen) wakeChrome()
        return super.dispatchTouchEvent(event)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.action == MotionEvent.ACTION_DOWN && !panelOpen) wakeChrome()
        return super.onTouchEvent(event)
    }

    companion object {
        private const val CHROME_TIMEOUT_MS = 3500L
    }
}