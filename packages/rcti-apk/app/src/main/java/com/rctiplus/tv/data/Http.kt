package com.rctiplus.tv.data

import java.net.HttpURLConnection
import java.net.URL

/** Blocking HTTP GET helper (java.net, no extra deps). */
object Http {

    class Response(val status: Int, val body: String)

    fun get(url: String, headers: Map<String, String>, timeoutMs: Int): Response {
        val conn = URL(url).openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = timeoutMs
            conn.readTimeout = timeoutMs
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("Accept", "*/*")
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            val status = conn.responseCode
            val body = if (status in 200..299) {
                conn.inputStream.bufferedReader().use { it.readText() }
            } else {
                conn.errorStream?.bufferedReader()?.use { it.readText() } ?: ""
            }
            return Response(status, body)
        } finally {
            conn.disconnect()
        }
    }
}