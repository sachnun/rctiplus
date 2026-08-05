#!/usr/bin/env bash
# Build the RCTI+ TV debug APK inside a container (podman or docker).
#
#   ./build-apk.sh            # build with podman (or docker if podman missing)
#   ENGINE=docker ./build-apk.sh
#
# Output: app/build/outputs/apk/debug/app-debug.apk
set -euo pipefail
cd "$(dirname "$0")"

ENGINE="${ENGINE:-$(command -v podman || command -v docker)}"
if [ -z "$ENGINE" ]; then
    echo "error: need podman or docker to build" >&2
    exit 1
fi

IMG="rctiplus-android-build"
CACHE_VOL="rctiplus-gradle-cache"

echo "== building image: $ENGINE build -t $IMG -f Dockerfile.build ."
"$ENGINE" build --network=host -t "$IMG" -f Dockerfile.build .

echo "== compiling APK (gradle cache kept in volume '$CACHE_VOL')"
"$ENGINE" run --rm --network=host \
    -v "$PWD":/src:Z \
    -v "$CACHE_VOL":/root/.gradle \
    -w /src \
    "$IMG" \
    bash -lc '
        gradle --no-daemon wrapper --gradle-version 8.11.1
        gradle --no-daemon assembleDebug
    '

echo
echo "OK — APK: $PWD/app/build/outputs/apk/debug/app-debug.apk"
