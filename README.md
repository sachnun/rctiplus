# RCTI+

RCTI+ live TV + catch-up replay — monorepo. Two clients:

- **Web + Worker proxy** (`rcti-api` Hono on Cloudflare, `rcti-web` Vite player)
- **Fully-local native Android TV app** (`rcti-apk`) — no proxy, no server

## Dev

```bash
npm install
npm run dev       # api :3000 + web :5173 (proxy + web player)
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

## Native app (`rcti-apk`)

**`rcti-apk` is fully local and native** — it talks to RCTI+ directly with no
proxy and no dependency on the deployed Worker:

1. extracts the anonymous visitor JWT from the RCTI+ page,
2. resolves signed HLS masters from `toutatis.rctiplus.com` itself,
3. scrapes the 7-day catch-up page and discovers deeper history by scanning
   the EPG id space,
4. plays via ExoPlayer, which sends the Referer header the CDN ACL demands.

The shared contract (apiKey, Referer, channel→id map, deep-history tuning)
lives once in `rcti-api/src/config.ts` and is mirrored in the APK's
`Config.kt`. Build: `packages/rcti-apk/build-apk.sh` (Docker).