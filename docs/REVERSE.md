# RCTI+ reversal notes

What was learned about RCTI+ (MNC Group) live TV and replay streaming, and how
it was learned. The proxy contract built on these findings lives in
[API.md](./API.md).

Reversal date: 2026 08 04. Retention measurements: 2026 08 05.

## 1. Findings at a glance

| Item | Finding |
|---|---|
| Channels | RCTI (1), MNCTV (2), GTV (3), iNews (4) |
| DRM | none, `is_drm: "no"` |
| Geo lock | none, `geoblock: "no"` |
| Transport | HLS: master, variant, MPEG TS segments |
| Live ladder | 5 variants, 144p to 720p, H.264 + AAC, 25 fps |
| Replay window | the page lists 7 days, the CDN keeps about 4 months |
| Protections | Referer ACL, Akamai `hdnts` and `hdntl` tokens, visitor JWT, expiring URLs |

## 2. Upstream topology

```
RCTI+ backend
  toutatis.rctiplus.com
    /video/live/api/v1/...   JSON API: signed stream URLs, EPG metadata
    /graphql                 mobile app API, needs x_api_token, unused here
  www.rctiplus.com           server rendered web app, embeds the visitor JWT
        |
        | signed HLS URL + visitor JWT
        v
CDN *.rctiplus.id (Tengine)
  rcti-linier / mnctv-linier / gtv-linier / inews-linier   live
  past-event.rctiplus.id                                   replay VOD
```

Both layers reject requests that miss the Referer header. The CDN also demands
the signed token that the JSON API hands out, therefore a plain URL copied from
the API stops working after a few hours and fails at once without a Referer.

## 3. Authentication

### 3.1 Anonymous visitor JWT

Every JSON API call carries:

```
Authorization: <visitor JWT>
apikey: k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0
Origin: https://www.rctiplus.com
Referer: https://www.rctiplus.com/
```

The visitor JWT is a standard HS256 JWT. Payload:

```jsonc
{
  "vid": 0,                                             // anonymous user id
  "token": "f9ab122856d74f0f",                          // per guest id
  "pl": "web",                                          // platform
  "device_id": "29e5fd8a-086a-11ef-9ba0-00163e0418ec"   // per session UUID
}
```

The header is `{"typ":"JWT","alg":"HS256"}` and the signature is opaque. The
web app embeds a fresh token on every page render:

```
https://www.rctiplus.com/tv/rcti  ->  var visitorsToken = "eyJ0eXAiOiJKV1Qi...";
```

A proxy can scrape that variable from the page and refresh it on a timer. A
static token also works until RCTI+ rotates the signing key.

### 3.2 What is not required

| Requirement | Status | Note |
|---|---|---|
| User login | not needed | anonymous sessions reach all four free to air channels |
| GraphQL `x_api_token` | not needed | mobile app signing scheme, unused here |
| Firebase or Firestore | not needed | the mobile app reads stream URLs from a private Firestore document `dai/rplus_<id>`, field `mweb.url` |

The Firestore path is a dead end for external clients: the document is private
and the mobile app also needs a signed GraphQL token. The desktop JSON API
below is public and simpler.

## 4. JSON API

Base: `https://toutatis.rctiplus.com/video/live/api/v1`

### 4.1 Live

`GET /live/{channel_id}/url?appierid=<any string>`

`channel_id`: `1` RCTI, `2` MNCTV, `3` GTV, `4` iNews.

Response `data`:

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
  "epg": { "id": 328776, "start": "23:00", "end": "23:59", "title": "...", "date": "2026-08-04" },
  "vmap_data": { "vmap": "https://ads.rctiplus.com/ads/v1/vmap?...", "vmap_ima": "..." }
}
```

`epg` describes the program on air and `vmap_data` points at ad manifests. A
player can ignore both.

### 4.2 Replay

`GET /epg/{epg_id}/url?appierid=<any string>`

`epg_id` is the program id from the schedule, for example `328332`.

Response `data`:

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
  "player_timeout_ads": 0, "player_timeout_content": 0
}
```

`epg_details.date` is the only reliable way to map an id to a day, therefore
id discovery is driven by this field.

### 4.3 Errors

| Reply | Meaning |
|---|---|
| `{"message":"Server Error"}` | backend error, bad parameters or outage |
| HTTP 403 | blocked IP or geo restriction |
| HTTP 401 or 403 | missing or invalid token |

## 5. CDN and HLS

All CDNs are Tengine behind Aliyun and Akamai style protection.

### 5.1 Referer ACL

Every request to `*.rctiplus.id` must include:

```
Referer: https://www.rctiplus.com/
```

A missing or mismatched Referer yields `403 denied by Referer ACL`. The rule is
enforced on the master too, therefore even a URL signed by the API fails when
fetched without the header.

### 5.2 Live HLS

Hosts: `rcti-linier`, `mnctv-linier`, `gtv-linier`, `inews-linier`, all under
`rctiplus.id`.

Master: `/{channel}-sdi.m3u8?hdnts=exp=<unix>~hmac=<sha256>`, an Akamai token
in the query string, valid about 10 hours.

Variant lines are relative and carry a second token (`hdntl`, valid about 5
hours) in the path:

```
#EXT-X-STREAM-INF:BANDWIDTH=1272655,RESOLUTION=1280x720,...
hdntl=exp=1785913745~acl=%2F*~data=hdntl~hmac=<sha256>/rcti-sdi-avc1_1000000=17-mp4a_96000=1.m3u8
```

Five variants: 256x144, 426x240, 640x360, 854x480, 1280x720, H.264 + AAC at 25
fps.

Segments, relative to the variant URL directory:

```
rcti-sdi-avc1_210000=10-mp4a_96000=1-begin=3657884650000000-dur=40000000-seq=91447117.ts
```

The variant playlist uses `#EXT-X-TARGETDURATION:4` and a sliding window with
`#EXT-X-MEDIA-SEQUENCE`.

### 5.3 Replay HLS

Host: `past-event.rctiplus.id`. The master URL is a bitrate basket template:

```
/vids/{slug}-{hex}-{DDMMYY}/v_,2.,3.,mp4.kkvod/rctiplus.m3u8
```

The `v_,2.,3.,mp4.kkvod` segment is a placeholder that maps onto concrete
variant playlists:

| Variant | Resolution | Bandwidth |
|---|---|---|
| `index-f1-v1-a1.m3u8` | 854x480 | 683043 |
| `index-f2-v1-a1.m3u8` | 1280x720 | 1079092 |

Segments are relative to the variant directory: `seg-{n}-f2-v1-a1.ts`. The
variant playlist sets `#EXT-X-PLAYLIST-TYPE:VOD` and
`#EXT-X-TARGETDURATION:10`. VOD tokens are long lived, no `hdntl` reissue was
observed.

### 5.4 Token lifetimes

| Token | Location | Life |
|---|---|---|
| `hdnts` | live master query | about 10 hours |
| `hdntl` | live variant path | about 5 hours |
| VOD token | replay master and variants | long lived, no refresh seen |

The `current_date` and `current_ts` fields in API replies follow the server
clock. A proxy should resolve the stream again instead of computing token
expiry.

## 6. Schedule listing

The desktop TV page renders the full 7 day replay window on the server:

```
https://www.rctiplus.com/tv/{channel}
```

Each program is an anchor of this shape:

```html
<a onclick="...; clickCatchup( 'https://www.rctiplus.com/tv/rcti/328332/si-cantik-dari-masa-lalu?date=2026-07-29');return false;"
   href="https://www.rctiplus.com/tv/rcti/328332/si-cantik-dari-masa-lalu?date=2026-07-29">
    <h2>Si Cantik Dari Masa Lalu</h2><br> <h4>00:15 - 01:30 </h4>
</a>
```

Fields available from one anchor:

| Field | Source |
|---|---|
| `channel` | path segment after `/tv/` |
| `epg_id` | numeric segment |
| `slug` | text segment after the id |
| `date` | `?date=` query |
| `title` | `<h2>` |
| `start`, `end` | `<h4>` |

The official ajax list `https://www.rctiplus.com/live-getcatchup?date&channel`
returns `Server Error` or an empty body when called externally, therefore the
server rendered page is the stable source.

## 7. Deep history

### 7.1 Retention measured

The 7 day cap is only the listing window. Measured on 2026 08 05:

| Layer | Window | Evidence |
|---|---|---|
| Schedule page and `live-getcatchup` | 7 days | page renders exactly 7 dates, ajax empty |
| API `/epg/{id}/url` | indefinite | ids as old as 2025 03 27 resolve |
| CDN `past-event.rctiplus.id` | about 4 months | masters answer 200 from 2026 03 31, 502 before |

Replay is therefore limited by CDN retention, not by the listing. The blocker
is discoverability: an old program id appears nowhere public.

### 7.2 Locating old programs

The id space is scanned, with real dates from the API as the source of truth:

1. Anchor the newest known id from the schedule scrape, with a baked reference
   as fallback.
2. Binary search the id range for the first id whose program date is on or
   after the target date. Probes walk outward over dead gaps that appear in
   the archive region, where pruned programs leave runs of 400 replies up to
   about 70 ids long.
3. Scan a window around the located boundary and keep programs whose
   `epg_details.date` matches the target day and channel.
4. Verify playability on the CDN: fetch the master with the Referer header and
   accept only `200` plus `#EXTM3U`. This separates a resolvable URL from a
   deleted file that answers 502.
5. Skip the CDN probe for days 30 days old or newer, because the CDN keeps
   about 4 months of files. Days near the retention edge are still verified.

Recent id regions are dense, about 73 ids per day. Archive regions are sparse.
A growing probe walk crosses the gaps without knowing where they are.

### 7.3 Discovery parameters

| Constant | Value | Role |
|---|---|---|
| `IDS_PER_DAY` | 73 | average ids per day in recent regions |
| `RATE_MAX` | 120 | upper bound on ids per day for range guesses |
| `MAX_BACK_DAYS` | 200 | deepest search from the anchor |
| `SCAN_BEFORE` | 10 | ids scanned before the located boundary |
| `SCAN_AFTER` | 210 | ids scanned after the located boundary |
| `RECENT_DAYS` | 30 | days that skip the CDN playability probe |
| `WALK` | `0, ±1, ±2, ±3, ±5, ±8, ±13, ±21, ±34, ±55, ±89, ±144` | probe offsets that cross dead gaps |

### 7.4 Cost

The first browse of an old date resolves about 250 to 350 ids, a few seconds at
concurrency 16. A date inside the 7 day window with a channel given is served
from the scrape with no scan, while the same date without a channel still needs
a scan. The boundary search result is cached per date, the anchor for 12 hours,
each day for 10 minutes and each resolved id for 5 minutes.

## 8. Reversal trail

1. `m.rctiplus.com/tv/rcti` (Next.js mobile app) led to GraphQL at
   `toutatis.rctiplus.com/graphql` with apikey
   `jFFhGYfZzrEgaPIGmFOVttQzCNbvqJHb` and a client signed `x_api_token`. The
   stream URL came from a private Firestore document `dai/rplus_<id>`, field
   `mweb.url`. Dead end for external clients.
2. `www.rctiplus.com/tv/rcti` (legacy jQuery desktop app) exposed plain
   `$.ajax` calls in the page source:
   - `Authorization` equals `usercToken` equals `visitorsToken`, the embedded
     JWT, for anonymous users, and `data.access_token` for logged in users,
   - `apikey: k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0`,
   - live endpoint `.../live/1/url`, replay endpoint `.../epg/328332/url`.
3. A direct fetch of the returned URL failed with `403 denied by Referer ACL`.
   The Referer header `https://www.rctiplus.com/` is therefore required.
4. Playlists are rewritten through a proxy because variant and segment URLs are
   relative and carry Akamai `hdntl` path tokens.
5. The replay window was probed by resolving ids from known dates backward,
   which produced the retention table in section 7.1.

## 9. Fragility and recheck

| Signal | Likely cause | Recheck |
|---|---|---|
| API replies 401 or 403 | visitor JWT or apikey rotated | read `visitorsToken` from the channel page and compare `apikey` in the page source |
| API replies `Server Error` | backend outage or bad parameters | retry, then probe a known good id |
| Schedule is empty | page structure changed | inspect anchors in `https://www.rctiplus.com/tv/rcti` |
| Deep date resolves but the CDN answers 502 | program beyond retention | probe one older and one newer master |
| Live playback stops after hours | `hdnts` or `hdntl` expired | refetch the master and compare token expiry |
| Id rate drifts | programs are added at a different pace | derive ids per day from two known dates |

Probe commands:

```bash
# token and page structure
curl -s https://www.rctiplus.com/tv/rcti | grep -o 'visitorsToken *= *"[^"]*"'
curl -s https://www.rctiplus.com/tv/rcti | grep -o "clickCatchup([^)]*" | head

# API with an explicit token
curl -s -H "Authorization: $TOKEN" \
  -H 'apikey: k1DzR0yYWIyZgvTvixiDHnb4Nl08wSU0' \
  -H 'Origin: https://www.rctiplus.com' \
  -H 'Referer: https://www.rctiplus.com/' \
  'https://toutatis.rctiplus.com/video/live/api/v1/live/1/url?appierid=probe'

# CDN with the Referer ACL
curl -s -H 'Referer: https://www.rctiplus.com/' "$MASTER" | head
```

The API key and fallback token embedded in `apps/api/src/config.ts` need
updating when RCTI+ rotates them.
