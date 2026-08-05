package com.rctiplus.tv.data

/** One TV channel (slug matches the proxy's `/channels` and HLS routes). */
data class Channel(val slug: String, val name: String)

/** A catch-up program from the schedule or deep-history feed. */
data class ReplayItem(
    val epgId: Long,
    val title: String,
    val date: String,
    val start: String,
    val end: String,
    val playable: Boolean = true,
)

/** Result of one `/history/prev` page (next older playable day). */
data class PrevResult(
    val date: String?,
    val end: Boolean,
    val items: List<ReplayItem>,
)