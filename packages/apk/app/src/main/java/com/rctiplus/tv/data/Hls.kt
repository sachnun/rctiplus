package com.rctiplus.tv.data

import java.io.IOException
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * HLS helpers — mirror of packages/api/src/hls.ts.
 *
 * The CDN picks the lowest bitrate when left to client-side ABR, so we pin
 * the best variant here. ExoPlayer then plays the chosen media playlist
 * directly and fetches segments itself — no URL rewriting is needed because
 * it sends the Referer header on every request.
 */
object Hls {

    private data class Variant(val inf: String, val url: String, val height: Int)

    /** Parse `#EXT-X-STREAM-INF` / URL pairs out of a master playlist. */
    private fun parseVariants(body: String): List<Variant> {
        val lines = body.split('\n')
        val variants = mutableListOf<Variant>()
        var i = 0
        while (i < lines.size) {
            val inf = lines[i].trim()
            if (!inf.startsWith("#EXT-X-STREAM-INF:")) {
                i++
                continue
            }
            val url = lines.getOrNull(i + 1)?.trim().orEmpty()
            if (url.isEmpty() || url.startsWith("#")) {
                i++
                continue
            }
            val res = Regex("""RESOLUTION=(\d+)x(\d+)""").find(inf)
            variants += Variant(inf, url, if (res != null) res.groupValues[2].toInt() else 0)
            i += 2
        }
        return variants
    }

    /**
     * Reduce a signed master URL to its highest-resolution variant's media
     * playlist URL (absolute). Returns the master URL unchanged when it has
     * no variants to filter.
     */
    suspend fun bestVariant(masterUrl: String): String = withContext(Dispatchers.IO) {
        val res = Http.get(
            masterUrl,
            mapOf(
                "Referer" to Config.REFERER,
                "Origin" to Config.ORIGIN,
                "User-Agent" to Config.USER_AGENT,
            ),
            Config.TIMEOUT_CDN,
        )
        if (res.status !in 200..299) throw IOException("CDN ${res.status} for master")
        val variants = parseVariants(res.body)
        if (variants.isEmpty()) return@withContext masterUrl
        val best = variants.maxByOrNull { it.height }!!
        return@withContext try {
            URL(URL(masterUrl), best.url).toString()
        } catch (_: Exception) {
            best.url
        }
    }

    /**
     * True when the CDN still serves a master playlist for a VOD URL
     * (history.ts verifyMaster).
     */
    suspend fun verifyMaster(url: String): Boolean = withContext(Dispatchers.IO) {
        try {
            val res = Http.get(
                url,
                mapOf(
                    "Referer" to Config.REFERER,
                    "Origin" to Config.ORIGIN,
                    "User-Agent" to Config.USER_AGENT,
                ),
                Config.TIMEOUT_CDN,
            )
            res.status in 200..299 && res.body.startsWith("#EXTM3U")
        } catch (_: Exception) {
            false
        }
    }
}