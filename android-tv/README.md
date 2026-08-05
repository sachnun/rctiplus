# RCTI+ TV — Android TV app

Native Android TV player for the [RCTI+ proxy](../../README.md), deployed at
`https://rcti-plus.sachnun.workers.dev`. Minimal and dependency-light:

- **Home** — Leanback `BrowseSupportFragment`: a *Live* row (RCTI, MNCTV, GTV,
  iNews) and a *Replay* row seeded with the 7-day catch-up schedule of all
  channels, paging deeper via `/history/prev` until the ~4-month CDN boundary.
- **Player** — media3 ExoPlayer HLS in a full-screen `PlayerView` with the
  built-in TV controller. Quality is pinned server-side (`?quality=best`);
  the proxy's token self-heal (302) is followed automatically.

Dependencies: leanback, media3 (exoplayer/hls/ui), lifecycle. JSON is parsed
with `org.json`; HTTP with `HttpURLConnection` — no OkHttp, no serialization
plugin, no settings screen (the proxy is a fixed remote HTTPS origin).

## Layout

```
app/src/main/java/com/rctiplus/tv/
├── MainActivity.kt        hosts BrowseFragment
├── PlayerActivity.kt      media3 PlayerView + ExoPlayer
├── data/Api.kt            BASE_URL + JSON endpoints (/schedule, /history/prev)
├── data/Model.kt          Channel / ReplayItem / PrevResult
└── ui/
    ├── BrowseFragment.kt  rows, card click -> play, infinite-scroll paging
    └── CardPresenter.kt   leanback card rendering
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
