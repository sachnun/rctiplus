# @rctiplus/web

RCTI+ browser player — immersive minimalist Android-TV UI.

## Scripts

- `npm run dev` — Vite dev server (:5173, proxies API + HLS to :3000)
- `npm run build` — build static output to `dist/`
- `npm run preview` — preview the production build
- `npm run typecheck` — `tsc --noEmit`

Production output (`dist/`) is served by the worker/API and deployed to
Cloudflare as static assets.