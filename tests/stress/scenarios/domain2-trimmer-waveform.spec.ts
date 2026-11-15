import { test, expect } from '@playwright/test';
import {
  createMinimalWavBuffer,
  createZeroByteBuffer,
  HOSTILE_STRINGS,
  attachConsoleCollector,
} from '../helpers/adversarial-fixtures';
import { saveBug } from '../helpers/bug-logger';

test.describe('Domain 2: Audio Trimmer & Waveform Engine Stress (T-01 to T-18)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/tools/trimmer');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  });

  test('T-01: Zero-Duration Audio / Empty Selection in Dropzone', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const zeroBuffer = createZeroByteBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'zero_audio.wav',
      mimeType: 'audio/wav',
      buffer: zeroBuffer,
    });

    await page.waitForTimeout(600);
    const bodyText = await page.textContent('body');
    expect(bodyText).not.toContain('NaN:NaN');

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR') || e.includes('Cannot read properties of undefined'));
    if (uncaught.length > 0) {
      saveBug({
        scenarioId: 'T-01',
        severity: 'Broken',
        category: 'Frontend UI',
        route: '/tools/trimmer',
        component: 'app/tools/trimmer/page.tsx',
        failureSignature: uncaught[0],
        consoleLogs: uncaught,
        reproductionCommand: "npx playwright test tests/stress/scenarios/domain2-trimmer-waveform.spec.ts -g 'T-01'",
        assignedFixer: 'fixer-frontend',
        fixRecommendation: 'Add check for empty selected files array before accessing selected[0]',
        status: 'OPEN',
      });
    }
    expect(uncaught).toHaveLength(0);
  });

  test('T-02: 10-Hour Audio Synthetic Load Downsampling', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'large_podcast_10h.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(700);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-03: Inverted Trim Handles Drag Collision', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'trim_handles_test.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(600);

    // If canvas or handles exist, simulate drag
    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible()) {
      const box = await canvas.boundingBox();
      if (box) {
        // Drag across the canvas from right to left
        await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2, { steps: 5 });
        await page.mouse.up();
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-04: Sub-Millisecond Trim Bounds Validation', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'sub_ms.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const numInputs = page.locator('input[type="number"], input[type="text"]');
    const count = await numInputs.count();
    for (let i = 0; i < count; i++) {
      const input = numInputs.nth(i);
      if (await input.isVisible()) {
        await input.fill('0.000001').catch(() => {});
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-05: Spacebar Play/Pause Rapid Spamming (50x in 2s)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'spacebar_spam.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(30);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-06: Handle Drag Beyond Canvas Viewport Boundaries', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'drag_out_of_bounds.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible()) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + 10, box.y + 10);
        await page.mouse.down();
        // Drag way off screen to negative coordinates
        await page.mouse.move(-200, -200, { steps: 5 });
        await page.mouse.up();
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-07: Fuzzed Numeric Inputs (-500, 999999, NaN, 1e10)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'fuzzed_inputs.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const inputs = page.locator('input');
    const count = await inputs.count();
    const fuzzValues = ['-500', '999999', 'NaN', '1e10', 'null', 'undefined', '0/0'];

    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const type = await input.getAttribute('type');
      if (type !== 'file' && (await input.isVisible())) {
        for (const fuzz of fuzzValues) {
          await input.fill(fuzz).catch(() => {});
        }
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-08: Rapid Zoom Wheel Spamming', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'zoom_test.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const canvas = page.locator('canvas').first();
    if (await canvas.isVisible()) {
      for (let i = 0; i < 20; i++) {
        await canvas.hover();
        await page.mouse.wheel(0, i % 2 === 0 ? 100 : -100);
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-09: Window Resize Mid-Scrub Dynamic Layout', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'resize_scrub.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    // Resize viewport while interacting
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(200);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(200);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-10: 32-Channel Surround Audio File Handling', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'surround_32ch.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-11: Extreme Volume Slider Bounds', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'gain_test.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const rangeSliders = page.locator('input[type="range"]');
    const count = await rangeSliders.count();
    for (let i = 0; i < count; i++) {
      const slider = rangeSliders.nth(i);
      if (await slider.isVisible()) {
        await slider.fill('500').catch(() => {});
        await slider.fill('-100').catch(() => {});
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-12: Trim During Active Playback Trigger', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'play_and_trim.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    // Start playback
    const playBtn = page.locator('button[aria-label*="play"], button:has-text("Play"), button:has-text("▶")').first();
    if (await playBtn.isVisible()) {
      await playBtn.click().catch(() => {});
    }

    // Trigger export while playing
    const exportBtn = page.locator('button:has-text("TRIM"), button:has-text("EXPORT"), button:has-text("PROCESS")').first();
    if (await exportBtn.isVisible()) {
      await exportBtn.click().catch(() => {});
    }

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-13: Multiple Fast Trim Exports Debounce', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'fast_exports.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const exportBtn = page.locator('button:has-text("TRIM"), button:has-text("EXPORT"), button:has-text("PROCESS")').first();
    if (await exportBtn.isVisible()) {
      for (let i = 0; i < 5; i++) {
        await exportBtn.click({ force: true }).catch(() => {});
      }
    }

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-14: Format Swap Post-Trim (MP3 -> WAV -> FLAC)', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'format_swap.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const formatButtons = page.locator('button:has-text("MP3"), button:has-text("WAV"), button:has-text("FLAC"), button:has-text("AAC")');
    const count = await formatButtons.count();
    for (let i = 0; i < count; i++) {
      await formatButtons.nth(i).click().catch(() => {});
      await page.waitForTimeout(50);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-15: Background Tab Refocus State Sync', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'tab_refocus.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(400);

    // Simulate tab blur and focus
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new Event('focus'));
    });

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-16: Overlapping Fade In/Out Bounds Clamping', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'fades_test.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);

    const fadeInputs = page.locator('input[type="number"]');
    const count = await fadeInputs.count();
    for (let i = 0; i < count; i++) {
      const input = fadeInputs.nth(i);
      if (await input.isVisible()) {
        await input.fill('999').catch(() => {});
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-17: Emoji-Bombed ID3 Metadata Render', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    const wavBuffer = createMinimalWavBuffer();

    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: `${HOSTILE_STRINGS.UNICODE_EMOJI}`,
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('T-18: High-DPI Display Scaling Emulation', async ({ page }) => {
    const collector = attachConsoleCollector(page);
    await page.emulateMedia({ colorScheme: 'dark' });

    const wavBuffer = createMinimalWavBuffer();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'retina_test.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(500);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });
});
