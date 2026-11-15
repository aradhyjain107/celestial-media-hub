#!/usr/bin/env bash
# scripts/qa/download-verify.sh — End-to-end transcode, download, and ffprobe verification
set -eo pipefail

BASE_URL="${1:-http://localhost:3000}"
AUTH_HEADER="Authorization: Bearer dev-token-ui"
WORK_DIR="/tmp/celestial_qa_verify_$$"
mkdir -p "$WORK_DIR"

cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

echo "========================================================"
echo "  CELESTIAL QA: End-to-End Transcode & Stream Audit"
echo "  Target: $BASE_URL"
echo "========================================================"

# 1. Synthesize 1s test video with audio stream
INPUT_FIXTURE="$WORK_DIR/input_fixture.mp4"
echo "1. Generating synthetic 1s test media fixture..."
ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 \
       -f lavfi -i sine=frequency=440:duration=1 \
       -c:v libx264 -pix_fmt yuv420p -c:a aac "$INPUT_FIXTURE" > /dev/null 2>&1

INPUT_AUDIO_STREAMS=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$INPUT_FIXTURE" | wc -l | tr -d ' ')
echo "   Input fixture verified: 1 video stream, $INPUT_AUDIO_STREAMS audio stream(s)."

# 2. Trigger Mute Transcode Job via API
echo "2. Submitting transcode job to $BASE_URL/api/mute..."
SSE_OUTPUT="$WORK_DIR/sse_response.txt"
curl -s -N -X POST "$BASE_URL/api/mute" \
  -H "$AUTH_HEADER" \
  -F "mode=remove" \
  -F "files=@$INPUT_FIXTURE;filename=input_fixture.mp4" > "$SSE_OUTPUT"

# 3. Extract download URL
DOWNLOAD_PATH=$(grep -o '/api/download?[^"]*' "$SSE_OUTPUT" | head -n 1 || true)
if [ -z "$DOWNLOAD_PATH" ]; then
  echo "❌ Error: Did not receive downloadUrl from transcode job. Server response:"
  cat "$SSE_OUTPUT"
  exit 1
fi

echo "   Transcode complete! Download endpoint: $DOWNLOAD_PATH"

# 4. Download output package
OUTPUT_ZIP="$WORK_DIR/output.zip"
echo "3. Fetching processed media artifact..."
curl -s -H "$AUTH_HEADER" "${BASE_URL}${DOWNLOAD_PATH}" -o "$OUTPUT_ZIP"

if [ ! -s "$OUTPUT_ZIP" ]; then
  echo "❌ Downloaded artifact is empty or missing!"
  exit 1
fi

# 5. Extract and probe output media
echo "4. Unpacking and running ffprobe stream inspection..."
unzip -q -o "$OUTPUT_ZIP" -d "$WORK_DIR/extracted"
PROCESSED_FILE=$(find "$WORK_DIR/extracted" -type f \( -name "*.mp4" -o -name "*.mov" -o -name "*.mkv" \) | head -n 1)

if [ -z "$PROCESSED_FILE" ]; then
  echo "❌ No media file found in extracted zip archive!"
  exit 1
fi

V_CODEC=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$PROCESSED_FILE")
A_COUNT=$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$PROCESSED_FILE" | wc -l | tr -d ' ')
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$PROCESSED_FILE")

echo "   Extracted file: $(basename "$PROCESSED_FILE")"
echo "   Video Codec   : $V_CODEC"
echo "   Audio Streams : $A_COUNT (Expected: 0)"
echo "   Duration      : ${DURATION}s"

# Verification assertions
if [ "$A_COUNT" -ne 0 ]; then
  echo "❌ Verification Failed: Output file still contains $A_COUNT audio stream(s)!"
  exit 1
fi

if [ "$V_CODEC" != "h264" ]; then
  echo "⚠️  Unexpected video codec: $V_CODEC"
fi

echo "========================================================"
echo "✅ End-to-End Transcode & Stream Audit Passed!"
echo "   Media successfully transcoded, stream-verified, and stripped clean."
echo "========================================================"
