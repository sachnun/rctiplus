/**
 * Shared API app + service graph for both server entry points.
 *
 * `index.ts` (Node/@hono/node-server) and `worker.ts` (Cloudflare Workers)
 * serve the exact same Hono app; only the static-assets fallback differs
 * (serveStatic vs the ASSETS binding).  Each entry registers that fallback
 * after `createApiApp` returns, so the API/HLS routes always win.
 */
import { Hono } from 'hono';
import { CONFIG } from './config.js';
import { createCache } from './cache.js';
import { createTokenManager } from './token.js';
import { createApiClient } from './rctiplus.js';
import { createCdnProxy } from './hls.js';
import { createScheduleService } from './schedule.js';
import { createHistoryService } from './history.js';
import { registerRoutes, type Services } from './routes.js';

/** Hono app with every API/HLS route registered, ready for a static fallback. */
export function createApiApp<E extends Record<string, unknown>>(): Hono<{ Bindings: E }> {
  const services: Services = buildServices();
  const app = new Hono<{ Bindings: E }>();
  registerRoutes(app, services);
  return app;
}

/** Wire up the service graph shared by every runtime entry point. */
function buildServices(): Services {
  const cache = createCache();
  const tokenManager = createTokenManager({ config: CONFIG });
  const api = createApiClient({ config: CONFIG, cache, tokenManager });
  const cdn = createCdnProxy({ config: CONFIG, api, cache });
  const schedule = createScheduleService({ config: CONFIG, cache });
  const history = createHistoryService({ config: CONFIG, cache, api, schedule });
  return { config: CONFIG, api, cdn, schedule, history };
}
