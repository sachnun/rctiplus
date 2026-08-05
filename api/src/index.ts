#!/usr/bin/env node
/**
 * RCTI+ proxy for VLC — live TV + schedule replay (catch-up).
 *
 * RCTI+ only hands out signed HLS URLs to its own web app (Referer ACL +
 * Akamai hdnts/hdntl tokens + an API key).  This proxy:
 *   1. resolves the signed master playlist from the RCTI+ API,
 *   2. serves it as /<channel>.m3u8 or /replay/<epg>.m3u8, rewriting every
 *      inner URL to go through itself (/h/<base64url>),
 *   3. fetches playlists & segments from the CDN with the required Referer
 *      header so VLC (which sends no Referer) can play them,
 *   4. exposes the 7-day catch-up schedule as JSON via /schedule, and
 *   5. finds replay beyond 7 days by scanning the EPG id space
 *      (/history/day/YYYY-MM-DD) — VOD is actually kept ~4 months on the CDN.
 *
 * The browser player is a separate Vite app in `web/`; in production the API
 * serves its built output from `web/dist`, in development the Vite dev server
 * (5173) proxies API + HLS traffic back here.
 *
 * Usage:  node --import tsx src/index.ts
 *   (port defaults to 3000 unless PORT env is set)
 *   player:  open http://localhost:3000/  (built web app from web/dist)
 *   live:    vlc http://localhost:3000/rcti.m3u8
 *   list:    curl http://localhost:3000/schedule?channel=rcti
 *   replay:  vlc "http://localhost:3000/replay/<epg_id>.m3u8"
 *   archive: curl http://localhost:3000/history/day/2026-04-05?channel=rcti
 */
import { serve } from '@hono/node-server';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

import { CONFIG } from './config.js';
import { createCache } from './cache.js';
import { createTokenManager } from './token.js';
import { createApiClient } from './rctiplus.js';
import { createCdnProxy } from './hls.js';
import { createScheduleService } from './schedule.js';
import { createHistoryService } from './history.js';
import { registerRoutes } from './routes.js';

const port = Number(process.env.PORT || 3000);

/** Production frontend: the built Vite app lives in `web/dist`. */
const WEB_DIST = fileURLToPath(new URL('../../web/dist', import.meta.url));

/* ------------------------------------------- wire up the service graph */
const cache = createCache();
const tokenManager = createTokenManager({ config: CONFIG });
const api = createApiClient({ config: CONFIG, cache, tokenManager });
const cdn = createCdnProxy({ config: CONFIG, api, cache });
const schedule = createScheduleService({ config: CONFIG, cache });
const history = createHistoryService({ config: CONFIG, cache, api, schedule });

const app = new Hono<{ Bindings: Record<string, unknown> }>();
registerRoutes(app, { config: CONFIG, api, cdn, schedule, history });

// Built frontend catch-all, registered last so the API routes above always
// win; skipped entirely when dist is absent (Vite dev server takes over).
if (existsSync(WEB_DIST)) {
  app.get('*', serveStatic({ root: WEB_DIST }));
}

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`RCTI+ proxy running on http://localhost:${port}`);
  console.log('  live:    /rcti.m3u8 /mnctv.m3u8 /gtv.m3u8 /inews.m3u8');
  console.log('  list:    /schedule?channel=rcti');
  console.log('  replay:  /replay/<epg_id>.m3u8');
  console.log('  archive: /history/day/YYYY-MM-DD?channel=rcti');
  console.log('  range:   /history/range');
  console.log('  web:     / (built Vite app from web/dist, if present)');
});
