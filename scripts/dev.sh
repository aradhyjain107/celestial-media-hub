#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/dev.sh  —  Celestial supervised dev launcher
#
# Starts the Next.js dev server under PM2 process supervision so it
# auto-restarts on crashes, OOM kills, or port conflicts.
#
# Usage:
#   npm run dev:supervised      # start / attach
#   npm run dev:stop            # graceful stop
#   npm run dev:restart         # rolling restart (no downtime)
#   npm run dev:status          # show PM2 process table
#   npm run dev:logs            # live log tail
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Ensure PM2 is available
if ! command -v pm2 &>/dev/null; then
  echo ""
  echo "  ⚠  PM2 not found. Installing globally…"
  npm install -g pm2
  echo "  ✓  PM2 installed."
  echo ""
fi

# Ensure logs/ directory exists
mkdir -p "$ROOT/logs"

cd "$ROOT"

# If already running, just attach to logs
if pm2 describe celestial-dev &>/dev/null 2>&1; then
  echo ""
  echo "  ✓  celestial-dev is already running."
  echo "     Use 'npm run dev:status' to inspect, 'npm run dev:restart' to restart."
  echo ""
  pm2 logs celestial-dev --lines 30
else
  echo ""
  echo "  ⬡  Starting Celestial Media Hub under PM2 supervision…"
  echo ""
  # Free port 3000 if an unmanaged orphan process is holding it
  if lsof -ti :3000 &>/dev/null; then
    echo "  ⚠  Port 3000 in use. Freeing port 3000 before starting…"
    kill -9 $(lsof -ti :3000) 2>/dev/null || true
    sleep 1
  fi
  pm2 start ecosystem.config.js --only celestial-dev
  echo ""
  echo "  ✓  Server is live at http://localhost:3000"
  echo "  ✓  Health check: http://localhost:3000/api/health"
  echo ""
  pm2 logs celestial-dev
fi
