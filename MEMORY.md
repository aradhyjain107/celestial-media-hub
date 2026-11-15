# MEMORY.md — Celestial Media Hub v2

## Project name
Celestial Media Hub v2

## Current phase
Phase 6 — Post-Stabilization (IN PROGRESS)

## Last completed task
- **Phase:** Phase 6 — Post-Stabilization
- **Last Completed:** Resolved critical UI "black screen" failure, fixed `next/font` autoprefixer resolution crash, and corrected `GlobalJobContext` stream types for Spotify tool.
- **Current Open Task:** Re-enable and verify `PageTransition` and `autoprefixer` after confirmed stable boot.

## Stack summary
- Next.js 14, TypeScript, Tailwind CSS
- FFmpeg via Node child_process (NO Python)
- yt-dlp via child_process
- Custom waveform engine (Web Audio API + Canvas)
- Zod for all schema validation
- Vitest + Playwright for testing
- GitHub Actions for CI

## Tools / features
1. Video Muter — strip or silence audio, batch, ZIP
2. HEVC Compressor — H.265, CRF, presets, hardware accel detection
3. Universal Converter — 10 formats, platform presets, metadata strip
4. YouTube Downloader — audio + video, playlist support
5. Audio Trimmer — custom waveform visualizer, trim + merge, fades
6. Spotify Converter — playlist → yt-dlp → MP3 batch download
7. Media Inspector — drag + drop metadata reader, side-by-side compare
8. Dashboard — unified entry point for all tools

## Deployment strategy
- Local first: everything runs via npm run dev
- Deployed: Vercel (frontend) + Railway/Render (FFmpeg backend)
- Switch via NEXT_PUBLIC_API_BASE_URL env var — zero code changes

## Critical constraints
- FFmpeg and yt-dlp must be installed on the host machine (local) or container (deployed)
- Temp files live in /tmp/celestial/[uuid]/ — cleaned in finally block always
- No hardcoded binary paths — all via env vars (FFMPEG_PATH, YTDLP_PATH)
- SSE (Server-Sent Events) for real-time progress streaming from FFmpeg

## Fast Server Startup Procedure
- When requested to start the servers, run `./start-servers.sh` immediately.
- It is idempotent, self-healing, fast (<500ms if running, <3s if starting), auto-frees port 3000, guards SWC binary integrity, and launches both `celestial-dev` and `monitoring-runner` under PM2 with verification.

## Open questions / blockers
None

## Key context for next session
Project is fully verified. 25 test files, 90 tests passing. walkthrough.md and bootstrap.sh are up to date. UI audit screenshots are in /public for final user sign-off.

