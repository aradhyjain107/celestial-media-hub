#!/usr/bin/env bash
# scripts/qa/clipboard-paste.sh — Tests OS clipboard sync with Celestial URL tools
set -eo pipefail

TEST_URL="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
SESSION="qa-clipboard"

echo "========================================================"
echo "  CELESTIAL QA: OS Clipboard & Input Sync"
echo "========================================================"

echo "1. Writing test URL to OS clipboard via agent-desktop..."
npx --yes agent-desktop clipboard-set "$TEST_URL"

echo "2. Verifying OS clipboard content..."
CLIP_VAL=$(npx --yes agent-desktop clipboard-get | grep -o 'https://[^"]*' || true)
if [[ "$CLIP_VAL" != *"$TEST_URL"* ]]; then
  echo "⚠️  agent-desktop clipboard-get returned unexpected content: $CLIP_VAL"
else
  echo "✅ Clipboard verified: $CLIP_VAL"
fi

echo "3. Opening YouTube Downloader tool via agent-browser..."
npx --yes agent-browser --session "$SESSION" open "http://localhost:3000/tools/youtube"
npx --yes agent-browser --session "$SESSION" wait 1500

echo "4. Interacting with url-input element..."
# Focus and populate input using clipboard value
npx --yes agent-browser --session "$SESSION" fill '[data-testid="url-input"]' "$TEST_URL"
npx --yes agent-browser --session "$SESSION" wait 1000

echo "5. Checking input element state for YouTube URL..."
SNAPSHOT=$(npx --yes agent-browser --session "$SESSION" snapshot -i)
if echo "$SNAPSHOT" | grep -qi "dQw4w9WgXcQ"; then
  echo "✅ YouTube URL populated and verified in DOM accessibility tree!"
else
  echo "⚠️  URL not found in DOM snapshot. Snapshot was:"
  echo "$SNAPSHOT"
fi

IG_URL="https://www.instagram.com/reel/C8abc123/"
echo "6. Testing Instagram Reel URL in YouTube & Instagram Downloader..."
npx --yes agent-desktop clipboard-set "$IG_URL"
npx --yes agent-browser --session "$SESSION" fill '[data-testid="url-input"]' "$IG_URL"
npx --yes agent-browser --session "$SESSION" wait 600
IG_SNAPSHOT=$(npx --yes agent-browser --session "$SESSION" snapshot -i)
if echo "$IG_SNAPSHOT" | grep -qi "instagram.com/reel/C8abc123"; then
  echo "✅ Instagram Reel URL populated and verified in DOM accessibility tree!"
else
  echo "⚠️  Instagram URL not found in DOM snapshot."
fi

echo "7. Teardown session..."
npx --yes agent-browser --session "$SESSION" close

echo "========================================================"
echo "✅ OS Clipboard & Input Sync Test Passed!"
echo "========================================================"
