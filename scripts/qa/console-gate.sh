#!/usr/bin/env bash
# scripts/qa/console-gate.sh — Zero-console-error crawler for Celestial Media Hub
set -eo pipefail

BASE_URL="${1:-http://localhost:3000}"
SESSION="qa-console"
ROUTES=(
  "/"
  "/tools/muter"
  "/tools/hevc"
  "/tools/converter"
  "/tools/youtube"
  "/tools/trimmer"
  "/tools/spotify"
)

echo "========================================================"
echo "  CELESTIAL QA: Console Error & Hydration Gate"
echo "  Target: $BASE_URL"
echo "========================================================"

FAILED_ROUTES=()

for ROUTE in "${ROUTES[@]}"; do
  FULL_URL="${BASE_URL}${ROUTE}"
  echo -n "Checking $ROUTE ... "
  
  # Open route in isolated session
  npx --yes agent-browser --session "$SESSION" open "$FULL_URL" > /dev/null 2>&1 || true
  npx --yes agent-browser --session "$SESSION" wait 1500 > /dev/null 2>&1 || true
  
  # Check for unhandled exceptions or console errors
  ERRORS=$(npx --yes agent-browser --session "$SESSION" errors 2>&1 || true)
  
  if echo "$ERRORS" | grep -qiE "error|exception|unhandled|failed" && ! echo "$ERRORS" | grep -q "0 errors"; then
    echo "⚠️  ERRORS DETECTED"
    echo "$ERRORS"
    FAILED_ROUTES+=("$ROUTE")
  else
    echo "✅ CLEAN"
  fi
  
  npx --yes agent-browser --session "$SESSION" close > /dev/null 2>&1 || true
done

echo "========================================================"
if [ ${#FAILED_ROUTES[@]} -eq 0 ]; then
  echo "✅ Console Gate Passed! All ${#ROUTES[@]} routes loaded with zero errors."
  exit 0
else
  echo "❌ Console Gate Failed on routes: ${FAILED_ROUTES[*]}"
  exit 1
fi
