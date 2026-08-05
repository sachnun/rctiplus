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

## Usage

- Player: `http://localhost:3000`
- Live: `/{channel}.m3u8` (`rcti`, `mnctv`, `gtv`, `inews`)
- Replay: `/replay/{epg_id}.m3u8`
- Schedule: `/schedule?channel={slug}`

Details: [docs/SPEC.md](docs/SPEC.md)