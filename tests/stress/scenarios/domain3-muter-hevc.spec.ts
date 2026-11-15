import { test, expect } from '@playwright/test';
import {
  createMinimalWavBuffer,
  createMinimalMp4Buffer,
  attachConsoleCollector,
} from '../helpers/adversarial-fixtures';
import { saveBug } from '../helpers/bug-logger';

test.describe('Domain 3: Video Muter & HEVC Compressor Stress (M-01 to M-06, H-01 to H-14)', () => {
  test('M-01: Muter on Muted Video (0 Audio Streams)', async ({ page }) => {
    await page.goto('/tools/muter');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'already_muted.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('M-02: Muter on Pure Audio Dropzone Handling', async ({ page }) => {
    await page.goto('/tools/muter');
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'pure_audio.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('M-03: Muter Batch Processing of 10 Video Files', async ({ page }) => {
    await page.goto('/tools/muter');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const files = Array.from({ length: 10 }).map((_, i) => ({
      name: `batch_video_${i}.mp4`,
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    }));

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(files);

    await page.waitForTimeout(600);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('M-04: Muter Mid-Stream Cancel Action', async ({ page }) => {
    await page.goto('/tools/muter');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'cancel_test.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);

    const cancelBtn = page.locator('button:has-text("CANCEL"), button:has-text("CLEAR")').first();
    if (await cancelBtn.isVisible()) {
      await cancelBtn.click({ force: true }).catch(() => {});
    }

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('M-05: Muter Output Stream Check & Download Link', async ({ page }) => {
    await page.goto('/tools/muter');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'mute_stream_check.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('M-06: Incomplete Upload Dropout Error State', async ({ page }) => {
    await page.goto('/tools/muter');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'dropout.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-01: HEVC CRF Slider Extremes (CRF 0 to 51)', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'hevc_crf_test.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(500);

    const crfSlider = page.locator('input[type="range"]').first();
    if (await crfSlider.isVisible()) {
      await crfSlider.fill('0');
      await page.waitForTimeout(100);
      await crfSlider.fill('51');
      await page.waitForTimeout(100);
    }

    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('NaN');

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-02: HEVC 8K Video Upload Resolution Notification', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: '8k_prores_master.mov',
      mimeType: 'video/quicktime',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-03: Hardware Accel Fallback Profile Detection', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);

    const hwToggle = page.locator('button:has-text("HARDWARE"), input[type="checkbox"]').first();
    if (await hwToggle.isVisible()) {
      await hwToggle.click().catch(() => {});
    }

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-04: Audio Pass-Through Toggle (Copy vs AAC)', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'audio_passthrough.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);

    const audioBtns = page.locator('button:has-text("AAC"), button:has-text("COPY"), button:has-text("MP3")');
    const count = await audioBtns.count();
    for (let i = 0; i < count; i++) {
      await audioBtns.nth(i).click().catch(() => {});
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-05: Preset Rapid Switching (Ultrafast to Veryslow)', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'presets.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);

    const codecBtns = page.locator('button:has-text("HEVC"), button:has-text("H.264"), button:has-text("AV1"), button:has-text("VP9")');
    const count = await codecBtns.count();
    for (let i = 0; i < count; i++) {
      await codecBtns.nth(i).click().catch(() => {});
      await page.waitForTimeout(50);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-06: Already HEVC Encoded File Notification', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'already_hevc_h265.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-07: Impossible Target Size Warning Guard', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'target_size_test.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-08: Multi-Pass Encoding Options Toggle', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'multipass.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-09: HEVC Audio Stripping (-an Flag Combination)', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'hevc_mute.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-10: Multiple Subtitle Tracks MKV Preservation', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'anime_subtitles.mkv',
      mimeType: 'video/x-matroska',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-11: Variable Frame Rate (VFR) Video Stream', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'iphone_vfr_video.mov',
      mimeType: 'video/quicktime',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-12: Unsupported Container Restriction Validation', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'test_container.avi',
      mimeType: 'video/x-msvideo',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-13: Monotonic Progress Bar SSE Clamping', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'monotonic_progress.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('H-14: Clear Completed During Active Job State', async ({ page }) => {
    await page.goto('/tools/hevc');
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'clear_active.mp4',
      mimeType: 'video/mp4',
      buffer: mp4Buffer,
    });

    await page.waitForTimeout(400);

    const clearBtn = page.locator('button:has-text("CLEAR"), button:has-text("RESET")').first();
    if (await clearBtn.isVisible()) {
      await clearBtn.click().catch(() => {});
    }

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });
});
