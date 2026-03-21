#!/bin/bash
# verify.sh — Run the full Phase 4 verification suite
# Usage: ./verify.sh
# Exits 0 if all checks pass, 1 if any fail.
set -uo pipefail

BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"

pass() { echo -e "  ${GREEN}✔${RESET} $1"; }
fail() { echo -e "  ${RED}✘${RESET} $1"; }

FAILED=0

run_step() {
  local label="$1"
  shift
  echo ""
  echo -e "${BOLD}[$label]${RESET}"
  if "$@"; then
    pass "$label passed"
  else
    fail "$label FAILED"
    FAILED=$((FAILED + 1))
  fi
}

echo ""
echo -e "${BOLD}Celestial Media Hub — Phase 4 Verification${RESET}"
echo "────────────────────────────────────────────"

# ── 1. Lint ───────────────────────────────────────────────────────────────────
run_step "ESLint" npm run lint

# ── 2. Unit tests ─────────────────────────────────────────────────────────────
run_step "Vitest unit tests" npx vitest run

# ── 3. Production build ───────────────────────────────────────────────────────
run_step "Next.js production build" npm run build

# ── 4. Playwright visual regression ──────────────────────────────────────────
run_step "Playwright visual regression" npx playwright test tests/visual/

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────────"
if [ "$FAILED" -eq 0 ]; then
  echo -e "${GREEN}${BOLD}All checks passed ✔${RESET}"
  echo ""
  exit 0
else
  echo -e "${RED}${BOLD}$FAILED check(s) failed ✘${RESET}"
  echo ""
  exit 1
fi
