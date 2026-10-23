import { Context, Effect, Layer } from "effect";
import { CONFIG } from "./config.js";
import { Cache } from "./cache.js";
import { ProxyError } from "./errors.js";

export type ScheduleItem = {
  readonly epg_id: number;
  readonly slug: string;
  readonly date: string;
  readonly title: string;
  readonly start: string;
  readonly end: string;
  readonly url: string;
  readonly permalink: string;
};

export type Schedule = {
  readonly channel: string;
  readonly generated_at: string;
  readonly items: ReadonlyArray<ScheduleItem>;
};

/** capture groups: (channel, epg_id, slug, date, title, start, end) */
const SCHEDULE_RE =
  /clickCatchup\(\s*'https:\/\/www\.rctiplus\.com\/tv\/(rcti|mnctv|gtv|inews)\/(\d+)\/([a-z0-9-]+)\?date=([0-9-]+)'[^>]*>\s*<h2>\s*([^<]+?)\s*<\/h2>\s*<br>\s*<h4>\s*([0-9:]+)\s*-\s*([0-9:]+)\s*<\/h4>/gs;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Decode the handful of HTML entities RCTI+ pages use in titles. */
export function decodeEntities(input: string): string {
  return input.replace(/&(?:([a-z]+)|#(\d+)|#x([0-9a-f]+));/gi, (match, name, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return name ? (ENTITIES[name.toLowerCase()] ?? match) : match;
  });
}

/** Parse catch-up entries out of the server-rendered channel page. */
export function parseSchedule(html: string, channel: string): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  for (const match of html.matchAll(SCHEDULE_RE)) {
    const [, ch, epgId, slug, date, title, start, end] = match;
    if (!ch || ch !== channel) continue;
    if (!epgId || !slug || !date || !title || !start || !end) continue;

    items.push({
      epg_id: Number(epgId),
      slug,
      date,
      title: decodeEntities(title.trim()),
      start,
      end,
      url: `/replay/${epgId}.m3u8`,
      permalink: `https://www.rctiplus.com/tv/${ch}/${epgId}/${slug}?date=${date}`,
    });
  }
  return items;
}

/**
 * 7-day catch-up schedule scraper.
 *
 * The desktop TV page renders the full catch-up window server-side; each
 * program is an anchor with an `onclick="...; clickCatchup('...')"` handler.
 * The official ajax endpoint returns empty when called externally, so the
 * page is parsed instead.
 */
export class ScheduleService extends Context.Service<
  ScheduleService,
  {
    fetchSchedule(channel: string): Effect.Effect<Schedule, ProxyError>;
  }
>()("rctiplus/ScheduleService") {
  static readonly layer = Layer.effect(
    ScheduleService,
    Effect.gen(function* () {
      const cache = yield* Cache;

      const fetchSchedule = Effect.fnUntraced(function* (channel: string) {
        const cached = yield* cache.get<Schedule>(`schedule:${channel}`, CONFIG.ttl.schedule);
        if (cached) return cached;

        const html = yield* Effect.tryPromise({
          try: async () => {
            const page = await fetch(`${CONFIG.siteBase}/tv/${channel}`, {
              headers: { "User-Agent": CONFIG.userAgent, Referer: CONFIG.referer },
              signal: AbortSignal.timeout(CONFIG.timeouts.page),
            });
            return page.text();
          },
          catch: () => ProxyError.from("schedule page unreachable"),
        });

        const result: Schedule = {
          channel,
          generated_at: new Date().toISOString(),
          items: parseSchedule(html, channel),
        };
        yield* cache.set(`schedule:${channel}`, result);
        return result;
      });

      return ScheduleService.of({ fetchSchedule });
    })
  );
}
