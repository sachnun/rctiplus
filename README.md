# RCTI+

RCTI+ live TV & catch-up replay proxy for VLC / browser.

- `api/` — Hono + TypeScript proxy
- `web/` — Vite + Tailwind + hls.js player

## Run

```bash
npm install
npm run dev   # api :3000, web :5173
```

- `npm run build` — build web + api
- `npm test` — api unit tests
- `npm run typecheck` — typecheck both
- `npm run deploy:temporary -w api` — deploy to Cloudflare Workers without logging in (temporary account; claim it within 60 min via the printed claim URL; requires wrangler ≥ 4.102)

## Usage

- Player: `http://localhost:3000`
- Live: `/{channel}.m3u8` (`rcti`, `mnctv`, `gtv`, `inews`)
- Replay: `/replay/{epg_id}.m3u8`
- Schedule: `/schedule?channel={slug}`

Details: [docs/SPEC.md](docs/SPEC.md)