# AGENTS.md — Celestial Media Hub

Guidance for AI coding agents and contributors working in this repository.

## Overview

Celestial Media Hub is a full-stack Next.js 14 (App Router) media processing studio backed by native server binaries (`ffmpeg`, `ffprobe`, `yt-dlp`, plus `cwebp` / `pdftoppm` / `sips` for image/PDF conversion) and a browser-side multi-worker Web Worker silicon profiler.

## Repository Layout

```text
.github/
  ├── workflows/         # GitHub Actions (ci.yml, sync-hf-space.yml)
  ├── CONTRIBUTING.md    # Contribution workflow and test checklist
  └── SECURITY.md        # Security architecture and vulnerability disclosure
public/                  # Static assets & Web Workers (hardware-probe-worker.js, bootstrap-guard.js, upi-qr.png)
scripts/                 # Cross-platform launcher & container scripts (run-next.mjs, docker-entrypoint.sh, pdf-rasterizer.swift)
src/
  ├── app/               # Next.js App Router pages, API routes (app/api/**), UI components, GlobalJobContext
  │   ├── api/           # Route handlers (audio-trim, auth, compress, convert, download, health, hevc, mute, spotify-convert, system/hardware, youtube)
  │   ├── components/    # Shared UI (ui/), layout shell (layout/), waveform canvas (waveform/)
  │   └── tools/         # Tool workspaces (converter, hevc, muter, spotify, trimmer, youtube)
  ├── lib/
  │   ├── media/         # ffmpeg.ts, ytdlp.ts, remuxDecision.ts, pdfRasterizer.ts, engine/
  │   ├── security/      # auth.ts, clientAuth.ts, jwt.ts, ratelimit.ts, errors.ts, safeFetch.ts
  │   ├── system/        # env.ts, temp.ts, hardwareProfiler.ts, serverHardwareProfiler.ts
  │   └── utils/         # archive.ts, filename.ts, qrcode.ts, useCursorGlow.ts
  ├── schemas/           # Zod input validation schemas per route
  └── middleware.ts      # Edge CORS, Fetch Metadata isolation, sliding-window rate limiter, JWT auth guard
tests/
  ├── e2e/               # End-to-end backend/UI pipeline tests
  ├── security/          # Auth, JWT, BOLA, rate limiting, header, and injection tests
  ├── stress/            # Playwright stress specs (excluded from Vitest default run)
  ├── unit/              # Component, route, and library unit tests
  ├── visual/            # Playwright UI QA & screenshot regression specs (excluded from Vitest default run)
  └── vitest.setup.ts    # Vitest global test setup
```

## Development & Verification Commands

- Install dependencies: `npm install` (or `npm ci` cleanly with synced `package-lock.json`)
- Dev server: `npm run dev` (serves on `http://localhost:3000`)
- Typecheck: `npx tsc --noEmit` *(run `npm run build` first if `.next/types` has not been generated yet)*
- Lint: `npm run lint`
- Unit + Security + E2E suite: `npm test` (Vitest) or `npx vitest run tests/security`
- Production build: `JWT_SECRET="build-time-only-jwt-secret-min-32-chars-ok" npm run build` (PowerShell: `$env:JWT_SECRET="build-time-only-jwt-secret-min-32-chars-ok"; npm run build`)
- Docker container: `docker build -t celestial-media-hub . && docker run -p 7860:7860 celestial-media-hub`

## Environment Variables (`.env.example`)

- `FFMPEG_PATH`, `YTDLP_PATH`: Optional overrides; `src/lib/system/env.ts` falls back to `ffmpeg`, `ffprobe`, `yt-dlp` on `PATH`.
- `TEMP_DIR`: Scratch job workspace directory (defaults to `path.join(os.tmpdir(), 'celestial')`, e.g. `/tmp/celestial` on POSIX or `%TEMP%\celestial` on Windows). Cleaned in `finally` handlers and background TTL sweepers.
- `JWT_SECRET`: Required (`>= 32` chars) in production builds/runtime; auto-generated at container boot in `scripts/docker-entrypoint.sh` if omitted.
- `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`: Optional; `/api/spotify-convert` falls back to Spotify public embed extraction when unset.

## Critical Architectural & Security Invariants

1. **No shell spawning**: Always use `spawn` or `execFile` with explicit argument arrays and `--` option terminators before untrusted URLs/filenames. Never concatenate user input into shell commands.
2. **Error sanitization**: Every API catch block and SSE error stream must use `sanitizeError` / `sanitizeSseError` from `src/lib/security/errors.ts`. Never leak stack traces, raw stderr, or host filesystem paths to clients.
3. **BOLA & path traversal**: API jobs register ownership (`registerJobOwner` / `verifyJobOwnership`), and downloads sanitize filenames via `path.basename` + containment checks + RFC 6266 `Content-Disposition`.
4. **Header stripping & SSRF**: `src/middleware.ts` strips spoofable `x-user-*` headers; YouTube/Instagram/Spotify/Turbo routes enforce strict protocol + domain allowlists.
