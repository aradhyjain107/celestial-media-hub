#!/bin/bash
# bootstrap.sh — Set up Celestial Media Hub on a fresh machine
# Usage: ./bootstrap.sh
set -euo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
RED="\033[0;31m"
RESET="\033[0m"

info()    { echo -e "  ${BOLD}→${RESET} $1"; }
success() { echo -e "  ${GREEN}✔${RESET} $1"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $1"; }
error()   { echo -e "  ${RED}✘${RESET} $1"; }

echo ""
echo -e "${BOLD}Celestial Media Hub — Bootstrap${RESET}"
echo "────────────────────────────────────"

# ── 1. Dependency checks ──────────────────────────────────────────────────────

info "Checking Node.js..."
if ! command -v node &>/dev/null; then
  error "Node.js not found. Install from https://nodejs.org (v18+)."
  exit 1
fi
NODE_VER=$(node -e "process.stdout.write(process.versions.node)")
info "  Node $NODE_VER detected."
MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$MAJOR" -lt 18 ]; then
  error "Node.js v18+ is required (found $NODE_VER). Please upgrade."
  exit 1
fi
success "Node.js OK"

info "Checking FFmpeg..."
if ! command -v ffmpeg &>/dev/null; then
  warn "FFmpeg not found. Install with: brew install ffmpeg"
  warn "Some media processing features will not work without it."
else
  success "FFmpeg: $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"
fi

info "Checking yt-dlp..."
if ! command -v yt-dlp &>/dev/null; then
  warn "yt-dlp not found. Install with: brew install yt-dlp"
  warn "YouTube download features will not work without it."
else
  success "yt-dlp: $(yt-dlp --version 2>&1 | head -1)"
fi

# ── 2. npm install ────────────────────────────────────────────────────────────

info "Running npm install..."
npm install --silent
success "Dependencies installed."

# ── 3. .env.local setup ──────────────────────────────────────────────────────

if [ ! -f ".env.local" ]; then
  cp .env.example .env.local
  success "Copied .env.example → .env.local"
  echo ""
  echo -e "  ${YELLOW}Action required:${RESET} Edit .env.local and fill in the values:"
  echo "    NEXT_PUBLIC_API_BASE_URL  — leave blank for local dev (uses relative routes)"
  echo "    FFMPEG_PATH               — path to ffmpeg binary (e.g. /opt/homebrew/bin/ffmpeg)"
  echo "    YTDLP_PATH                — path to yt-dlp binary (e.g. /opt/homebrew/bin/yt-dlp)"
  echo "    TEMP_DIR                  — working directory for temp files (default: /tmp/celestial)"
  echo ""
else
  success ".env.local already exists — skipped."
fi

# ── 4. Create temp directory ──────────────────────────────────────────────────

TEMP_DIR="/tmp/celestial"
info "Creating temp directory at $TEMP_DIR..."
mkdir -p "$TEMP_DIR"
success "Temp directory ready: $TEMP_DIR"

# ── 5. Verify build ───────────────────────────────────────────────────────────

info "Running npm run build (this may take ~30s)..."
if npm run build --silent; then
  success "Production build successful."
else
  error "Build failed. Fix the errors above and re-run bootstrap.sh."
  exit 1
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}Bootstrap complete! 🎉${RESET}"
echo ""
echo "Next steps:"
echo "  1. Review and update .env.local if needed"
echo "  2. Start the dev server:  npm run dev"
echo "  3. Run the test suite:    ./verify.sh"
echo "  4. Open http://localhost:3000"
echo ""
