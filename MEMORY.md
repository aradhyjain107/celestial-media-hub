# MEMORY.md — Celestial Media Hub v2

## Project name
Celestial Media Hub v2

## Current phase
Phase 4 — Verification (IN PROGRESS)

## Last completed task
- **Phase:** Phase 3 — Execution Mode
- **Last Completed:** Phase 3 — all 8 tool pages built, tested, and committed
- **Current Open Task:** Phase 4 final verification and Phase 5 handoff

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

## Deployment strategy
- Local first: everything runs via npm run dev
- Deployed: Vercel (frontend) + Railway/Render (FFmpeg backend)
- Switch via NEXT_PUBLIC_API_BASE_URL env var — zero code changes

## Critical constraints
- FFmpeg and yt-dlp must be installed on the host machine (local) or container (deployed)
- Temp files live in /tmp/celestial/[uuid]/ — cleaned in finally block always
- No hardcoded binary paths — all via env vars (FFMPEG_PATH, YTDLP_PATH)
- SSE (Server-Sent Events) for real-time progress streaming from FFmpeg

## Open questions / blockers
None

## Key context for next session
25 test files, 90 tests passing, zero lint errors, production build clean at exit code 0. All tool pages committed. walkthrough.md written. bootstrap.sh and verify.sh being written. Final Playwright visual regression check in progress.
