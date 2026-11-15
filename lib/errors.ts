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

/**
 * Returns a sanitized generic SSE error payload string.
 * Use inside ReadableStream error handlers to avoid leaking internal details.
 *
 * @param err     The caught error.
 * @param context A short label for server-side logging.
 */
export function sanitizeSseError(err: unknown, context: string): string {
  console.error(`[${context}] SSE Error:`, err);
  return `data: ${JSON.stringify({ error: 'Processing failed. Please try again.' })}\n\n`;
}
