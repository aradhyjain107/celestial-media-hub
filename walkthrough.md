# Celestial Media Hub v2 — Walkthrough

## What was built
Celestial Media Hub v2 is a local-first, privacy-focused media processing suite. It completely drops the unstable Python/ML backend from v1 in favor of a robust, standalone architecture powered entirely by Next.js, FFmpeg, and yt-dlp.

## Screens generated
1. **Dashboard** (`/`) — 12-column Bento Grid of all available media processing tools.
2. **Video Muter** (`/tools/muter`) — Batch strip audio or replace with silence.
3. **HEVC Compressor** (`/tools/hevc`) — Batch H.265 compression with CRF and presets.
4. **Universal Converter & Synthesis Studio** (`/tools/converter`) — Batch format conversion across video, audio, image formats, 16-bit RAW camera image support, and real-time Audio-to-Video Synthesis Studio with 4 kinetic visualizer styles.
5. **YouTube Downloader** (`/tools/youtube`) — Audio/video fetching via yt-dlp including playlists.
6. **Audio Trimmer** (`/tools/trimmer`) — Custom interactive waveform trimmer with fades and multi-track concat.
7. **Spotify Converter** (`/tools/spotify`) — Playlist tracking mapping into high-bitrate audio.
*(Note: Early drafts included an experimental Media Inspector screen, which was pruned from the web platform to focus on the 6 core media transformation engines).*

## Tech stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Framer Motion, HTML5 Canvas, Zod.
- **Backend / Processing:** Node.js `child_process` (structured vector spawning), FFmpeg, yt-dlp, cwebp, sips.
- **Testing:** Vitest (unit & security suites), Playwright (visual regression).
- **Design System:** Obsidian Cyber-Noir (`#030304` / `#FF5A00`) custom CSS tokens (`globals.css`) and glassmorphic primitives.
- **Removed / Superseded:** Python backend, PyTorch, PySceneDetect, WaveSurfer.js, heavy external WASM runtimes (Rive/Lottie).

## Architecture decisions
- **Drop Python entirely:** Replaced fragility of v1's Python ML pipeline with pure FFmpeg operations, stabilizing the app.
- **Custom waveform engine:** Built a zero-dependency Web Audio API + HTML Canvas visualizer (~500 LOC) instead of using the heavy WaveSurfer.js.
- **SSE for FFmpeg progress:** Piped FFmpeg standard output via Server-Sent Events to the frontend for real-time progress blocks, circumventing WebSockets.
- **Split deployment via single env var:** Using `NEXT_PUBLIC_API_BASE_URL` to route requests either locally (empty) or to a deployed backend (e.g. Railway), keeping codebase unified.
- **Framer Motion for fluid interactions:** Adopted Framer Motion for hardware-accelerated gesture recognition, layout transitions, and dynamic spotlight cards without compromising 60fps performance.
- **Tailwind for layout, CSS vars for tokens:** Kept Tailwind for structural blocks but stored brand identity tokens in CSS custom properties for tight Canvas integration.
- **Explicit Design Tokens:** Grounded UI generation in definitive layout rules rather than vague generative prompts (Obsidian `#030304`, Cyber Orange `#FF5A00`).
- **SSE Parsing Pattern & Auth:** Standardized `ReadableStream` manual parsing over `fetch` to enable `Authorization: Bearer` JWT transmission across all streaming API endpoints.
- **Vitest fake timer scope:** Fake timers (`vi.useFakeTimers()`) are isolated to specific `test()` blocks instead of globally in `beforeEach` to prevent React render lockups.
- **WaveformControls scope:** Separated timeline navigation (WaveformControls) from tool processing state (Options Panel).
- **Client Directives:** Ensured `'use client'` is declared at the top of all tool pages utilizing React hooks.
- **Float32Array spread:** Avoided spread operators on TypedArrays due to TS target compilation limitations.

## SLO results
```text
Route (app)                              Size     First Load JS
┌ ○ /                                    175 B          96.1 kB
├ ○ /_not-found                          875 B          88.2 kB
├ ƒ /api/audio-trim                      0 B                0 B
├ ƒ /api/convert                         0 B                0 B
├ ƒ /api/hevc                            0 B                0 B
├ ƒ /api/mute                            0 B                0 B
├ ƒ /api/spotify-convert                 0 B                0 B
├ ƒ /api/youtube                         0 B                0 B
├ ○ /tools/converter                     3.8 kB         91.1 kB
├ ○ /tools/hevc                          3.64 kB        90.9 kB
├ ○ /tools/muter                         3.39 kB        90.7 kB
├ ○ /tools/spotify                       3.43 kB        90.7 kB
├ ○ /tools/trimmer                       4.42 kB        91.7 kB
└ ○ /tools/youtube                       9.13 kB        96.4 kB
+ First Load JS shared by all            87.3 kB
```

## Environment variables required
| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_API_BASE_URL` | Base URL for remote API (empty for local) | `""` |
| `FFMPEG_PATH` | Absolute path to FFmpeg binary | `/opt/homebrew/bin/ffmpeg` |
| `YTDLP_PATH` | Absolute path to yt-dlp binary | `/opt/homebrew/bin/yt-dlp` |
| `TEMP_DIR` | Directory for inflight media processing jobs | `/tmp/celestial` |

## Prerequisites
- Node.js (v18+)
- FFmpeg (`brew install ffmpeg`)
- yt-dlp (`brew install yt-dlp`)

## How to run locally
1. Clone the repository and `cd` into `celestial-media-hub`
2. Run `npm install`
3. Copy `.env.example` to `.env.local`
4. Start development server: `npm run dev`

## How to run tests
- **Phase-based verification:** `./verify.sh`
- **Unit (Vitest):** `npx vitest run`
- **Visual Regression (Playwright):** `npx playwright test tests/visual/regression.spec.ts`

## How to deploy
- **Frontend (Vercel):** Connect repo, setup Vercel build command, and set `NEXT_PUBLIC_API_BASE_URL` to point to Backend.
- **Backend (Railway/Render):** Deploy as a Docker container or Node service, ensure FFmpeg and yt-dlp are installed in the container via Dockerfile, and supply `FFMPEG_PATH`, `YTDLP_PATH`, and `TEMP_DIR`.

## Known limitations / future work
- AVSE ML integration temporarily disabled, may be reintroduced later as a standalone microservice.
- Form inputs trigger explicit ESLint overrides for dynamic filesystem interaction, but are tightly validated through UUIDs.

## Git history
```text
b27e4e6 fix: full UI audit and consistency pass against stitch-exports
a4845de chore: update visual regression baselines to final verified state
82738c3 chore: ignore Playwright diff and current screenshot directories
12afeef docs: update task.md and MEMORY.md for Phase 4
86e995a chore: add bootstrap.sh and verify.sh utility scripts
c0522a3 docs: add final walkthrough.md
4d1326a fix: add ESLint disable comments to converter, hevc, and muter pages
663f114 chore: update visual regression baselines
543037f fix: ESLint errors, security warnings, and failing tests across codebase
8995503 feat: Spotify Converter page — verified against design
b7ca85e feat: Media Inspector page — complete with compare mode and tests
80cdadc feat: Audio Trimmer + custom waveform engine — verified against design
6eeaf17 feat: YouTube Downloader page — verified against design
f08ed00 feat: HEVC Compressor page — verified against design
db1c44f feat: Universal Converter page — verified against design
fbbd3a8 feat: Video Muter page — verified against design
aabd8cd feat: Media Inspector page — verified against design
2935f15 feat: Dashboard page — verified against design
348623b feat: API layer — all backend routes implemented and tested
bae0c30 feat: shared infrastructure — layout shell + core UI components
```
