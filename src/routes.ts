import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HttpError } from './rctiplus.js';
import type { ApiClient } from './rctiplus.js';
import type { CdnProxy } from './hls.js';
import { unb64 } from './hls.js';
import type { ScheduleService } from './schedule.js';
import type { Config, ChannelSlug, ChannelId } from './config.js';
import { playerPage } from './player.js';

/** Everything the route handlers need, wired up in `index.ts`. */
export interface Services {
  config: Config;
  api: ApiClient;
  cdn: CdnProxy;
  schedule: ScheduleService;
  port: number;
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

export function registerRoutes(app: Hono, services: Services): void {
  const { config, api, cdn, schedule, port } = services;

  app.get('/', (c) => c.html(playerPage(port, playerChannels(config))));
  app.get('/favicon.ico', (c) => c.body(null, 204));

  /* --------------------------------------------- proxied HLS asset (/h/<b64>) */
  app.get('/h/:b64', async (c) => {
    const url = unb64(c.req.param('b64'));
    try {
      const { body, headers } = await cdn.handleAsset(url);
      return c.body(body, 200, headers);
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

  /* ------------------------------------------------- catch-up: /replay/<epg>.m3u8 */
  // Hono (this version) mis-parses `:param.ext` segment patterns, so replay
  // uses a wildcard and strips the optional .m3u8 suffix manually.
  app.get('/replay/*', async (c) => {
    const epgId = c.req.path.slice('/replay/'.length).replace(/\.m3u8$/i, '');
    if (!/^\d+$/.test(epgId)) return c.text(`unknown route: ${c.req.path}`, 404);

    const master = await api.resolveEpgMaster(epgId);
    const { body, headers } = await cdn.serveMaster(master);
    return c.body(body, 200, headers);
  });

  /* ------------------------------------------------- live: /<channel>.m3u8 */
  // Registered explicitly per known slug (the `.m3u8` suffix is not a valid
  // Hono `:param.ext` pattern in this version); `/foo.m3u8` falls through to
  // notFound.
  for (const slug of Object.keys(config.channels)) {
    app.get(`/${slug}.m3u8`, async (c) => {
      const master = await api.resolveMaster(config.channels[slug as ChannelSlug]);
      const { body, headers } = await cdn.serveMaster(master);
      return c.body(body, 200, headers);
    });
  }

  app.notFound((c) => c.text(`unknown route: ${c.req.path}`, 404));

  app.onError((err, c) => {
    const status = (err instanceof HttpError ? err.status : 502) as ContentfulStatusCode;
    return c.text(`proxy error: ${err.message}`, status);
  });
}
