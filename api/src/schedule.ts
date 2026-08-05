import type { Config, ChannelSlug } from './config.js';
import type { Cache } from './cache.js';

export interface ScheduleItem {
  epg_id: number;
  slug: string;
  date: string;
  title: string;
  start: string;
  end: string;
  url: string;
  permalink: string;
}

export interface Schedule {
  channel: ChannelSlug;
  generated_at: string;
  items: ScheduleItem[];
}

/**
 * 7-day catch-up schedule scraper.
 *
 * The desktop TV page renders the full catch-up window server-side; each
 * program is an anchor with an `onclick="...; clickCatchup('...')"` handler.
 * The official ajax endpoint (`live-getcatchup`) returns empty when called
 * externally, so we parse the server-rendered page instead (stable).
 */
export interface ScheduleService {
  fetchSchedule(channel: ChannelSlug): Promise<Schedule>;
}

/** capture groups: (channel, epg_id, slug, date, title, start, end) */
const SCHEDULE_RE =
  /clickCatchup\(\s*'https:\/\/www\.rctiplus\.com\/tv\/(rcti|mnctv|gtv|inews)\/(\d+)\/([a-z0-9-]+)\?date=([0-9-]+)'[^>]*>\s*<h2>\s*([^<]+?)\s*<\/h2>\s*<br>\s*<h4>\s*([0-9:]+)\s*-\s*([0-9:]+)\s*<\/h4>/gs;

/** Decode the handful of HTML entities RCTI+ pages use in titles. */
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
function decodeEntities(s: string): string {
  return s.replace(/&(?:([a-z]+)|#(\d+)|#x([0-9a-f]+));/gi, (m, name, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec));
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    return name ? (ENTITIES[name.toLowerCase()] ?? m) : m;
  });
}

export function createScheduleService({
  config,
  cache,
}: {
  config: Config;
  cache: Cache;
}): ScheduleService {
  async function fetchSchedule(channel: ChannelSlug): Promise<Schedule> {
    const cached = cache.get<Schedule>(`schedule:${channel}`, config.ttl.schedule);
    if (cached) return cached;

    const page = await fetch(`${config.siteBase}/tv/${channel}`, {
      headers: { 'User-Agent': config.userAgent, Referer: config.referer },
      signal: AbortSignal.timeout(config.timeouts.page),
    });
    const html = await page.text();

    const items: ScheduleItem[] = [];
    let m: RegExpExecArray | null;
    while ((m = SCHEDULE_RE.exec(html)) !== null) {
      const [, ch, epgId, slug, date, title, start, end] = m;
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

    const result: Schedule = { channel, generated_at: new Date().toISOString(), items };
    cache.set(`schedule:${channel}`, result);
    return result;
  }

  return { fetchSchedule };
}
