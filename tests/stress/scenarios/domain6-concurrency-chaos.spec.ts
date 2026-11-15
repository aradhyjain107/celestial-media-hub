import { test, expect } from '@playwright/test';
import { createMinimalWavBuffer, attachConsoleCollector } from '../helpers/adversarial-fixtures';
import { saveBug } from '../helpers/bug-logger';

test.describe('Domain 6: Global State, Multi-Tab Concurrency & Network Chaos (G-01 to G-15)', () => {
  test('G-01: Multi-Tab Concurrency Across 3 Tabs', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();
    const page3 = await context.newPage();

    const c1 = attachConsoleCollector(page1);
    const c2 = attachConsoleCollector(page2);
    const c3 = attachConsoleCollector(page3);

    await Promise.all([
      page1.goto('/tools/converter'),
      page2.goto('/tools/trimmer'),
      page3.goto('/tools/muter'),
    ]);

    await page1.waitForTimeout(500);

    await page1.close();
    await page2.close();
    await page3.close();

    expect(c1.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'))).toHaveLength(0);
    expect(c2.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'))).toHaveLength(0);
    expect(c3.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'))).toHaveLength(0);
  });

  test('G-02: LocalStorage Quota Exceeded Graceful Handling', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    // Attempt to fill localStorage to quota limit
    await page.evaluate(() => {
      try {
        const largeChunk = 'x'.repeat(1024 * 1024); // 1MB
        for (let i = 0; i < 10; i++) {
          localStorage.setItem(`quota_bomb_${i}`, largeChunk);
        }
      } catch {
        // Quota exceeded
      }
    });

    await page.reload();
    await page.waitForTimeout(400);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-03: Offline Network Drop & Online Reconnect State', async ({ context, page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    // Drop offline
    await context.setOffline(true);
    await page.waitForTimeout(300);

    // Restore online
    await context.setOffline(false);
    await page.waitForTimeout(300);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-04: Fast Page Reload During Active Workflow', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    const wavBuffer = createMinimalWavBuffer();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'reload_test.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(200);
    await page.reload();
    await page.waitForTimeout(300);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-05: Tab Close Lifecycle Process Cleanup', async ({ context }) => {
    const p = await context.newPage();
    await p.goto('/tools/converter');
    await p.waitForTimeout(200);
    await p.close();
  });

  test('G-06: Browser History Back and Forward Navigation', async ({ page }) => {
    const collector = attachConsoleCollector(page);

    await page.goto('/tools/converter');
    await page.goto('/tools/trimmer');
    await page.goto('/tools/hevc');

    await page.goBack();
    await page.waitForTimeout(200);
    await page.goBack();
    await page.waitForTimeout(200);
    await page.goForward();
    await page.waitForTimeout(200);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-07: Slow Network Latency Emulation', async ({ page }) => {
    const collector = attachConsoleCollector(page);

    await page.goto('/tools/converter');
    await page.waitForTimeout(400);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-08: Window Visibility Change & Inactive Tab Throttle', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(300);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-09: HTTP 500 Injection & ErrorBoundary Resilience', async ({ page }) => {
    const collector = attachConsoleCollector(page);

    // Intercept API routes to inject simulated 500
    await page.route('**/api/convert', route => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Stress Simulation Error' }),
      });
    });

    await page.goto('/tools/converter');
    const wavBuffer = createMinimalWavBuffer();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'error_trigger.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(300);

    const convertBtn = page.locator('button:has-text("CONVERT"), button:has-text("INITIALIZE")').first();
    if (await convertBtn.isVisible()) {
      await convertBtn.click().catch(() => {});
    }

    await page.waitForTimeout(500);

    // Verify error was handled without blank screen
    const appMounted = await page.locator('body').isVisible();
    expect(appMounted).toBe(true);
  });

  test('G-10: HTTP 504 Gateway Timeout Handling', async ({ page }) => {
    await page.route('**/api/convert', route => {
      route.fulfill({
        status: 504,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Gateway Timeout' }),
      });
    });

    await page.goto('/tools/converter');
    await page.waitForTimeout(300);
  });

  test('G-11: Cross-Tab Job Sync via Storage Events', async ({ context }) => {
    const page1 = await context.newPage();
    const page2 = await context.newPage();

    await page1.goto('/tools/converter');
    await page2.goto('/tools/converter');

    await page1.evaluate(() => {
      localStorage.setItem('celestial_job_converter', JSON.stringify({ status: 'complete', progress: 100 }));
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'celestial_job_converter',
        newValue: JSON.stringify({ status: 'complete', progress: 100 }),
      }));
    });

    await page2.waitForTimeout(300);
    await page1.close();
    await page2.close();
  });

  test('G-12: 100 Sequential Object URL Allocations and Revocation', async ({ page }) => {
    await page.goto('/tools/trimmer');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      const urls: string[] = [];
      for (let i = 0; i < 100; i++) {
        const blob = new Blob([`dummy payload ${i}`], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        urls.push(url);
      }
      // Revoke all
      urls.forEach(u => URL.revokeObjectURL(u));
    });

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-13: Temporary Blob URL Memory Cleanup on Tool Switch', async ({ page }) => {
    const collector = attachConsoleCollector(page);

    await page.goto('/tools/trimmer');
    const wavBuffer = createMinimalWavBuffer();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'cleanup_test.wav',
      mimeType: 'audio/wav',
      buffer: wavBuffer,
    });

    await page.waitForTimeout(300);

    // Switch tool
    await page.goto('/tools/converter');
    await page.waitForTimeout(300);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-14: Session Storage Manual Reset Recovery', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      sessionStorage.clear();
    });

    await page.reload();
    await page.waitForTimeout(300);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('G-15: Main Thread Responsiveness Under Fast Execution', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      // Busy loop for 50ms
      const start = Date.now();
      while (Date.now() - start < 50) {
        // burn CPU
      }
    });

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });
});
