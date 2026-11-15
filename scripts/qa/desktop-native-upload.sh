#!/usr/bin/env bash
# scripts/qa/desktop-native-upload.sh — Tests native media upload & dropzone hydration
set -eo pipefail

FIXTURE="/tmp/celestial_qa_fixture.mp4"

echo "========================================================"
echo "  CELESTIAL QA: Media File Upload & Dropzone Test"
echo "========================================================"

# Ensure test fixture exists
if [ ! -f "$FIXTURE" ]; then
  echo "1. Generating test media fixture..."
  ffmpeg -y -f lavfi -i testsrc=duration=1:size=320x240:rate=30 \
         -f lavfi -i sine=frequency=440:duration=1 \
         -c:v libx264 -pix_fmt yuv420p -c:a aac "$FIXTURE" > /dev/null 2>&1
fi

echo "1. Verifying desktop environment & OS permissions..."
npx --yes agent-desktop permissions > /dev/null 2>&1 || true

echo "2. Driving browser file chooser & dropzone via Chrome..."
node -e '
import("playwright").then(async ({ chromium }) => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1512, height: 945 });
  
  await page.goto("http://localhost:3000/tools/muter", { waitUntil: "networkidle" });
  
  // Locate file input and attach fixture
  const fileInput = page.locator("input[type=\"file\"]").first();
  await fileInput.setInputFiles("/tmp/celestial_qa_fixture.mp4");
  
  // Wait for state transition to batch queue
  await page.waitForSelector("[data-testid=\"batch-file-item\"]", { timeout: 8000 });
  
  const text = await page.textContent("body");
  const hasFile = text.includes("celestial_qa_fixture.mp4") && text.includes("BATCH QUEUE");
  
  if (!hasFile) {
    console.error("❌ Batch queue element did not render uploaded file.");
    await browser.close();
    process.exit(1);
  }
  
  console.log("✅ File fixture loaded into batch queue: celestial_qa_fixture.mp4");
  await browser.close();
  process.exit(0);
}).catch(err => {
  console.error("❌ Test runner error:", err.message);
  process.exit(1);
});
'

echo "========================================================"
echo "✅ Media File Upload & Dropzone Test Passed!"
echo "========================================================"
