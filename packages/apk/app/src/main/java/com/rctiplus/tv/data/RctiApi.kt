package com.rctiplus.tv.data

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Program metadata returned by `/epg/{id}/url` (`data.epg_details`). */
data class EpgDetails(
    val id: Long,
    val title: String,
    val start: String,
    val end: String,
    val date: String,
    val channel: String,
)

/** A resolved catch-up: the signed VOD master URL plus program details. */
data class ResolvedEpg(
    val url: String,
    val details: EpgDetails? = null,
)

/**
 * RCTI+ JSON API client (toutatis.rctiplus.com/video/live/api/v1) — mirror of
 * packages/api/src/rctiplus.ts. Resolves signed master playlist URLs.
 * Results are cached because the tokens in them are only valid for a few
 * hours and re-resolving on every playback is wasteful.
 */
object RctiApi {

    /** Signed live master URL for a channel id (1=RCTI, 2=MNCTV, 3=GTV, 4=iNews). */
    suspend fun resolveMaster(channelId: Int): String = withContext(Dispatchers.IO) {
        val key = "live:$channelId"
        TtlCache.get<String>(key, Config.TTL_LIVE)?.let { return@withContext it }
        val json = apiGet("/live/$channelId/url?appierid=vlc-proxy")
        val url = json.optJSONObject("data")?.optString("url")
            .takeUnless { it.isNullOrEmpty() }
            ?: throw IOException("no stream url in API reply")
        TtlCache.set(key, url)
        url
    }

    /** Resolve a catch-up EPG id to its signed VOD URL plus program details. */
    suspend fun resolveEpg(epgId: String): ResolvedEpg = withContext(Dispatchers.IO) {
        val key = "epg:$epgId"
        TtlCache.get<ResolvedEpg>(key, Config.TTL_EPG)?.let { return@withContext it }
        val json = apiGet("/epg/$epgId/url?appierid=vlc-proxy")
        val data = json.optJSONObject("data")
            ?: throw IOException("no replay url in API reply")
        val url = data.optString("url")
            .takeUnless { it.isEmpty() }
            ?: throw IOException("no replay url in API reply")
        val d = data.optJSONObject("epg_details")
        val result = ResolvedEpg(
            url = url,
            details = d?.let {
                EpgDetails(
                    id = it.optLong("id"),
                    title = it.optString("title"),
                    start = it.optString("start"),
                    end = it.optString("end"),
                    date = it.optString("date"),
                    channel = it.optString("channel"),
                )
            },
        )
        TtlCache.set(key, result)
        result
    }

    /** Drop the cached live URL so the next request re-resolves fresh tokens. */
    fun invalidateLive(channelId: Int) = TtlCache.delete("live:$channelId")

    /** Drop the cached EPG URL so the next request re-resolves fresh tokens. */
    fun invalidateEpg(epgId: String) = TtlCache.delete("epg:$epgId")

    private fun apiGet(path: String): JSONObject {
        val res = Http.get("${Config.API_BASE}$path", TokenManager.headers(), Config.TIMEOUT_API)
        if (res.status !in 200..299) {
            throw IOException("API ${res.status}: ${res.body}")
        }
        return JSONObject(res.body)
    }
}