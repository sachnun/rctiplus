# RCTI+

RCTI+ live TV + catch-up replay — monorepo.

## Packages

| Package                                                         | Description |
| --------------------------------------------------------------- | ----------- |
| [`@rctiplus/rcti-api`](packages/rcti-api/README.md) | API proxy + Worker |
| [`@rctiplus/rcti-web`](packages/rcti-web/README.md) | Web player  |
| [`@rctiplus/rcti-apk`](packages/rcti-apk/README.md) | Native TV app |

## Commands

| Command               | What it does                    |
| --------------------- | ------------------------------- |
| `npm run dev`         | api :3000 + web :5173           |
| `npm run build`       | Build web + api                 |
| `npm test`            | Api unit tests                  |
| `npm run typecheck`   | Typecheck both                  |
| `npx wrangler deploy` | Deploy Worker to Cloudflare     |

## Spec

Technical spec and endpoints: [SPEC.md](SPEC.md)
