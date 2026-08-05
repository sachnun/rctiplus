package com.rctiplus.tv.data

import java.io.IOException

/**
 * Anonymous visitor JWT manager — mirror of packages/rcti-api/src/token.ts,
 * minus the baked fallback token (no hardcoded credential in the APK).
 *
 * Every JSON API call must carry `Authorization: <visitor JWT>` plus the
 * `apikey` header. The web app embeds a fresh token in every page render
 * (`var visitorsToken = "..."`); we extract it here and cache it. When the
 * page is unreachable or changes shape we keep the last extracted token;
 * if we never obtained one the call fails.
 */
object TokenManager {

    private val TOKEN_RE = Regex("""visitorsToken\s*=\s*"([^"]+)"""")

    @Volatile private var token: String? = null
    private var tokenAt = 0L

    /** Return the current token, refreshing it from the live page if stale. */
    @Synchronized
    fun get(): String {
        val now = System.currentTimeMillis()
        token?.let { t ->
            if (now - tokenAt < Config.TTL_TOKEN) return t
        }
        try {
            val res = Http.get(
                "${Config.SITE_BASE}/tv/rcti",
                mapOf("User-Agent" to Config.USER_AGENT),
                Config.TIMEOUT_TOKEN,
            )
            if (res.status !in 200..299) {
                throw IOException("token page ${res.status}")
            }
            val fresh = TOKEN_RE.find(res.body)?.groupValues?.get(1)
            if (fresh != null && fresh.length > 100) {
                token = fresh
                tokenAt = now
            }
        } catch (_: Exception) {
            // Page unreachable or changed shape — keep the last token.
        }
        return token ?: throw IOException("no visitor token available")
    }

    /** Headers shared by every RCTI+ API request. */
    fun headers(): Map<String, String> = mapOf(
        "Authorization" to get(),
        "apikey" to Config.API_KEY,
        "Origin" to Config.ORIGIN,
        "Referer" to Config.REFERER,
        "User-Agent" to Config.USER_AGENT,
    )
}