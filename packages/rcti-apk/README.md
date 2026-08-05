# @rctiplus/rcti-apk

Native Android TV player for the [RCTI+ proxy](../../README.md). One screen:
live channel auto-plays on boot, with a small chrome HUD and a slide-in menu
for switching channels and watching replay programs.

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
