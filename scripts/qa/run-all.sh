#!/usr/bin/env bash
# scripts/qa/run-all.sh — Master QA Test Suite Orchestrator
set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================================"
echo "    CELESTIAL MEDIA HUB — MASTER QA SUITE EXECUTION     "
echo "========================================================"

FAILED_SUITES=()

run_suite() {
  local name="$1"
  local script="$2"
  echo ""
  echo "▶ RUNNING: $name"
  echo "--------------------------------------------------------"
  if bash "$script"; then
    echo "✔ PASSED: $name"
  else
    echo "✖ FAILED: $name"
    FAILED_SUITES+=("$name")
  fi
}

run_suite "Zero Console Errors Gate" "$SCRIPT_DIR/console-gate.sh"
run_suite "Clipboard & URL Input Sync" "$SCRIPT_DIR/clipboard-paste.sh"
run_suite "Media File Upload & Dropzone" "$SCRIPT_DIR/desktop-native-upload.sh"
run_suite "End-to-End Transcode & Stream Audit" "$SCRIPT_DIR/download-verify.sh"

echo ""
echo "========================================================"
echo "               MASTER QA SUITE SUMMARY                  "
echo "========================================================"
if [ ${#FAILED_SUITES[@]} -eq 0 ]; then
  echo "🎉 ALL 4 QA SUITES PASSED! ZERO REGRESSIONS."
  exit 0
else
  echo "🚨 FAILURES DETECTED IN: ${FAILED_SUITES[*]}"
  exit 1
fi
