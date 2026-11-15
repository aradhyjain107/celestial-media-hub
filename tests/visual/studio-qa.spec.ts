import { test, expect } from '@playwright/test';
import { execFileSync } from 'child_process';

test.describe('Celestial Media Hub - Studio QA Suite', () => {
  const sampleAudio = '/tmp/qa_sample_audio.mp3';

  test.beforeAll(() => {
    try {
      execFileSync('ffmpeg', [
        '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10',
        '-c:a', 'libmp3lame', '-q:a', '4', sampleAudio
      ], { stdio: 'ignore' });
    } catch (e) {
      console.warn('FFmpeg sample generation skipped:', e);
    }
  });

  test('Universal Converter: switches into Audio-to-Video Studio without clipping or visual collisions', async ({ page }) => {
    await page.setViewportSize({ width: 1512, height: 945 });
    await page.goto('http://localhost:3000/tools/converter', { waitUntil: 'networkidle' });

    // 1. Upload audio
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(sampleAudio);

    // 2. Select VIDEO target tab
    await page.locator('[data-testid="tab-video"]').click();
    await expect(page.locator('[data-testid="audio-to-video-studio"]')).toBeVisible({ timeout: 10000 });

    // 3. Verify format & preset buttons
    await page.locator('[data-testid="format-mov"]').click();
    await page.locator('[data-testid="preset-high"]').click();
    await page.locator('[data-testid="theme-nebula_spectrum"]').click();

    // 4. Verify timeline elements within bounds
    const cardBox = await page.locator('[data-testid="video-trimmer-timeline"]').boundingBox();
    const playheadBadge = await page.locator('[data-testid="playhead-timestamp"]').boundingBox();
    const startHandle = await page.locator('[data-testid="trim-handle-start"]').boundingBox();
    const endHandle = await page.locator('[data-testid="trim-handle-end"]').boundingBox();

    expect(cardBox).not.toBeNull();
    expect(playheadBadge).not.toBeNull();
    expect(startHandle).not.toBeNull();
    expect(endHandle).not.toBeNull();

    if (cardBox && playheadBadge && startHandle && endHandle) {
      expect(playheadBadge.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(playheadBadge.x + playheadBadge.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(startHandle.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(endHandle.x + endHandle.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
    }

    // 5. Playback toggle
    await page.locator('[data-testid="play-pause-btn"]').click();
    await page.waitForTimeout(600);
    const masterTimecode = await page.locator('[data-testid="timecode-master"]').textContent();
    expect(masterTimecode).not.toContain('NaN');
  });
});
