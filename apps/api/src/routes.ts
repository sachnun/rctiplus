import { Context, Effect, Layer } from "effect";
import { CONFIG } from "./config.js";
import { ProxyError } from "./errors.js";
import { CdnProxy, type ProxiedBody, type QualityFilter, unb64 } from "./hls.js";
import { RctiApi } from "./rctiplus.js";
import { ScheduleService } from "./schedule.js";
import { HistoryService } from "./history.js";

export type AssetRequest = {
  range?: string | null;
  ifNoneMatch?: string | null;
  ifModifiedSince?: string | null;
};

/** Displayed channels (first slug per channel id, dedupes the gtv alias). */
export function playerChannels(): string[] {
  const seen = new Set<number>();
  const out: string[] = [];
  for (const [slug, id] of Object.entries(CONFIG.channels)) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(slug);
  }
  return out;
}

/** Validate a channel slug and return its API id, or undefined if unknown. */
export function channelId(slug: string): number | undefined {
  return CONFIG.channels[slug.toLowerCase() as keyof typeof CONFIG.channels];
}

/**
 * Map a `?quality=` value to a proxy-side variant filter. `auto`/absent keeps
 * the full master; `best` pins the highest variant; a number keeps the highest
 * variant at or below that height.
 */
export function qualityFilter(quality: string | undefined): QualityFilter | undefined {
  if (!quality || quality === "auto") return undefined;
  if (quality === "best") return { mode: "best" };
  const height = Number(quality);
  if (Number.isFinite(height) && height > 0) return { mode: "max-height", height };
  return undefined;
}

/** HTTP surface of the proxy, independent of the server runtime. */
export class Routes extends Context.Service<
  Routes,
  {
    channels: Effect.Effect<{ channels: ReadonlyArray<string> }>;
    schedule(channel: string): Effect.Effect<unknown, ProxyError>;
    historyDay(date: string, channel?: string): Effect.Effect<unknown, ProxyError>;
    historyPrev(before: string, channel?: string): Effect.Effect<unknown, ProxyError>;
    historyRange: Effect.Effect<unknown, ProxyError>;
    live(channel: string, quality?: string): Effect.Effect<ProxiedBody, ProxyError>;
    replay(epgId: string, quality?: string): Effect.Effect<ProxiedBody, ProxyError>;
    asset(
      encoded: string,
      request: AssetRequest
    ): Effect.Effect<ProxiedBody | { redirect: string }, ProxyError>;
  }
>()("rctiplus/Routes") {
  static readonly layer = Layer.effect(
    Routes,
    Effect.gen(function* () {
      const api = yield* RctiApi;
      const cdn = yield* CdnProxy;
      const schedule = yield* ScheduleService;
      const history = yield* HistoryService;

      const ensureChannel = (slug: string): Effect.Effect<string, ProxyError> =>
        channelId(slug) === undefined
          ? ProxyError.from(`unknown channel: ${slug}`, 404)
          : Effect.succeed(slug);

      const live = Effect.fnUntraced(function* (channel: string, quality?: string) {
        const slug = yield* ensureChannel(channel);
        const master = yield* api.resolveMaster(channelId(slug)!);
        return yield* cdn.serveMaster(master, { filter: qualityFilter(quality) });
      });

      const replay = Effect.fnUntraced(function* (epgId: string, quality?: string) {
        if (!/^\d+$/.test(epgId)) {
          return yield* ProxyError.from(`unknown route: /replay/${epgId}`, 404);
        }
        const master = yield* api.resolveEpgMaster(epgId);
        return yield* cdn.serveMaster(master, { filter: qualityFilter(quality) });
      });

      const asset = Effect.fnUntraced(function* (encoded: string, request: AssetRequest) {
        const url = unb64(encoded);
        return yield* cdn.handleAsset(url, request).pipe(
          Effect.catchTag("ProxyError", (error) =>
            Effect.gen(function* () {
              if (error.status !== 403) return yield* error;
              const location = yield* cdn.selfHeal(url);
              if (!location) return yield* error;
              return { redirect: location };
            })
          )
        );
      });

      return Routes.of({
        channels: Effect.succeed({ channels: playerChannels() }),
        schedule: (channel) =>
          ensureChannel(channel).pipe(Effect.flatMap(() => schedule.fetchSchedule(channel))),
        historyDay: (date, channel) =>
          channel === undefined
            ? history.fetchDay(date)
            : ensureChannel(channel).pipe(Effect.flatMap(() => history.fetchDay(date, channel))),
        historyPrev: (before, channel) =>
          channel === undefined
            ? history.fetchPrev(before)
            : ensureChannel(channel).pipe(Effect.flatMap(() => history.fetchPrev(before, channel))),
        historyRange: history.fetchRange(),
        live,
        replay,
        asset,
      });
    })
  );
}
