import { test, expect } from '@playwright/test';
import { DaemonManager } from '../helpers/daemon-manager';
import fs from 'fs';
import path from 'path';

test.describe('Daemon Manager E2E Tests', () => {
  let dm: DaemonManager;
  const projectRoot = path.resolve(__dirname, '../../..');
  const logFile = path.join(projectRoot, 'monitoring.log');

  test.beforeEach(() => {
    dm = new DaemonManager();
    try {
      dm.deletePM2();
    } catch (e) {
      // Ignore
    }
  });

  test.afterEach(() => {
    try {
      dm.deletePM2();
    } catch (e) {
      // Ignore
    }
  });

  test('should manage direct Node.js runner process', async () => {
    const child = dm.startDirect();
    expect(child).not.toBeNull();
    expect(child.pid).toBeGreaterThan(0);

    // Wait a brief moment for it to write heartbeat
    await new Promise((resolve) => setTimeout(resolve, 2000));

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, 'utf8');
    expect(content).toContain('[heartbeat]');

    dm.stopDirect();
    expect(dm.getDirectProcess()).toBeNull();
  });

  test('should manage PM2 runner lifecycle', async () => {
    const startRes = dm.startPM2();
    expect(startRes).toContain('monitoring-runner');

    // Wait for PM2 process status to stabilize
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const status = dm.statusPM2();
    expect(['online', 'launching']).toContain(status);

    const stopRes = dm.stopPM2();
    expect(stopRes).toBeDefined();

    const delRes = dm.deletePM2();
    expect(delRes).toBeDefined();
  });
});
