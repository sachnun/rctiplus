# RCTI+

## Dev

```bash
npm install
npm run dev       # api :3000 + web :5173
npm run dev:api   # api only
npm run dev:web   # web only
```

## Commands

| Command               | What it does                    |
| --------------------- | ------------------------------- |
| `npm run build`       | Build web + api                 |
| `npm test`            | Api unit tests                  |
| `npm run typecheck`   | Typecheck both                  |
| `npx wrangler deploy` | Deploy Worker to Cloudflare     |

## Usage

- Player: `http://localhost:3000`
- Live: `/{channel}.m3u8` (`rcti`, `mnctv`, `gtv`, `inews`)
- Replay: `/replay/{epg_id}.m3u8`
- Schedule: `/schedule?channel={slug}`

Details: [docs/SPEC.md](docs/SPEC.md)