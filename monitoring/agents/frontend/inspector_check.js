async function runCheck(page, baseUrl) {
  const startTime = Date.now();
  try {
    const response = await page.goto(`${baseUrl}/tools/inspector`, {
      timeout: 5000,
      waitUntil: 'domcontentloaded'
    });
    
    const status = response ? response.status() : 0;
    if (status !== 200) {
      throw new Error(`Failed to load page. Status: ${status}`);
    }

    // Wait for header
    await page.waitForSelector('h2.tool-title:has-text("Media")', { timeout: 3000 });
    
    // Verify specific UI element exists
    await page.waitForSelector('[data-testid="initialize-btn"]', { timeout: 3000 });

    const durationMs = Date.now() - startTime;
    return {
      success: true,
      durationMs,
      metrics: {
        httpStatus: status
      }
    };
  } catch (err) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      durationMs,
      error: err.message
    };
  }
}

module.exports = { runCheck };
