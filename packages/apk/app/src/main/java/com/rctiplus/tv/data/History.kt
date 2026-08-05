package com.rctiplus.tv.data

import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** One playable-or-not program found for a date (history.ts DayItem). */
data class DayItem(
    val epgId: Long,
    val title: String,
    val start: String,
    val end: String,
    val channel: String,
    val date: String,
    val playable: Boolean,
)

/** Result of walking one step further back in time (history.ts PrevResult). */
data class HistoryPrev(
    val date: String?,
    val earliest: String,
    val items: List<DayItem>,
    val end: Boolean,
)

/**
 * Deep catch-up history discovery — mirror of packages/api/src/history.ts.
 *
 * The desktop TV page only renders a 7-day catch-up list, but the VOD files
 * on `past-event.rctiplus.id` are kept for ~4 months. EPG ids are shared
 * across all 4 channels and advance roughly monotonically with time
 * (~73 ids/day), so an unknown older program can be *found* by scanning the
 * id space:
 *
 *   1. anchor the newest known id (from the schedule scrape),
 *   2. binary-search the id range to locate the target date's boundary id,
 *   3. scan the ids around it, keep those whose `epg_details.date` matches,
 *   4. verify each master still plays on the CDN near the retention edge.
 *
 * Results are cached per (date, channel); the CDN check is what separates
 * "URL still resolvable" from "actually playable".
 */
object History {

    private data class Anchor(val id: Int, val date: String)

    private val DATE_RE = Regex("""\d{4}-\d{2}-\d{2}""")

    /** Thread-safe UTC date parser (SimpleDateFormat is not thread-safe). */
    private val DATE_FMT = object : ThreadLocal<SimpleDateFormat>() {
        override fun initialValue(): SimpleDateFormat =
            SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
            }
    }

    private fun parseDate(s: String): Long = DATE_FMT.get().parse(s)!!.time

    private fun todayLocal(): String {
        val cal = Calendar.getInstance()
        return "%04d-%02d-%02d".format(
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH) + 1,
            cal.get(Calendar.DAY_OF_MONTH),
        )
    }

    private fun daysBetween(a: String, b: String): Long =
        Math.round((parseDate(b) - parseDate(a)) / 86400000.0)

    private fun addDays(date: String, n: Long): String {
        val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply {
            timeInMillis = parseDate(date) + n * 86400000L
        }
        return "%04d-%02d-%02d".format(
            cal.get(Calendar.YEAR),
            cal.get(Calendar.MONTH) + 1,
            cal.get(Calendar.DAY_OF_MONTH),
        )
    }

    /** Newest known (id, date) pair: schedule scrape, else extrapolated ref. */
    private suspend fun getAnchor(): Anchor {
        TtlCache.get<Anchor>("history:anchor", Config.TTL_ANCHOR)?.let { return it }
        try {
            val sched = ScheduleScraper.fetchSchedule("rcti")
            var maxId = -1
            var maxDate = ""
            for (it in sched) {
                if (it.epgId > maxId) {
                    maxId = it.epgId.toInt()
                    maxDate = it.date
                }
            }
            if (maxId > 0 && maxDate.isNotEmpty()) {
                val anchor = Anchor(maxId, maxDate)
                TtlCache.set("history:anchor", anchor)
                return anchor
            }
        } catch (_: Exception) {
            // schedule unreachable — fall through to the baked reference
        }
        val days = maxOf(0L, daysBetween(Config.HISTORY_REF.date, todayLocal()))
        return Anchor(Config.HISTORY_REF.id + (days * Config.IDS_PER_DAY).toInt(), todayLocal())
    }

    /** Resolve an id, walking across dead gaps to the nearest live program. */
    private suspend fun probeNear(id: Int): ResolvedEpg? {
        for (off in Config.WALK) {
            val cand = id + off
            if (cand < 0) continue
            try {
                val r = RctiApi.resolveEpg(cand.toString())
                if (r.details != null) return r
            } catch (_: Exception) {
                // non-catchup slot (ads, pruned program) — keep walking
            }
        }
        return null
    }

    /**
     * Binary-search for the first id whose program date is on/after `date`
     * (mirrors history.ts locateBoundary).
     */
    private suspend fun locateBoundary(anchor: Anchor, date: String): Int {
        val key = "boundary:$date"
        TtlCache.get<Int>(key, Config.TTL_BOUNDARY)?.let { return it }
        val age = daysBetween(date, anchor.date)
        var lo = maxOf(
            anchor.id - Config.MAX_BACK_DAYS * Config.RATE_MAX,
            anchor.id - (age * Config.RATE_MAX).toInt() - Config.IDS_PER_DAY,
        )
        var hi = anchor.id
        while (lo < hi) {
            val mid = (lo + hi) / 2
            val info = probeNear(mid)
            if (info == null) {
                lo = mid + 1 // gap wider than WALK (rare) — step past it
                continue
            }
            if ((info.details?.date ?: "").compareTo(date) < 0) lo = mid + 1 else hi = mid
        }
        TtlCache.set(key, lo)
        return lo
    }

    /** Programs for one calendar date, optionally filtered by channel. */
    suspend fun fetchDay(date: String, channel: String?): List<DayItem> {
        if (!DATE_RE.matches(date)) throw IOException("invalid date, use YYYY-MM-DD")
        val cacheKey = "day:$date:${channel ?: "all"}"
        TtlCache.get<List<DayItem>>(cacheKey, Config.TTL_DAY)?.let { return it }

        val anchor = getAnchor()
        if (date.compareTo(anchor.date) > 0) throw IOException("date $date is in the future")
        val age = daysBetween(date, anchor.date) // positive for past dates
        if (age > Config.MAX_BACK_DAYS) {
            TtlCache.set(cacheKey, emptyList<DayItem>())
            return emptyList()
        }

        // Fast path: dates inside the 7-day schedule window need no id-space
        // scan (the schedule scrape already lists them, per channel) and are
        // well inside CDN retention, so no per-item CDN probe either.
        if (channel != null && age <= 6) {
            val sched = ScheduleScraper.fetchSchedule(channel)
            val fast = sched.filter { it.date == date }
                .map { it ->
                    DayItem(it.epgId, it.title, it.start, it.end, channel, date, playable = true)
                }
                .sortedWith(compareBy({ it.start }, { it.epgId }))
            TtlCache.set(cacheKey, fast)
            return fast
        }

        val boundary = locateBoundary(anchor, date)
        val ids = (boundary - Config.SCAN_BEFORE..boundary + Config.SCAN_AFTER).toList()
        val resolved = mapLimit(ids, 16) { id ->
            try {
                RctiApi.resolveEpg(id.toString())
            } catch (_: Exception) {
                null
            }
        }
        val candidates = resolved.filterNotNull().filter { r ->
            r.details?.date == date && (channel == null || r.details.channel == channel)
        }

        // Days well inside the CDN retention window are trusted once the id
        // resolves. Only days near the retention edge are CDN-verified.
        val verifyCdn = age > Config.RECENT_DAYS
        val items = mapLimit(candidates, 8) { r ->
            val d = r.details!!
            DayItem(
                epgId = d.id,
                title = d.title,
                start = d.start,
                end = d.end,
                channel = d.channel,
                date = d.date,
                playable = if (verifyCdn) Hls.verifyMaster(r.url) else true,
            )
        }.sortedWith(compareBy({ it.start }, { it.epgId }))

        TtlCache.set(cacheKey, items)
        return items
    }

    /** Earliest playable date overall — the hard stop for the scroll walk. */
    private suspend fun fetchEarliest(): String {
        TtlCache.get<String>("history:earliest", Config.TTL_RANGE)?.let { return it }
        val anchor = getAnchor()

        suspend fun isPlayable(daysAgo: Long): Boolean {
            val mid = anchor.id - (daysAgo * Config.IDS_PER_DAY).toInt() - Config.IDS_PER_DAY / 2
            for (off in intArrayOf(-35, 0, 35)) {
                val info = probeNear(mid + off)
                if (info != null && Hls.verifyMaster(info.url)) return true
            }
            return false
        }

        // Binary-search the largest daysAgo with playable content (CDN retention).
        var lo = 1
        var hi = Config.MAX_BACK_DAYS
        var lastPlayable = 1
        while (lo <= hi) {
            val mid = (lo + hi) / 2
            if (isPlayable(mid.toLong())) {
                lastPlayable = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        val earliest = addDays(anchor.date, -lastPlayable.toLong())
        TtlCache.set("history:earliest", earliest)
        return earliest
    }

    /** The nearest playable day strictly before `before`, for infinite scroll. */
    suspend fun fetchPrev(before: String, channel: String?): HistoryPrev {
        val anchor = getAnchor()
        if (before.compareTo(anchor.date) > 0) {
            throw IOException("date $before is after the newest program")
        }
        val earliest = fetchEarliest()

        var date = addDays(before, -1)
        while (date.compareTo(earliest) >= 0) {
            val day = fetchDay(date, channel)
            if (day.any { it.playable }) {
                return HistoryPrev(date, earliest, day, end = false)
            }
            date = addDays(date, -1)
        }
        return HistoryPrev(null, earliest, emptyList(), end = true)
    }

    /**
     * Concurrent map with a cap on in-flight work: N workers each grab the
     * next index, so concurrency is bounded by `limit`.
     */
    private suspend fun <T, R> mapLimit(
        items: List<T>,
        limit: Int,
        fn: suspend (T) -> R,
    ): List<R> = coroutineScope {
        val out = arrayOfNulls<Any?>(items.size)
        val next = AtomicInteger(0)
        val workers = List(limit.coerceAtMost(items.size)) {
            launch(Dispatchers.IO) {
                while (true) {
                    val i = next.getAndIncrement()
                    if (i >= items.size) break
                    out[i] = fn(items[i])
                }
            }
        }
        workers.forEach { it.join() }
        @Suppress("UNCHECKED_CAST")
        out.map { it as R }
    }
}