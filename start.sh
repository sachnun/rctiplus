#!/bin/sh
# Start the RCTI+ VLC proxy
cd "$(dirname "$0")" || exit 1
PORT="${1:-8080}"
exec node proxy.js "$PORT"
