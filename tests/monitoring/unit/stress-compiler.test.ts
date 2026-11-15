import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// @ts-ignore
import { compileDashboard } from '../../../monitoring/compiler';

describe('Compiler Stress & Robustness Tests', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const tempLogFile = path.join(projectRoot, 'stress_test.log');
  const tempHtmlFile = path.join(projectRoot, 'public/stress_status.html');

  beforeEach(() => {
    if (fs.existsSync(tempLogFile)) fs.unlinkSync(tempLogFile);
    if (fs.existsSync(tempHtmlFile)) fs.unlinkSync(tempHtmlFile);
  });

  afterEach(() => {
    if (fs.existsSync(tempLogFile)) fs.unlinkSync(tempLogFile);
    if (fs.existsSync(tempHtmlFile)) fs.unlinkSync(tempHtmlFile);
  });

  test('should handle completely empty log file', () => {
    fs.writeFileSync(tempLogFile, '', 'utf8');
    expect(() => compileDashboard(tempLogFile, tempHtmlFile)).not.toThrow();
    expect(fs.existsSync(tempHtmlFile)).toBe(true);
    const html = fs.readFileSync(tempHtmlFile, 'utf8');
    expect(html).toContain('HEALTHY');
  });

  test('should not crash on invalid JSON in log file (Robustness)', () => {
    const validEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      daemonId: 'daemon-1',
      agentType: 'backend',
      toolName: 'converter',
      status: 'healthy',
      durationMs: 100,
      error: null
    });
    
    // Write valid entry followed by a corrupt entry
    fs.writeFileSync(tempLogFile, `${validEntry}\n{invalid-json}\n`, 'utf8');
    
    // We expect it NOT to throw an error due to crash prevention
    expect(() => compileDashboard(tempLogFile, tempHtmlFile)).not.toThrow();
    expect(fs.existsSync(tempHtmlFile)).toBe(true);
    const html = fs.readFileSync(tempHtmlFile, 'utf8');
    expect(html).toContain('status-healthy');
  });

  test('should not crash on schema validation failure (Robustness)', () => {
    const invalidEntry = JSON.stringify({
      timestamp: new Date().toISOString(),
      daemonId: 'daemon-1',
      agentType: 'backend',
      toolName: 'invalid-tool-name', // invalid
      status: 'healthy',
      durationMs: 100,
      error: null
    });
    fs.writeFileSync(tempLogFile, `${invalidEntry}\n`, 'utf8');
    expect(() => compileDashboard(tempLogFile, tempHtmlFile)).not.toThrow();
    expect(fs.existsSync(tempHtmlFile)).toBe(true);
  });

  test('performance under large payload (stress test)', () => {
    const tools = ['dashboard', 'converter', 'hevc', 'inspector', 'muter', 'spotify', 'trimmer', 'youtube'];
    
    // 1. Test 10k entries
    const entries10k: string[] = [];
    for (let i = 0; i < 10000; i++) {
      const tool = tools[i % tools.length];
      const agentType = i % 2 === 0 ? 'frontend' : 'backend';
      entries10k.push(JSON.stringify({
        timestamp: new Date(Date.now() - (10000 - i) * 1000).toISOString(),
        daemonId: 'daemon-1',
        agentType,
        toolName: tool,
        status: 'healthy',
        durationMs: 50,
        error: null
      }));
    }
    fs.writeFileSync(tempLogFile, entries10k.join('\n') + '\n', 'utf8');
    
    let start = performance.now();
    compileDashboard(tempLogFile, tempHtmlFile);
    let duration = performance.now() - start;
    console.log(`[INFO] Compilation of 10k logs took ${duration.toFixed(2)}ms`);
    expect(fs.existsSync(tempHtmlFile)).toBe(true);
    expect(duration).toBeLessThan(2000);

    // 2. Test 50k entries
    const entries50k: string[] = [];
    for (let i = 0; i < 50000; i++) {
      const tool = tools[i % tools.length];
      const agentType = i % 2 === 0 ? 'frontend' : 'backend';
      entries50k.push(JSON.stringify({
        timestamp: new Date(Date.now() - (50000 - i) * 1000).toISOString(),
        daemonId: 'daemon-1',
        agentType,
        toolName: tool,
        status: 'healthy',
        durationMs: 50,
        error: null
      }));
    }
    fs.writeFileSync(tempLogFile, entries50k.join('\n') + '\n', 'utf8');
    
    start = performance.now();
    compileDashboard(tempLogFile, tempHtmlFile);
    duration = performance.now() - start;
    console.log(`[INFO] Compilation of 50k logs took ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(5000);

    // 3. Test 100k entries
    const entries100k: string[] = [];
    for (let i = 0; i < 100000; i++) {
      const tool = tools[i % tools.length];
      const agentType = i % 2 === 0 ? 'frontend' : 'backend';
      entries100k.push(JSON.stringify({
        timestamp: new Date(Date.now() - (100000 - i) * 1000).toISOString(),
        daemonId: 'daemon-1',
        agentType,
        toolName: tool,
        status: 'healthy',
        durationMs: 50,
        error: null
      }));
    }
    fs.writeFileSync(tempLogFile, entries100k.join('\n') + '\n', 'utf8');
    
    start = performance.now();
    compileDashboard(tempLogFile, tempHtmlFile);
    duration = performance.now() - start;
    console.log(`[INFO] Compilation of 100k logs took ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(10000);
  });

  test('rapid sequential updates (race condition risk)', () => {
    // Generate a basic log file
    const tools = ['dashboard', 'converter', 'hevc', 'inspector', 'muter', 'spotify', 'trimmer', 'youtube'];
    const entries = tools.map((tool, idx) => JSON.stringify({
      timestamp: new Date().toISOString(),
      daemonId: 'daemon-1',
      agentType: 'backend',
      toolName: tool,
      status: 'healthy',
      durationMs: 50,
      error: null
    }));
    fs.writeFileSync(tempLogFile, entries.join('\n') + '\n', 'utf8');

    // Run compileDashboard 50 times in rapid sequence (simulating high frequency updates)
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      compileDashboard(tempLogFile, tempHtmlFile);
    }
    const duration = performance.now() - start;
    console.log(`[INFO] 50 sequential compilations took ${duration.toFixed(2)}ms (${(duration / 50).toFixed(2)}ms/compilation)`);
    expect(duration).toBeLessThan(2000);
  });

  test('HTML Injection vulnerability check', () => {
    const xssPayload = `</div><script>window.XSS_EXECUTED=true;</script><div class="error-msg">`;
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      daemonId: 'daemon-1',
      agentType: 'backend',
      toolName: 'converter',
      status: 'unhealthy',
      durationMs: 100,
      error: {
        message: xssPayload,
        code: 'ERR_XSS'
      }
    });
    
    fs.writeFileSync(tempLogFile, entry + '\n', 'utf8');
    compileDashboard(tempLogFile, tempHtmlFile);
    
    const html = fs.readFileSync(tempHtmlFile, 'utf8');
    // The HTML should contain the escaped script tag instead of the unescaped one
    expect(html).not.toContain(`<div class="error-msg"></div><script>window.XSS_EXECUTED=true;</script>`);
    expect(html).toContain(`&lt;/div&gt;&lt;script&gt;window.XSS_EXECUTED=true;&lt;/script&gt;&lt;div class=&quot;error-msg&quot;&gt;`);
  });

  test('chronological ordering bug check', () => {
    // Line 1 has a LATER timestamp but is written FIRST
    const laterEntryUnhealthy = JSON.stringify({
      timestamp: '2026-06-19T12:05:00.000Z',
      daemonId: 'daemon-1',
      agentType: 'backend',
      toolName: 'converter',
      status: 'unhealthy',
      durationMs: 100,
      error: { message: 'Failed late check', code: 'ERR_LATE' }
    });

    // Line 2 has an EARLIER timestamp but is written SECOND (e.g., due to write order or race condition)
    const earlierEntryHealthy = JSON.stringify({
      timestamp: '2026-06-19T12:00:00.000Z',
      daemonId: 'daemon-1',
      agentType: 'backend',
      toolName: 'converter',
      status: 'healthy',
      durationMs: 100,
      error: null
    });

    fs.writeFileSync(tempLogFile, `${laterEntryUnhealthy}\n${earlierEntryHealthy}\n`, 'utf8');
    compileDashboard(tempLogFile, tempHtmlFile);

    const html = fs.readFileSync(tempHtmlFile, 'utf8');
    // Since compiler.js now sorts logEntries chronologically, the unhealthy (later) entry takes precedence.
    expect(html).toContain('data-tool="converter" data-agent="backend" data-status="unhealthy"');
    expect(html).not.toContain('data-tool="converter" data-agent="backend" data-status="healthy"');
  });

  test('log file rotation logic simulation', () => {
    // Simulating the exact rotation logic implemented in runner.js
    const initialLinesCount = 1050;
    const lines = [];
    for (let i = 0; i < initialLinesCount; i++) {
      lines.push(JSON.stringify({
        timestamp: new Date(Date.now() - (initialLinesCount - i) * 1000).toISOString(),
        daemonId: 'daemon-1',
        agentType: 'backend',
        toolName: 'converter',
        status: 'healthy',
        durationMs: 50,
        error: null
      }));
    }
    
    // Write lines to temp log file
    fs.writeFileSync(tempLogFile, lines.join('\n') + '\n', 'utf8');
    
    // Read and rotate
    if (fs.existsSync(tempLogFile)) {
      const fileContent = fs.readFileSync(tempLogFile, 'utf8');
      const readLines = fileContent.split('\n').filter(line => line.trim() !== '');
      expect(readLines.length).toBe(1050);
      
      if (readLines.length > 1000) {
        const truncated = readLines.slice(-1000);
        fs.writeFileSync(tempLogFile, truncated.join('\n') + '\n', 'utf8');
      }
    }
    
    // Assert file contains exactly 1000 lines now
    const rotatedContent = fs.readFileSync(tempLogFile, 'utf8');
    const rotatedLines = rotatedContent.split('\n').filter(line => line.trim() !== '');
    expect(rotatedLines.length).toBe(1000);
    
    // The last line of the original array (newest log entry) should be preserved
    const lastOriginalEntry = JSON.parse(lines[lines.length - 1]);
    const lastRotatedEntry = JSON.parse(rotatedLines[rotatedLines.length - 1]);
    expect(lastRotatedEntry.timestamp).toBe(lastOriginalEntry.timestamp);
    
    // The first 50 lines should be removed, so the first remaining line is the 50th index (item 50)
    const firstRemainingEntry = JSON.parse(rotatedLines[0]);
    const original50thEntry = JSON.parse(lines[50]);
    expect(firstRemainingEntry.timestamp).toBe(original50thEntry.timestamp);
  });
});
