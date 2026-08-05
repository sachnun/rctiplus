import type { Config, ChannelId } from './config.js';
import type { Cache } from './cache.js';
import type { TokenManager } from './token.js';

/**
 * Error carrying an optional HTTP status for the Hono error handler.
 * Callers throw this with `status` set (403 from the CDN, 404, ...); the
 * router maps it onto the client response.
 */
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

/**
 * RCTI+ JSON API client (toutatis.rctiplus.com/video/live/api/v1).
 *
 * Resolves the signed master playlist URL for a live channel or a catch-up
 * (replay) EPG id.  Results are cached because the tokens in them are only
 * valid for a few hours and re-resolving on every VLC open is wasteful.
 */
export interface ApiClient {
  /** Signed live master URL for a channel id (1=RCTI, 2=MNCTV, 3=GTV, 4=iNews). */
  resolveMaster(channelId: ChannelId): Promise<string>;
  /** Signed replay master URL for a catch-up EPG id. */
  resolveEpgMaster(epgId: string): Promise<string>;
  /** Drop the cached live URL so the next request re-resolves fresh tokens. */
  invalidateLive(channelId: ChannelId): void;
}

/** The subset of the API reply the proxy consumes. */
interface ApiReply {
  data?: {
    url?: string;
  };
}

export function createApiClient({
  config,
  cache,
  tokenManager,
}: {
  config: Config;
  cache: Cache;
  tokenManager: TokenManager;
}): ApiClient {
  async function apiGet(path: string): Promise<ApiReply> {
    const res = await fetch(`${config.apiBase}${path}`, {
      headers: await tokenManager.headers(),
      signal: AbortSignal.timeout(config.timeouts.api),
    });
    if (!res.ok) {
      throw new HttpError(`API ${res.status}: ${await res.text()}`, res.status);
    }
    return res.json() as Promise<ApiReply>;
  }

  async function resolveMaster(channelId: ChannelId): Promise<string> {
    const cached = cache.get<string>(`live:${channelId}`, config.ttl.live);
    if (cached) return cached;

    const json = await apiGet(`/live/${channelId}/url?appierid=vlc-proxy`);
    if (!json.data?.url) throw new HttpError('no stream url in API reply');
    cache.set(`live:${channelId}`, json.data.url);
    return json.data.url;
  }

  async function resolveEpgMaster(epgId: string): Promise<string> {
    const cached = cache.get<string>(`epg:${epgId}`, config.ttl.epg);
    if (cached) return cached;

    const json = await apiGet(`/epg/${epgId}/url?appierid=vlc-proxy`);
    if (!json.data?.url) throw new HttpError('no replay url in API reply');
    cache.set(`epg:${epgId}`, json.data.url);
    return json.data.url;
  }

  function invalidateLive(channelId: ChannelId): void {
    cache.delete(`live:${channelId}`);
  }

  return { resolveMaster, resolveEpgMaster, invalidateLive };
}
