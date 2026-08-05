# @rctiplus/apk

**Fully-local native Android TV player.** Unlike the web/Worker client, this
app needs **no proxy and no server**: it talks to RCTI+ directly and plays via
ExoPlayer. One screen: live channel auto-plays on boot, with a small chrome
HUD and a slide-in menu for switching channels and watching replay programs
(7-day catch-up plus deep history back ~4 months).

## How it works (local)

The app ports the proxy's logic to Kotlin, so nothing runs server-side:

| Concern                          | React setup                        |
| -------------------------------- | ---------------------------------- |
| Visitor JWT                      | `TokenManager.kt` — extracts fresh token from the RCTI+ page |
| Signed HLS resolution            | `RctiApi.kt` — `toutatis` live/epg `.url` endpoints |
| 7-day catch-up scrape            | `ScheduleScraper.kt` — parses `www.rctiplus.com/tv/{ch}` |
| Deep history (id-space scan)     | `History.kt` — anchor + binary search over EPG ids |
| Best-variant pin + CDN verify    | `Hls.kt` |
| Playback (Referer header)        | `MainActivity` ExoPlayer via `DefaultHttpDataSource` |

The shared contract (apiKey, Referer, channel→id map, history tuning)
mirrors `packages/api/src/config.ts` in `Config.kt` — keep them in sync.

## Build

```bash
./build-apk.sh              # container build (podman/docker) — no local toolchain
# ENGINE=docker ./build-apk.sh
```

Or open this directory in Android Studio / WSL2 and run `./gradlew assembleDebug`.
Output: `app/build/outputs/apk/debug/app-debug.apk`.

## Install

```bash
adb connect <tv-ip>:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```