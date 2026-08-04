# RCTI+ Proxy for VLC — Live TV & Schedule Replay

Stream RCTI, MNCTV, GTV and iNews **live** plus **7-day catch-up replays**
in VLC, without DRM issues.

## How it works

RCTI+ only hands out signed HLS URLs to its own web app:

- **Live**: resolved at runtime from
  `https://toutatis.rctiplus.com/video/live/api/v1/live/<channel>/url`
- **Replay**: `https://toutatis.rctiplus.com/video/live/api/v1/epg/<epg_id>/url`
- Both use an anonymous visitor JWT + API key; URLs are Akamai token-signed
  (`hdnts`/`hdntl` for live, long-lived tokens for replays) and expire.
- The CDN (`*.rctiplus.id`) enforces a **Referer ACL**: requests without the
  right `Referer` header get `403 denied by Referer ACL`. VLC sends no
  Referer, so raw URLs never play directly in VLC.

This proxy fixes that: it resolves a fresh signed master per request and
re-serves every playlist/segment through itself (`/h/<b64>`) with the
required headers. Playlists are rewritten so all inner URLs point back to
the proxy. When a live token dies mid-session the proxy 302-redirects VLC
to a fresh master.

The 7-day catch-up schedule is scraped from the server-rendered TV page.

## Usage

```sh
node proxy.js [port]     # default 8080
```

### Live TV (VLC → Open Network Stream)

```
http://localhost:8080/rcti.m3u8
```

| URL            | Channel |
|----------------|---------|
| `/rcti.m3u8`   | RCTI    |
| `/mnctv.m3u8`  | MNCTV   |
| `/gtv.m3u8`    | GTV     |
| `/inews.m3u8`  | iNews   |

### Schedule (JSON)

```sh
curl http://localhost:8080/schedule?channel=rcti
# or /rcti/schedule
```

Returns the last 7 days of catch-up programs:

```json
{ "channel": "rcti", "generated_at": "...", "items": [
  { "epg_id": 328332, "slug": "si-cantik-dari-masa-lalu", "date": "2026-07-29",
    "title": "Si Cantik Dari Masa Lalu", "start": "00:15", "end": "01:30",
    "url": "/replay/328332.m3u8", "permalink": "https://..." }
] }
```

### Replay (VLC)

```
vlc "http://localhost:8080/replay/<epg_id>.m3u8"
```

Replays have 480p & 720p variants (VOD, no DRM).

## Requirements

- Node.js 18+ (global `fetch`)
- Network access to `toutatis.rctiplus.com`, `*.rctiplus.id`,
  `www.rctiplus.com`

## Notes

- Live tokens (`hdnts`/`hdntl`) expire after a few hours; reopening the URL
  re-resolves fresh ones. Replay tokens are VOD-style and long-lived.
- The visitor token is refreshed from the RCTI+ page every 15 min; a static
  fallback token is baked in.
- Geo-restriction: streams are `geoblock: no`, but if your IP is blocked the
  API returns an error and the proxy answers `502`.
- Reversed 2026-08: endpoint + API key may change; update `API_KEY`, `REFERER`
  in `proxy.js` if it stops working.
