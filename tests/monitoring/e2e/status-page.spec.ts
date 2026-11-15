import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { compileDashboard } from '../helpers/dashboard-compiler';

test.describe('Status Dashboard E2E Tests', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const testLogFile = path.join(projectRoot, 'monitoring.test.log');
  const testHtmlFile = path.join(projectRoot, 'public/status-test.html');

  function generateLogLine(toolName: string, agentType: 'frontend' | 'backend', status: 'healthy' | 'unhealthy', errorMessage?: string): string {
    const entry = {
      timestamp: new Date().toISOString(),
      daemonId: 'test-daemon-session',
      agentType,
      toolName,
      status,
      durationMs: 150,
      error: status === 'unhealthy' ? { message: errorMessage || 'Error occurred', code: 'ERR_TEST_FAIL' } : null
    };
    return JSON.stringify(entry);
  }

  test.beforeEach(() => {
    if (fs.existsSync(testLogFile)) fs.unlinkSync(testLogFile);
    if (fs.existsSync(testHtmlFile)) fs.unlinkSync(testHtmlFile);
  });

  test.afterAll(() => {
    if (fs.existsSync(testLogFile)) fs.unlinkSync(testLogFile);
    if (fs.existsSync(testHtmlFile)) fs.unlinkSync(testHtmlFile);
  });

  test('should serve status-test.html statically with correct CSS styling and 8 cards', async ({ page }) => {
    const tools = ['dashboard', 'converter', 'hevc', 'inspector', 'muter', 'spotify', 'trimmer', 'youtube'];
    let logContent = '';
    for (const tool of tools) {
      logContent += generateLogLine(tool, 'frontend', 'healthy') + '\n';
      logContent += generateLogLine(tool, 'backend', 'healthy') + '\n';
    }
    fs.writeFileSync(testLogFile, logContent, 'utf8');

    compileDashboard(testLogFile, testHtmlFile);

    expect(fs.existsSync(testHtmlFile)).toBe(true);

    const response = await page.goto('/status-test.html');
    expect(response?.status()).toBe(200);

    await expect(page.locator('.tool-status-card')).toHaveCount(8);

    const bodyBg = await page.evaluate(() => {
      return window.getComputedStyle(document.body).backgroundColor;
    });
    expect(bodyBg).toBe('rgb(13, 13, 15)'); // #0D0D0F

    const healthyBadges = page.locator('.status-badge.status-healthy');
    await expect(healthyBadges).toHaveCount(16);
  });

  test('should ingest and display mixed health states', async ({ page }) => {
    const tools = ['dashboard', 'converter', 'hevc', 'inspector', 'muter', 'spotify', 'trimmer', 'youtube'];
    let logContent = '';
    for (const tool of tools) {
      const fStatus = (tool === 'youtube') ? 'unhealthy' : 'healthy';
      const bStatus = (tool === 'muter') ? 'unhealthy' : 'healthy';
      
      logContent += generateLogLine(tool, 'frontend', fStatus, fStatus === 'unhealthy' ? 'YouTube frontend failed to render dropzone' : undefined) + '\n';
      logContent += generateLogLine(tool, 'backend', bStatus, bStatus === 'unhealthy' ? 'Muter API responded with HTTP 500' : undefined) + '\n';
    }
    fs.writeFileSync(testLogFile, logContent, 'utf8');

    compileDashboard(testLogFile, testHtmlFile);

    await page.goto('/status-test.html');

    const globalStatus = page.locator('#global-status-header');
    await expect(globalStatus).toHaveText('DEGRADED');
    await expect(globalStatus).toHaveClass(/status-degraded/);

    const youtubeFrontBadge = page.locator('[data-tool="youtube"][data-agent="frontend"]');
    await expect(youtubeFrontBadge).toHaveText('UNHEALTHY');
    await expect(youtubeFrontBadge).toHaveClass(/status-unhealthy/);

    const youtubeError = page.locator('[data-tool="youtube"] .error-msg');
    await expect(youtubeError).toContainText('YouTube frontend failed to render dropzone');

    const muterBackBadge = page.locator('[data-tool="muter"][data-agent="backend"]');
    await expect(muterBackBadge).toHaveText('UNHEALTHY');
    await expect(muterBackBadge).toHaveClass(/status-unhealthy/);

    const muterError = page.locator('[data-tool="muter"] .error-msg');
    await expect(muterError).toContainText('Muter API responded with HTTP 500');

    const healthyBadges = page.locator('.status-badge.status-healthy');
    await expect(healthyBadges).toHaveCount(14);
  });

  test('should dynamically refresh and update status without page reload', async ({ page }) => {
    const tools = ['dashboard', 'converter', 'hevc', 'inspector', 'muter', 'spotify', 'trimmer', 'youtube'];
    let logContent = '';
    for (const tool of tools) {
      logContent += generateLogLine(tool, 'frontend', 'healthy') + '\n';
      logContent += generateLogLine(tool, 'backend', 'healthy') + '\n';
    }
    fs.writeFileSync(testLogFile, logContent, 'utf8');
    compileDashboard(testLogFile, testHtmlFile);

    await page.goto('/status-test.html');
    
    const healthyBadges = page.locator('.status-badge.status-healthy');
    await expect(healthyBadges).toHaveCount(16);

    const failedLine = generateLogLine('hevc', 'backend', 'unhealthy', 'HEVC hardware acceleration failure');
    fs.appendFileSync(testLogFile, failedLine + '\n', 'utf8');

    compileDashboard(testLogFile, testHtmlFile);

    const unhealthyBadge = await page.waitForSelector('[data-tool="hevc"][data-agent="backend"][data-status="unhealthy"]', { timeout: 10000 });
    expect(unhealthyBadge).not.toBeNull();

    const errorMsg = page.locator('[data-tool="hevc"] .error-msg');
    await expect(errorMsg).toContainText('HEVC hardware acceleration failure');
  });
});
