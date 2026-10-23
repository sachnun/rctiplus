# RCTI+ proxy API

Contract of the proxy in `apps/api` that serves RCTI+ live TV and replay HLS to
any player. Upstream findings behind it are in [REVERSE.md](./REVERSE.md).

```
apps/api/    Nitro + Effect proxy, deploy target Cloudflare Workers
apps/web/    Nuxt SPA player, deploy target GitHub Pages
(root)       bun scripts: dev, build, test, lint, typecheck
```

## 1. Architecture

```
            RCTI+ backend
  toutatis.rctiplus.com   JSON API, signed stream URLs
  www.rctiplus.com        schedule page, visitor JWT
              |
              v
      apps/api (Nitro on Cloudflare Workers)
      - resolves a fresh signed URL per request
      - injects the Referer header
      - rewrites every playlist URL through /h/<b64>
              |
      +-------+--------+
      v                v
  apps/web (Nuxt SPA)  VLC and other players
  hls.js, /rcti.m3u8   /replay/<epg>.m3u8
```

Commands:

| Command | Effect |
|---|---|
| `bun run dev` | API on :3000 and Nuxt dev server on :3001 |
| `bun run build` | builds the API worker, then the static Nuxt output |
| `bun run test` | `bun test` across both apps |
| `bun run lint` | `oxlint` |
| `bun run typecheck` | both apps |

The API uses the `cloudflare_module` preset. The player is a prerendered SPA and
reaches the API through `NUXT_PUBLIC_API_BASE`.

### Why a proxy is required

| Problem | Effect on a plain URL | Fix in the proxy |
|---|---|---|
| Referer ACL | CDN answers `403 denied by Referer ACL` without a Referer header | always sends `Referer: https://www.rctiplus.com/` |
| URL expiry | `hdnts` and `hdntl` tokens expire within hours | master resolved again per request, 302 self heal |
| Signed URL privacy | a master is valid only when obtained through the API | the proxy is the only party calling the API |
| Relative playlists | variant and segment URLs carry path tokens | every URL rewritten to `/h/<b64>` |

## 2. Routes

| Route | Response |
|---|---|
| `GET /` | 308 redirect to `/channels` |
| `GET /channels` | `{ channels: string[] }`, drives the player UI |
| `GET /health` | `{ status: "ok" }` |
| `GET /favicon.ico` | 204 |
| `GET /{channel}.m3u8` | live master, `rcti`, `mnctv`, `gtv`, `inews`, `globaltv` |
| `GET /{channel}.m3u8?quality={best\|auto\|720\|480\|360\|240\|144}` | live master, optional single variant pin |
| `GET /replay/{epg_id}.m3u8` | replay master |
| `GET /replay/{epg_id}.m3u8?quality=...` | replay master, optional single variant pin |
| `GET /schedule?channel={slug}` | 7 day schedule JSON |
| `GET /{channel}/schedule` | same, path style |
| `GET /history/day/{YYYY-MM-DD}?channel={slug}` | deep history listing for one date |
| `GET /history/prev?before={YYYY-MM-DD}&channel={slug}` | nearest playable day before a date |
| `GET /history/range` | playable replay window |
| `GET /h/{base64url}` | internal: proxied playlist or segment |
| anything else | `unknown route: <path>`, 404 |

CORS is open on every route (`access-control-allow-origin: *`) and
`access-control-allow-headers: *`. A browser SPA on another origin can call the
API and load the HLS output.

### 2.1 Channel slugs

| Slug | API id | Live host |
|---|---|---|
| `rcti` | 1 | `rcti-linier.rctiplus.id` |
| `mnctv` | 2 | `mnctv-linier.rctiplus.id` |
| `gtv` | 3 | `gtv-linier.rctiplus.id` |
| `globaltv` | 3 | alias of `gtv`, live only, not listed by `/channels` |
| `inews` | 4 | `inews-linier.rctiplus.id` |

`/channels` lists each id once in declaration order:
`["rcti", "mnctv", "gtv", "inews"]`. Unknown slugs answer 404 for live,
schedule and history routes. The `globaltv` alias works for live playback, while
schedule scraping only recognises the four canonical slugs and returns an empty
item list for the alias.

## 3. Live and replay playback

### 3.1 Live request flow

1. `GET /rcti.m3u8` calls `resolveMaster(1)`, cached for 5 minutes:
   `GET https://toutatis.rctiplus.com/video/live/api/v1/live/1/url?appierid=vlc-proxy`
   with `Authorization` (visitor JWT), `apikey`, `Origin` and `Referer`.
2. The master is fetched from the CDN with the Referer header.
3. Every non comment line becomes `/h/<base64url>` resolved against the master
   URL. Relative `hdntl=...` variant paths keep their tokens that way.
4. The reply is `Content-Type: application/vnd.apple.mpegurl` with
   `Cache-Control: no-cache, max-age=1` unless the CDN sets its own policy.

Replay follows the same flow through `/epg/{epg_id}/url`, cached for 5 minutes.

### 3.2 Quality pinning

Absent or `quality=auto` serves the full master and leaves the variant to client
ABR. `quality=best` keeps the highest variant. A number keeps the highest
variant at or below that height. The filtered master contains one
`#EXT-X-STREAM-INF` line and its URL.

Pinning exists for players without ABR, such as VLC. The SPA never pins a
quality: it loads the full master and lets hls.js ABR pick a variant
(`testBandwidth` off, `abrEwmaDefaultEstimate` 1 Mbit/s). Pinning never
transcodes the stream: segment timing stays as the CDN produces it.

### 3.3 Asset flow

`GET /h/{base64url}` decodes the upstream URL and fetches it with the Referer
header.

| Upstream content | Reply |
|---|---|
| playlist (`mpegurl` or `hls`) | body rewritten recursively through `/h/<b64>` |
| segment or other binary | bytes streamed through, `Cache-Control: public, max-age=300` |

Conditional requests are honoured: `If-None-Match` first, then
`If-Modified-Since`, answering 304 with the upstream validators. Byte ranges
are supported for buffered bodies through `Range`, `Content-Range` and 206
replies.

### 3.4 Self healing on token expiry

A proxied playlist answering 403 whose URL contains `hdntl=` is treated as an
expired live token. The proxy drops the cached master for that channel and
replies `302 Location: /{channel}.m3u8`; the client then resolves the stream
again with fresh tokens. Replay URLs carry no `hdntl` and are never redirected.

## 4. JSON responses

### 4.1 `GET /channels`

```jsonc
{ "channels": ["rcti", "mnctv", "gtv", "inews"] }
```

### 4.2 `GET /schedule?channel=rcti`

```jsonc
{
  "channel": "rcti",
  "generated_at": "2026-08-05T04:36:30.000Z",
  "items": [
    {
      "epg_id": 328332,
      "slug": "si-cantik-dari-masa-lalu",
      "date": "2026-07-29",
      "title": "Si Cantik Dari Masa Lalu",
      "start": "00:15",
      "end": "01:30",
      "url": "/replay/328332.m3u8",
      "permalink": "https://www.rctiplus.com/tv/rcti/328332/si-cantik-dari-masa-lalu?date=2026-07-29"
    }
  ]
}
```

The schedule covers the 7 day window the RCTI+ page renders, cached 10 minutes
inside the Worker. `channel` defaults to `rcti` on the query route and is
required on the path route. The reply carries `cache-control: no-store`, which
keeps browsers and CDNs from storing it.

### 4.3 `GET /history/day/{date}?channel=rcti`

```jsonc
{
  "date": "2026-05-01",
  "channel": "rcti",
  "generated_at": "2026-08-05T04:36:30.000Z",
  "items": [
    {
      "epg_id": 321004,
      "title": "Seputar iNews Siang",
      "start": "12:00",
      "end": "13:00",
      "channel": "rcti",
      "date": "2026-05-01",
      "url": "/replay/321004.m3u8",
      "playable": true
    }
  ]
}
```

Items are sorted by start time. `playable` is false when the API resolves a URL
but the CDN no longer has the file. The listing is cached 10 minutes per date
and channel inside the Worker, while the reply itself is `no-store`.

With a `channel` and a date inside the 7 day schedule window, the reply comes
from the schedule scrape and every item is marked playable. Without a channel,
or for older dates, the EPG id space is scanned and each candidate is checked
against the CDN.

### 4.4 `GET /history/prev?before={date}&channel=rcti`

```jsonc
{
  "date": "2026-05-01",
  "earliest": "2026-03-31",
  "items": [ /* DayItem, same shape as history/day */ ],
  "end": false
}
```

`date` is the nearest day before `before` with at least one playable item. When
the walk reaches `earliest`, the reply is `{ date: null, items: [], end: true }`.
This powers infinite scroll in the player replay panel.

### 4.5 `GET /history/range`

```jsonc
{ "earliest": "2026-03-31", "latest": "2026-08-05", "days": 128 }
```

Cached for one hour. `earliest` is fuzzy by about two days because programs
expire asynchronously at the retention edge.

### 4.6 Errors

Errors are plain text, `proxy error: <message>`, with the mapped status.

| Status | Cause |
|---|---|
| 400 | invalid date format, future date, `before` after the newest program |
| 404 | unknown channel, non numeric replay id, unknown route |
| 502 | upstream API or CDN failure, no stream URL in the reply, unreadable body |
| upstream status | passed through when the API or CDN answers an error status |

## 5. Caching

| Key | TTL | Contents |
|---|---|---|
| `live:{channel_id}` | 5 min | signed live master |
| `epg:{epg_id}` | 5 min | signed replay master plus details |
| `schedule:{channel}` | 10 min | parsed schedule |
| `day:{date}:{channel}` | 10 min | deep history listing |
| `boundary:{date}` | 10 min | id to date boundary from the binary search |
| `history:anchor` | 12 h | newest known id and date |
| `history:range` | 1 h | playable replay window |
| `cdn:{url}` | 1 s | fetched playlist body and validators |

The visitor JWT is refreshed every 15 minutes from the channel page, with a
baked fallback. All caches are in memory inside the Worker isolate and reset
when it is recycled. JSON replies are sent with `cache-control: no-store`, which
makes these TTLs the only caching layer.

## 6. Client integration

| Player | URL |
|---|---|
| Browser with hls.js | `https://<worker>/rcti.m3u8`, ABR across the full master |
| VLC or mpv | `https://<worker>/rcti.m3u8?quality=best` to avoid a low start variant |
| Replay in VLC | `https://<worker>/replay/328332.m3u8?quality=480` |
| Playlist export | `/history/day/{date}` items carry `url`, ready for a multi entry `.m3u8` |
| EPG export | `/schedule?channel=rcti` carries title, start, end and date |

The SPA builds URLs with `streamUrl(channel)` and `replayUrl(epgId)`, both
without a quality parameter, and reloads the stream when the manifest fails,
retrying twice before reporting an error.

## 7. Failure modes

| Symptom | Cause | Handling |
|---|---|---|
| `proxy error: API ...` with 502 | toutatis down or the caller IP is blocked | retry later, geo locked IPs always fail |
| `403 denied by Referer ACL` | a CDN URL used directly | use the proxy |
| Playback stops after hours | live `hdnts` or `hdntl` expiry | reopen the URL, the proxy self heals mid session |
| Empty schedule | RCTI+ page structure changed | update the anchor regex in `parseSchedule` |
| Deep date returns no items | beyond CDN retention or all programs pruned | `playable` false or an empty listing, pick a newer date |
| `earliest` off by two days | asynchronous expiry near the retention edge | treat it as a hint for a date picker |
| Player shows `API unreachable` | `NUXT_PUBLIC_API_BASE` missing or wrong | rebuild the SPA with the Worker origin |

## 8. Extensions

| Extension | Path |
|---|---|
| New channel | add the slug to id map in `CHANNELS` and `<slug>-linier` to `CDN_CHANNEL_HOSTS` |
| XMLTV export | convert `/schedule` items to `TVGuide` entries |
| Day playlist | emit one `#EXTINF` per `/history/day/{date}` item pointing at its `url` |
| Longer retention | nothing to change, discovery already walks up to 200 days back |
| Rate limiting relief | raise the live and EPG TTLs in `config.ts` |

## 9. Source map

| Concern | File |
|---|---|
| HTTP surface, quality filter, channel validation | `apps/api/src/routes.ts` |
| Upstream JSON API client and caches | `apps/api/src/rctiplus.ts` |
| CDN proxy, playlist rewrite, ranges, self heal | `apps/api/src/hls.ts` |
| Schedule scrape and parsing | `apps/api/src/schedule.ts` |
| Deep history discovery | `apps/api/src/history.ts` |
| Visitor JWT | `apps/api/src/token.ts` |
| TTL cache | `apps/api/src/cache.ts` |
| Constants and keys | `apps/api/src/config.ts` |
| Service wiring | `apps/api/src/app-layer.ts` |
| Nitro handlers | `apps/api/server/routes/**` |
| Player and ABR settings | `apps/web/app/utils/player.ts` |
| API client | `apps/web/app/utils/api.ts` |
