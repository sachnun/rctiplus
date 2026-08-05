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
 *   4. exposes the 7-day catch-up schedule as JSON via /schedule.
 *
 * Usage:  node --import tsx src/index.ts
 *   (port defaults to Hono's built-in 3000 unless PORT env is set)
 *   live:    vlc http://localhost:3000/rcti.m3u8
 *   list:    curl http://localhost:3000/schedule?channel=rcti
 *   replay:  vlc "http://localhost:3000/replay/<epg_id>.m3u8"
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import { CONFIG } from './config.js';
import { createCache } from './cache.js';
import { createTokenManager } from './token.js';
import { createApiClient } from './rctiplus.js';
import { createCdnProxy } from './hls.js';
import { createScheduleService } from './schedule.js';
import { registerRoutes } from './routes.js';

const port = Number(process.env.PORT || 3000);

/* ------------------------------------------- wire up the service graph */
const cache = createCache();
const tokenManager = createTokenManager({ config: CONFIG });
const api = createApiClient({ config: CONFIG, cache, tokenManager });
const cdn = createCdnProxy({ config: CONFIG, api });
const schedule = createScheduleService({ config: CONFIG, cache });

const app = new Hono();
registerRoutes(app, { config: CONFIG, api, cdn, schedule, port });

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`RCTI+ proxy running on http://localhost:${port}`);
  console.log('  live:    /rcti.m3u8 /mnctv.m3u8 /gtv.m3u8 /inews.m3u8');
  console.log('  list:    /schedule?channel=rcti');
  console.log('  replay:  /replay/<epg_id>.m3u8');
});
