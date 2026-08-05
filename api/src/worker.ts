/**
 * Cloudflare Workers entry point.
 *
 * Deploys the same Hono app as the Node server (src/index.ts) so the proxy
 * runs on workers.dev. The API routes are registered first; every other
 * request falls back to the Workers Static Assets binding (web/dist) so a
 * single deployment hosts the player, the JSON API and the HLS proxy.
 *
 * Deploy from the repo root (config lives in wrangler.toml at the root):
 *   npx wrangler deploy
 */
import { Hono } from 'hono';

import { CONFIG } from './config.js';
import { createCache } from './cache.js';
import { createTokenManager } from './token.js';
import { createApiClient } from './rctiplus.js';
import { createCdnProxy } from './hls.js';
import { createScheduleService } from './schedule.js';
import { createHistoryService } from './history.js';
import { registerRoutes } from './routes.js';

/** Minimal stand-in for the Workers `Fetcher` type (avoids workers-types dep). */
interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env extends Record<string, unknown> {
  ASSETS: AssetsBinding;
}

const cache = createCache();
const tokenManager = createTokenManager({ config: CONFIG });
const api = createApiClient({ config: CONFIG, cache, tokenManager });
const cdn = createCdnProxy({ config: CONFIG, api, cache });
const schedule = createScheduleService({ config: CONFIG, cache });
const history = createHistoryService({ config: CONFIG, cache, api, schedule });

const app = new Hono<{ Bindings: Env }>();
registerRoutes(app, { config: CONFIG, api, cdn, schedule, history });

// Static assets fallback (web/dist) — registered last so API routes win.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
};
