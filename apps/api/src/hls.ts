import { Context, Effect, Layer } from "effect";
import { CONFIG, type ChannelSlug } from "./config.js";
import { Cache } from "./cache.js";
import { ProxyError } from "./errors.js";
import { RctiApi } from "./rctiplus.js";

/** A body plus headers the router can hand straight to the runtime. */
export type ProxiedBody = {
  body: string | Uint8Array | ReadableStream<Uint8Array> | null;
  headers: Record<string, string>;
  status?: number;
};

/** Optional quality pin for a served master playlist. */
export type QualityFilter =
  | { readonly mode: "best" }
  | { readonly mode: "max-height"; readonly height: number };

type Variant = { inf: string; url: string; height: number };

/** Parse `#EXT-X-STREAM-INF` / URL pairs out of a master playlist. */
export function parseVariants(body: string): Variant[] {
  const lines = body.split("\n");
  const variants: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    const inf = (lines[i] ?? "").trim();
    if (!inf.startsWith("#EXT-X-STREAM-INF:")) continue;
    const url = (lines[i + 1] ?? "").trim();
    if (!url || url.startsWith("#")) continue;
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
    filter.mode === "best" ? variants : variants.filter((v) => v.height <= filter.height);
  if (pool.length === 0) return body;
  const keep = pool.reduce((a, b) => (b.height > a.height ? b : a));
  return ["#EXTM3U", "#EXT-X-VERSION:3", keep.inf, keep.url].join("\n");
}

/** Optional request headers that influence how an asset is served. */
export type AssetRequest = {
  range?: string | null;
  ifNoneMatch?: string | null;
  ifModifiedSince?: string | null;
};

type PlaylistData = {
  body: string;
  lastModified?: string;
  etag?: string;
  cacheControl?: string;
  expires?: string;
};

/** UTF-8 to base64url (URL-safe, no padding). */
export function b64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url to UTF-8. */
export function unb64(input: string): string {
  const binary = atob(input.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Parse a single `Range` header (`bytes=a-b`, `bytes=a-`, `bytes=-n`) against
 * a known size. Returns null for unsatisfiable/unparseable ranges.
 */
export function parseRange(header: string, size: number): [number, number] | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size === 0) return null;
  const [, a, b] = match;
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Number(b);
    if (!Number.isFinite(start) || start < 0 || start >= size) return null;
    if (!Number.isFinite(end) || end < start) return null;
    end = Math.min(end, size - 1);
  }
  return [start, end];
}

/** RFC 7232 conditional check: If-None-Match wins over If-Modified-Since. */
export function isNotModified(
  cond: AssetRequest,
  data: Pick<PlaylistData, "etag" | "lastModified">
): boolean {
  const inm = cond.ifNoneMatch;
  if (inm && data.etag) {
    if (inm === "*") return true;
    return inm.split(",").map((t) => t.trim()).includes(data.etag);
  }
  const ims = cond.ifModifiedSince;
  if (ims && data.lastModified) {
    const t = Date.parse(ims);
    const lm = Date.parse(data.lastModified);
    if (Number.isFinite(t) && Number.isFinite(lm)) {
      return Math.floor(t / 1000) >= Math.floor(lm / 1000);
    }
  }
  return false;
}

/** Channel slug for a CDN host (`rcti-linier...` becomes `rcti`), or null. */
export function channelForHost(hostname: string): ChannelSlug | null {
  const hit = CONFIG.cdnChannelHosts.find(([host]) => hostname.startsWith(host));
  return hit ? hit[1] : null;
}

/**
 * CDN proxy: fetch HLS playlists/segments from `*.rctiplus.id` with the
 * Referer header the CDN ACL demands, and rewrite every inner URL to go
 * through this proxy so VLC (which sends no Referer) can play them.
 */
export class CdnProxy extends Context.Service<
  CdnProxy,
  {
    rewritePlaylist(body: string, baseUrl: string): string;
    serveMaster(
      url: string,
      opts?: { filter?: QualityFilter } & AssetRequest
    ): Effect.Effect<ProxiedBody, ProxyError>;
    handleAsset(url: string, opts?: AssetRequest): Effect.Effect<ProxiedBody, ProxyError>;
    selfHeal(url: string): Effect.Effect<string | null>;
  }
>()("rctiplus/CdnProxy") {
  static readonly layer = Layer.effect(
    CdnProxy,
    Effect.gen(function* () {
      const cache = yield* Cache;
      const api = yield* RctiApi;

      const cdnFetch = (url: string): Effect.Effect<Response, ProxyError> =>
        Effect.tryPromise({
          try: () =>
            fetch(url, {
              headers: {
                Referer: CONFIG.referer,
                Origin: CONFIG.origin,
                "User-Agent": CONFIG.userAgent,
                Accept: "*/*",
              },
              redirect: "follow",
              signal: AbortSignal.timeout(CONFIG.timeouts.cdn),
            }),
          catch: () => ProxyError.from("CDN unreachable"),
        });

      const rewritePlaylist = (body: string, baseUrl: string): string =>
        body
          .split("\n")
          .map((line) => {
            const trimmed = line.trim();
            if (trimmed === "" || trimmed.startsWith("#")) return line;
            return "/h/" + b64(new URL(trimmed, baseUrl).toString());
          })
          .join("\n");

      const playlistHeaders = (data: PlaylistData): Record<string, string> => {
        const headers: Record<string, string> = {
          "Content-Type": "application/vnd.apple.mpegurl",
          "Cache-Control": data.cacheControl ?? "no-cache, max-age=1",
          "Access-Control-Allow-Origin": "*",
        };
        if (data.lastModified) headers["Last-Modified"] = data.lastModified;
        if (data.etag) headers["ETag"] = data.etag;
        if (data.expires) headers["Expires"] = data.expires;
        return headers;
      };

      const readPlaylist = (res: Response, body: string): PlaylistData => ({
        body,
        lastModified: res.headers.get("last-modified") ?? undefined,
        etag: res.headers.get("etag") ?? undefined,
        cacheControl: res.headers.get("cache-control") ?? undefined,
        expires: res.headers.get("expires") ?? undefined,
      });

      const fetchPlaylist = (url: string): Effect.Effect<PlaylistData, ProxyError> =>
        Effect.gen(function* () {
          const hit = yield* cache.get<PlaylistData>(`cdn:${url}`, CONFIG.ttl.playlist);
          if (hit) return hit;

          const res = yield* cdnFetch(url);
          if (!res.ok) return yield* ProxyError.from(`CDN ${res.status}`, res.status);
          const body = yield* Effect.tryPromise({
            try: () => res.text(),
            catch: () => ProxyError.from("CDN body unreadable"),
          });
          if (!body.startsWith("#EXTM3U")) {
            return yield* ProxyError.from("not an HLS playlist");
          }
          const data = readPlaylist(res, body);
          yield* cache.set(`cdn:${url}`, data);
          return data;
        });

      const serveMaster = Effect.fnUntraced(function* (
        url: string,
        opts: { filter?: QualityFilter } & AssetRequest = {}
      ) {
        const data = yield* fetchPlaylist(url);
        const headers = playlistHeaders(data);
        if (isNotModified(opts, data)) return { body: null, headers, status: 304 };

        const body = opts.filter ? filterMaster(data.body, opts.filter) : data.body;
        return { body: rewritePlaylist(body, url), headers } satisfies ProxiedBody;
      });

      const serveRange = (
        buf: Uint8Array,
        base: Record<string, string>,
        range?: string | null
      ): ProxiedBody => {
        const parsed = range ? parseRange(range, buf.length) : null;
        if (parsed) {
          const [start, end] = parsed;
          return {
            body: buf.subarray(start, end + 1),
            headers: {
              ...base,
              "Content-Length": String(end - start + 1),
              "Content-Range": `bytes ${start}-${end}/${buf.length}`,
            },
            status: 206,
          };
        }
        return { body: buf, headers: { ...base, "Content-Length": String(buf.length) } };
      };

      const handleAsset = Effect.fnUntraced(function* (
        url: string,
        opts: AssetRequest = {}
      ) {
        const cached = yield* cache.get<PlaylistData>(`cdn:${url}`, CONFIG.ttl.playlist);
        if (cached) {
          const headers = playlistHeaders(cached);
          if (isNotModified(opts, cached)) return { body: null, headers, status: 304 };
          return { body: rewritePlaylist(cached.body, url), headers } satisfies ProxiedBody;
        }

        const upstream = yield* cdnFetch(url);
        const contentType = upstream.headers.get("content-type") || "application/octet-stream";
        const isPlaylist = /mpegurl|hls/i.test(contentType);

        if (isPlaylist) {
          const body = yield* Effect.tryPromise({
            try: () => upstream.text(),
            catch: () => ProxyError.from("CDN body unreadable"),
          });
          const data = readPlaylist(upstream, body);
          yield* cache.set(`cdn:${url}`, data);
          const headers = playlistHeaders(data);
          if (isNotModified(opts, data)) return { body: null, headers, status: 304 };
          return { body: rewritePlaylist(data.body, url), headers } satisfies ProxiedBody;
        }

        const baseHeaders: Record<string, string> = {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=300",
          "Access-Control-Allow-Origin": "*",
          "Accept-Ranges": "bytes",
        };

        const length = upstream.headers.get("content-length");
        if (!opts.range && upstream.body && length !== null) {
          return {
            body: upstream.body,
            headers: { ...baseHeaders, "Content-Length": length },
          } satisfies ProxiedBody;
        }

        const buffer = yield* Effect.tryPromise({
          try: async () => new Uint8Array(await upstream.arrayBuffer()),
          catch: () => ProxyError.from("CDN body unreadable"),
        });
        if (!buffer.length) return yield* ProxyError.from("empty upstream body");
        return serveRange(buffer, baseHeaders, opts.range);
      });

      const selfHeal = Effect.fnUntraced(function* (url: string) {
        if (!/\/hdntl=/.test(url) || !/\.m3u8/i.test(url)) return null;

        let channel: ChannelSlug = "rcti";
        try {
          channel = channelForHost(new URL(url).hostname) ?? channel;
        } catch {
          channel = "rcti";
        }
        yield* api.invalidateLive(CONFIG.channels[channel]);
        return `/${channel}.m3u8`;
      });

      return CdnProxy.of({ rewritePlaylist, serveMaster, handleAsset, selfHeal });
    })
  );
}
