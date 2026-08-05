package com.rctiplus.tv.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Base URL of the deployed RCTI+ proxy (Cloudflare Worker). Everything — JSON
 * endpoints, live HLS, replay HLS — is served from this single HTTPS origin,
 * so the app needs no local proxy setup and no cleartext-HTTP allowance.
 */
const val BASE_URL = "https://rcti-plus.sachnun.workers.dev"

/** Minimal JSON client for the proxy's public endpoints (org.json, no deps). */
object Api {

    /** Static channel list — mirrors the proxy's `/channels` response. */
    fun channels(): List<Channel> = listOf(
        Channel("rcti", "RCTI"),
        Channel("mnctv", "MNCTV"),
        Channel("gtv", "GTV"),
        Channel("inews", "iNews"),
    )

    /** 7-day catch-up list for one channel. */
    suspend fun schedule(channel: String): List<ReplayItem> = withContext(Dispatchers.IO) {
        parseItems(getJson("/schedule?channel=$channel"))
    }

    /** Next older playable day (infinite-scroll paging; all channels by default). */
    suspend fun historyPrev(before: String, channel: String? = null): PrevResult =
        withContext(Dispatchers.IO) {
            val path = buildString {
                append("/history/prev?before=").append(before)
                if (channel != null) append("&channel=").append(channel)
            }
            val obj = getJson(path)
            PrevResult(
                date = obj.optString("date").takeUnless { it.isEmpty() || it == "null" },
                end = obj.optBoolean("end", false),
                items = parseItems(obj),
            )
        }

    /** Live master, quality pinned to the best variant server-side. */
    fun liveUrl(channel: String) = "$BASE_URL/$channel.m3u8?quality=best"

    /** Catch-up (VOD) master for one program — always the highest variant. */
    fun replayUrl(epgId: Long) = "$BASE_URL/replay/$epgId.m3u8?quality=best"

    private fun parseItems(obj: JSONObject): List<ReplayItem> {
        val arr = obj.getJSONArray("items")
        return List(arr.length()) { i ->
            val it = arr.getJSONObject(i)
            ReplayItem(
                epgId = it.getLong("epg_id"),
                title = it.getString("title"),
                date = it.getString("date"),
                start = it.getString("start"),
                end = it.getString("end"),
                playable = it.optBoolean("playable", true),
            )
        }
    }

    private fun getJson(path: String): JSONObject {
        val conn = URL(BASE_URL + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        conn.setRequestProperty("Accept", "application/json")
        return try {
            if (conn.responseCode !in 200..299) {
                throw IOException("HTTP ${conn.responseCode} for $path")
            }
            val body = conn.inputStream.bufferedReader().use { it.readText() }
            JSONObject(body)
        } finally {
            conn.disconnect()
        }
    }
}