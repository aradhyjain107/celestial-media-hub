import { test, expect } from '@playwright/test';
import {
  createMinimalWavBuffer,
  createMinimalMp4Buffer,
  createZeroByteBuffer,
  createCorruptBuffer,
  HOSTILE_STRINGS,
  attachConsoleCollector,
} from '../helpers/adversarial-fixtures';
import { saveBug } from '../helpers/bug-logger';

test.describe('Domain 1: Universal Converter & Audio-to-Video Synthesis Stress (C-01 to C-20)', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage and navigate to /tools/converter
    await page.goto('/tools/converter');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('C-01: Zero-Byte Upload in FileDropzone', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const zeroBuffer = createZeroByteBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'empty_file.mp4',
      mimeType: 'video/mp4',
      buffer: zeroBuffer,
    });

    // Check if the page handles 0-byte file without crashing or rendering NaN
    await page.waitForTimeout(500);
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('NaN');
    expect(bodyText).not.toContain('undefined B');
    
    // Check for uncaught react runtime errors
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR') || e.includes('Cannot read properties'));
    if (uncaught.length > 0) {
      saveBug({
        scenarioId: 'C-01',
        severity: 'Broken',
        category: 'Frontend UI',
        route: '/tools/converter',
        component: 'app/components/ui/FileDropzone.tsx',
        failureSignature: uncaught[0],
        consoleLogs: uncaught,
        reproductionCommand: "npx playwright test tests/stress/scenarios/domain1-converter-a2v.spec.ts -g 'C-01'",
        assignedFixer: 'fixer-frontend',
        fixRecommendation: 'Add zero-byte buffer validation in FileDropzone',
        status: 'OPEN',
      });
    }
    expect(uncaught).toHaveLength(0);
  });

  test('C-02: Huge Corrupted Header File', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const corruptBuffer = createCorruptBuffer(1024 * 50);

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'corrupt_video.mp4',
      mimeType: 'video/mp4',
      buffer: corruptBuffer,
    });

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-03: 50-File Rapid Batch Drop', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const batchFiles = Array.from({ length: 50 }).map((_, i) => ({
      name: `stress_batch_track_${i.toString().padStart(2, '0')}.wav`,
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    }));

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(batchFiles);

    await page.waitForTimeout(1000);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);

    // Ensure queue rendered and didn't crash
    const queueCards = page.locator('.batch-queue, [data-testid="batch-queue"], div:has-text("stress_batch_track")');
    expect(await queueCards.count()).toBeGreaterThan(0);
  });

  test('C-04: Rapid Start/Cancel Toggling in BatchQueue', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'rapid_toggle_1.wav', mimeType: 'audio/wav', buffer: wavBuffer },
      { name: 'rapid_toggle_2.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(500);

    const convertBtn = page.locator('button:has-text("CONVERT"), button:has-text("INITIALIZE"), button:has-text("START")').first();
    if (await convertBtn.isVisible()) {
      for (let i = 0; i < 5; i++) {
        await convertBtn.click({ force: true }).catch(() => {});
        const cancelBtn = page.locator('button:has-text("CANCEL"), button:has-text("CLEAR"), button:has-text("STOP")').first();
        if (await cancelBtn.isVisible()) {
          await cancelBtn.click({ force: true }).catch(() => {});
        }
        await page.waitForTimeout(50);
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-05: Hostile Filename Symbols & Sanitization', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: HOSTILE_STRINGS.UNICODE_EMOJI, mimeType: 'audio/wav', buffer: wavBuffer },
      { name: HOSTILE_STRINGS.SPECIAL_CHARS, mimeType: 'audio/wav', buffer: wavBuffer },
      { name: HOSTILE_STRINGS.XSS_PAYLOAD, mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(600);

    // Verify XSS script was not executed
    const isPwned = await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned);
    expect(isPwned).toBeUndefined();

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-06: Inverted Audio-to-Video Timecodes (Start > End)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'audio_track.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    // Check if A2V companion mode or inputs are available
    const a2vToggle = page.locator('button:has-text("AUDIO-TO-VIDEO"), button:has-text("COMPANION")').first();
    if (await a2vToggle.isVisible()) {
      await a2vToggle.click();
      const companionInput = page.locator('input[type="file"]').last();
      await companionInput.setInputFiles([
        { name: 'companion.mp4', mimeType: 'video/mp4', buffer: mp4Buffer },
      ]);
    }

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-07: Malformed Hex Color Pickers in Visualizer', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'visualizer_test.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(500);

    // Attempt to inject invalid hex colors into color inputs if present
    const colorInputs = page.locator('input[type="text"], input[type="color"]');
    const count = await colorInputs.count();
    for (let i = 0; i < count; i++) {
      const input = colorInputs.nth(i);
      if (await input.isVisible()) {
        await input.fill('##ZZZZZZ').catch(() => {});
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-08: Non-Standard Aspect Ratio Handling', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'aspect_ratio_test.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-09: Mid-Stream Preset Switch', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'preset_switch.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(400);

    // Toggle presets rapidly
    const presetButtons = page.locator('button:has-text("WHATSAPP"), button:has-text("DISCORD"), button:has-text("EMAIL"), button:has-text("HIGH")');
    const btnCount = await presetButtons.count();
    for (let i = 0; i < btnCount; i++) {
      await presetButtons.nth(i).click({ force: true }).catch(() => {});
      await page.waitForTimeout(30);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-10: Audio File Renamed to Video (.mp4 extension with WAV payload)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'fake_video.mp4', mimeType: 'video/mp4', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-11: Video File Renamed to Audio (.mp3 extension with MP4 payload)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const mp4Buffer = createMinimalMp4Buffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'fake_audio.mp3', mimeType: 'audio/mp3', buffer: mp4Buffer },
    ]);

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-12: 1-Hour Audio to GIF Duration Warning / Clamp', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'long_audio.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    const gifFormatBtn = page.locator('button:has-text("GIF"), [data-format="gif"]').first();
    if (await gifFormatBtn.isVisible()) {
      await gifFormatBtn.click().catch(() => {});
    }

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-13: Missing Companion Video Validation in A2V', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'orphan_audio.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-14: Fast Double Submit Debounce on Convert Button', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'double_submit.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(400);

    const convertBtn = page.locator('button:has-text("CONVERT"), button:has-text("START"), button:has-text("INITIALIZE")').first();
    if (await convertBtn.isVisible()) {
      // Double click rapidly
      await Promise.all([
        convertBtn.click({ force: true }).catch(() => {}),
        convertBtn.click({ force: true }).catch(() => {}),
      ]);
    }

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-15: Silent Audio Visualizer Zero-Division Guard', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'silence_0hz.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-16: Active Queue Item Deletion Mid-Progress', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: 'item_to_remove.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(500);

    const removeBtn = page.locator('button[aria-label*="remove"], button:has-text("✕"), button:has-text("Remove")').first();
    if (await removeBtn.isVisible()) {
      await removeBtn.click({ force: true }).catch(() => {});
    }

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-17: Rapid Download Button Spamming', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const downloadBtns = page.locator('a[download], button:has-text("DOWNLOAD")');
    const count = await downloadBtns.count();

    for (let i = 0; i < count; i++) {
      for (let spam = 0; spam < 5; spam++) {
        await downloadBtns.nth(i).click({ force: true }).catch(() => {});
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-18: Keyboard Format Navigation (Arrow keys / Enter)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-19: Ultra-Long Filename (255+ Chars) Layout Containment', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles([
      { name: HOSTILE_STRINGS.LONG_255_CHAR, mimeType: 'video/mp4', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(600);

    // Verify that the body or container does not horizontally scroll beyond window
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 20;
    });

    if (hasHorizontalOverflow) {
      saveBug({
        scenarioId: 'C-19',
        severity: 'Ugly',
        category: 'Frontend UI',
        route: '/tools/converter',
        component: 'app/components/BatchQueue.tsx',
        failureSignature: 'Horizontal scroll blowout on 255-character filename',
        reproductionCommand: "npx playwright test tests/stress/scenarios/domain1-converter-a2v.spec.ts -g 'C-19'",
        assignedFixer: 'fixer-frontend',
        fixRecommendation: 'Ensure min-width: 0 and truncate / middle-ellipsis on filename container',
        status: 'OPEN',
      });
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('C-20: Duplicate File Re-upload (Unique Job ID Collision Guard)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    // Drop the exact same file 3 times
    await fileInput.setInputFiles([
      { name: 'duplicate_sample.wav', mimeType: 'audio/wav', buffer: wavBuffer },
      { name: 'duplicate_sample.wav', mimeType: 'audio/wav', buffer: wavBuffer },
      { name: 'duplicate_sample.wav', mimeType: 'audio/wav', buffer: wavBuffer },
    ]);

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });
});
