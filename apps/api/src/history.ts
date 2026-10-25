import { Context, Effect, Layer } from "effect";
import { CONFIG } from "./config.js";
import { Cache } from "./cache.js";
import { ProxyError } from "./errors.js";
import { RctiApi, type EpgDetails, type ResolvedEpg } from "./rctiplus.js";
import { ScheduleService } from "./schedule.js";

export type DayItem = {
  readonly epg_id: number;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly channel: string;
  readonly date: string;
  readonly url: string;
  readonly playable: boolean;
};

export type DayResult = {
  readonly date: string;
  readonly channel?: string;
  readonly generated_at: string;
  readonly items: ReadonlyArray<DayItem>;
};

export type HistoryRange = {
  readonly earliest: string;
  readonly latest: string;
  readonly days: number;
};

const IDS_PER_DAY = 73;
const RATE_MAX = 120;
const MAX_BACK_DAYS = 200;
const SCAN_BEFORE = 10;
const SCAN_AFTER = 210;

const MAX_LISTING_DAYS = 120;

const WALK = [
  0, 1, -1, 2, -2, 3, -3, 5, -5, 8, -8, 13, -13, 21, -21, 34, -34, 55, -55, 89, -89, 144, -144,
];

function parseDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function nowClock(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / 86_400_000);
}

function addDays(date: string, days: number): string {
  return new Date(parseDate(date) + days * 86_400_000).toISOString().slice(0, 10);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class HistoryService extends Context.Service<
  HistoryService,
  {
    fetchDay(date: string, channel?: string): Effect.Effect<DayResult, ProxyError>;
    fetchRange(): Effect.Effect<HistoryRange, ProxyError>;
  }
>()("rctiplus/HistoryService") {
  static readonly layer = Layer.effect(
    HistoryService,
    Effect.gen(function* () {
      const cache = yield* Cache;
      const api = yield* RctiApi;
      const schedule = yield* ScheduleService;

      
      const verifyMaster = (url: string): Effect.Effect<boolean> =>
        Effect.tryPromise({
          try: async () => {
            const res = await fetch(url, {
              headers: {
                Referer: CONFIG.referer,
                Origin: CONFIG.origin,
                "User-Agent": CONFIG.userAgent,
                Accept: "*/*",
              },
              redirect: "follow",
              signal: AbortSignal.timeout(CONFIG.timeouts.cdn),
            });
            if (!res.ok) return false;
            return (await res.text()).startsWith("#EXTM3U");
          },
          catch: () => false,
        }).pipe(Effect.orElseSucceed(() => false));

      const getAnchor: Effect.Effect<{ id: number; date: string }, ProxyError> = Effect.gen(
        function* () {
          const cached = yield* cache.get<{ id: number; date: string }>(
            "history:anchor",
            CONFIG.ttl.anchor
          );
          if (cached) return cached;

          const scraped = yield* schedule.fetchSchedule("rcti").pipe(
            Effect.map((sched) => {
              let maxId = -1;
              let maxDate = "";
              for (const item of sched.items) {
                if (item.epg_id > maxId) {
                  maxId = item.epg_id;
                  maxDate = item.date;
                }
              }
              return maxId > 0 && maxDate ? { id: maxId, date: maxDate } : null;
            }),
            Effect.orElseSucceed(() => null)
          );

          if (scraped) {
            yield* cache.set("history:anchor", scraped);
            return scraped;
          }

          const days = Math.max(0, daysBetween(CONFIG.historyRef.date, todayLocal()));
          return { id: CONFIG.historyRef.id + days * IDS_PER_DAY, date: todayLocal() };
        }
      );

      
      const probeNear = (id: number): Effect.Effect<ResolvedEpg | null> =>
        Effect.gen(function* () {
          for (const offset of WALK) {
            const candidate = id + offset;
            if (candidate < 0) continue;
            const resolved = yield* api.resolveEpg(String(candidate)).pipe(
              Effect.map((r) => (r.details ? r : null)),
              Effect.orElseSucceed(() => null)
            );
            if (resolved) return resolved;
          }
          return null;
        });

      
      const locateBoundary = (
        anchor: { id: number; date: string },
        date: string
      ): Effect.Effect<number, ProxyError> =>
        Effect.gen(function* () {
          const key = `boundary:${date}`;
          const cached = yield* cache.get<number>(key, CONFIG.ttl.day);
          if (cached !== undefined) return cached;

          const age = daysBetween(date, anchor.date);
          let lo = Math.max(
            anchor.id - MAX_BACK_DAYS * RATE_MAX,
            anchor.id - age * RATE_MAX - IDS_PER_DAY
          );
          let hi = anchor.id;
          while (lo < hi) {
            const mid = Math.floor((lo + hi) / 2);
            const info = yield* probeNear(mid);
            if (!info?.details) {
              lo = mid + 1;
              continue;
            }
            if (info.details.date < date) lo = mid + 1;
            else hi = mid;
          }
          yield* cache.set(key, lo);
          return lo;
        });

      const fetchDay = Effect.fnUntraced(function* (date: string, channel?: string) {
        if (!DATE_RE.test(date)) {
          return yield* ProxyError.from("invalid date, use YYYY-MM-DD", 400);
        }
        const key = `day:${date}:${channel ?? "all"}`;
        const cached = yield* cache.get<DayResult>(key, CONFIG.ttl.day);
        if (cached) return cached;

        const anchor = yield* getAnchor;
        if (date > anchor.date) {
          return yield* ProxyError.from(`date ${date} is in the future`, 400);
        }

        const ageDays = daysBetween(date, anchor.date);
        if (ageDays > MAX_BACK_DAYS) {
          const empty: DayResult = {
            date,
            channel,
            generated_at: new Date().toISOString(),
            items: [],
          };
          yield* cache.set(key, empty);
          return empty;
        }

        if (channel && ageDays <= 6) {
          const sched = yield* schedule.fetchSchedule(channel);
          const fast: DayItem[] = sched.items
            .filter((item) => item.date === date)
            .map((item) => ({
              epg_id: item.epg_id,
              title: item.title,
              start: item.start,
              end: item.end,
              channel,
              date,
              url: item.url,
              playable: item.end <= nowClock(),
            }));
          fast.sort((a, b) => a.start.localeCompare(b.start) || a.epg_id - b.epg_id);
          const result: DayResult = {
            date,
            channel,
            generated_at: new Date().toISOString(),
            items: fast,
          };
          yield* cache.set(key, result);
          return result;
        }

        const boundary = yield* locateBoundary(anchor, date);
        const ids: number[] = [];
        for (let id = boundary - SCAN_BEFORE; id <= boundary + SCAN_AFTER; id++) ids.push(id);

        const resolved = yield* Effect.forEach(
          ids,
          (id) =>
            api.resolveEpg(String(id)).pipe(
              Effect.map((r) => (r.details ? r : null)),
              Effect.orElseSucceed(() => null)
            ),
          { concurrency: 16 }
        );

        const candidates = resolved.filter(
          (resolved): resolved is ResolvedEpg & { details: EpgDetails } =>
            !!resolved?.details &&
            resolved.details.date === date &&
            (!channel || resolved.details.channel === channel)
        );

        const items = yield* Effect.forEach(
          candidates,
          (candidate) =>
            Effect.gen(function* () {
              const details = candidate.details;
              const playable = yield* verifyMaster(candidate.url);
              return {
                epg_id: details.id,
                title: details.title,
                start: details.start,
                end: details.end,
                channel: details.channel,
                date: details.date,
                url: `/replay/${details.id}.m3u8`,
                playable,
              } satisfies DayItem;
            }),
          { concurrency: 8 }
        );

        const sorted = [...items].sort(
          (a, b) => a.start.localeCompare(b.start) || a.epg_id - b.epg_id
        );
        const result: DayResult = {
          date,
          channel,
          generated_at: new Date().toISOString(),
          items: sorted,
        };
        yield* cache.set(key, result);
        return result;
      });

      const fetchRange = Effect.fnUntraced(function* () {
        const cached = yield* cache.get<HistoryRange>("history:range", CONFIG.ttl.range);
        if (cached) return cached;

        const anchor = yield* getAnchor;
        const earliest = addDays(anchor.date, -MAX_LISTING_DAYS);
        const result: HistoryRange = {
          earliest,
          latest: anchor.date,
          days: MAX_LISTING_DAYS + 1,
        };
        yield* cache.set("history:range", result);
        return result;
      });

      return HistoryService.of({ fetchDay, fetchRange });
    })
  );
}
