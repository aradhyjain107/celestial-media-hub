# Celestial Media Hub v2 — Walkthrough

## What was built
Celestial Media Hub v2 is a local-first, privacy-focused media processing suite. It completely drops the unstable Python/ML backend from v1 in favor of a robust, standalone architecture powered entirely by Next.js, FFmpeg, and yt-dlp.

## Screens generated
1. **Dashboard** (`/`) — Grid of all available media processing tools.
2. **Video Muter** (`/tools/muter`) — Batch strip audio or replace with silence.
3. **HEVC Compressor** (`/tools/hevc`) — Batch H.265 compression with CRF and presets.
4. **Universal Converter** (`/tools/converter`) — Format conversion and metadata stripping.
5. **YouTube Downloader** (`/tools/youtube`) — Audio/video fetching via yt-dlp including playlists.
6. **Audio Trimmer** (`/tools/trimmer`) — Custom interactive waveform trimmer with fades.
7. **Spotify Converter** (`/tools/spotify`) — Playlist tracking mapping into MP3s.
8. **Media Inspector** (`/tools/inspector`) — Telemetry extraction and side-by-side media comparison.

## Tech stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, Zod.
- **Backend / Processing:** Node.js `child_process`, FFmpeg, yt-dlp.
- **Testing:** Vitest (unit), Playwright (visual regression).
- **Design System:** Custom CSS custom properties (`globals.css`) for deterministic UI.
- **Removed:** Python, PyTorch, PySceneDetect, WaveSurfer.js, Framer Motion.

## Architecture decisions
- **Drop Python entirely:** Replaced fragility of v1's Python ML pipeline with pure FFmpeg operations, stabilizing the app.
- **Custom waveform engine:** Built a zero-dependency Web Audio API + HTML Canvas visualizer (~500 LOC) instead of using the heavy WaveSurfer.js.
- **SSE for FFmpeg progress:** Piped FFmpeg standard output via Server-Sent Events to the frontend for real-time progress blocks, circumventing WebSockets.
- **Split deployment via single env var:** Using `NEXT_PUBLIC_API_BASE_URL` to route requests either locally (empty) or to a deployed backend (e.g. Railway), keeping codebase unified.
- **No Framer Motion:** Used CSS custom keyframe animations reducing bundle by ~40KB.
- **Tailwind for layout, CSS vars for tokens:** Kept Tailwind for structural blocks but stored brand identity tokens in CSS custom properties for tight Canvas integration.
- **Explicit Design Tokens:** Grounded UI generation in definitive layout rules rather than vague generative prompts.
- **SSE Parsing Pattern:** Standardized `ReadableStream` manual parsing where `throw` must execute outside the `try/catch` JSON parse block.
- **Vitest fake timer scope:** Fake timers (`vi.useFakeTimers()`) are isolated to specific `test()` blocks instead of globally in `beforeEach` to prevent React render lockups.
- **WaveformControls scope:** Separated timeline navigation (WaveformControls) from tool processing state (Options Panel).
- **Client Directives:** Ensured `'use client'` is declared at the top of all tool pages utilizing React hooks.
- **Float32Array spread:** Avoided spread operators on TypedArrays due to TS target compilation limitations.

## SLO results
```text
Route (app)                              Size     First Load JS
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
4d1326a (HEAD -> main) fix: add ESLint disable comments to converter, hevc, and muter pages
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
0337061 chore: scaffold Next.js 14 project with full dev toolchain
aeff229 Initial commit from Create Next App
```
