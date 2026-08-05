import { HttpError } from './rctiplus.js';
import type { ApiClient } from './rctiplus.js';
import type { Config, ChannelSlug } from './config.js';

/** UTF-8 -> base64url (URL-safe, no padding — safe to embed in a path). */
const b64 = (u: string): string => Buffer.from(u, 'utf8').toString('base64url');
/** base64url -> UTF-8. */
const unb64 = (s: string): string => Buffer.from(s, 'base64url').toString('utf8');

/** A body + headers pair the router can hand straight to Hono. */
export interface ProxiedBody {
  body: string | ReadableStream<Uint8Array>;
  headers: Record<string, string>;
}

/**
 * CDN proxy: fetch HLS playlists/segments from *.rctiplus.id with the Referer
 * header the CDN's ACL demands, and rewrite every inner URL to go through
 * this proxy so VLC (which sends no Referer) can play them.
 */
export interface CdnProxy {
  /** Rewrite every URL line in an HLS playlist to `/h/<b64url>`. */
  rewritePlaylist(body: string, baseUrl: string): string;
  /** Serve a master playlist, rewriting all inner URLs through the proxy. */
  serveMaster(url: string): Promise<ProxiedBody>;
  /** Serve an inner `/h/<b64url>` asset (playlist or TS segment). */
  handleAsset(url: string): Promise<ProxiedBody>;
  /**
   * Self-healing on token expiry: return the fresh-master route a dead live
   * playlist should redirect to, or null when the asset is not recoverable.
   */
  selfHeal(url: string): string | null;
}

export function createCdnProxy({
  config,
  api,
}: {
  config: Config;
  api: ApiClient;
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

  /** Channel slug for a CDN host (rcti-linier... -> rcti), or null. */
  function channelForHost(hostname: string): ChannelSlug | null {
    const hit = config.cdnChannelHosts.find(([h]) => hostname.startsWith(h));
    return hit ? hit[1] : null;
  }

  async function serveMaster(url: string): Promise<ProxiedBody> {
    const body = await fetchPlaylistText(url);
    return {
      body: rewritePlaylist(body, url),
      headers: {
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    };
  }

  async function handleAsset(url: string): Promise<ProxiedBody> {
    const upstream = await cdnFetch(url);
    const ctype = upstream.headers.get('content-type') || 'application/octet-stream';
    const isPlaylist = /mpegurl|hls/i.test(ctype);

    if (isPlaylist) {
      return {
        body: rewritePlaylist(await upstream.text(), url),
        headers: {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
          'Access-Control-Allow-Origin': '*',
        },
      };
    }

    // TS segment — stream bytes through.
    const stream = upstream.body;
    if (!stream) throw new HttpError('empty upstream body');
    return {
      body: stream,
      headers: {
        'Content-Type': ctype,
        'Cache-Control': 'public, max-age=300',
        'Access-Control-Allow-Origin': '*',
      },
    };
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
