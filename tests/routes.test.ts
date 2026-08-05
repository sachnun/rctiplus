import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { CONFIG } from '../src/config.js';
import { registerRoutes } from '../src/routes.js';
import { HttpError } from '../src/rctiplus.js';
import { b64 } from '../src/hls.js';
import type { ApiClient } from '../src/rctiplus.js';
import type { CdnProxy } from '../src/hls.js';
import type { ScheduleService } from '../src/schedule.js';
import type { HistoryService } from '../src/history.js';

/** Build a Hono app wired to mocked services, returning the mocks too. */
function makeApp() {
  const api = {
    resolveMaster: vi.fn(async (id: number) => `https://cdn/live/${id}.m3u8`),
    resolveEpgMaster: vi.fn(async (id: string) => `https://cdn/replay/${id}.m3u8`),
    resolveEpg: vi.fn(),
    invalidateLive: vi.fn(),
  };
  const cdn = {
    rewritePlaylist: vi.fn((b: string) => b),
    serveMaster: vi.fn(async (url: string) => ({
      body: `#EXTM3U\n${url}\n`,
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    })),
    handleAsset: vi.fn(async () => ({
      body: 'SEG',
      headers: { 'Content-Type': 'video/mp2t' },
    })),
    selfHeal: vi.fn(() => '/rcti.m3u8'),
  };
  const schedule = {
    fetchSchedule: vi.fn(async (channel: string) => ({
      channel,
      generated_at: new Date().toISOString(),
      items: [],
    })),
  };
  const history = {
    fetchDay: vi.fn(async (date: string, channel?: string) => ({
      date,
      channel: channel ?? 'all',
      generated_at: new Date().toISOString(),
      items: [],
    })),
    fetchRange: vi.fn(async () => ({
      earliest: '2026-03-31',
      latest: '2026-08-05',
      days: 128,
    })),
  };

  const app = new Hono();
  registerRoutes(app, {
    config: CONFIG,
    port: 8080,
    api: api as unknown as ApiClient,
    cdn: cdn as unknown as CdnProxy,
    schedule: schedule as unknown as ScheduleService,
    history: history as unknown as HistoryService,
  });
  return { app, api, cdn, schedule, history };
}

describe('routes', () => {
  it('serves the HTML player page on /', async () => {
    const { app } = makeApp();
    const res = await app.request('http://x/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('<!doctype html>');
    expect(text).toContain('RCTI+ Proxy');
    expect(text).toContain('<video');
    expect(text).toContain('data-ch="rcti"');
    expect(text).not.toContain('<script>const a =');
  });

  it('returns 204 for favicon.ico', async () => {
    const { app } = makeApp();
    expect((await app.request('http://x/favicon.ico')).status).toBe(204);
  });

  it('serves the local hls.js bundle for the player page', async () => {
    const { app } = makeApp();
    const res = await app.request('http://x/hls.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    const text = await res.text();
    expect(text).toContain('hls.js');
  });

  it('404s unknown channels and routes', async () => {
    const { app } = makeApp();
    expect((await app.request('http://x/foo.m3u8')).status).toBe(404);
    expect((await app.request('http://x/nope')).status).toBe(404);
    expect((await app.request('http://x/nope/schedule')).status).toBe(404);
  });

  it('serves a live master for every known channel slug', async () => {
    const { app, api } = makeApp();
    for (const [slug, id] of Object.entries(CONFIG.channels)) {
      const res = await app.request(`http://x/${slug}.m3u8`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`https://cdn/live/${id}.m3u8`);
      expect(api.resolveMaster).toHaveBeenCalledWith(id);
    }
    expect(api.resolveMaster).toHaveBeenCalledTimes(5);
  });

  it('passes a quality filter to serveMaster when ?quality=best', async () => {
    const { app, cdn } = makeApp();
    await app.request('http://x/rcti.m3u8?quality=best');
    expect(cdn.serveMaster).toHaveBeenLastCalledWith(
      'https://cdn/live/1.m3u8',
      { filter: { mode: 'best' } },
    );
  });

  it('passes a max-height filter and skips unknown quality values', async () => {
    const { app, cdn } = makeApp();
    await app.request('http://x/rcti.m3u8?quality=480');
    expect(cdn.serveMaster).toHaveBeenLastCalledWith(
      'https://cdn/live/1.m3u8',
      { filter: { mode: 'max-height', height: 480 } },
    );
    await app.request('http://x/rcti.m3u8?quality=auto');
    expect(cdn.serveMaster).toHaveBeenLastCalledWith('https://cdn/live/1.m3u8', {
      filter: undefined,
    });
  });

  it('serves a catch-up master for /replay/<epg>.m3u8', async () => {
    const { app, api } = makeApp();
    const res = await app.request('http://x/replay/328332.m3u8');
    expect(res.status).toBe(200);
    expect(api.resolveEpgMaster).toHaveBeenCalledWith('328332');
    expect(await res.text()).toContain('https://cdn/replay/328332.m3u8');
  });

  it('passes a quality filter on replay masters too', async () => {
    const { app, cdn } = makeApp();
    await app.request('http://x/replay/123456.m3u8?quality=720');
    expect(cdn.serveMaster).toHaveBeenLastCalledWith(
      'https://cdn/replay/123456.m3u8',
      { filter: { mode: 'max-height', height: 720 } },
    );
  });

  it('404s a non-numeric replay epg', async () => {
    const { app } = makeApp();
    expect((await app.request('http://x/replay/abc.m3u8')).status).toBe(404);
  });

  it('serves the schedule as JSON from the query route', async () => {
    const { app, schedule } = makeApp();
    const res = await app.request('http://x/schedule?channel=mnctv');
    expect(res.status).toBe(200);
    expect(schedule.fetchSchedule).toHaveBeenCalledWith('mnctv');
    expect(res.headers.get('content-type')).toContain('json');
  });

  it('defaults the schedule channel to rcti', async () => {
    const { app, schedule } = makeApp();
    await app.request('http://x/schedule');
    expect(schedule.fetchSchedule).toHaveBeenCalledWith('rcti');
  });

  it('serves the schedule from the path-style route', async () => {
    const { app, schedule } = makeApp();
    const res = await app.request('http://x/globaltv/schedule');
    expect(res.status).toBe(200);
    expect(schedule.fetchSchedule).toHaveBeenCalledWith('globaltv');
  });

  it('serves the deep-history day listing at /history/day/<date>', async () => {
    const { app, history } = makeApp();
    const res = await app.request('http://x/history/day/2026-07-29?channel=rcti');
    expect(res.status).toBe(200);
    expect(history.fetchDay).toHaveBeenCalledWith('2026-07-29', 'rcti');
    expect(res.headers.get('content-type')).toContain('json');
    const body = await res.json();
    expect(body.date).toBe('2026-07-29');
  });

  it('serves the playable archive range at /history/range', async () => {
    const { app, history } = makeApp();
    const res = await app.request('http://x/history/range');
    expect(res.status).toBe(200);
    expect(history.fetchRange).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.earliest).toBe('2026-03-31');
  });

  it('404s an unknown channel on the history day route', async () => {
    const { app } = makeApp();
    expect((await app.request('http://x/history/day/2026-07-29?channel=nope')).status).toBe(404);
  });

  it('maps a 400 from the history service to a 400 response', async () => {
    const { app, history } = makeApp();
    history.fetchDay.mockRejectedValueOnce(new HttpError('invalid date', 400));
    const res = await app.request('http://x/history/day/not-a-date');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('invalid date');
  });

  it('404s an unknown schedule channel', async () => {
    const { app } = makeApp();
    expect((await app.request('http://x/schedule?channel=nope')).status).toBe(404);
  });

  it('serves proxied assets through /h/<b64>', async () => {
    const { app, cdn } = makeApp();
    const res = await app.request('http://x/h/' + b64('https://cdn.example/seg-1.ts'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('SEG');
    expect(cdn.handleAsset).toHaveBeenCalledWith('https://cdn.example/seg-1.ts', {
      range: undefined,
      ifNoneMatch: undefined,
      ifModifiedSince: undefined,
    });
  });

  it('redirects a 403 hdntl playlist to a fresh master (self-heal)', async () => {
    const { app, cdn } = makeApp();
    cdn.handleAsset.mockRejectedValueOnce(new HttpError('CDN 403', 403));
    const res = await app.request(
      'http://x/h/' + b64('https://rcti-linier.rctiplus.id/hdntl=exp~hmac/x.m3u8'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/rcti.m3u8');
  });

  it('does not self-heal non-403 asset errors', async () => {
    const { app, cdn } = makeApp();
    cdn.handleAsset.mockRejectedValueOnce(new HttpError('CDN 500', 500));
    const res = await app.request('http://x/h/' + b64('https://cdn.example/x.m3u8'));
    expect(res.status).toBe(500);
    expect(cdn.selfHeal).not.toHaveBeenCalled();
  });

  it('maps upstream HttpErrors to their status via onError', async () => {
    const { app, cdn } = makeApp();
    cdn.serveMaster.mockRejectedValueOnce(new HttpError('CDN 403', 403));
    const res = await app.request('http://x/rcti.m3u8');
    expect(res.status).toBe(403);
    expect(await res.text()).toContain('proxy error');
  });
});