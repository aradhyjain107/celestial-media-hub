async function runCheck(baseUrl) {
  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${baseUrl}/status.html`, {
      signal: controller.signal
    });
    const status = res.status;
    if (status === 200) {
      return {
        success: true,
        durationMs: Date.now() - startTime,
        metrics: { httpStatus: status }
      };
    } else {
      let code = 'ERR_HTTP_' + status;
      let message = `Failed to load dashboard. Status: ${status}`;
      if (status >= 500) {
        code = 'ERR_HTTP_5xx';
        try {
          const body = await res.json();
          if (body && body.code) {
            code = body.code;
          }
          if (body && body.error) {
            message = body.error;
          }
        } catch (_) {}
      }
      return {
        success: false,
        durationMs: Date.now() - startTime,
        error: { message, code }
      };
    }
  } catch (err) {
    const code = err.name === 'AbortError' ? 'ERR_TIMEOUT' : 'ERR_NETWORK';
    return {
      success: false,
      durationMs: Date.now() - startTime,
      error: { message: err.message, code }
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { runCheck };
