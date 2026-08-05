import { HttpError } from './rctiplus.js';
import type { ApiClient } from './rctiplus.js';
import type { Cache } from './cache.js';
import type { Config, ChannelSlug } from './config.js';

/** UTF-8 -> base64url (URL-safe, no padding — safe to embed in a path). */
const b64 = (u: string): string => {
  const bytes = new TextEncoder().encode(u);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/** base64url -> UTF-8. */
const unb64 = (s: string): string => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
};

/** A body + headers pair the router can hand straight to Hono. */
export interface ProxiedBody {
  /** null for 304 Not Modified responses. */
  body: string | Uint8Array | ReadableStream<Uint8Array> | null;
  headers: Record<string, string>;
  /** HTTP status (default 200; 206/304 for range/conditional responses). */
  status?: number;
}

/**
 * Optional quality pin for a served master playlist, applied at the proxy so
 * every client (VLC, hls.js, native HLS) uses the same variant — the CDN
 * picks the lowest bitrate when left to client-side ABR.
 */
export type QualityFilter =
  | { mode: 'best' } // single highest-resolution variant
  | { mode: 'max-height'; height: number }; // highest variant at/below height

interface Variant {
  inf: string;
  url: string;
  height: number;
}

/** Parse `#EXT-X-STREAM-INF` / URL pairs out of a master playlist. */
function parseVariants(body: string): Variant[] {
  const lines = body.split('\n');
  const variants: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const inf = (lines[i] ?? '').trim();
    if (!inf.startsWith('#EXT-X-STREAM-INF:')) continue;
    const url = (lines[i + 1] ?? '').trim();
    if (!url || url.startsWith('#')) continue;
    const res = /RESOLUTION=(\d+)x(\d+)/.exec(inf);
    variants.push({ inf, url, height: res ? Number(res[2]) : 0 });
  }
  return variants;
}

/**
 * Reduce a master playlist to a single variant matching the filter. Returns
 * the body unchanged when the playlist has no variants to filter.
 */
export function filterMaster(body: string, filter: QualityFilter): string {
  const variants = parseVariants(body);
  if (variants.length === 0) return body;
  const pool =
    filter.mode === 'best'
      ? variants
      : variants.filter((v) => v.height <= filter.height);
  if (pool.length === 0) return body;
  const keep = pool.reduce((a, b) => (b.height > a.height ? b : a));
  return ['#EXTM3U', '#EXT-X-VERSION:3', keep.inf, keep.url].join('\n');
}

/**
 * CDN proxy: fetch HLS playlists/segments from *.rctiplus.id with the Referer
 * header the CDN's ACL demands, and rewrite every inner URL to go through
 * this proxy so VLC (which sends no Referer) can play them.
 */
/** Optional request headers that influence how an asset is served. */
export interface AssetRequest {
  range?: string | null;
  ifNoneMatch?: string | null;
  ifModifiedSince?: string | null;
}

export interface CdnProxy {
  /** Rewrite every URL line in an HLS playlist to `/h/<b64url>`. */
  rewritePlaylist(body: string, baseUrl: string): string;
  /**
   * Serve a master playlist, rewriting all inner URLs through the proxy.
   * Pass a `filter` to pin the playlist to a single quality variant.
   */
  serveMaster(
    url: string,
    opts?: { filter?: QualityFilter } & AssetRequest,
  ): Promise<ProxiedBody>;
  /**
   * Serve an inner `/h/<b64url>` asset (playlist or TS segment). Conditional
   * headers (`ifNoneMatch`/`ifModifiedSince`) yield 304 for unchanged
   * playlists, and `range` yields 206 for TS segments.
   */
  handleAsset(url: string, opts?: AssetRequest): Promise<ProxiedBody>;
  /**
   * Self-healing on token expiry: return the fresh-master route a dead live
   * playlist should redirect to, or null when the asset is not recoverable.
   */
  selfHeal(url: string): string | null;
}

export function createCdnProxy({
  config,
  api,
  cache,
}: {
  config: Config;
  api: ApiClient;
  cache: Cache;
}): CdnProxy {
  /** Fetch from the CDN with the headers the ACL requires. */
  async function cdnFetch(url: string): Promise<Response> {
    return fetch(url, {
      headers: {
        Referer: config.referer,
        Origin: config.origin,
        'User-Agent': config.userAgent,
        Accept: '*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(config.timeouts.cdn),
    });
  }

  function rewritePlaylist(body: string, baseUrl: string): string {
    return body
      .split('\n')
      .map((line) => {
        const t = line.trim();
        if (t === '' || t.startsWith('#')) return line;
        return '/h/' + b64(new URL(t, baseUrl).toString());
      })
      .join('\n');
  }

  /** Fetch a playlist body, throwing HttpError when it is not one. */
  async function fetchPlaylistText(url: string): Promise<string> {
    const res = await cdnFetch(url);
    if (!res.ok) throw new HttpError(`CDN ${res.status}`, res.status);
    const body = await res.text();
    if (!body.startsWith('#EXTM3U')) throw new HttpError('not an HLS playlist');
    return body;
  }

  /**
   * Fetch a playlist plus its upstream cache metadata.  Live playlists on the
   * CDN slide every few seconds and bump Last-Modified/ETag — native players
   * pace their re-polls on those (and on freshness), so dropping them makes
   * them hammer the same playlist in a tight loop instead of waiting
   * TARGETDURATION.  Mirror the CDN's semantics on the way out.
   *
   * Playlists are cached for ~1s (the CDN's own max-age=1) so even a
   * misbehaving client cannot force more than one upstream fetch per second
   * per playlist.
   */
  interface PlaylistData {
    body: string;
    lastModified?: string;
    etag?: string;
    cacheControl?: string;
    expires?: string;
  }
  const PLAYLIST_TTL_MS = 1000;

  async function fetchPlaylist(url: string): Promise<PlaylistData> {
    const hit = cache.get<PlaylistData>(`cdn:${url}`, PLAYLIST_TTL_MS);
    if (hit) return hit;
    const res = await cdnFetch(url);
    if (!res.ok) throw new HttpError(`CDN ${res.status}`, res.status);
    const body = await res.text();
    if (!body.startsWith('#EXTM3U')) throw new HttpError('not an HLS playlist');
    const data: PlaylistData = {
      body,
      lastModified: res.headers.get('last-modified') ?? undefined,
      etag: res.headers.get('etag') ?? undefined,
      cacheControl: res.headers.get('cache-control') ?? undefined,
      expires: res.headers.get('expires') ?? undefined,
    };
    cache.set(`cdn:${url}`, data);
    return data;
  }

  /**
   * Headers for a media playlist: forward the CDN's cache semantics verbatim
   * (Cache-Control/Expires/ETag/Last-Modified) so native players can pace
   * their re-polls instead of spinning on a no-store response.
   */
  function playlistHeaders(d: PlaylistData): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': d.cacheControl ?? 'no-cache, max-age=1',
      'Access-Control-Allow-Origin': '*',
    };
    if (d.lastModified) headers['Last-Modified'] = d.lastModified;
    if (d.etag) headers['ETag'] = d.etag;
    if (d.expires) headers['Expires'] = d.expires;
    return headers;
  }

  /**
   * RFC 7232 conditional request check: If-None-Match wins over
   * If-Modified-Since.  Returning 304 tells the client the live playlist did
   * not advance — the missing signal that was making native players re-fetch
   * the same playlist in a tight loop.
   */
  function isNotModified(
    cond: AssetRequest,
    d: Pick<PlaylistData, 'etag' | 'lastModified'>,
  ): boolean {
    const inm = cond.ifNoneMatch;
    if (inm && d.etag) {
      if (inm === '*') return true;
      return inm
        .split(',')
        .map((t) => t.trim())
        .includes(d.etag);
    }
    const ims = cond.ifModifiedSince;
    if (ims && d.lastModified) {
      const t = Date.parse(ims);
      const lm = Date.parse(d.lastModified);
      if (Number.isFinite(t) && Number.isFinite(lm)) {
        return Math.floor(t / 1000) >= Math.floor(lm / 1000);
      }
    }
    return false;
  }

  /** Channel slug for a CDN host (rcti-linier... -> rcti), or null. */
  function channelForHost(hostname: string): ChannelSlug | null {
    const hit = config.cdnChannelHosts.find(([h]) => hostname.startsWith(h));
    return hit ? hit[1] : null;
  }

  async function serveMaster(
    url: string,
    opts: { filter?: QualityFilter } & AssetRequest = {},
  ): Promise<ProxiedBody> {
    const data = await fetchPlaylist(url);
    const headers = playlistHeaders(data);
    if (isNotModified(opts, data)) return { body: null, headers, status: 304 };
    const body = opts.filter ? filterMaster(data.body, opts.filter) : data.body;
    return {
      body: rewritePlaylist(body, url),
      headers,
    };
  }

  /**
   * Parse a single `Range` header (`bytes=a-b`, `bytes=a-`, `bytes=-n`)
   * against a known size.  Returns null for unsatisfiable/unparseable ranges.
   */
  function parseRange(header: string, size: number): [number, number] | null {
    const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!m || size === 0) return null;
    const [, a, b] = m;
    let start: number;
    let end: number;
    if (a === '') {
      const suffix = Number(b);
      if (!Number.isFinite(suffix) || suffix <= 0) return null;
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(a);
      end = b === '' ? size - 1 : Number(b);
      if (!Number.isFinite(start) || start < 0 || start >= size) return null;
      if (!Number.isFinite(end) || end < start) return null;
      end = Math.min(end, size - 1);
    }
    return [start, end];
  }

  /** Serve buffered bytes, honoring an optional Range as a 206 response. */
  function serveRange(
    buf: Uint8Array,
    base: Record<string, string>,
    range?: string | null,
  ): ProxiedBody {
    const parsed = range ? parseRange(range, buf.length) : null;
    if (parsed) {
      const [start, end] = parsed;
      return {
        body: buf.subarray(start, end + 1),
        headers: {
          ...base,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${buf.length}`,
        },
        status: 206,
      };
    }
    return {
      body: buf,
      headers: { ...base, 'Content-Length': String(buf.length) },
    };
  }

  async function handleAsset(
    url: string,
    opts: AssetRequest = {},
  ): Promise<ProxiedBody> {
    // Playlist cache hit — serve the cached copy without touching the CDN.
    const cached = cache.get<PlaylistData>(`cdn:${url}`, PLAYLIST_TTL_MS);
    if (cached) {
      const headers = playlistHeaders(cached);
      if (isNotModified(opts, cached)) return { body: null, headers, status: 304 };
      return { body: rewritePlaylist(cached.body, url), headers };
    }

    const upstream = await cdnFetch(url);
    const ctype = upstream.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist = /mpegurl|hls/i.test(ctype);

    if (isPlaylist) {
      const data: PlaylistData = {
        body: await upstream.text(),
        lastModified: upstream.headers.get('last-modified') ?? undefined,
        etag: upstream.headers.get('etag') ?? undefined,
        cacheControl: upstream.headers.get('cache-control') ?? undefined,
        expires: upstream.headers.get('expires') ?? undefined,
      };
      cache.set(`cdn:${url}`, data);
      const headers = playlistHeaders(data);
      if (isNotModified(opts, data)) return { body: null, headers, status: 304 };
      return { body: rewritePlaylist(data.body, url), headers };
    }

    // TS segment.  Serve whole segments as a seekable byte file for native
    // media pipelines (they choke on chunked bodies without Content-Length and
    // expect byte-range support).  But when the client wants the whole segment
    // (hls.js, no Range header) and the CDN gives us a known size, STREAM it
    // through instead of buffering: time-to-first-byte then matches the CDN's
    // instead of waiting for the whole (sometimes slow) segment to download,
    // which is what makes replay "hang at the start" on slower links.
    const len = upstream.headers.get('content-length');
    if (!opts.range && upstream.body && len !== null) {
      const headers: Record<string, string> = {
        'Content-Type': ctype,
        'Content-Length': len,
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      return { body: upstream.body, headers };
    }

    // Range/seek (native players) or unknown size — buffer, then serve 206.
    const buf = new Uint8Array(await upstream.arrayBuffer());
    if (!buf.length) throw new HttpError('empty upstream body');
    const baseHeaders: Record<string, string> = {
      'Content-Type': ctype,
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
    };
    return serveRange(buf, baseHeaders, opts.range);
  }

  function selfHeal(url: string): string | null {
    // hdnts/hdntl tokens expire; a dead live playlist points the player back
    // at a fresh master so it re-resolves with new tokens.  Replays are VOD
    // with long-lived tokens and are never redirected.
    if (!/\/hdntl=/.test(url) || !/\.m3u8/i.test(url)) return null;

    let channel: ChannelSlug = 'rcti';
    try {
      channel = channelForHost(new URL(url).hostname) ?? channel;
    } catch {
      /* unparseable URL — fall back to rcti */
    }
    api.invalidateLive(config.channels[channel]);
    return `/${channel}.m3u8`;
  }

  return { rewritePlaylist, serveMaster, handleAsset, selfHeal };
}

export { b64, unb64 };
