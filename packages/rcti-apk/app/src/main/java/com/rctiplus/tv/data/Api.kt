package com.rctiplus.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Fully-local RCTI+ client — no proxy, no server.
 *
 * The app talks to RCTI+ directly with the same contract the server-side
 * proxy implements (packages/rcti-api): it extracts the visitor JWT, resolves
 * signed HLS masters from toutatis, scrapes the 7-day catch-up page and
 * discovers deeper history by scanning the EPG id space. ExoPlayer then plays
 * the streams directly, sending the Referer header the CDN's ACL demands.
 */
object Api {

    /**
     * Static channel list — the app's copy of the shared contract
     * (Config.CHANNELS / config.ts CHANNELS). There is no proxy to ask, so
     * this mirrors the server-side map 1:1.
     */
    fun channels(): List<Channel> = Config.CHANNELS.keys.map { Channel(it, displayName(it)) }

    /** 7-day catch-up list for one channel (scraped, cached). */
    suspend fun schedule(channel: String): List<ReplayItem> = withContext(Dispatchers.IO) {
        ScheduleScraper.fetchSchedule(channel).map {
            ReplayItem(it.epgId, it.title, it.date, it.start, it.end, playable = true)
        }
    }

    /** Next older playable day (infinite-scroll paging; all channels by default). */
    suspend fun historyPrev(before: String, channel: String? = null): PrevResult {
        val res = History.fetchPrev(before, channel)
        return PrevResult(
            date = res.date,
            end = res.end,
            items = res.items.map {
                ReplayItem(it.epgId, it.title, it.date, it.start, it.end, it.playable)
            },
        )
    }

    /** Live master, pinned to the best variant (media playlist URL). */
    suspend fun liveUrl(slug: String): String {
        val id = requireNotNull(Config.CHANNELS[slug]) { "unknown channel $slug" }
        return Hls.bestVariant(RctiApi.resolveMaster(id))
    }

    /** Catch-up (VOD) master for one program — always the best variant. */
    suspend fun replayUrl(epgId: Long): String =
        Hls.bestVariant(RctiApi.resolveEpg(epgId.toString()).url)

    /**
     * Drop cached URLs for a play kind (`live:<slug>` or `epg:<id>`) so the
     * next call re-resolves fresh tokens — self-heal on token expiry.
     */
    fun invalidateKind(kind: String) {
        when {
            kind.startsWith("live:") -> Config.CHANNELS[kind.removePrefix("live:")]
                ?.let { RctiApi.invalidateLive(it) }
            kind.startsWith("epg:") -> RctiApi.invalidateEpg(kind.removePrefix("epg:"))
        }
    }

    private fun displayName(slug: String): String = when (slug) {
        "rcti" -> "RCTI"
        "mnctv" -> "MNCTV"
        "gtv" -> "GTV"
        "inews" -> "iNews"
        else -> slug
    }
}