import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createCache } from '../src/cache.js';
import { createScheduleService } from '../src/schedule.js';

function entry(channel: string, id: number, slug: string, title: string, start: string, end: string) {
  const date = '2026-07-29';
  return (
    `<a onclick="ok; clickCatchup( 'https://www.rctiplus.com/tv/${channel}/${id}/${slug}?date=${date}');return false;"` +
    ` href="https://www.rctiplus.com/tv/${channel}/${id}/${slug}?date=${date}">` +
    `<h2>${title}</h2><br> <h4>${start} - ${end} </h4></a>`
  );
}

const HTML = [
  entry('rcti', 328332, 'si-cantik', 'Si Cantik', '00:15', '01:30'),
  entry('rcti', 328333, 'kalau-suka', 'Kalau Suka', '01:30', '03:00'),
  entry('mnctv', 555, 'show-mnc', 'MNCTV Show', '10:00', '11:00'),
].join('\n');

function makeService() {
  const cache = createCache();
  return { service: createScheduleService({ config: CONFIG, cache }), cache };
}

describe('createScheduleService', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses catch-up entries into schedule items', async () => {
    const { service } = makeService();
    vi.mocked(fetch).mockResolvedValue(new Response(HTML));
    const sched = await service.fetchSchedule('rcti');
    expect(sched.channel).toBe('rcti');
    expect(sched.items[0]).toMatchObject({
      epg_id: 328332,
      slug: 'si-cantik',
      title: 'Si Cantik',
      start: '00:15',
      end: '01:30',
      url: '/replay/328332.m3u8',
      permalink: 'https://www.rctiplus.com/tv/rcti/328332/si-cantik?date=2026-07-29',
    });
  });

  it('filters out entries from other channels', async () => {
    const { service } = makeService();
    vi.mocked(fetch).mockResolvedValue(new Response(HTML));
    const sched = await service.fetchSchedule('rcti');
    expect(sched.items.map((i) => i.epg_id)).toEqual([328332, 328333]);
  });

  it('caches the parsed schedule', async () => {
    const { service } = makeService();
    vi.mocked(fetch).mockResolvedValue(new Response(HTML));
    await service.fetchSchedule('rcti');
    await service.fetchSchedule('rcti');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});