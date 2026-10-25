# RCTI+ proxy

Two deploys: the proxy worker that speaks HLS, and the static player that reads
it. The proxy has no JSON API: every listing is an M3U playlist, so the same URL
works in the browser player, in VLC, and as the catalog the player builds its
menu from. Upstream findings are in [REVERSE.md](./REVERSE.md).

```
apps/api/    Nitro + Effect worker, HLS only, deploy target Cloudflare Workers
apps/web/    Nuxt SPA, static files, deploy target GitHub Pages
(root)       bun scripts: dev, build, test, lint, typecheck, deploy:api, deploy:web
```

## 1. Architecture

```
          RCTI+ upstream
  toutatis.rctiplus.com   JSON API, signed stream URLs
  www.rctiplus.com        schedule page, visitor JWT
  *.rctiplus.id           HLS playlists and segments
              |
              v
  apps/api (Nitro on Cloudflare Workers)
  - resolves a fresh signed URL per request
  - injects the Referer header the CDN ACL demands
  - rewrites every playlist URL through /h/<b64>.<ext>
              |
      +-------+---------+
      v                 v
  apps/web          VLC, mpv, ffmpeg
  (GitHub Pages, cross origin, CORS *)
```

| Command | Effect |
|---|---|
| `bun run dev` | worker on :3000, Nuxt dev server on :3001 |
| `bun run build` | builds the worker, then the static SPA |
| `bun run deploy:api` | `wrangler deploy` the worker as `rctiplus-api` |
| `bun run deploy:web` | generate the SPA for GitHub Pages |
| `bun run test` | `bun test` across both apps |
| `bun run lint` | `oxlint` |
| `bun run typecheck` | both apps |

The SPA is generated with `ssr: false` and `preset: "static"`, published to
GitHub Pages under `/<repo>/`. It is served from a different origin than the
worker, so the worker answers every route with `access-control-allow-origin: *`.
The page is built with `NUXT_PUBLIC_API_BASE` pointing at the worker, and
`NUXT_APP_BASE_URL` set to the Pages sub path.

Deploy pipelines are split by path: `apps/api/**` triggers `.github/workflows/api.yml`
(environment `api`, Worker secrets), `apps/web/**` triggers `.github/workflows/web.yml`
(environment `web`, Pages).

### Why a proxy is required

| Problem | Effect on a plain URL | Fix in the worker |
|---|---|---|
| Referer ACL | CDN answers `403 denied by Referer ACL` without `Referer: https://www.rctiplus.com/` | always sends that Referer |
| Token expiry | live URLs carry an `auth_key` valid about 3 hours | playlist resolved again per request, 302 self heal |
| Signed URL privacy | a live URL only works with its own token | the worker is the only party calling the JSON API |
| Relative playlists | variant and segment URLs carry their own tokens | every URL rewritten to `/h/<b64>.<ext>` |
| No JSON CORS | `toutatis` sends no CORS headers | the browser never calls it, the worker does |

## 2. Routes

Every route below returns `application/vnd.apple.mpegurl` except the SPA and
`/health`.

| Route | Response |
|---|---|
| `GET /` | 308 redirect to `/playlist.m3u8` |
| `GET /playlist.m3u8` | catalog: live channels, then today's finished replay |
| `GET /live/{channel}.m3u8` | live master |
| `GET /live/{channel}.m3u8?quality={best\|auto\|720\|480\|360\|240\|144}` | live master, optional single variant pin |
| `GET /replay/{epg_id}.m3u8` | catch-up master |
| `GET /replay/{epg_id}.m3u8?quality=...` | catch-up master, optional pin |
| `GET /days/{channel}.m3u8` | every catch-up date, newest first |
| `GET /day/{YYYY-MM-DD}/{channel}.m3u8` | programs of one date; `channel` may be `all` |
| `GET /h/{base64url}.{ext}` | internal: proxied playlist or segment |
| `GET /health` | `{ "status": "ok" }` |
| `GET /favicon.ico` | 204 |
| anything else | `unknown route: <path>`, 404 |

CORS is open on every route: the Pages build calls the worker cross origin.

### 2.1 Catalog shape

```
#EXTM3U
#EXTINF:-1,RCTI
https://worker.example/live/rcti.m3u8
#EXTINF:-1,MNCTV
https://worker.example/live/mnctv.m3u8
#EXTINF:-1,12:15-17:30 Ikatan Cinta Aldebaran & Andin
https://worker.example/replay/334749.m3u8
```

| Element | Meaning |
|---|---|
| `#EXTINF:-1,<name>` | channel slug upper cased, or `start-end title` for a program |
| URL | absolute in `/playlist.m3u8`, root relative in the other listings |

Two rules make one file work in both a player and the SPA:

1. **No HLS tag may appear in a listing.** VLC picks between its HLS and its
   playlist demuxer by probing for `#EXT-X-` tags (`STREAM-INF`, `VERSION`,
   `TARGETDURATION`, ...). One of those would make VLC parse a channel list as a
   media playlist and fail. `HLS_TAGS` in `catalog.ts` lists the forbidden tags
   and a test asserts none of them are emitted.
2. **The program slot lives in the name.** VLC ignores `group-title` and has no
   grouping in its playlist panel, but it does show the `#EXTINF` name.

Listings reply `audio/x-mpegurl`; only `/live` and `/replay` reply
`application/vnd.apple.mpegurl`, because those really are HLS.

Catalog URLs are always stable: they never carry a CDN token, so a playlist
saved today keeps working. `/playlist.m3u8` absolutizes its entries because it
is meant to be pasted into a player by hand.

### 2.2 Channel slugs

| Slug | API id | Live host |
|---|---|---|
| `rcti` | 1 | `proxy-b.rctiplus.id/live/web/rcti/` |
| `mnctv` | 2 | `proxy-b.rctiplus.id/live/web/mnctv/` |
| `gtv` | 3 | `proxy-b.rctiplus.id/live/web/gtv/` |
| `globaltv` | 3 | alias of `gtv`, live only |
| `inews` | 4 | `proxy-b.rctiplus.id/live/web/inews/` |

The catalog lists each id once: `rcti`, `mnctv`, `gtv`, `inews`.

## 3. Playback flow

1. `GET /live/rcti.m3u8` calls `resolveMaster(1)`, cached 5 minutes:
   `GET https://toutatis.rctiplus.com/video/live/api/v1/live/1/url?appierid=vlc-proxy`
   with `Authorization` (visitor JWT), `apikey`, `Origin` and `Referer`.
2. The master is fetched from the CDN with the Referer header.
3. Duplicate variants are dropped: catch-up masters list every quality twice.
4. Every non comment line becomes `/h/<base64url>.<ext>`, resolved against the
   master URL. The extension is kept because ffmpeg based players reject segment
   URLs without one (`not in allowed_segment_extensions`).
5. The reply is `application/vnd.apple.mpegurl` with `Cache-Control: no-cache`.

Catch-up follows the same flow through `/epg/{epg_id}/url`.

### 3.1 Quality pinning

Absent or `quality=auto` serves the full master and leaves the variant to client
ABR. `quality=best` keeps the highest variant. A number keeps the highest
variant at or below that height. Pinning never transcodes: segment timing stays
as the CDN produces it.

### 3.2 Asset flow

`GET /h/{base64url}.{ext}` decodes the upstream URL and fetches it with the
Referer header.

| Upstream content | Reply |
|---|---|
| playlist | body rewritten recursively through `/h/<b64>.<ext>` |
| segment or other binary | bytes streamed through, `Cache-Control: public, max-age=300` |

Conditional requests are honoured (`If-None-Match`, then `If-Modified-Since`),
and buffered bodies support byte ranges.

### 3.3 Self healing on token expiry

A proxied playlist answering 403 whose URL carries `auth_key` or `hdnts` is
treated as an expired live token. The worker drops the cached master for that
channel and replies `302 Location: /live/{channel}.m3u8`; the client then
resolves the stream again. Catch-up URLs carry no expiring token and are never
redirected.

## 4. Listings

| Listing | Source | Cache |
|---|---|---|
| `/playlist.m3u8` | live slugs plus today's finished programs | none |
| `/days/{channel}.m3u8` | anchor date minus a 120 day budget | 1 h |
| `/day/{date}/{channel}.m3u8` | schedule scrape for 7 days, EPG scan older | 10 min |

A date past CDN retention comes back as an empty playlist rather than an error,
which keeps the client walk simple: skip empty days.

Programs that have not ended yet are marked unplayable and left out of every
listing, because their files are still being written.

## 5. Caching

| Key | TTL | Contents |
|---|---|---|
| `live:{channel_id}` | 5 min | signed live master |
| `epg:{epg_id}` | 5 min | signed catch-up master plus details |
| `schedule:{channel}` | 10 min | parsed schedule |
| `day:{date}:{channel}` | 10 min | day listing |
| `boundary:{date}` | 10 min | id to date boundary from the binary search |
| `history:anchor` | 12 h | newest known id and date |
| `history:range` | 1 h | catch-up window budget |
| `cdn:{url}` | 1 s | fetched playlist body and validators |

The visitor JWT is refreshed every 15 minutes from the channel page, with a
baked fallback. All caches live in memory inside the Worker isolate and reset
when it is recycled.

## 6. Client integration

| Player | URL |
|---|---|
| VLC | `https://rctiplus-api.primare.workers.dev/playlist.m3u8`, then `N`/`P` to switch, or let it advance |
| VLC, single channel | `https://<worker>/live/rcti.m3u8?quality=best` |
| mpv | `mpv https://<worker>/playlist.m3u8` |
| ffmpeg | `ffmpeg -i https://<worker>/live/rcti.m3u8 -c copy out.ts` |
| Replay | `https://<worker>/replay/334749.m3u8?quality=480` |
| Archive browser | `https://<worker>/days/rcti.m3u8` |

The SPA reads `/playlist.m3u8` for its channel list, `/days/{channel}.m3u8` for
the date index, and one `/day/...` playlist per scroll batch. It has no JSON
client and no schema shared with the worker.

Verified with VLC 3 on 2026 10 25: opening `/playlist.m3u8` logs
`found valid M3U playlist`, then plays RCTI, MNCTV, GTV and INEWS in order, each
through the adaptive (HLS) demuxer. ffmpeg cannot open a flat M3U listing at all
(it has no multi-item playlist demuxer), so use a per-item URL there.

## 7. Failure modes

| Symptom | Cause | Handling |
|---|---|---|
| `proxy error: API ...` with 502 | toutatis down or the caller IP is blocked | retry later |
| `403 denied by Referer ACL` | a CDN URL used directly | use the worker |
| Playback stops after hours | live `auth_key` expiry | reopen the URL, the worker self heals |
| Empty day playlist | date past CDN retention | pick a newer date |
| `not in allowed_segment_extensions` | a proxied segment URL lost its extension | keep the `.ts` suffix in `/h/` |
| VLC opens the catalog as HLS and fails | a `#EXT-X-` tag leaked into a listing | see `HLS_TAGS` |
| ffmpeg rejects `/playlist.m3u8` | flat M3U has no ffmpeg demuxer | pass a `/live` or `/replay` URL instead |
| SPA loads but lists nothing | `NUXT_PUBLIC_API_BASE` missing or stale | rebuild Pages with the worker origin |
| SPA calls the wrong worker | the Pages build baked an old `NUXT_PUBLIC_API_BASE` | update the `web` environment variable and re-run the Web workflow |

## 8. Extensions

| Extension | Path |
|---|---|
| New channel | add the slug to `CHANNELS` in `config.ts` |
| XMLTV export | build it from the `#EXTINF` names and notes |
| Longer retention | raise `MAX_LISTING_DAYS` in `history.ts` |
| Rate limiting relief | raise the live and EPG TTLs in `config.ts` |

## 9. Source map

| Concern | File |
|---|---|
| HTTP surface | `apps/api/src/routes.ts` |
| M3U building and parsing | `apps/api/src/catalog.ts` |
| Stable playback URLs | `apps/api/src/urls.ts` |
| Upstream JSON API client and caches | `apps/api/src/rctiplus.ts` |
| CDN proxy, playlist rewrite, ranges, self heal | `apps/api/src/hls.ts` |
| Schedule scrape and parsing | `apps/api/src/schedule.ts` |
| Deep history discovery | `apps/api/src/history.ts` |
| Visitor JWT | `apps/api/src/token.ts` |
| Constants and keys | `apps/api/src/config.ts` |
| Nitro handlers | `apps/api/server/routes/**` |
| Player and ABR settings | `apps/web/app/utils/player.ts` |
| Playlist client | `apps/web/app/utils/api.ts`, `apps/web/app/utils/playlist.ts` |
