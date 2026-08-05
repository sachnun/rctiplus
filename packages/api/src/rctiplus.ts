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
  /**
   * Resolve a catch-up EPG id to its signed VOD URL plus the program details
   * the API returns alongside it (date/channel/title/start/end).  Cached with
   * the URL so the deep-history scanner never re-hits the API for the same id.
   */
  resolveEpg(epgId: string): Promise<ResolvedEpg>;
  /** Drop the cached live URL so the next request re-resolves fresh tokens. */
  invalidateLive(channelId: ChannelId): void;
}

/** Program metadata returned by `/epg/{id}/url` (`data.epg_details`). */
export interface EpgDetails {
  id: number;
  title: string;
  start: string;
  end: string;
  date: string;
  channel: string;
  channel_id: number;
  label?: string;
}

/** A resolved catch-up: the signed VOD master URL plus program details. */
export interface ResolvedEpg {
  url: string;
  details?: EpgDetails;
}

/** The subset of the API reply the proxy consumes. */
interface ApiReply {
  data?: {
    url?: string;
    epg_details?: EpgDetails;
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

  async function resolveEpg(epgId: string): Promise<ResolvedEpg> {
    const cached = cache.get<ResolvedEpg>(`epg:${epgId}`, config.ttl.epg);
    if (cached) return cached;

    const json = await apiGet(`/epg/${epgId}/url?appierid=vlc-proxy`);
    if (!json.data?.url) throw new HttpError('no replay url in API reply');
    const result: ResolvedEpg = { url: json.data.url, details: json.data.epg_details };
    cache.set(`epg:${epgId}`, result);
    return result;
  }

  async function resolveEpgMaster(epgId: string): Promise<string> {
    return (await resolveEpg(epgId)).url;
  }

  function invalidateLive(channelId: ChannelId): void {
    cache.delete(`live:${channelId}`);
  }

  return { resolveMaster, resolveEpgMaster, resolveEpg, invalidateLive };
}
