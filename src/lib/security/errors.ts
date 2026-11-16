/**
 * Centralized error sanitization for API routes.
 *
 * SECURITY: Never expose raw error messages, stack traces, or internal file
 * paths to HTTP clients. Log full details server-side only.
 */

/** Generic messages returned to clients for each HTTP status bucket. */
const CLIENT_MESSAGES: Record<number, string> = {
  400: 'Bad request. Please check your input and try again.',
  401: 'Authentication required.',
  403: 'You do not have permission to perform this action.',
  404: 'The requested resource was not found.',
  429: 'Too many requests. Please slow down.',
  500: 'An internal server error occurred. Please try again later.',
};

/**
 * Logs the full error server-side and returns a sanitized, client-safe
 * error message. Use this in every API route catch block.
 *
 * @param err     The caught error (any type).
 * @param context A short label for server-side logging, e.g. 'POST /api/convert'.
 * @param status  HTTP status code to return (defaults to 500).
 * @returns       An object with a sanitized `error` string and the `status` code.
 */
export function sanitizeError(
  err: unknown,
  context: string,
  status: number = 500
): { error: string; status: number } {
  // Log full details server-side (never reaches the client)
  if (process.env.NODE_ENV !== 'test') {
    console.error(`[${context}] Error (${status}):`, err);
  }

  // eslint-disable-next-line security/detect-object-injection
  const message = CLIENT_MESSAGES[status] ?? CLIENT_MESSAGES[500];
  return { error: message, status };
}

const KNOWN_SAFE_SSE_MESSAGES: ReadonlyMap<string, string> = new Map([
  [
    'YOUTUBE_BOT_CHECK',
    'YouTube blocked automated download from this shared cloud IP (bot verification required). Run Celestial Media Hub locally via Desktop App.',
  ],
  [
    'MEDIA_UNAVAILABLE',
    'This video is private, deleted, copyright-restricted, or unavailable in the server region.',
  ],
  [
    'AGE_RESTRICTED',
    'This video requires account sign-in or age verification and cannot be fetched anonymously.',
  ],
  [
    'UPSTREAM_TIMEOUT',
    'Media extraction timed out on the cloud server. Try audio-only, lower resolution, or run locally via Desktop App.',
  ],
]);

/**
 * Classifies known public upstream failure reasons into allowlisted static client
 * messages without ever exposing raw error strings, paths, or stack traces.
 */
export function resolveSafeSseMessage(err: unknown): string | undefined {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (!raw) return undefined;
  for (const [code, safeMessage] of Array.from(KNOWN_SAFE_SSE_MESSAGES.entries())) {
    if (raw.includes(`[SAFE:${code}]`)) {
      return safeMessage;
    }
  }
  return undefined;
}

/**
 * Returns a sanitized SSE error payload string.
 * Use inside ReadableStream error handlers to avoid leaking internal details.
 *
 * @param err     The caught error.
 * @param context A short label for server-side logging.
 */
export function sanitizeSseError(err: unknown, context: string): string {
  console.error(`[${context}] SSE Error:`, err);
  const safeMessage = resolveSafeSseMessage(err) ?? 'Processing failed. Please try again.';
  return `data: ${JSON.stringify({ error: safeMessage })}\n\n`;
}
