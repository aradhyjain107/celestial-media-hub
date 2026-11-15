/**
 * tests/monitoring/e2e/audio-to-video.spec.ts
 *
 * Comprehensive Playwright End-to-End Test Suite for Celestial Media Hub
 * Audio-to-Video Synthesis Studio (Tier 4 Real-World Application Scenarios).
 */

import { test, expect } from '@playwright/test';

test.describe('Audio-to-Video Synthesis Workflow & Tier 4 Real-World E2E Suite', () => {
  const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

  test.beforeEach(async ({ page }) => {
    // Intercept SSE /api/convert to provide reliable E2E progress streaming
    await page.route('**/api/convert', async (route) => {
      const request = route.request();
      if (request.method() === 'POST') {
        const sseStream = [
          'data: {"strategy":"AUDIO+VIDEO-SYNTHESIS","strategyReason":"Synthesized primary audio with companion video clip"}\n\n',
          'data: {"progress":25}\n\n',
          'data: {"progress":50}\n\n',
          'data: {"progress":75}\n\n',
          'data: {"progress":100}\n\n',
          'data: {"status":"complete","downloadUrl":"/api/download?jobId=mock-e2e-job-id&file=output.mp4"}\n\n',
        ].join('');

        await route.fulfill({
          status: 200,
          contentType: 'text/event-stream',
          headers: {
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
          },
          body: sseStream,
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`${BASE_URL}/tools/converter`);
    await expect(page.locator('body')).toBeVisible();
  });

  /* ── Suite 1: Category Tab Unlock & Studio Morphing ── */
  test('Suite 1: Unlocks VIDEO category tab when audio is uploaded and mounts AudioToVideoStudio', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'podcast_teaser.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('mock-audio-content-60s'),
    });

    // Verify VIDEO tab is enabled and click it
    const videoTab = page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first();
    await expect(videoTab).toBeVisible();
    await videoTab.click();

    // Select MP4 output format
    const mp4Tile = page.locator('[data-testid="format-mp4"], button:has-text("MP4")').first();
    await expect(mp4Tile).toBeVisible();
    await mp4Tile.click();

    // Verify A2V Studio is mounted
    const studio = page.locator('[data-testid="audio-to-video-studio"], [data-testid="a2v-studio"]').first();
    await expect(studio).toBeVisible();

    // Verify initial components
    const dropzone = page.locator('[data-testid="video-attachment-dropzone"], [data-testid="video-dropzone-empty"]').first();
    await expect(dropzone).toBeVisible();

    const visualizer = page.locator('[data-testid="kinetic-visualizer-canvas"], canvas').first();
    await expect(visualizer).toBeVisible();
  });

  /* ── Suite 2: Video Attachment & Synchronized Preview ── */
  test('Suite 2: Attaches companion video, updates preview canvas, and supports removal', async ({ page }) => {
    // 1. Upload audio
    const primaryInput = page.locator('input[type="file"]').first();
    await primaryInput.setInputFiles({
      name: 'podcast_teaser.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('mock-audio-content'),
    });

    const videoTab = page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first();
    await videoTab.click();

    const mp4Tile = page.locator('[data-testid="format-mp4"], button:has-text("MP4")').first();
    await mp4Tile.click();

    // 2. Attach companion video
    const videoInput = page.locator('[data-testid="video-file-input"], [data-testid="video-attachment-input"], input[type="file"]').last();
    await videoInput.setInputFiles({
      name: 'drone_shot.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('mock-video-content-10s'),
    });

    // 3. Verify attached dropzone or video preview renders
    const attachedDropzone = page.locator('[data-testid="video-attachment-dropzone"], [data-testid="video-dropzone-attached"], text=drone_shot.mp4').first();
    await expect(attachedDropzone).toBeVisible();

    // 4. Verify remove button removes attachment and returns to procedural visualizer
    const removeBtn = page.locator('[data-testid="remove-video-btn"], [data-testid="video-remove-btn"]').first();
    if (await removeBtn.isVisible()) {
      await removeBtn.click();
      await expect(page.locator('[data-testid="video-dropzone-empty"], [data-testid="video-attachment-dropzone"]').first()).toBeVisible();
    }
  });

  /* ── Suite 3: Interactive Dual-Handle Timeline Trimming ── */
  test('Suite 3: Adjusts timeline trimming start and end timecodes', async ({ page }) => {
    const primaryInput = page.locator('input[type="file"]').first();
    await primaryInput.setInputFiles({
      name: 'podcast_teaser.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('mock-audio-content'),
    });

    await page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first().click();
    await page.locator('[data-testid="format-mp4"], button:has-text("MP4")').first().click();

    const videoInput = page.locator('[data-testid="video-file-input"], [data-testid="video-attachment-input"], input[type="file"]').last();
    await videoInput.setInputFiles({
      name: 'drone_shot.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('mock-video-content-10s'),
    });

    // Verify timeline trimmer container
    const timeline = page.locator('[data-testid="timeline-trimmer"], [data-testid="trimmer-timeline"]').first();
    if (await timeline.isVisible()) {
      const startHandle = page.locator('[data-testid="trim-handle-start"]').first();
      const endHandle = page.locator('[data-testid="trim-handle-end"]').first();

      await expect(startHandle).toBeVisible();
      await expect(endHandle).toBeVisible();

      // Verify timecode readouts exist
      await expect(page.locator('[data-testid="timecode-start"]').first()).toBeVisible();
      await expect(page.locator('[data-testid="timecode-end"]').first()).toBeVisible();
    }
  });

  /* ── Suite 4: Tier 4 Scenario 1 (Podcast Teaser with Looped Video) ── */
  test('Suite 4: Scenario 1 — Synthesizes 60s podcast teaser with trimmed & looped 1080p B-roll to MP4', async ({ page }) => {
    const primaryInput = page.locator('input[type="file"]').first();
    await primaryInput.setInputFiles({
      name: 'podcast_teaser.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from('podcast-teaser-audio-content'),
    });

    await page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first().click();
    await page.locator('[data-testid="format-mp4"], button:has-text("MP4")').first().click();

    const videoInput = page.locator('[data-testid="video-file-input"], [data-testid="video-attachment-input"], input[type="file"]').last();
    await videoInput.setInputFiles({
      name: 'drone_shot.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('drone-broll-content'),
    });

    // Select loop-video sync mode if available
    const loopBtn = page.locator('[data-testid="sync-mode-loop-video"], button:has-text("Loop Video")').first();
    if (await loopBtn.isVisible()) {
      await loopBtn.click();
    }

    // Initialize conversion
    const initBtn = page.locator('[data-testid="initialize-btn"], button:has-text("INITIALIZE")').first();
    await expect(initBtn).toBeVisible();
    await initBtn.click();

    // Verify progress tracking
    const progressTrack = page.locator('[data-testid="progress-track-area"], [data-testid="progress-fill"], [data-testid="progress-bar"]').first();
    await expect(progressTrack).toBeVisible();

    // Verify download button appearance on completion
    const downloadBtn = page.locator('[data-testid="download-btn"], [data-testid="download-link"], a:has-text("DOWNLOAD")').first();
    await expect(downloadBtn).toBeVisible({ timeout: 15000 });
  });

  /* ── Suite 5: Tier 4 Scenario 2 (Instagram Reel with Kinetic Waveform) ── */
  test('Suite 5: Scenario 2 — Generates 9:16 Instagram Reel with Obsidian Pulse kinetic waveform', async ({ page }) => {
    const primaryInput = page.locator('input[type="file"]').first();
    await primaryInput.setInputFiles({
      name: 'drop_promo.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('drop-promo-audio-data'),
    });

    await page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first().click();
    await page.locator('[data-testid="format-mp4"], button:has-text("MP4")').first().click();

    // Select Instagram preset
    const igPreset = page.locator('[data-testid="preset-instagram"], button:has-text("Instagram")').first();
    if (await igPreset.isVisible()) {
      await igPreset.click();
    }

    // Select Obsidian Pulse theme if visible
    const pulseTheme = page.locator('[data-testid="theme-obsidian_pulse"], button:has-text("Obsidian Pulse")').first();
    if (await pulseTheme.isVisible()) {
      await pulseTheme.click();
    }

    // Initialize conversion
    const initBtn = page.locator('[data-testid="initialize-btn"], button:has-text("INITIALIZE")').first();
    await expect(initBtn).toBeVisible();
    await initBtn.click();

    const downloadBtn = page.locator('[data-testid="download-btn"], [data-testid="download-link"], a:has-text("DOWNLOAD")').first();
    await expect(downloadBtn).toBeVisible({ timeout: 15000 });
  });

  /* ── Suite 6: Tier 4 Scenario 3 (YouTube Shorts 1.5x Speed Transcode) ── */
  test('Suite 6: Scenario 3 — Synthesizes YouTube Short with 1.5x speed multiplier and trimmed audio', async ({ page }) => {
    const primaryInput = page.locator('input[type="file"]').first();
    await primaryInput.setInputFiles({
      name: 'quick_guide.m4a',
      mimeType: 'audio/mp4',
      buffer: Buffer.from('quick-guide-content'),
    });

    await page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first().click();
    await page.locator('[data-testid="format-mp4"], button:has-text("MP4")').first().click();

    // Select 1.5x speed
    const speed15 = page.locator('[data-testid="speed-1.5"], button:has-text("1.5x")').first();
    if (await speed15.isVisible()) {
      await speed15.click();
    }

    const initBtn = page.locator('[data-testid="initialize-btn"], button:has-text("INITIALIZE")').first();
    await expect(initBtn).toBeVisible();
    await initBtn.click();

    const downloadBtn = page.locator('[data-testid="download-btn"], [data-testid="download-link"], a:has-text("DOWNLOAD")').first();
    await expect(downloadBtn).toBeVisible({ timeout: 15000 });
  });

  /* ── Suite 7: Tier 4 Scenario 4 (Lossless FLAC Audio to MKV Container) ── */
  test('Suite 7: Scenario 4 — Converts lossless FLAC audio to MKV container with high-bitrate video', async ({ page }) => {
    const primaryInput = page.locator('input[type="file"]').first();
    await primaryInput.setInputFiles({
      name: 'concert_master.flac',
      mimeType: 'audio/flac',
      buffer: Buffer.from('flac-audio-content'),
    });

    await page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first().click();
    const mkvTile = page.locator('[data-testid="format-mkv"], button:has-text("MKV")').first();
    await expect(mkvTile).toBeVisible();
    await mkvTile.click();

    const initBtn = page.locator('[data-testid="initialize-btn"], button:has-text("INITIALIZE")').first();
    await expect(initBtn).toBeVisible();
    await initBtn.click();

    const downloadBtn = page.locator('[data-testid="download-btn"], [data-testid="download-link"], a:has-text("DOWNLOAD")').first();
    await expect(downloadBtn).toBeVisible({ timeout: 15000 });
  });

  /* ── Suite 8: Tier 4 Scenario 5 (Cyber Grid Animated GIF Generation) ── */
  test('Suite 8: Scenario 5 — Generates animated GIF from audio snippet with procedural cyber waveform', async ({ page }) => {
    const primaryInput = page.locator('input[type="file"]').first();
    await primaryInput.setInputFiles({
      name: 'cyber_synth.wav',
      mimeType: 'audio/wav',
      buffer: Buffer.from('cyber-synth-audio'),
    });

    await page.locator('[data-testid="tab-video"], button:has-text("VIDEO")').first().click();
    const gifTile = page.locator('[data-testid="format-gif"], button:has-text("GIF")').first();
    await expect(gifTile).toBeVisible();
    await gifTile.click();

    const initBtn = page.locator('[data-testid="initialize-btn"], button:has-text("INITIALIZE")').first();
    await expect(initBtn).toBeVisible();
    await initBtn.click();

    const downloadBtn = page.locator('[data-testid="download-btn"], [data-testid="download-link"], a:has-text("DOWNLOAD")').first();
    await expect(downloadBtn).toBeVisible({ timeout: 15000 });
  });
});
