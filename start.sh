#!/bin/sh
# Start the RCTI+ VLC proxy (Hono + TypeScript)
cd "$(dirname "$0")" || exit 1
PORT="${1:-8080}"
exec node --import tsx src/index.ts "$PORT"
