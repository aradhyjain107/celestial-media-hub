#!/bin/sh
set -e

# Ensure temp directory exists and is writable by the container user
mkdir -p "${TEMP_DIR:-/tmp/celestial}"

# Ensure a strong HS256 JWT_SECRET (>= 32 chars) even if Space Secrets weren't set yet
if [ -z "${JWT_SECRET}" ] || [ "${#JWT_SECRET}" -lt 32 ]; then
  export JWT_SECRET
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  echo "[celestial-entrypoint] Generated ephemeral runtime JWT_SECRET (set JWT_SECRET in Space Secrets for persistent tokens across restarts)."
fi

PORT="${PORT:-7860}"
echo "[celestial-entrypoint] Starting Celestial Media Hub on 0.0.0.0:${PORT}..."
exec ./node_modules/.bin/next start -p "${PORT}" -H 0.0.0.0
