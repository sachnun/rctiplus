# RCTI+ TV — Android TV app

Native Android TV player for the [RCTI+ proxy](../../README.md), deployed at
`https://rcti-plus.sachnun.workers.dev`. A single, web-like screen — minimal
and dependency-light:

- **Player-first** — full-screen media3 ExoPlayer HLS in a `PlayerView`; the
  first channel's live feed auto-plays on boot (like the web player). Quality
  is pinned server-side (`?quality=best`); the proxy's token self-heal (302)
  is followed automatically.
- **Chrome HUD** — a small program/channel label and a `Channels` button fade
  in on any key/touch and out after 3.5s of idle.
- **Left slide-in menu** (same look as the web sidebar): hairline channel
  rows (`01`, `02`, …) and a `Replay` section with date headers
  (Hari Ini / Kemarin / absolute), paging deeper via `/history/prev` until
  the ~4-month CDN boundary. Selecting a channel plays it live and reloads
  its replay; picking a program plays that catch-up and dismisses the menu.

Dependencies: leanback (theme only), media3 (exoplayer/hls/ui), lifecycle.
JSON is parsed with `org.json`; HTTP with `HttpURLConnection` — no OkHttp, no
serialization plugin, no settings screen (the proxy is a fixed remote HTTPS
origin).

## Layout

```
app/src/main/java/com/rctiplus/tv/
├── MainActivity.kt        player + chrome HUD + slide-in menu (single screen)
├── data/Api.kt            BASE_URL + JSON endpoints (/schedule, /history/prev)
├── data/Model.kt          Channel / ReplayItem / PrevResult
└── ui/MenuAdapter.kt      replay feed adapter (date headers + program rows)
```

## Build the APK

### Via container (podman or docker) — no local Android toolchain

```bash
./build-apk.sh
# ENGINE=docker ./build-apk.sh   # if you prefer docker
```

The script builds a JDK 17 + Android SDK 35 + Gradle 8.11.1 image, keeps a
gradle dependency cache in a named volume, and emits
`app/build/outputs/apk/debug/app-debug.apk`.

### Via Android Studio / WSL2

Open the `android-tv/` directory in Android Studio (or run
`./gradlew assembleDebug` in WSL2 with OpenJDK 17 + Android SDK 35
installed), then install the debug APK.

## Install on the TV

```bash
adb connect <tv-ip>:5555     # enable "USB/network debugging" on the TV
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Notes

- minSdk 21 (all Android TV devices), targetSdk 35, no touchscreen required,
  leanback launcher banner included.
- Live URL shape: `https://rcti-plus.sachnun.workers.dev/{channel}.m3u8?quality=best`
- Replay URL shape: `https://rcti-plus.sachnun.workers.dev/replay/{epg_id}.m3u8`
- Debug APKs are signed with `app/debug.keystore` (stable across rebuilds, so
  `adb install -r` upgrades in place); it is git-ignored — regenerate with
  `keytool` if missing, or delete the file to let Gradle fall back to the
  default debug signing.
