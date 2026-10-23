# RCTI+

RCTI+ live TV and catch-up replay proxy, plus an immersive TV player.

| App | Stack | Deploy |
| --- | --- | --- |
| [`apps/api`](apps/api) | Nitro + Effect v4 | Cloudflare Workers |
| [`apps/web`](apps/web) | Nuxt SPA + hls.js | GitHub Pages |

Technical spec and endpoints: [docs/SPEC.md](docs/SPEC.md)

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | API on :3000 and web on :3001 |
| `bun run build` | Build API worker and static web output |
| `bun run test` | `bun test` across workspaces |
| `bun run lint` | `oxlint` |
| `bun run typecheck` | Typecheck both apps |

## Local usage

```bash
bun install
bun run dev
```

| Endpoint | Purpose |
| --- | --- |
| `GET /channels` | Channel slugs for the player |
| `GET /rcti.m3u8` | Live master playlist (`mnctv`, `gtv`, `inews`) |
| `GET /replay/{epg_id}.m3u8` | Catch-up master playlist |
| `GET /schedule?channel=rcti` | 7-day catch-up listing |
| `GET /history/day/{YYYY-MM-DD}` | Deep history for one date |
| `GET /history/prev?before={date}` | Next older playable day |
| `GET /history/range` | Playable archive window |
| `GET /h/{base64url}` | Proxied playlist or segment |

Append `?quality=best` (or `480`, `720`, ...) to pin a single variant.

## Configuration

| Variable | App | Purpose |
| --- | --- | --- |
| `NUXT_PUBLIC_API_BASE` | web | Public API origin baked into the SPA build |
| `NUXT_APP_BASE_URL` | web | Base path when Pages serves the app from a subpath |
| `CLOUDFLARE_API_TOKEN` | api | Workers deploy token |
| `CLOUDFLARE_ACCOUNT_ID` | api | Cloudflare account |
| `CLOUDFLARE_WORKER_NAME` | api | Worker name override |

The API is stateless, so Workers needs no bindings or secrets beyond the deploy
credentials.
