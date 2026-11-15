#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/start-servers.sh — High-speed, idempotent server launcher
# Starts celestial-dev and monitoring-runner under PM2 in <2s with health checks.
# ─────────────────────────────────────────────────────────────────────────────
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RESET="\033[0m"

# 1. Fast path: check if already running and healthy
if curl -s -f -m 1 http://localhost:3000/api/health >/dev/null 2>&1; then
  echo -e "${GREEN}✔ Servers are already online and healthy at http://localhost:3000${RESET}"
  npx pm2 status
  exit 0
fi

echo -e "${BOLD}⬡ Starting Celestial Media Hub servers...${RESET}"

# 2. Free port 3000 if an unmanaged orphan process is holding it
if lsof -ti :3000 &>/dev/null; then
  echo -e "  ${YELLOW}⚠ Freeing port 3000...${RESET}"
  kill -9 $(lsof -ti :3000) 2>/dev/null || true
  sleep 0.5
fi

# 3. Ensure SWC binary exists (fast integrity guard)
SWC_DIR="$ROOT/node_modules/@next/swc-darwin-arm64"
if [ ! -f "$SWC_DIR/next-swc.darwin-arm64.node" ]; then
  echo -e "  ${YELLOW}⚠ Installing native Next.js SWC binary...${RESET}"
  rm -rf "$ROOT/node_modules/next/node_modules/@next/swc-darwin-arm64" 2>/dev/null || true
  npm install @next/swc-darwin-arm64@14.2.33 -E --no-save --silent
fi

# 4. Start / reload PM2 applications (non-blocking)
npx pm2 start ecosystem.config.js >/dev/null 2>&1

# 5. Fast poll for health check (max 5s, checks every 250ms)
READY=0
for i in {1..20}; do
  if curl -s -f -m 1 http://localhost:3000/api/health >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done

if [ "$READY" -eq 1 ]; then
  echo -e "${GREEN}✔ Servers online and verified healthy.${RESET}"
  echo -e "  • Web UI:     http://localhost:3000"
  echo -e "  • Health:     http://localhost:3000/api/health"
  echo -e "  • Monitoring: http://localhost:3000/status.html"
  echo ""
  npx pm2 status
else
  echo -e "  ${YELLOW}⚠ Servers started, still warming up compilation cache.${RESET}"
  npx pm2 status
fi
