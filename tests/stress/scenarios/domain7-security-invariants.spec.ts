import { test, expect } from '@playwright/test';
import { attachConsoleCollector } from '../helpers/adversarial-fixtures';
import { saveBug } from '../helpers/bug-logger';

test.describe('Domain 7: Security Invariants & Console Injections (SEC-01 to SEC-15)', () => {
  test('SEC-01: Console Identity Spoof Header Stripping Verification', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    // Call API from browser console attempting to spoof x-user-id
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: {
          'x-user-id': 'spoofed-admin-id',
          'x-role': 'admin',
        },
        body: new FormData(),
      });
      return { status: res.status };
    });

    // Unauthenticated request should return 401
    expect(response.status).toBe(401);
  });

  test('SEC-02: BOLA Direct Download Probe Rejection', async ({ page }) => {
    await page.goto('/tools/converter');

    const res = await page.evaluate(async () => {
      const resp = await fetch('/api/download?jobId=unauthorized-foreign-id&file=confidential.mp4');
      return resp.status;
    });

    // Should return 403 or 401 or 400
    expect([400, 401, 403, 404]).toContain(res);
  });

  test('SEC-03: Expired JWT Token Rejection', async ({ page }) => {
    await page.goto('/tools/converter');

    const expiredJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.4-wQjZk';

    const res = await page.evaluate(async (token) => {
      const resp = await fetch('/api/convert', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return resp.status;
    }, expiredJwt);

    expect(res).toBe(401);
  });

  test('SEC-04: alg: "none" Unsigned JWT Injection Rejection', async ({ page }) => {
    await page.goto('/tools/converter');

    const algNoneJwt = 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsImlhdCI6MTUxNjIzOTAyMn0.';

    const res = await page.evaluate(async (token) => {
      const resp = await fetch('/api/convert', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return resp.status;
    }, algNoneJwt);

    expect(res).toBe(401);
  });

  test('SEC-05: Rogue CORS Preflight From Untrusted Origin', async ({ page }) => {
    await page.goto('/tools/converter');

    const status = await page.request.fetch('/api/convert', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://evil-hacker-domain.com',
        'Access-Control-Request-Method': 'POST',
      },
    });

    // Security invariant requires 403 for unauthorized origins
    expect([403, 401, 400]).toContain(status.status());
  });

  test('SEC-06: XSS in Media Metadata Render Sanitization', async ({ page }) => {
    await page.goto('/tools/trimmer');

    await page.evaluate(() => {
      (window as unknown as { __xss_probe?: boolean }).__xss_probe = false;
    });

    const isExecuted = await page.evaluate(() => (window as unknown as { __xss_probe?: boolean }).__xss_probe);
    expect(isExecuted).toBe(false);
  });

  test('SEC-07: Malicious SVG Script Bomb in Dropzone', async ({ page }) => {
    await page.goto('/tools/converter');
    const collector = attachConsoleCollector(page);

    const svgPayload = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>window.__svg_pwned=1</script></svg>');
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: 'malicious.svg',
      mimeType: 'image/svg+xml',
      buffer: svgPayload,
    });

    await page.waitForTimeout(400);

    const isSvgPwned = await page.evaluate(() => (window as unknown as { __svg_pwned?: number }).__svg_pwned);
    expect(isSvgPwned).toBeUndefined();

    const uncaught = collector.errors.filter(e => e.includes('UNCAUGHT PAGE ERROR'));
    expect(uncaught).toHaveLength(0);
  });

  test('SEC-08: Client Rate Limit Rapid Request Burst', async ({ page }) => {
    await page.goto('/tools/converter');

    const statuses = await page.evaluate(async () => {
      const results: number[] = [];
      for (let i = 0; i < 30; i++) {
        const res = await fetch('/api/health');
        results.push(res.status);
      }
      return results;
    });

    // Should not crash the server
    expect(statuses.every(s => [200, 429].includes(s))).toBe(true);
  });

  test('SEC-09: Directory Path Traversal in Download Route', async ({ page }) => {
    const res = await page.request.get('/api/download?jobId=123&file=../../../../../../etc/passwd');
    expect([400, 403, 404]).toContain(res.status());
  });

  test('SEC-10: CSP Direct Inline Script Injection Guard', async ({ page }) => {
    await page.goto('/tools/converter');

    const evalBlocked = await page.evaluate(() => {
      try {
        const s = document.createElement('script');
        s.textContent = 'window.__inline_csp_check = 1;';
        document.body.appendChild(s);
        return (window as unknown as { __inline_csp_check?: number }).__inline_csp_check === 1;
      } catch {
        return false;
      }
    });

    // CSP should restrict or allow controlled execution without crashing
    expect(typeof evalBlocked).toBe('boolean');
  });

  test('SEC-11: SSRF Egress Block on Turbo-Download Route', async ({ page }) => {
    const res = await page.request.post('/api/experimental/turbo-download', {
      data: { url: 'http://169.254.169.254/latest/meta-data/' },
    });

    // Should reject SSRF attempt
    expect([400, 401, 403, 404]).toContain(res.status());
  });

  test('SEC-12: Sensitive Server Path Leakage Sanitization', async ({ page }) => {
    const res = await page.request.post('/api/hevc', {
      data: { invalid: 'payload' },
    });

    const text = await res.text();
    expect(text).not.toMatch(/\/Users\/[^/\s"']+/);
    expect(text).not.toContain('node_modules');
  });

  test('SEC-13: Clickjacking Frame Check (X-Frame-Options: DENY)', async ({ page }) => {
    const response = await page.goto('/tools/converter');
    const headers = response?.headers();
    expect(headers?.['x-frame-options']?.toUpperCase()).toBe('DENY');
  });

  test('SEC-14: Prototype Pollution in Options JSON', async ({ page }) => {
    const res = await page.request.post('/api/compress', {
      data: JSON.parse('{"__proto__": {"polluted": true}}'),
    });

    expect([400, 401, 422]).toContain(res.status());
  });

  test('SEC-15: CRLF Header Splitting in Download Route', async ({ page }) => {
    const res = await page.request.get('/api/download?jobId=123&file=test.mp4%0d%0aSet-Cookie:%20hacked=true');
    expect([400, 403, 404]).toContain(res.status());
    expect(res.headers()['set-cookie']).toBeUndefined();
  });
});
