import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HttpError } from './rctiplus.js';
import type { ApiClient } from './rctiplus.js';
import type { CdnProxy, ProxiedBody } from './hls.js';
import { unb64, type QualityFilter } from './hls.js';
import type { ScheduleService } from './schedule.js';
import type { HistoryService } from './history.js';
import type { Config, ChannelSlug, ChannelId } from './config.js';

/** Convert a non-304 ProxiedBody body to something Hono accepts. */
function toBodyInit(
  body: Exclude<ProxiedBody['body'], null>,
): string | ArrayBuffer | ReadableStream<Uint8Array> {
  if (body instanceof Uint8Array) {
    // Buffer/Uint8Array -> ArrayBuffer (Hono's Data type wants ArrayBuffer).
    return body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength,
    ) as ArrayBuffer;
  }
  return body;
}

/** Send a ProxiedBody (200/206/304) to the client. */
function sendProxied(c: Context, pb: ProxiedBody): Response {
  if (pb.status === 304) return c.body(null, 304, pb.headers);
  return c.body(
    toBodyInit(pb.body as Exclude<ProxiedBody['body'], null>),
    (pb.status ?? 200) as ContentfulStatusCode,
    pb.headers,
  );
}

/** Everything the route handlers need, wired up in `index.ts`. */
export interface Services {
  config: Config;
  api: ApiClient;
  cdn: CdnProxy;
  schedule: ScheduleService;
  history: HistoryService;
}

/** Displayed channels (first slug per channel id — dedupes the gtv/globaltv alias). */
function playerChannels(config: Config): string[] {
  const seen = new Set<number>();
  return Object.entries(config.channels)
    .filter(([, id]) => (seen.has(id) ? false : (seen.add(id), true)))
    .map(([slug]) => slug);
}

/** Validate a channel slug and return its API id, or undefined if unknown. */
function channelId(config: Config, slug: string): ChannelId | undefined {
  return config.channels[slug.toLowerCase() as ChannelSlug];
}

/**
 * Map a `?quality=` value to a proxy-side variant filter. `auto`/absent
 * keeps the full master (client ABR); the player prefixes one of `best` or a
 * target height (e.g. `480`) to force a single variant for every client.
 */
function qualityFilter(q: string | undefined): QualityFilter | undefined {
  if (!q || q === 'auto') return undefined;
  if (q === 'best') return { mode: 'best' };
  const height = Number(q);
  if (Number.isFinite(height) && height > 0) return { mode: 'max-height', height };
  return undefined;
}

export function registerRoutes<
  E extends Record<string, unknown> = Record<string, unknown>,
>(app: Hono<{ Bindings: E }>, services: Services): void {
  const { config, api, cdn, schedule, history } = services;

  app.get('/channels', (c) => c.json({ channels: playerChannels(config) }));
  app.get('/favicon.ico', (c) => c.body(null, 204));

  /* --------------------------------------------- proxied HLS asset (/h/<b64>) */
  app.get('/h/:b64', async (c) => {
    const url = unb64(c.req.param('b64'));
    try {
      const { body, headers, status } = await cdn.handleAsset(url, {
        range: c.req.header('range'),
        ifNoneMatch: c.req.header('if-none-match'),
        ifModifiedSince: c.req.header('if-modified-since'),
      });
      return sendProxied(c, { body, headers, status });
    } catch (e) {
      // A dead live playlist with expired hdntl tokens: point the player at a
      // fresh master so it re-resolves and keeps playing.
      if (e instanceof HttpError && e.status === 403) {
        const location = cdn.selfHeal(url);
        if (location) return c.redirect(location, 302);
      }
      throw e;
    }
  });

  /* -------------------------------------------------- schedule (JSON list) */
  // /schedule?channel=rcti   or   /rcti/schedule
  app.get('/schedule', async (c) => {
    const slug = (c.req.query('channel') || 'rcti') as ChannelSlug;
    if (channelId(config, slug) === undefined) {
      return c.text(`unknown channel: ${slug}`, 404);
    }
    const data = await schedule.fetchSchedule(slug);
    return c.json(data, 200, { 'Cache-Control': 'no-store' });
  });

  app.get('/:channel/schedule', async (c) => {
    const slug = c.req.param('channel') as ChannelSlug;
    if (channelId(config, slug) === undefined) {
      return c.text(`unknown channel: ${slug}`, 404);
    }
    const data = await schedule.fetchSchedule(slug);
    return c.json(data, 200, { 'Cache-Control': 'no-store' });
  });

  /* --------------------------------------- deep history: /history/* */
  // Replay beyond the 7-day schedule window.  The page only lists 7 days, but
  // the VOD files on the CDN are kept ~4 months; /history/day/<date> finds
  // those older programs by scanning the EPG id space (see src/history.ts).
  app.get('/history/range', async (c) => c.json(await history.fetchRange()));

  app.get('/history/day/:date', async (c) => {
    const date = c.req.param('date');
    const q = c.req.query('channel');
    const slug = q ? (q.toLowerCase() as ChannelSlug) : undefined;
    if (slug && channelId(config, slug) === undefined) {
      return c.text(`unknown channel: ${slug}`, 404);
    }
    try {
      const data = await history.fetchDay(date, slug);
      return c.json(data, 200, { 'Cache-Control': 'no-store' });
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) return c.text(e.message, 400);
      throw e;
    }
  });

  // /history/prev?before=YYYY-MM-DD&channel=<slug> — next older day for the
  // infinite-scroll replay feed (see web/src/main.ts -> loadMoreReplay).
  app.get('/history/prev', async (c) => {
    const before = c.req.query('before');
    const q = c.req.query('channel');
    const slug = q ? (q.toLowerCase() as ChannelSlug) : undefined;
    if (slug && channelId(config, slug) === undefined) {
      return c.text(`unknown channel: ${slug}`, 404);
    }
    if (!before) return c.text('missing before=YYYY-MM-DD', 400);
    try {
      const data = await history.fetchPrev(before, slug);
      return c.json(data, 200, { 'Cache-Control': 'no-store' });
    } catch (e) {
      if (e instanceof HttpError && e.status === 400) return c.text(e.message, 400);
      throw e;
    }
  });

  /* ------------------------------------------------- catch-up: /replay/<epg>.m3u8 */
  // Hono (this version) mis-parses `:param.ext` segment patterns, so replay
  // uses a wildcard and strips the optional .m3u8 suffix manually.
  app.get('/replay/*', async (c) => {
    const epgId = c.req.path.slice('/replay/'.length).replace(/\.m3u8$/i, '');
    if (!/^\d+$/.test(epgId)) return c.text(`unknown route: ${c.req.path}`, 404);

    const master = await api.resolveEpgMaster(epgId);
    const { body, headers, status } = await cdn.serveMaster(master, {
      filter: qualityFilter(c.req.query('quality')),
      ifNoneMatch: c.req.header('if-none-match'),
      ifModifiedSince: c.req.header('if-modified-since'),
    });
    return sendProxied(c, { body, headers, status });
  });

  /* ------------------------------------------------- live: /<channel>.m3u8 */
  // Registered explicitly per known slug (the `.m3u8` suffix is not a valid
  // Hono `:param.ext` pattern in this version); `/foo.m3u8` falls through to
  // notFound.
  for (const slug of Object.keys(config.channels)) {
    app.get(`/${slug}.m3u8`, async (c) => {
      const master = await api.resolveMaster(config.channels[slug as ChannelSlug]);
      const { body, headers, status } = await cdn.serveMaster(master, {
        filter: qualityFilter(c.req.query('quality')),
        ifNoneMatch: c.req.header('if-none-match'),
        ifModifiedSince: c.req.header('if-modified-since'),
      });
      return sendProxied(c, { body, headers, status });
    });
  }

  /* ---------------------------------------- built frontend (web/dist) */
  // The Node entry (index.ts) registers a `serveStatic` catch-all here; the
  // Workers entry (worker.ts) falls back to the ASSETS binding. When neither
  // is configured the notFound handler below replies with a plain 404.

  app.notFound((c) => c.text(`unknown route: ${c.req.path}`, 404));

  app.onError((err, c) => {
    const status = (err instanceof HttpError ? err.status : 502) as ContentfulStatusCode;
    return c.text(`proxy error: ${err.message}`, status);
  });
}
