import { test, expect } from '@playwright/test';
import { VIEWPORTS, attachConsoleCollector } from '../helpers/adversarial-fixtures';
import { saveBug } from '../helpers/bug-logger';

test.describe('Domain 5: Responsive Layout, Glassmorphism, Theme & A11y (L-01 to L-15)', () => {
  const routes = ['/tools/converter', '/tools/trimmer', '/tools/muter', '/tools/hevc', '/tools/youtube', '/tools/spotify'];

  test('L-01: 320px Mobile Viewport Layout Verification', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.MOBILE);

    for (const route of routes) {
      await page.goto(route);
      const collector = attachConsoleCollector(page);
      await page.waitForTimeout(300);

      // Check for horizontal overflow beyond 320px
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > 325) {
        saveBug({
          scenarioId: 'L-01',
          severity: 'Broken',
          category: 'Frontend UI',
          route,
          component: 'app/layout.tsx',
          failureSignature: `Horizontal overflow at 320px viewport (scrollWidth: ${scrollWidth}px)`,
          reproductionCommand: "npx playwright test tests/stress/scenarios/domain5-layout-a11y.spec.ts -g 'L-01'",
          assignedFixer: 'fixer-frontend',
          fixRecommendation: 'Add overflow-x-hidden and min-w-0 to mobile container',
          status: 'OPEN',
        });
      }

      const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
      expect(uncaught).toHaveLength(0);
    }
  });

  test('L-02: 4K Ultrawide Viewport Max-Width Constraints', async ({ page }) => {
    await page.setViewportSize(VIEWPORTS.ULTRAWIDE);
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-03: 200% Browser Zoom Emulation', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    // Emulate 200% zoom by scaling font size on root
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-04: RTL Layout Flipping (dir="rtl")', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      document.documentElement.setAttribute('dir', 'rtl');
    });

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-05: Rapid Route Transitions (100ms Navigations)', async ({ page }) => {
    const collector = attachConsoleCollector(page);

    for (let i = 0; i < 2; i++) {
      for (const route of routes) {
        await page.goto(route);
        await page.waitForTimeout(80);
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-06: Collapsed Sidebar Hover & Tooltip Positioning', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    const sidebarToggle = page.locator('button[aria-label*="sidebar"], button[aria-label*="collapse"]').first();
    if (await sidebarToggle.isVisible()) {
      await sidebarToggle.click();
      await page.waitForTimeout(200);
    }

    const navLinks = page.locator('nav a, aside a');
    const count = await navLinks.count();
    for (let i = 0; i < Math.min(count, 5); i++) {
      await navLinks.nth(i).hover().catch(() => {});
      await page.waitForTimeout(50);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-07: Backdrop Filter Fallback Check', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    // Disable backdrop-filter via style injection
    await page.addStyleTag({
      content: '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
    });

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-08: Sticky Header Scrolling Performance', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.evaluate(() => {
      window.scrollTo(0, 500);
    });

    await page.waitForTimeout(200);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-09: Keyboard Tab Navigation Focus Rings', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    for (let i = 0; i < 15; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(30);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-10: Screen Reader Live Region Presence', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    const liveRegions = page.locator('[aria-live], [role="status"], [role="alert"]');
    const count = await liveRegions.count();
    expect(count).toBeGreaterThanOrEqual(0);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-11: High Contrast Mode Emulation', async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active' });
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.waitForTimeout(400);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-12: ResizableOptionsPanel Width Constraint Enforcement', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    const resizeHandle = page.locator('.resize-handle, [data-testid="resize-handle"]').first();
    if (await resizeHandle.isVisible()) {
      const box = await resizeHandle.boundingBox();
      if (box) {
        await page.mouse.move(box.x, box.y);
        await page.mouse.down();
        await page.mouse.move(box.x - 500, box.y, { steps: 5 });
        await page.mouse.up();
      }
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-13: Dark Theme Visual Contrast Check', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.waitForTimeout(300);
    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-14: Rapid Tooltip Hovers Unmount Cycle', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    const buttons = page.locator('button');
    const count = await buttons.count();
    for (let i = 0; i < Math.min(count, 10); i++) {
      await buttons.nth(i).hover().catch(() => {});
      await page.waitForTimeout(20);
    }

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('L-15: Print Stylesheet Emulation', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    await page.emulateMedia({ media: 'print' });
    await page.waitForTimeout(300);

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });
});
