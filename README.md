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

## Code quality (fallow)

Static analysis config lives in [`.fallowrc.jsonc`](.fallowrc.jsonc): the
Cloudflare Worker entry (`worker.ts`, declared in `wrangler.toml`) is seeded as
a known entry point, API CRAP scores use the real vitest coverage, and the
untested web player gets a documented complexity ceiling.

| Command               | What it does                    |
| --------------------- | ------------------------------- |
| `npx fallow`          | Full review: dead code + dupes + health (0 findings = exit 0) |
| `npm run coverage -w @rctiplus/api` | Generate `packages/api/coverage/` for accurate CRAP |
| `npx fallow audit --coverage packages/api/coverage/coverage-final.json` | Gate only the files your branch changed |

## Spec

Technical spec and endpoints: [SPEC.md](SPEC.md)
