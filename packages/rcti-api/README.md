# @rctiplus/rcti-api

RCTI+ live TV + catch-up replay proxy. Serves signed HLS manifests, proxies
CDN segments, and provides the JSON schedule/history API.

## Scripts

- `npm run dev` — run locally (:3000)
- `npm run build` — compile to `dist/`
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest unit tests
- `npm run deploy` — `wrangler deploy` (config at repo root)

See [docs/SPEC.md](../../docs/SPEC.md) for the full API surface.