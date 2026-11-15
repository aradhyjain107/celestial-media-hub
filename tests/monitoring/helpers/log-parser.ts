import { z } from 'zod';

export const LogEntrySchema = z.object({
  timestamp: z.string().datetime(),
  daemonId: z.string(),
  agentType: z.enum(['frontend', 'backend']),
  toolName: z.enum(['dashboard', 'converter', 'hevc', 'inspector', 'muter', 'spotify', 'trimmer', 'youtube']),
  status: z.enum(['healthy', 'unhealthy']),
  durationMs: z.number().nonnegative(),
  error: z.object({
    message: z.string(),
    code: z.string(),
    stack: z.string().optional()
  }).nullable(),
  metrics: z.object({
    httpStatus: z.number().optional(),
    tempFilesCleaned: z.boolean().optional(),
    domContentLoadedMs: z.number().optional(),
    lcp: z.number().optional(),
    screenshotPath: z.string().optional(),
  }).optional()
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

export function parseLogLine(line: string): LogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return LogEntrySchema.parse(parsed);
  } catch (error) {
    throw new Error(`Invalid log entry: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseLogContent(content: string): LogEntry[] {
  const lines = content.split('\n');
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (parsed) {
      entries.push(parsed);
    }
  }
  return entries;
}

export function verifyChronologicalOrder(entries: LogEntry[]): boolean {
  for (let i = 1; i < entries.length; i++) {
    const prevTime = new Date(entries[i - 1].timestamp).getTime();
    const currTime = new Date(entries[i].timestamp).getTime();
    if (currTime < prevTime) {
      return false;
    }
  }
  return true;
}
