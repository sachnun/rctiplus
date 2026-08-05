# RCTI+

RCTI+ live TV + catch-up replay — monorepo.

## Packages

| Package                                                         | Description |
| --------------------------------------------------------------- | ----------- |
| [`@rctiplus/api`](packages/api/README.md) | API proxy + Worker |
| [`@rctiplus/web`](packages/web/README.md) | Web player  |
| [`@rctiplus/apk`](packages/apk/README.md) | Native TV app |

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
