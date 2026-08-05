package com.rctiplus.tv.ui

import android.content.Intent
import android.os.Bundle
import androidx.leanback.app.BrowseSupportFragment
import androidx.leanback.widget.ArrayObjectAdapter
import androidx.leanback.widget.HeaderItem
import androidx.leanback.widget.ListRow
import androidx.leanback.widget.ListRowPresenter
import androidx.lifecycle.lifecycleScope
import com.rctiplus.tv.PlayerActivity
import com.rctiplus.tv.R
import com.rctiplus.tv.data.Api
import com.rctiplus.tv.data.ReplayItem
import kotlinx.coroutines.launch

/**
 * Home screen: a "Live" row (4 channels) and a "Replay" row seeded with the
 * 7-day catch-up schedules of all channels. Scrolling near the end of the
 * replay row pages deeper with `/history/prev` until the archive boundary.
 */
class BrowseFragment : BrowseSupportFragment() {

    private val liveAdapter = ArrayObjectAdapter(CardPresenter())
    private val replayAdapter = ArrayObjectAdapter(CardPresenter())
    private val rows = ArrayObjectAdapter(ListRowPresenter())

    private var loaded = false
    private var loadingMore = false

    /** Oldest loaded date — cursor for the next `/history/prev` page. */
    private var oldestDate: String? = null

    @Suppress("DEPRECATION") // onActivityCreated: standard leanback setup point
    override fun onActivityCreated(savedInstanceState: Bundle?) {
        super.onActivityCreated(savedInstanceState)
        title = getString(R.string.app_name)
        setAdapter(rows)
        setOnItemViewClickedListener { _, item, _, _ -> onCardClicked(item) }
        setOnItemViewSelectedListener { _, item, _, _ ->
            if (item != null) maybeLoadMore(item)
        }
    }

    override fun onStart() {
        super.onStart()
        if (!loaded) {
            loaded = true
            lifecycleScope.launch { loadHome() }
        }
    }

    private suspend fun loadHome() {
        try {
            val channels = Api.channels()
            liveAdapter.clear()
            liveAdapter.addAll(0, channels.map { it.toChannelCard() })
            rows.add(ListRow(HeaderItem(1, getString(R.string.live_title)), liveAdapter))

            // Seed the replay feed: merge the 7-day schedules of all channels,
            // deduped by epg id, newest first.
            val seed = LinkedHashMap<Long, ReplayItem>()
            for (ch in channels) {
                for (item in Api.schedule(ch.slug)) seed[item.epgId] = item
            }
            val sorted = seed.values
                .filter { it.playable }
                .sortedByDescending { "${it.date} ${it.start}" }
            replayAdapter.clear()
            replayAdapter.addAll(0, sorted.map { it.toReplayCard() })
            rows.add(ListRow(HeaderItem(2, getString(R.string.replay_title)), replayAdapter))
            oldestDate = sorted.lastOrNull()?.date
        } catch (e: Exception) {
            showProxyError()
        }
    }

    private fun onCardClicked(item: Any) {
        when (item) {
            is CardItem.Channel -> startPlayer(item.name, Api.liveUrl(item.slug))
            is CardItem.Replay -> if (item.playable) {
                startPlayer(item.title, Api.replayUrl(item.epgId))
            }
        }
    }

    private fun startPlayer(title: String, url: String) {
        startActivity(
            Intent(requireContext(), PlayerActivity::class.java)
                .putExtra(PlayerActivity.EXTRA_URL, url)
                .putExtra(PlayerActivity.EXTRA_TITLE, title),
        )
    }

    /** Trigger the next `/history/prev` page when the focus nears the feed end. */
    private fun maybeLoadMore(item: Any) {
        if (item !is CardItem.Replay || loadingMore) return
        val pos = replayAdapter.indexOf(item)
        if (pos < 0 || pos < replayAdapter.size() - PAGE_MARGIN) return
        loadMoreReplay()
    }

    private fun loadMoreReplay() {
        val before = oldestDate ?: return
        loadingMore = true
        lifecycleScope.launch {
            try {
                val res = Api.historyPrev(before)
                if (res.end || res.date == null || res.items.isEmpty()) {
                    oldestDate = null
                    return@launch
                }
                val existing = (0 until replayAdapter.size())
                    .map { (replayAdapter[it] as CardItem.Replay).epgId }
                    .toSet()
                val fresh = res.items
                    .filter { it.playable && it.epgId !in existing }
                    .map { it.toReplayCard() }
                replayAdapter.addAll(replayAdapter.size(), fresh)
                oldestDate = res.date
            } catch (e: Exception) {
                // Keep the cursor; the next selection retries.
            } finally {
                loadingMore = false
            }
        }
    }

    private fun showProxyError() {
        replayAdapter.clear()
        replayAdapter.add(
            CardItem.Replay(
                epgId = 0,
                title = getString(R.string.error_title),
                subtitle = getString(R.string.error_subtitle),
                playable = false,
            ),
        )
        if (rows.size() == 0) {
            rows.add(ListRow(HeaderItem(2, getString(R.string.replay_title)), replayAdapter))
        }
    }

    private fun ReplayItem.toReplayCard() = CardItem.Replay(
        epgId = epgId,
        title = title,
        subtitle = "$date · $start–$end",
        playable = playable,
    )

    private fun com.rctiplus.tv.data.Channel.toChannelCard() = CardItem.Channel(
        slug = slug,
        name = name,
        color = when (slug) {
            "rcti" -> 0xFFE50914.toInt()
            "mnctv" -> 0xFF1565C0.toInt()
            "gtv" -> 0xFF2E7D32.toInt()
            "inews" -> 0xFFF57C00.toInt()
            else -> 0xFF37474F.toInt()
        },
    )

    companion object {
        private const val PAGE_MARGIN = 8
    }
}