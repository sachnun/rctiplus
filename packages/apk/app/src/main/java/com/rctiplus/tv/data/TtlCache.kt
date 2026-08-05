package com.rctiplus.tv.data

import java.util.concurrent.ConcurrentHashMap

/**
 * Minimal TTL cache — mirror of packages/api/src/cache.ts.
 * Entries expire once `now - at` exceeds the caller-supplied TTL.
 * Keys are plain strings (`live:1`, `epg:328332`, `schedule:rcti`, ...).
 */
object TtlCache {

    private data class Entry(val value: Any?, val at: Long)

    private val store = ConcurrentHashMap<String, Entry>()

    /** Return the cached value if it is newer than `ttlMs`, else null. */
    @Suppress("UNCHECKED_CAST")
    fun <T> get(key: String, ttlMs: Long): T? {
        val hit = store[key] ?: return null
        if (System.currentTimeMillis() - hit.at < ttlMs) return hit.value as T
        store.remove(key)
        return null
    }

    fun set(key: String, value: Any?) {
        store[key] = Entry(value, System.currentTimeMillis())
    }

    fun delete(key: String) {
        store.remove(key)
    }
}