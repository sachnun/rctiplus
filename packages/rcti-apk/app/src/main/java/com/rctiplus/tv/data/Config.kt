package com.rctiplus.tv.data

/**
 * RCTI+ constants — the Kotlin side of the shared contract, mirroring
 * packages/rcti-api/src/config.ts.
 *
 * RCTI+ hands out signed HLS URLs only to its own web app: the CDN enforces a
 * Referer ACL plus Akamai hdnts/hdntl tokens, and the JSON API requires a
 * client-side visitor JWT (Authorization) and an API key. This app talks to
 * RCTI+ directly (fully local, no proxy), so it needs the exact same
 * constants the server-side proxy uses. Keep every value in sync with
 * packages/rcti-api/src/config.ts.
 */
object Config {

    /* ------------------------------------------------------- RCTI+ constants */
    const val API_BASE = "https://toutatis.rctiplus.com/video/live/api/v1"
    const val SITE_BASE = "https://www.rctiplus.com"
    const val REFERER = "https://www.rctiplus.com/"
    const val ORIGIN = "https://www.rctiplus.com"
    const val API_KEY = "k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0"
    const val USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

    /** Channel slug -> RCTI+ API channel id (config.ts CHANNELS). */
    val CHANNELS = linkedMapOf(
        "rcti" to 1,
        "mnctv" to 2,
        "gtv" to 3,
        "inews" to 4,
    )

    /** Baked reference for deep-history id->date mapping (config.ts historyRef). */
    data class HistoryRef(val id: Int, val date: String)

    val HISTORY_REF = HistoryRef(328842, "2026-08-05")

    /* ------------------------------------------- deep-history tuning (history.ts) */
    const val IDS_PER_DAY = 73
    const val RATE_MAX = 120
    const val MAX_BACK_DAYS = 200
    const val SCAN_BEFORE = 10
    const val SCAN_AFTER = 210
    const val RECENT_DAYS = 30
    val WALK = intArrayOf(
        0, 1, -1, 2, -2, 3, -3, 5, -5, 8, -8, 13, -13, 21, -21,
        34, -34, 55, -55, 89, -89, 144, -144,
    )

    /* ---------------------------------------------------------------- TTLs (ms) */
    const val TTL_LIVE = 5 * 60 * 1000L
    const val TTL_EPG = 5 * 60 * 1000L
    const val TTL_SCHEDULE = 10 * 60 * 1000L
    const val TTL_TOKEN = 15 * 60 * 1000L
    const val TTL_DAY = 10 * 60 * 1000L
    const val TTL_RANGE = 60 * 60 * 1000L
    const val TTL_ANCHOR = 12 * 60 * 60 * 1000L
    const val TTL_BOUNDARY = 10 * 60 * 1000L

    /* ---------------------------------------------------------- timeouts (ms) */
    const val TIMEOUT_API = 15_000
    const val TIMEOUT_CDN = 20_000
    const val TIMEOUT_PAGE = 20_000
    const val TIMEOUT_TOKEN = 10_000
}