#!/usr/bin/env bash
# scripts/agent-qa.sh — Automated QA Runner using agent-browser
set -eo pipefail

echo "========================================================"
echo "  Celestial Media Hub — Automated Agent Browser QA"
echo "========================================================"

URL="${1:-http://localhost:3000/tools/converter}"
SCREENSHOT_DIR="/tmp/celestial_qa_screenshots"
mkdir -p "$SCREENSHOT_DIR"

echo "1. Navigating to $URL..."
npx --yes agent-browser open "$URL"
npx --yes agent-browser wait 1200

echo "2. Inspecting interactive accessibility tree..."
npx --yes agent-browser snapshot -i

echo "3. Capturing initial state..."
npx --yes agent-browser screenshot "$SCREENSHOT_DIR/01_initial.png"

echo "4. Checking console & page errors..."
npx --yes agent-browser errors || true

echo "5. Teardown session..."
npx --yes agent-browser close

echo "========================================================"
echo "  QA Run Completed Successfully! Screenshots saved to:"
echo "  $SCREENSHOT_DIR"
echo "========================================================"
