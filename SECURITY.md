# Security Policy

## Supported Versions

Celestial Media Hub actively supports and maintains security updates for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

---

## Security Architecture & Defenses

Celestial Media Hub implements defense-in-depth measures based on the **Invicti Vibe Coding Security Checklist**:

1. **Authentication & Authorization**:
   - All `/api/*` endpoints require signed JWT credentials (`HS256` verified via `JWT_SECRET`).
   - Requests with missing or invalid credentials are rejected with HTTP 401.
   - Resource access strictly enforces Object-Level Ownership (BOLA prevention); unauthorized resource access yields HTTP 403.
   - Direct identity injection headers (`x-user-id`, `x-user-role`, `x-user-email`) are automatically stripped by `middleware.ts` before requests reach API routes.

2. **DoS & Resource Exhaustion Protection**:
   - Per-IP sliding-window rate limiting enforced across all route groups.
   - Heavy processing routes (e.g. `/api/convert`, `/api/youtube`) capped at strict thresholds.
   - Rate limit violations yield HTTP 429 with explicit `Retry-After` headers.

3. **Injection & Command Execution Safeguards**:
   - All binary execution calls (FFmpeg, yt-dlp) use structured array argument vectors (`execFile` / `spawn`), bypassing shell execution.
   - User parameters (timestamps, bitrates, format choices) are sanitized and strictly validated against regex allowlists.
   - Explicit `--` option separators precede user input in CLI flags to prevent option injection.

4. **SSRF & URL Handling**:
   - Outbound media retrieval enforces strict domain allowlists against known providers (`*.youtube.com`, `youtu.be`, `*.googlevideo.com`, etc.).
   - Private CIDR ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`) are blocked.

5. **Transport Security & Error Sanitization**:
   - Hardened security headers enforced via `next.config.mjs`:
     - Global route enforcement (`/(.*)`):
       - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
       - `X-Frame-Options: DENY`
       - `X-Content-Type-Options: nosniff`
       - `Referrer-Policy: strict-origin-when-cross-origin`
       - `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
       - `X-DNS-Prefetch-Control: off`
       - `X-Download-Options: noopen`
       - `X-Permitted-Cross-Domain-Policies: none`
     - Scoped API enforcement (`/api/(.*)`):
       - `Content-Security-Policy: default-src 'none'`
       - `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate`
       - `Pragma: no-cache`
   - Production API error responses and SSE streams mask internal path details, stack traces, and system diagnostics (`lib/errors.ts`).

---

## Reporting a Vulnerability

We take the security of Celestial Media Hub seriously. If you discover a security vulnerability, please follow responsible disclosure guidelines:

1. **Do NOT publicly report** the vulnerability via GitHub issues or public forums.
2. **Email your findings** directly to `security@celestial-media-hub.local` or contact the repository maintainer.
3. Provide a detailed summary including:
   - Type of issue (e.g., SSRF, BOLA, JWT flaw, injection).
   - Step-by-step proof of concept (PoC) to reproduce the vulnerability.
   - Impact assessment.

### Response Timelines
- **Acknowledgment**: Within 24 hours.
- **Triage & Assessment**: Within 48 hours.
- **Fix & Patch Release**: Within 7 business days for high/critical vulnerabilities.

---

## Security Updates & Dependencies
- System CLI binaries (`yt-dlp`, `ffmpeg`) should be updated regularly. Ensure `yt-dlp` is pinned to a release `≥2025.12.0` (or system package manager pinned release) to mitigate upstream YouTube extraction security patches.
- **CI / Docker Deployment Note:** When containerizing or deploying to remote server/CI environments, add an explicit binary startup version check (or pin `yt-dlp` in the `Dockerfile`/base image) to prevent silent version drift or breaking extractor changes.

