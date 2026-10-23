import { Clock, Context, Effect, Layer } from "effect";
import { CONFIG } from "./config.js";
import { Cache } from "./cache.js";
import { ProxyError } from "./errors.js";
import { TokenManager } from "./token.js";

/** Program metadata returned by `/epg/{id}/url` (`data.epg_details`). */
export type EpgDetails = {
  readonly id: number;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly date: string;
  readonly channel: string;
  readonly channel_id: number;
  readonly label?: string;
};

/** A resolved catch-up: the signed VOD master URL plus program details. */
export type ResolvedEpg = {
  readonly url: string;
  readonly details?: EpgDetails;
};

type ApiReply = {
  readonly data?: {
    readonly url?: string;
    readonly epg_details?: EpgDetails;
  };
};

/**
 * RCTI+ JSON API client (`toutatis.rctiplus.com/video/live/api/v1`).
 *
 * Resolves signed master playlist URLs for live channels and catch-up EPG ids.
 * Results are cached because the tokens in them are valid for a few hours.
 */
export class RctiApi extends Context.Service<
  RctiApi,
  {
    resolveMaster(channelId: number): Effect.Effect<string, ProxyError>;
    resolveEpgMaster(epgId: string): Effect.Effect<string, ProxyError>;
    resolveEpg(epgId: string): Effect.Effect<ResolvedEpg, ProxyError>;
    invalidateLive(channelId: number): Effect.Effect<void>;
  }
>()("rctiplus/RctiApi") {
  static readonly layer = Layer.effect(
    RctiApi,
    Effect.gen(function* () {
      const cache = yield* Cache;
      const tokens = yield* TokenManager;

      const apiGet = (path: string): Effect.Effect<ApiReply, ProxyError> =>
        Effect.gen(function* () {
          const headers = yield* tokens.headers();
          const res = yield* Effect.tryPromise({
            try: () =>
              fetch(`${CONFIG.apiBase}${path}`, {
                headers,
                signal: AbortSignal.timeout(CONFIG.timeouts.api),
              }),
            catch: () => ProxyError.from("API unreachable"),
          });
          if (!res.ok) {
            const body = yield* Effect.tryPromise({
              try: () => res.text(),
              catch: () => "",
            }).pipe(Effect.orElseSucceed(() => ""));
            return yield* ProxyError.from(`API ${res.status}: ${body}`, res.status);
          }
          return yield* Effect.tryPromise({
            try: () => res.json() as Promise<ApiReply>,
            catch: () => ProxyError.from("invalid API reply"),
          });
        });

      const resolveMaster = Effect.fnUntraced(function* (channelId: number) {
        const cached = yield* cache.get<string>(`live:${channelId}`, CONFIG.ttl.live);
        if (cached) return cached;

        const json = yield* apiGet(`/live/${channelId}/url?appierid=vlc-proxy`);
        const url = json.data?.url;
        if (!url) return yield* ProxyError.from("no stream url in API reply");

        yield* cache.set(`live:${channelId}`, url);
        return url;
      });

      const resolveEpg = Effect.fnUntraced(function* (epgId: string) {
        const cached = yield* cache.get<ResolvedEpg>(`epg:${epgId}`, CONFIG.ttl.epg);
        if (cached) return cached;

        const json = yield* apiGet(`/epg/${epgId}/url?appierid=vlc-proxy`);
        const url = json.data?.url;
        if (!url) return yield* ProxyError.from("no replay url in API reply");

        const result: ResolvedEpg = { url, details: json.data?.epg_details };
        yield* cache.set(`epg:${epgId}`, result);
        return result;
      });

      const invalidateLive = (channelId: number) => cache.delete(`live:${channelId}`);

      return RctiApi.of({
        resolveMaster,
        resolveEpgMaster: (epgId) => resolveEpg(epgId).pipe(Effect.map((r) => r.url)),
        resolveEpg,
        invalidateLive,
      });
    })
  );
}

/** Current time in epoch milliseconds, from the Effect clock. */
export const nowMillis: Effect.Effect<number> = Clock.currentTimeMillis;
