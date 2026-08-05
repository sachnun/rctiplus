/**
 * Deep catch-up history discovery — replay beyond the 7-day schedule window.
 *
 * The RCTI+ desktop TV page only renders a 7-day catch-up list, but the VOD
 * files on `past-event.rctiplus.id` are actually kept for ~4 months (older
 * masters return 502 from the CDN).  EPG ids are shared across all 4 channels
 * and advance roughly monotonically with time (~73 ids/day measured over 123
 * days), so an unknown older program can be *found* by scanning the id space:
 *
 *   1. anchor the newest known id (from the schedule scrape),
 *   2. binary-search the id range to locate the target date's boundary id,
 *   3. scan the ids around it, keep those whose `epg_details.date` matches,
 *   4. verify each master still plays on the CDN (200 + `#EXTM3U`).
 *
 * Results are cached per (date, channel); the CDN check is what separates
 * "URL still resolvable" from "actually playable", mirroring the retention
 * boundary observed on the CDN.
 */
import type { Config, ChannelSlug } from './config.js';
import type { Cache } from './cache.js';
import type { ApiClient, ResolvedEpg } from './rctiplus.js';
import type { ScheduleService } from './schedule.js';
import { HttpError } from './rctiplus.js';

/** One playable-or-not program found for a date. */
export interface DayItem {
  epg_id: number;
  title: string;
  start: string;
  end: string;
  channel: string;
  date: string;
  url: string;
  /** True when the CDN still serves the master playlist for this program. */
  playable: boolean;
}

export interface DayResult {
  date: string;
  channel?: ChannelSlug;
  generated_at: string;
  items: DayItem[];
}

/** Playable catch-up window as known by the CDN. */
export interface HistoryRange {
  earliest: string;
  latest: string;
  days: number;
}

/** Result of walking one step further back in time (for infinite scroll). */
export interface PrevResult {
  /** The previous playable day found, or null when none remain before `earliest`. */
  date: string | null;
  /** Earliest playable date overall — the hard stop for the walk. */
  earliest: string;
  items: DayItem[];
  /** True when there are no more days to load (stop the scroll feed). */
  end: boolean;
}

/** Deep-history discovery service (see module doc for the algorithm). */
export interface HistoryService {
  /** Programs for one calendar date, optionally filtered by channel. */
  fetchDay(date: string, channel?: ChannelSlug): Promise<DayResult>;
  /** Earliest/latest dates with playable catch-up content. */
  fetchRange(): Promise<HistoryRange>;
  /**
   * The nearest playable day strictly before `before`, for infinite scroll.
   * Walks backward one day at a time (reusing the per-day cache) until it
   * finds a day with playable items or hits the archive `earliest` boundary.
   */
  fetchPrev(before: string, channel?: ChannelSlug): Promise<PrevResult>;
}

const IDS_PER_DAY = 73; // measured: ~73 epg ids per calendar day across 4 channels
const RATE_MAX = 120; // generous upper bound for sizing the binary-search range
const MAX_BACK_DAYS = 200; // hard cap for deep lookups (CDN retention is ~4 months)
const SCAN_BEFORE = 10; // ids before the located date boundary
const SCAN_AFTER = 210; // ids after it (sparse archive days span up to ~190 incl. gaps)

/**
 * Days for which a resolved EPG id is trusted without probing the CDN.
 * The CDN retains ~4 months, so recent days are far inside the window and
 * per-item CDN probes would only add latency to the common scroll path;
 * only days near the retention edge are still verified.
 */
const RECENT_DAYS = 30;

/**
 * Probe offsets, growing so a search can walk across the dead gaps that
 * appear in the archive region of the id space (older programs are pruned
 * from the API, leaving runs of 400s up to ~70 ids wide).
 */
const WALK = [0, 1, -1, 2, -2, 3, -3, 5, -5, 8, -8, 13, -13, 21, -21, 34, -34, 55, -55, 89, -89, 144, -144];

const TTL = {
  day: 10 * 60 * 1000,
  range: 60 * 60 * 1000,
  anchor: 12 * 60 * 60 * 1000,
};

/** Concurrent map with a cap on in-flight promises. */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

/** Parse `YYYY-MM-DD` as UTC midnight (dates are timezone-agnostic labels). */
function parseDate(s: string): number {
  return Date.parse(`${s}T00:00:00Z`);
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

function addDays(date: string, n: number): string {
  return new Date(parseDate(date) + n * 86400000).toISOString().slice(0, 10);
}

export function createHistoryService({
  config,
  cache,
  api,
  schedule,
}: {
  config: Config;
  cache: Cache;
  api: ApiClient;
  schedule: ScheduleService;
}): HistoryService {
  /** Newest known (id, date) pair: from the schedule scrape, else extrapolated. */
  async function getAnchor(): Promise<{ id: number; date: string }> {
    const cached = cache.get<{ id: number; date: string }>('history:anchor', TTL.anchor);
    if (cached) return cached;

    try {
      const sched = await schedule.fetchSchedule('rcti');
      let maxId = -1;
      let maxDate = '';
      for (const it of sched.items) {
        if (it.epg_id > maxId) {
          maxId = it.epg_id;
          maxDate = it.date;
        }
      }
      if (maxId > 0 && maxDate) {
        const anchor = { id: maxId, date: maxDate };
        cache.set('history:anchor', anchor);
        return anchor;
      }
    } catch {
      /* schedule unreachable — fall through to the baked reference */
    }

    // Last resort: extrapolate the baked reference by elapsed days.
    const days = Math.max(0, daysBetween(config.historyRef.date, todayLocal()));
    return {
      id: config.historyRef.id + days * IDS_PER_DAY,
      date: todayLocal(),
    };
  }

  /** Resolve an id, walking across dead gaps to the nearest live program. */
  async function probeNear(id: number): Promise<ResolvedEpg | null> {
    for (const off of WALK) {
      const cand = id + off;
      if (cand < 0) continue;
      try {
        const r = await api.resolveEpg(String(cand));
        if (r.details) return r;
      } catch {
        /* non-catchup slot (ads, pruned program) — keep walking */
      }
    }
    return null;
  }

  /** Verify the CDN still serves a master playlist for a VOD url. */
  async function verifyMaster(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, {
        headers: {
          Referer: config.referer,
          Origin: config.origin,
          'User-Agent': config.userAgent,
          Accept: '*/*',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(config.timeouts.cdn),
      });
      if (!res.ok) return false;
      return (await res.text()).startsWith('#EXTM3U');
    } catch {
      return false;
    }
  }

  /**
   * Binary-search the id range for the first live id whose program date is on
   * or after the target date.  Live ids advance monotonically with time (the
   * sparse archive region still orders correctly), so this pins the target
   * date's slot window cheaply and is immune to id-rate drift.
   */
  async function locateBoundary(
    anchor: { id: number; date: string },
    date: string,
  ): Promise<number> {
    const key = `boundary:${date}`;
    const cached = cache.get<number>(key, TTL.day);
    if (cached !== undefined) return cached;

    // Seed the low end from the estimated id for `date` instead of the full
    // MAX_BACK_DAYS span: ids advance at most RATE_MAX/day, so the true
    // boundary cannot sit below anchor.id - age*RATE_MAX - IDS_PER_DAY.
    // That shrinks the search (and its sequential API probes) dramatically
    // for recent dates — the common infinite-scroll case.
    const age = daysBetween(date, anchor.date);
    let lo = Math.max(
      anchor.id - MAX_BACK_DAYS * RATE_MAX,
      anchor.id - age * RATE_MAX - IDS_PER_DAY,
    );
    let hi = anchor.id;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const info = await probeNear(mid);
      if (!info) {
        lo = mid + 1; // gap wider than WALK (rare) — step past it
        continue;
      }
      if ((info.details?.date ?? '') < date) lo = mid + 1;
      else hi = mid;
    }
    cache.set(key, lo);
    return lo;
  }

  async function fetchDay(date: string, channel?: ChannelSlug): Promise<DayResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpError('invalid date, use YYYY-MM-DD', 400);
    }
    const key = `day:${date}:${channel ?? 'all'}`;
    const cached = cache.get<DayResult>(key, TTL.day);
    if (cached) return cached;

    const anchor = await getAnchor();
    if (date > anchor.date) throw new HttpError(`date ${date} is in the future`, 400);
    const ageDays = daysBetween(date, anchor.date); // positive for past dates
    if (ageDays > MAX_BACK_DAYS) {
      const empty: DayResult = { date, channel, generated_at: new Date().toISOString(), items: [] };
      cache.set(key, empty);
      return empty;
    }

    // Fast path: dates inside the 7-day schedule window need no id-space scan
    // (the schedule scrape already lists them, per channel), and they are
    // well inside CDN retention, so no per-item CDN probe either.
    if (channel && ageDays <= 6) {
      const sched = await schedule.fetchSchedule(channel);
      const fast = sched.items
        .filter((it) => it.date === date)
        .map(
          (it) =>
            ({
              epg_id: it.epg_id,
              title: it.title,
              start: it.start,
              end: it.end,
              channel,
              date,
              url: it.url,
              playable: true,
            }) satisfies DayItem,
        );
      fast.sort((a, b) => a.start.localeCompare(b.start) || a.epg_id - b.epg_id);
      const fastResult: DayResult = { date, channel, generated_at: new Date().toISOString(), items: fast };
      cache.set(key, fastResult);
      return fastResult;
    }

    const boundary = await locateBoundary(anchor, date);
    const ids: number[] = [];
    for (let id = boundary - SCAN_BEFORE; id <= boundary + SCAN_AFTER; id++) ids.push(id);

    const resolved = await mapLimit(ids, 16, async (id) => {
      try {
        return await api.resolveEpg(String(id));
      } catch {
        return null;
      }
    });

    const candidates = resolved.filter(
      (r): r is ResolvedEpg =>
        !!r && r.details?.date === date && (!channel || r.details.channel === channel),
    );

    // Days well inside the CDN retention window are trusted once the id
    // resolves (probing the CDN per item is what makes first-browse pages
    // slow).  Only days near the retention edge are still CDN-verified.
    const verifyCdn = ageDays > RECENT_DAYS;
    const items = await mapLimit(candidates, 8, async (r) => {
      const d = r.details!;
      return {
        epg_id: d.id,
        title: d.title,
        start: d.start,
        end: d.end,
        channel: d.channel,
        date: d.date,
        url: `/replay/${d.id}.m3u8`,
        playable: verifyCdn ? await verifyMaster(r.url) : true,
      } satisfies DayItem;
    });

    items.sort(
      (a, b) =>
        a.start.localeCompare(b.start) || a.epg_id - b.epg_id,
    );
    const result: DayResult = { date, channel, generated_at: new Date().toISOString(), items };
    cache.set(key, result);
    return result;
  }

  async function fetchPrev(before: string, channel?: ChannelSlug): Promise<PrevResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) {
      throw new HttpError('invalid date, use YYYY-MM-DD', 400);
    }
    const [anchor, range] = await Promise.all([getAnchor(), fetchRange()]);
    if (before > anchor.date) {
      throw new HttpError(`date ${before} is after the newest program`, 400);
    }
    const { earliest } = range;

    let date = addDays(before, -1);
    while (date >= earliest) {
      const day = await fetchDay(date, channel);
      if (day.items.some((it) => it.playable)) {
        return { date, earliest, items: day.items, end: false };
      }
      date = addDays(date, -1);
    }
    return { date: null, earliest, items: [], end: true };
  }

  async function fetchRange(): Promise<HistoryRange> {
    const cached = cache.get<HistoryRange>('history:range', TTL.range);
    if (cached) return cached;

    const anchor = await getAnchor();
    /** True when any program at `daysAgo` still plays on the CDN. */
    const isPlayable = async (daysAgo: number): Promise<boolean> => {
      // Probe three slots around the middle of the estimated day block: the
      // id→date mapping floors to the block *end*, so offsets symmetric around
      // the middle stay inside the target day and never leak into the newer
      // block.  Probing several slots keeps a single dead slot (ads, pruned
      // programs) from flipping the bisection to "gone".
      const mid = anchor.id - daysAgo * IDS_PER_DAY - Math.floor(IDS_PER_DAY / 2);
      for (const off of [-35, 0, 35]) {
        const info = await probeNear(mid + off);
        if (info && (await verifyMaster(info.url))) return true;
      }
      return false;
    };

    // Binary-search the largest daysAgo with playable content (CDN retention).
    let lo = 1;
    let hi = MAX_BACK_DAYS;
    let lastPlayable = 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (await isPlayable(mid)) {
        lastPlayable = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    const earliest = addDays(anchor.date, -lastPlayable);
    const result: HistoryRange = {
      earliest,
      latest: anchor.date,
      days: daysBetween(earliest, anchor.date) + 1,
    };
    cache.set('history:range', result);
    return result;
  }

  return { fetchDay, fetchRange, fetchPrev };
}
