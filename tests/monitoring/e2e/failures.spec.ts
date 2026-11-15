import { test, expect } from '@playwright/test';
import { MockApiServer } from '../helpers/mock-api-server';
import { spawn, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

test.describe('Failure and Edge Case Simulation E2E Tests', () => {
  let mockServer: MockApiServer;
  const mockPort = 3009;
  const projectRoot = path.resolve(__dirname, '../../..');
  const logFile = path.join(projectRoot, 'monitoring.log');
  let daemonProcess: ChildProcess | null = null;

  test.beforeAll(async () => {
    // Start mock API server on 3009, with targetPort = 3000 (Next.js server)
    mockServer = new MockApiServer(3000);
    await mockServer.start(mockPort);
  });

  test.afterAll(async () => {
    await mockServer.close();
  });

  test.beforeEach(() => {
    mockServer.clearIntercepts();
    if (fs.existsSync(logFile)) {
      try {
        fs.unlinkSync(logFile);
      } catch (_) {}
    }
  });

  test.afterEach(() => {
    if (daemonProcess) {
      try {
        daemonProcess.kill('SIGTERM');
      } catch (_) {}
      daemonProcess = null;
    }
  });

  function startDaemon(): ChildProcess {
    const runnerPath = path.join(projectRoot, 'monitoring/runner.js');
    daemonProcess = spawn('node', [runnerPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        BASE_URL: `http://localhost:${mockPort}`,
        LOG_FILE: logFile
      },
      stdio: 'pipe'
    });
    return daemonProcess;
  }

  // Helper to poll log file for content
  async function waitForLogToContain(substring: string, timeoutMs: number = 25000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (fs.existsSync(logFile)) {
        const content = fs.readFileSync(logFile, 'utf8');
        if (content.includes(substring)) {
          return content;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timeout waiting for log to contain: "${substring}". Log file exists: ${fs.existsSync(logFile)}`);
  }

  test('should simulate backend API 500 error', async ({ page }) => {
    mockServer.setIntercept('/api/hevc', {
      status: 500,
      body: { error: 'Internal Server Error', code: 'ERR_API_CRASH' }
    });

    startDaemon();

    const logContent = await waitForLogToContain('ERR_API_CRASH');
    expect(logContent).toContain('ERR_API_CRASH');

    // Parse log and assert details
    const lines = logContent.trim().split('\n');
    const hevcBackendEntry = lines
      .map(line => {
        try { return JSON.parse(line); } catch(_) { return null; }
      })
      .reverse()
      .find(entry => entry && entry.toolName === 'hevc' && entry.agentType === 'backend');

    expect(hevcBackendEntry).toBeDefined();
    expect(hevcBackendEntry.status).toBe('unhealthy');
    expect(hevcBackendEntry.error.code).toBe('ERR_API_CRASH');

    // Verify status page
    await page.goto('/status.html');
    
    // Status header should show degraded
    const globalStatus = page.locator('#global-status-header');
    await expect(globalStatus).toHaveText('DEGRADED');

    // HEVC backend status badge should be unhealthy
    const hevcBadge = page.locator('[data-tool="hevc"][data-agent="backend"]');
    await expect(hevcBadge).toHaveText('UNHEALTHY');
    await expect(hevcBadge).toHaveClass(/status-unhealthy/);

    // Error message should be visible on status page
    const errorMsg = page.locator('[data-tool="hevc"] .error-msg');
    await expect(errorMsg).toContainText('Internal Server Error');
  });

  test('should simulate API timeout detection', async ({ page }) => {
    mockServer.setIntercept('/api/convert', {
      status: 200,
      delay: 6000, // Timeout in agent is 5000ms
      body: { status: 'success' }
    });

    startDaemon();

    const logContent = await waitForLogToContain('ERR_TIMEOUT');
    expect(logContent).toContain('ERR_TIMEOUT');

    const lines = logContent.trim().split('\n');
    const convertBackendEntry = lines
      .map(line => {
        try { return JSON.parse(line); } catch(_) { return null; }
      })
      .reverse()
      .find(entry => entry && entry.toolName === 'converter' && entry.agentType === 'backend');

    expect(convertBackendEntry).toBeDefined();
    expect(convertBackendEntry.status).toBe('unhealthy');
    expect(convertBackendEntry.error.code).toBe('ERR_TIMEOUT');

    // Verify status page
    await page.goto('/status.html');

    const convertBadge = page.locator('[data-tool="converter"][data-agent="backend"]');
    await expect(convertBadge).toHaveText('UNHEALTHY');
    await expect(convertBadge).toHaveClass(/status-unhealthy/);
  });

  test('should verify error when system tools are missing', async ({ page }) => {
    mockServer.setIntercept('/api/inspect', {
      status: 500,
      body: { error: 'FFmpeg binary not found', code: 'ERR_SYSTEM_TOOL_MISSING' }
    });

    startDaemon();

    const logContent = await waitForLogToContain('ERR_SYSTEM_TOOL_MISSING');
    expect(logContent).toContain('ERR_SYSTEM_TOOL_MISSING');

    const lines = logContent.trim().split('\n');
    const inspectBackendEntry = lines
      .map(line => {
        try { return JSON.parse(line); } catch(_) { return null; }
      })
      .reverse()
      .find(entry => entry && entry.toolName === 'inspector' && entry.agentType === 'backend');

    expect(inspectBackendEntry).toBeDefined();
    expect(inspectBackendEntry.status).toBe('unhealthy');
    expect(inspectBackendEntry.error.code).toBe('ERR_SYSTEM_TOOL_MISSING');

    // Verify status page
    await page.goto('/status.html');

    const inspectBadge = page.locator('[data-tool="inspector"][data-agent="backend"]');
    await expect(inspectBadge).toHaveText('UNHEALTHY');
    await expect(inspectBadge).toHaveClass(/status-unhealthy/);

    const errorMsg = page.locator('[data-tool="inspector"] .error-msg');
    await expect(errorMsg).toContainText('FFmpeg binary not found');
  });
});
