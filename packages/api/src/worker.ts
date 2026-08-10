/**
 * Cloudflare Workers entry point.
 *
 * Deploys the same Hono app as the Node server (src/index.ts) so the proxy
 * runs on workers.dev. The API routes are registered first; every other
 * request falls back to the Workers Static Assets binding
 * (packages/web/dist) so a single deployment hosts the player, the JSON
 * API and the HLS proxy.
 *
 * Deploy from the repo root (config lives in wrangler.toml at the root):
 *   npx wrangler deploy
 */
import { createApiApp } from './app.js';

/** Minimal stand-in for the Workers `Fetcher` type (avoids workers-types dep). */
interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env extends Record<string, unknown> {
  ASSETS: AssetsBinding;
}

const app = createApiApp<Env>();

// Static assets fallback (packages/web/dist) — registered last so API
// routes win.
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw));

export default {
  fetch: app.fetch,
};
