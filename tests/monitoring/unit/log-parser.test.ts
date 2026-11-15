import { expect, describe, test } from 'vitest';
import { parseLogLine, parseLogContent, verifyChronologicalOrder } from '../helpers/log-parser';

describe('Log Parser Unit Tests', () => {
  const validEntry1 = {
    timestamp: '2026-06-15T03:53:45.123Z',
    daemonId: 'daemon-uuid-123',
    agentType: 'frontend' as const,
    toolName: 'converter' as const,
    status: 'healthy' as const,
    durationMs: 120,
    error: null,
    metrics: {
      domContentLoadedMs: 45,
      lcp: 1.2
    }
  };

  const validEntry2 = {
    timestamp: '2026-06-15T03:54:45.123Z',
    daemonId: 'daemon-uuid-123',
    agentType: 'backend' as const,
    toolName: 'muter' as const,
    status: 'unhealthy' as const,
    durationMs: 350,
    error: {
      message: 'API returned HTTP 500',
      code: 'ERR_API_CRASH'
    }
  };

  test('should successfully parse valid log lines', () => {
    const parsed1 = parseLogLine(JSON.stringify(validEntry1));
    expect(parsed1).toEqual(validEntry1);

    const parsed2 = parseLogLine(JSON.stringify(validEntry2));
    expect(parsed2).toEqual(validEntry2);
  });

  test('should return null for empty/whitespace lines', () => {
    expect(parseLogLine('')).toBeNull();
    expect(parseLogLine('   ')).toBeNull();
  });

  test('should throw error for malformed JSON', () => {
    expect(() => parseLogLine('{invalid json}')).toThrow();
  });

  test('should throw error for schema validation failure', () => {
    const invalidEntry = { ...validEntry1, toolName: 'invalid-tool' as any };
    expect(() => parseLogLine(JSON.stringify(invalidEntry))).toThrow();

    const missingFieldEntry = { ...validEntry1 };
    delete (missingFieldEntry as any).status;
    expect(() => parseLogLine(JSON.stringify(missingFieldEntry))).toThrow();
  });

  test('should parse log content with multiple lines', () => {
    const content = `${JSON.stringify(validEntry1)}\n\n${JSON.stringify(validEntry2)}`;
    const parsed = parseLogContent(content);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(validEntry1);
    expect(parsed[1]).toEqual(validEntry2);
  });

  test('should verify chronological order correctly', () => {
    const entry1 = { ...validEntry1, timestamp: '2026-06-15T03:50:00.000Z' };
    const entry2 = { ...validEntry1, timestamp: '2026-06-15T03:51:00.000Z' };
    const entry3 = { ...validEntry1, timestamp: '2026-06-15T03:52:00.000Z' };

    expect(verifyChronologicalOrder([entry1, entry2, entry3])).toBe(true);
    expect(verifyChronologicalOrder([entry1, entry3, entry2])).toBe(false);
  });
});
