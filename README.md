# RCTI+ Proxy for VLC — Full Technical Specification

Reverse-engineered live TV **and** catch-up replay streaming from
RCTI+ (MNC Group), served through a local proxy so VLC can play it.

- **Scope**: RCTI (1), MNCTV (2), GTV (3), iNews (4)
- **DRM**: none (`is_drm: "no"`)
- **Geo-lock**: none (`geoblock: "no"`)
- **Transport**: HLS (master → variant → MPEG-TS segments), 144p–720p
- **Replay window**: the web page lists 7 days, but VOD on the CDN is kept
  **~4 months**; the proxy can discover and play older programs too
  (see §5.1)
- **Protection defeated**: Referer ACL + Akamai token auth (`hdnts`/`hdntl`),
  client-side JWT requirement, expiring stream URLs

---

## 1. System architecture

```
                    RCTI+ backend
   ┌──────────────────────────────┐
   │ toutatis.rctiplus.com        │  API gateway (Laravel / reverse proxy)
   │   ├─ /video/live/api/v1/...  │  JSON API (stream URLs, EPG metadata)
   │   └─ /graphql                │  GraphQL (mobile app; requires x_api_token — NOT used)
   │ www.rctiplus.com             │  Server-rendered web app (HTML)
   └──────────────┬───────────────┘
                  │ signed HLS URL + visitor JWT
                  ▼
        CDN *.rctiplus.id (Tengine)         Referer ACL + Akamai hdnt tokens
        rcti-linier / mnctv-linier /        live streams
        gtv-linier / inews-linier
        past-event.rctiplus.id              catch-up VOD (kkvod basket)
                  │
                  ▼
              src/index.ts (localhost)
        - resolves fresh signed URL per request
        - injects Referer header
        - rewrites all playlist URLs through /h/<b64>
                  │
                  ▼
                 VLC
```

### Why a proxy is required

| Problem | Effect on plain URL | Fix in proxy |
|---|---|---|
| Referer ACL | CDN returns `403 denied by Referer ACL` when `Referer` header is missing | Proxy always sends `Referer: https://www.rctiplus.com/` |
| URL expiry | `hdnts`/`hdntl` tokens expire after a few hours | Master re-resolved per request; 302 self-heal to a fresh master |
| Signed-URL privacy | Master URLs valid only when obtained via the API | Proxy is the only party that ever calls the API |

---

## 2. Authentication

### 2.1 Anonymous visitor JWT

All JSON API calls require:

```
Authorization: <visitor JWT>
apikey: k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0
Origin: https://www.rctiplus.com
Referer: https://www.rctiplus.com/
```

The visitor JWT is a standard JWT (HS256). Payload:

```json
{
  "vid": 0,                                  // anonymous user id
  "token": "f9ab122856d74f0f",               // per-guest id
  "pl": "web",                               // platform
  "device_id": "29e5fd8a-086a-11ef-9ba0-00163e0418ec"  // per-session UUID
}
```

The header is `{"typ":"JWT","alg":"HS256"}`; the signature is server-side
opaque. The web app embeds a *fresh* token in every page render:

```
www.rctiplus.com/tv/rcti  →  var visitorsToken = "eyJ0eXAiOiJKV1Qi...";
```

The proxy re-extracts it from the page every 15 minutes (with a hardcoded
fallback token baked in).

### 2.2 What is NOT required

- No user login (anonymous session is enough for all 4 FTA channels)
- No GraphQL `x_api_token` (the mobile-app signing scheme; unused here)
- No Firebase/Firestore (the mobile Next.js app reads stream URLs from a
  private Firestore doc `dai/rplus_<id>` — the desktop API below is simpler
  and public)

---

## 3. JSON API (toutatis.rctiplus.com)

Base: `https://toutatis.rctiplus.com/video/live/api/v1`

### 3.1 Live — `GET /live/{channel_id}/url`

`channel_id`: `1`=RCTI, `2`=MNCTV, `3`=GTV, `4`=iNews

Request: `?appierid=<any-string>`

Response (`data`):

```jsonc
{
  "url": "https://rcti-linier.rctiplus.id/rcti-sdi.m3u8?hdnts=exp=1785895735~hmac=1c3d1b3980b425bc04fac943a76d670b1918aeb30cf9fba0aa91d02c814de1c9",
  "stream_details": {
    "id": 1, "product_id": "v_lt1", "media_type": "video",
    "title": "RCTI", "event_type": "now_playing", "streaming_type": "on air",
    "channel_code": "rcti", "is_drm": "no", "geoblock": "no",
    "is_live": true, "chat": "active", "permalink": "https://www.rctiplus.com/tv/rcti",
    "deeplink": "android-app://com.fta.rctitv/tv/rcti"
  },
  "epg": { "id": 328776, "start": "23:00", "end": "23:59", "title": "...", "date": "2026-08-04", ... },
  "vmap_data": { "vmap": "https://ads.rctiplus.com/ads/v1/vmap?...", "vmap_ima": "..." }
}
```

### 3.2 Replay / catch-up — `GET /epg/{epg_id}/url`

`epg_id` is the program id from the schedule (e.g. `328332`).

Response (`data`):

```jsonc
{
  "url": "https://past-event.rctiplus.id/vids/si-cantik-dari-masa-lalu-00270145-290726/v_,2.,3.,mp4.kkvod/rctiplus.m3u8",
  "epg_details": {
    "id": 328332, "title": "Si Cantik Dari Masa Lalu",
    "start": "00:15", "end": "01:30", "date": "2026-07-29",
    "channel": "rcti", "channel_id": 1, "label": "catchup",
    "permalink": "https://www.rctiplus.com/tv/rcti/328332/si-cantik-dari-masa-lalu?date=2026-07-29"
  },
  "vmap_data": { "vmap": "...", "vmap_ima": "..." },
  "offering": "...", "account_detail": "...",
  "player_timeout_ads": ..., "player_timeout_content": ...
}
```

### 3.3 Errors

- `{"message":"Server Error"}` — backend error (bad params / outage)
- HTTP 403 — blocked IP / geo-restriction
- Missing/invalid token → 401/403

---

## 4. CDN & HLS layout

All CDNs are Tengine behind Aliyun/Akamai-style protection.

### 4.1 Referer ACL

Every request to `*.rctiplus.id` must include:

```
Referer: https://www.rctiplus.com/
```

Missing/mismatched → `403 denied by Referer ACL` (Tengine).
(Also enforced on the master, so even the API-signed URL fails without it.)

### 4.2 Live HLS (rcti-linier / mnctv-linier / gtv-linier / inews-linier)

Master: `/{channel}-sdi.m3u8?hdnts=exp=<unix>~hmac=<sha256>` — Akamai
token-in-query, valid ≈ 10 h.

Variant lines are **relative** and carry a second token (`hdntl`, valid ≈ 5 h)
in the path:

```
#EXT-X-STREAM-INF:BANDWIDTH=1272655,RESOLUTION=1280x720,...
hdntl=exp=1785913745~acl=%2F*~data=hdntl~hmac=<sha256>/rcti-sdi-avc1_1000000=17-mp4a_96000=1.m3u8
```

Variants (5): 256x144, 426x240, 640x360, 854x480, 1280x720 — H.264 + AAC,
25 fps.

Segments (in variant playlist, relative to the variant URL directory):

```
rcti-sdi-avc1_210000=10-mp4a_96000=1-begin=3657884650000000-dur=40000000-seq=91447117.ts
```

`#EXT-X-TARGETDURATION:4`, live with sliding window (`#EXT-X-MEDIA-SEQUENCE`).

### 4.3 Replay HLS (past-event.rctiplus.id)

Master URL is a *bitrate basket* template:

```
/vids/{slug}-{hex}-{DDMMYY}/v_,2.,3.,mp4.kkvod/rctiplus.m3u8
```

The `v_,2.,3.,mp4.kkvod` segment is a placeholder that maps onto concrete
variant playlists:

```
index-f1-v1-a1.m3u8    # 854x480,  BANDWIDTH=683043
index-f2-v1-a1.m3u8    # 1280x720, BANDWIDTH=1079092
```

Segments (relative to variant directory): `seg-{n}-f2-v1-a1.ts`
`#EXT-X-PLAYLIST-TYPE:VOD`, `#EXT-X-TARGETDURATION:10`. VOD tokens are
long-lived (no `hdntl` re-issue observed).

---

## 5. Schedule (catch-up listing)

The desktop TV page renders the full 7-day catch-up window server-side:

```
https://www.rctiplus.com/tv/{channel}
```

Each program is an anchor of the form:

```html
<a onclick="...; clickCatchup( 'https://www.rctiplus.com/tv/rcti/328332/si-cantik-dari-masa-lalu?date=2026-07-29');return false;"
   href="https://www.rctiplus.com/tv/rcti/328332/si-cantik-dari-masa-lalu?date=2026-07-29">
    <h2>Si Cantik Dari Masa Lalu</h2><br> <h4>00:15 - 01:30 </h4>
</a>
```

The proxy parses these into JSON: `epg_id`, `slug`, `date`, `title`,
`start`, `end`, `url` (proxy replay URL), `permalink`.

Notes on the alternative endpoint `www.rctiplus.com/live-getcatchup?date&channel`
(the official ajax list): it returns `Server Error` / empty when called
externally, so the proxy scrapes the server-rendered page instead (stable).

### 5.1 Deep history — replay beyond the 7-day listing

The 7-day cap is **only the page's listing window** — measured directly:

| Layer | Window | Evidence (2026-08-05) |
|---|---|---|
| schedule page / `live-getcatchup` | 7 days | page renders exactly 7 dates; ajax empty |
| API `/epg/{id}/url` | indefinite | resolves ids as old as 2025-03-27 |
| CDN `past-event.rctiplus.id` | **~4 months** | masters 200 from 2026-03-31, 502 before |

So replay is genuinely limited by **CDN retention (~4 months)**, not by the
7-day listing.  The blocker is discoverability: the id of an old program is
not listed anywhere public.  The proxy solves that by scanning the EPG id
space (`src/history.ts`):

- **Anchor**: the newest known id comes from the schedule scrape (fallback:
  baked reference in `config.historyRef`), refreshed on a 12 h TTL.
- **Boundary search**: binary search over the id range using *real* dates from
  the API, so the result is immune to id-rate drift.  A growing probe walk
  (`±1, ±2, ±3, ±5, ±8, … ±144`) steps across the dead gaps that appear in
  the archive region (older programs get pruned from the API, leaving 400s
  in runs up to ~70 ids).
- **Scan**: every id in a window around the located boundary is resolved;
  programs whose `epg_details.date` matches the target (and channel) are
  kept.  Recent id regions are dense (~73 ids/day), archive regions sparse.
- **Playability check**: each candidate's master is fetched from the CDN
  (with `Referer`); only `200` + `#EXTM3U` counts as playable.  This is what
  separates a resolvable URL from a deleted file (502).
- **Fast path**: dates inside the 7-day schedule window reuse the scrape
  instead of scanning (zero API load for the common case).
- Dates closer than 7 days: `/history/day` returns instantly from the
  schedule.  Older dates: first browse scans ~250-350 ids (a few seconds,
  parallelised at 16), then everything is cached (per-day 10 min, per-id
  5 min).
- `fetchRange()` bisects the retention boundary the same way, giving the
  playable window for a date picker (fuzzy ±2 days at the fuzzy expiry edge).

---

## 6. Proxy behavior

### 6.1 Routes

| Route | Purpose |
|---|---|
| `GET /` | HTML player page (Hono JSX): channel buttons + live video + inline playable catch-up schedule (fetched from `/schedule`) |
| `GET /rcti.m3u8` (also `mnctv`, `gtv`, `inews`, `globaltv`) | live master |
| `GET /{channel}.m3u8?quality={best\|auto\|720\|480\|360\|240\|144}` | live master, quality-pinned (see §6.2 note) |
| `GET /replay/{epg_id}.m3u8` | catch-up master |
| `GET /schedule?channel={rcti\|mnctv\|gtv\|inews}` | JSON schedule (10 min cache) |
| `GET /{channel}/schedule` | same, path-style |
| `GET /history/day/{YYYY-MM-DD}?channel={slug}` | deep-history listing for one date (playability-verified, 10 min cache) |
| `GET /history/range` | playable catch-up window `{earliest, latest, days}` (1 h cache) |
| `GET /hls.js` | local hls.js bundle for the player page (no CDN dependency) |
| `GET /h/{base64url}` | internal: proxied playlist/segment |

### 6.2 Request flow (live)

1. `GET /rcti.m3u8` → `resolveMaster(1)`:
   - cache TTL 5 min (per channel)
   - `GET https://toutatis.rctiplus.com/video/live/api/v1/live/1/url?appierid=vlc-proxy`
     with `Authorization` (fresh visitor JWT) + `apikey`
2. Fetch master from CDN **with** `Referer` header.
3. Rewrite every non-`#` line: `new URL(line, masterUrl)` → `/h/<b64url>`.
   (Relative `hdntl=...` lines resolve correctly against the master URL.)
4. Serve with `Content-Type: application/vnd.apple.mpegurl`, `Cache-Control: no-store`.

> **Quality pinning (proxy-side).** By default the full master (all variants)
> is served and bitrate is left to client ABR, which can end up stuck on the
> lowest variant (e.g. 144p ⇒ tiny, frequent segments). Appending
> `?quality=best` (or `?quality=480` etc.) makes the proxy **filter the master
> to a single variant** before rewriting, so *every* client (VLC included)
> plays the same quality. `best` keeps the highest-resolution variant; numeric
> values keep the highest variant at or below that height. `auto`/absent keeps
> the full master. `max-height` semantics do not re-encode the stream — the
> CDN's segment timing (4 s) is untouched.

### 6.3 Asset flow (`/h/<b64>`)

1. Decode URL; fetch from CDN with `Referer`.
2. If content is a playlist (`mpegurl|hls`): rewrite recursively and return.
3. Else (`.ts` segments): stream bytes through, `Cache-Control: public, max-age=300`.

### 6.4 Self-healing on token expiry

If a proxied playlist gets `403` and the URL contains `hdntl=` (live):
proxy invalidates the channel cache and replies `302 Location: /{channel}.m3u8`.
VLC follows the redirect and re-resolves with fresh tokens. Replays (VOD,
no `hdntl`) are not redirected.

### 6.5 Security model

- Listens on `0.0.0.0:8080` (LAN accessible).
- `appierid=vlc-proxy` identifies this client to the ad-insertion system.
- The visitor JWT is refreshed periodically; a static fallback is baked in
  so the proxy survives page-template changes.

---

## 7. Failure modes & limits

| Symptom | Cause | Handling |
|---|---|---|
| `502 proxy error: API ...` | toutatis down / blocked IP | retry later; geo-locked IPs get errors |
| `403 denied by Referer ACL` | Referer missing (direct URL use) | use proxy only |
| Playback stops after hours | live `hdnts`/`hdntl` expiry | reopen URL; proxy self-heals mid-session |
| Empty schedule | RCTI+ page structure change | update regex in `fetchSchedule()` |
| Deep date returns no items | beyond the ~4-month CDN retention (or all programs pruned) | `playable` is `false` / empty listing; pick a newer date |
| `history:range` earliest is fuzzy ±2 days | programs expire asynchronously near the retention edge | treat it as a hint for the date picker, not an exact boundary |

Token lifetimes: `hdnts` ≈ 10 h (query), `hdntl` ≈ 5 h (variant path),
replay VOD tokens long-lived. `current_date` / `current_ts` fields in API
responses are server clock — the proxy relies on re-resolution, not on
token math.

---

## 8. Extensions

- **New channels**: add slug→id in `CHANNELS`, and `<slug>-linier` in
  `CDN_CHANNEL`; channel ids are the API's own (`live/{id}/url`).
- **XMLTV/EPG export**: `/schedule` JSON already contains title/start/end/
  date — trivially convertible to `TVGuide` XMLTV for PVR tools.
- **Day playlist**: build a multi-entry `.m3u8` pointing at
  `/replay/{id}.m3u8` per program.  `/history/day/{date}` now makes this
  trivial for any date within the ~4-month retention.
- **Session cache**: bump `masterCache` TTLs if API rate-limiting is hit.

---

## 9. Reversal notes (how this was derived)

1. `m.rctiplus.com/tv/rcti` (Next.js mobile app) → GraphQL at
   `toutatis.rctiplus.com/graphql` (apikey `jFFhGYfZzrEgaPIGmFOVttQzCNbvqJHb`,
   `x_api_token` signed client-side; stream URL read from private Firestore
   doc `dai/rplus_<id>` field `mweb.url`) — dead end for external clients.
2. `www.rctiplus.com/tv/rcti` (legacy jQuery desktop app) → plain
   `$.ajax` in the page source revealed:
   - `Authorization` = `usercToken` = `visitorsToken` (embedded JWT) for
     anonymous users, or `data.access_token` for logged-in users,
   - `apikey: k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0`,
   - live endpoint `.../live/1/url`, replay endpoint `.../epg/328332/url`.
3. Direct curl of returned URL failed with `403 denied by Referer ACL`
   (Tengine) → proxy injects `Referer: https://www.rctiplus.com/`.
4. Playlists rewritten through `/h/<b64>` because variant/segment URLs are
   relative and contain Akamai `hdntl` path tokens.

Reversal date: 2026-08-04. API keys/tokens embedded in `src/config.ts` may need
updating if RCTI+ rotates them.
