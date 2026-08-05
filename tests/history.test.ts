import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCache } from '../src/cache.js';
import { createHistoryService } from '../src/history.js';
import { HttpError } from '../src/rctiplus.js';
import type { ApiClient, EpgDetails } from '../src/rctiplus.js';
import type { ScheduleService } from '../src/schedule.js';

/**
 * Deterministic simulation of the RCTI+ EPG id space:
 *  - ids advance ~73/day, shared across 4 channels (channel = id % 4),
 *  - every 7th id is a dead slot (ads / non-catchup → API 400),
 *  - VOD is gone from the CDN beyond 100 days (masters 502).
 */
const ANCHOR_ID = 328842;
const ANCHOR_DATE = '2026-08-05';
const IDS_PER_DAY = 73;
const RETENTION_DAYS = 100;
const CHANNELS = ['rcti', 'mnctv', 'gtv', 'inews'];

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Build the service against a deterministic mock of the EPG id space.
 * Recent ids are dense (every 7th dead); with `sparseFromDays` the older
 * region mimics the real archive: only ~26% of ids are live with dead gaps
 * up to ~71 wide, exactly what broke the naive boundary search.
 */
function makeEnv(sparseFromDays = 0) {
  const cache = createCache();
  const resolveEpg = vi.fn(async (idStr: string) => {
    const id = Number(idStr);
    const daysAgo = Math.floor((ANCHOR_ID - id) / IDS_PER_DAY);
    if (id % 7 === 0) throw new HttpError('no replay url in API reply', 400);
    if (sparseFromDays > 0 && daysAgo > sparseFromDays && id % 97 < 72) {
      throw new HttpError('no replay url in API reply', 400); // archive gap
    }
    const gone = daysAgo > RETENTION_DAYS;
    return {
      url: `https://past-event.rctiplus.id/${gone ? 'gone' : 'ok'}-${id}.m3u8`,
      details: {
        id,
        title: `Program ${id}`,
        start: `${String(id % 24).padStart(2, '0')}:00`,
        end: `${String((id % 24) + 1).padStart(2, '0')}:00`,
        date: addDays(ANCHOR_DATE, -daysAgo),
        channel: CHANNELS[id % 4]!,
        channel_id: (id % 4) + 1,
        label: 'catchup',
      } satisfies EpgDetails,
    };
  });
  const api = { resolveEpg } as unknown as Pick<ApiClient, 'resolveEpg'>;
  const schedule = {
    fetchSchedule: vi.fn(async () => ({
      channel: 'rcti',
      generated_at: new Date().toISOString(),
      items: [
        {
          epg_id: ANCHOR_ID,
          slug: 'newest',
          date: ANCHOR_DATE,
          title: 'Newest',
          start: '00:00',
          end: '01:00',
          url: '/replay/x.m3u8',
          permalink: 'https://www.rctiplus.com/tv/rcti/x',
        },
      ],
    })),
  };
  const service = createHistoryService({
    config: CONFIG,
    cache,
    api,
    schedule: schedule as unknown as ScheduleService,
  });
  return { service, api, schedule, cache };
}

describe('createHistoryService', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        const s = String(url);
        if (s.includes('gone')) return new Response('<!DOCTYPE html>', { status: 502 });
        return new Response('#EXTM3U\n#EXT-X-VERSION:3\nhttps://cdn/x.m3u8\n');
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds playable programs for an old date, filtered by channel', async () => {
    const { service, api } = makeEnv();
    const day = await service.fetchDay('2026-07-29', 'rcti'); // 7 days back
    expect(day.date).toBe('2026-07-29');
    expect(day.channel).toBe('rcti');
    expect(day.items.length).toBeGreaterThan(0);
    for (const it of day.items) {
      expect(it.date).toBe('2026-07-29');
      expect(it.channel).toBe('rcti');
      expect(it.playable).toBe(true);
      expect(it.url).toBe(`/replay/${it.epg_id}.m3u8`);
    }
    // sorted by start time
    const starts = day.items.map((i) => i.start);
    expect([...starts].sort()).toEqual(starts);
    // every 7th id was skipped without crashing the scan
    expect(api.resolveEpg).toHaveBeenCalled();
  });

  it('returns all channels when no channel filter is given', async () => {
    const { service } = makeEnv();
    const day = await service.fetchDay('2026-07-29');
    const channels = new Set(day.items.map((i) => i.channel));
    expect(channels).toEqual(new Set(CHANNELS));
  });

  it('marks items beyond the CDN retention as not playable', async () => {
    const { service } = makeEnv();
    const day = await service.fetchDay('2026-04-20'); // 107 days back
    expect(day.items.length).toBeGreaterThan(0);
    expect(day.items.every((i) => i.playable === false)).toBe(true);
  });

  it('returns an empty listing for dates beyond the hard cap', async () => {
    const { service, api } = makeEnv();
    const day = await service.fetchDay('2026-01-01'); // 216 days back
    expect(day.items).toEqual([]);
    expect(api.resolveEpg).not.toHaveBeenCalled();
  });

  it('caches the day result so a second call does not rescan', async () => {
    const { service, api } = makeEnv();
    const a = await service.fetchDay('2026-07-29', 'rcti');
    const calls = api.resolveEpg.mock.calls.length;
    const b = await service.fetchDay('2026-07-29', 'rcti');
    expect(b).toBe(a);
    expect(api.resolveEpg.mock.calls.length).toBe(calls);
  });

  it('finds items in the sparse archive region despite large dead gaps', async () => {
    // old ids are ~74% dead with gaps up to ~71 wide (mirrors real API)
    const { service } = makeEnv(60);
    const day = await service.fetchDay('2026-05-05'); // 92 days back, sparse
    expect(day.items.length).toBeGreaterThan(0);
    expect(day.items.every((i) => i.date === '2026-05-05')).toBe(true);
    expect(day.items.every((i) => i.playable)).toBe(true);
  });

  it('reports the playable range from the sparse region within tolerance', async () => {
    const { service } = makeEnv(60);
    const range = await service.fetchRange();
    const expected = addDays(ANCHOR_DATE, -RETENTION_DAYS);
    const drift = Math.abs(
      Math.round(
        (Date.parse(`${range.earliest}T00:00:00Z`) - Date.parse(`${expected}T00:00:00Z`)) / 86400000,
      ),
    );
    expect(drift).toBeLessThanOrEqual(3);
    expect(range.latest).toBe(ANCHOR_DATE);
  });

  it('rejects invalid and future dates with a 400 HttpError', async () => {
    const { service } = makeEnv();
    await expect(service.fetchDay('2026-7-29')).rejects.toMatchObject({ status: 400 });
    await expect(service.fetchDay('2026-09-01')).rejects.toMatchObject({ status: 400 });
  });

  it('reports the playable range via binary search over the retention', async () => {
    const { service } = makeEnv();
    const range = await service.fetchRange();
    expect(range.latest).toBe(ANCHOR_DATE);
    expect(range.earliest).toBe(addDays(ANCHOR_DATE, -RETENTION_DAYS));
    expect(range.days).toBe(RETENTION_DAYS + 1);
  });

  it('caches the range result', async () => {
    const { service } = makeEnv();
    const a = await service.fetchRange();
    const b = await service.fetchRange();
    expect(b).toBe(a);
  });
});
