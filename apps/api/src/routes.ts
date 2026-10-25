import { Context, Effect, Layer } from "effect";
import { absolutize, buildPlaylist, playlistHeaders, slotName, type CatalogEntry } from "./catalog.js";
import { channelId, playerChannels } from "./config.js";
import { ProxyError } from "./errors.js";
import { assetTarget, CdnProxy, type ProxiedBody, type QualityFilter } from "./hls.js";
import { RctiApi } from "./rctiplus.js";
import { HistoryService } from "./history.js";
import { dayUrl, liveUrl, replayUrl } from "./urls.js";
import { previousDate } from "./catalog.js";

export type AssetRequest = {
  range?: string | null;
  ifNoneMatch?: string | null;
  ifModifiedSince?: string | null;
};

export { channelId, playerChannels };

export { catalogUrl, dayUrl, liveUrl, replayUrl } from "./urls.js";

export function qualityFilter(quality: string | undefined): QualityFilter | undefined {
  if (!quality || quality === "auto") return undefined;
  if (quality === "best") return { mode: "best" };
  const height = Number(quality);
  if (Number.isFinite(height) && height > 0) return { mode: "max-height", height };
  return undefined;
}

export class Routes extends Context.Service<
  Routes,
  {
    catalog(quality?: string, origin?: string): Effect.Effect<ProxiedBody, ProxyError>;
    live(channel: string, quality?: string): Effect.Effect<ProxiedBody, ProxyError>;
    replay(epgId: string, quality?: string): Effect.Effect<ProxiedBody, ProxyError>;
    day(date: string, channel?: string): Effect.Effect<ProxiedBody, ProxyError>;
    days(channel?: string): Effect.Effect<ProxiedBody, ProxyError>;
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
      const history = yield* HistoryService;

      const ensureChannel = (slug: string): Effect.Effect<string, ProxyError> =>
        channelId(slug) === undefined
          ? ProxyError.from(`unknown channel: ${slug}`, 404)
          : Effect.succeed(slug);

      const asCatalog = (
        entries: ReadonlyArray<CatalogEntry>,
        origin?: string
      ): ProxiedBody => {
        const body = buildPlaylist(entries);
        return { body: origin ? absolutize(body, origin) : body, headers: playlistHeaders() };
      };

      
      const catalog = Effect.fnUntraced(function* (quality?: string, origin?: string) {
        const entries: CatalogEntry[] = playerChannels().map((channel) => ({
          name: channel.toUpperCase(),
          url: liveUrl(channel, quality),
        }));

        const today = new Date().toISOString().slice(0, 10);
        const day = yield* history
          .fetchDay(today, "rcti")
          .pipe(Effect.orElseSucceed(() => null));

        for (const item of day?.items ?? []) {
          if (!item.playable) continue;
          entries.push({
            name: slotName(item.title, item.start, item.end),
            url: replayUrl(item.epg_id, quality),
          });
        }
        return asCatalog(entries, origin);
      });

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

      const day = Effect.fnUntraced(function* (date: string, channel?: string) {
        const slug = channel && channel !== "all" ? yield* ensureChannel(channel) : undefined;
        const result = yield* history.fetchDay(date, slug);
        return asCatalog(
          result.items
            .filter((item) => item.playable)
            .map((item) => ({
              name: slotName(item.title, item.start, item.end),
              url: replayUrl(item.epg_id),
            }))
        );
      });

      
      const days = Effect.fnUntraced(function* (channel?: string) {
        const slug = channel && channel !== "all" ? yield* ensureChannel(channel) : undefined;
        const range = yield* history.fetchRange();
        const entries: CatalogEntry[] = [];
        for (let date = range.latest; date >= range.earliest; ) {
          entries.push({ name: date, url: dayUrl(date, slug) });
          date = previousDate(date);
        }
        return asCatalog(entries);
      });

      const asset = Effect.fnUntraced(function* (encoded: string, request: AssetRequest) {
        const url = assetTarget(encoded);
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

      return Routes.of({ catalog, live, replay, day, days, asset });
    })
  );
}
