package com.rctiplus.tv.data

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One catch-up program scraped from the desktop TV page (schedule.ts). */
data class ScheduleItem(
    val epgId: Long,
    val slug: String,
    val date: String,
    val title: String,
    val start: String,
    val end: String,
)

/**
 * 7-day catch-up schedule scraper — mirror of packages/api/src/schedule.ts.
 *
 * The desktop TV page renders the full catch-up window server-side; each
 * program is an anchor with an `onclick="...; clickCatchup('...')"` handler.
 * The official ajax endpoint (`live-getcatchup`) returns empty when called
 * externally, so we parse the server-rendered page instead (stable).
 */
object ScheduleScraper {

    /** capture groups: (channel, epg_id, slug, date, title, start, end) */
    private val SCHEDULE_RE = Regex(
        """clickCatchup\(\s*'https://www\.rctiplus\.com/tv/(rcti|mnctv|gtv|inews)/(\d+)/([a-z0-9-]+)\?date=([0-9-]+)'[^>]*>\s*<h2>\s*([^<]+?)\s*</h2>\s*<br>\s*<h4>\s*([0-9:]+)\s*-\s*([0-9:]+)\s*</h4>""",
        RegexOption.DOT_MATCHES_ALL,
    )

    /** Decode the handful of HTML entities RCTI+ pages use in titles. */
    private val ENTITIES = mapOf(
        "amp" to "&",
        "lt" to "<",
        "gt" to ">",
        "quot" to "\"",
        "apos" to "'",
        "nbsp" to " ",
    )

    private fun decodeEntities(s: String): String {
        val out = StringBuilder()
        var i = 0
        while (i < s.length) {
            val amp = s.indexOf('&', i)
            if (amp < 0) {
                out.append(s, i, s.length)
                break
            }
            out.append(s, i, amp)
            val semi = s.indexOf(';', amp)
            if (semi < 0) {
                out.append(s, amp, s.length)
                break
            }
            val ent = s.substring(amp + 1, semi)
            val decoded = when {
                ent.startsWith("#x", ignoreCase = true) ->
                    ent.substring(2).toIntOrNull(16)?.let { String(Character.toChars(it)) }
                ent.startsWith("#") ->
                    ent.substring(1).toIntOrNull()?.let { String(Character.toChars(it)) }
                else -> ENTITIES[ent.lowercase()]
            }
            if (decoded != null) out.append(decoded) else out.append(s, amp, semi + 1)
            i = semi + 1
        }
        return out.toString()
    }

    /** 7-day catch-up list for one channel (scraped, cached 10 min). */
    suspend fun fetchSchedule(channel: String): List<ScheduleItem> = withContext(Dispatchers.IO) {
        val key = "schedule:$channel"
        TtlCache.get<List<ScheduleItem>>(key, Config.TTL_SCHEDULE)?.let { return@withContext it }

        val res = Http.get(
            "${Config.SITE_BASE}/tv/$channel",
            mapOf("User-Agent" to Config.USER_AGENT, "Referer" to Config.REFERER),
            Config.TIMEOUT_PAGE,
        )
        if (res.status !in 200..299) throw IOException("schedule page ${res.status}")

        val items = mutableListOf<ScheduleItem>()
        for (m in SCHEDULE_RE.findAll(res.body)) {
            val g = m.groupValues
            if (g.size < 8) continue
            if (g[1] != channel) continue
            items += ScheduleItem(
                epgId = g[2].toLong(),
                slug = g[3],
                date = g[4],
                title = decodeEntities(g[5].trim()),
                start = g[6],
                end = g[7],
            )
        }
        TtlCache.set(key, items)
        items
    }
}