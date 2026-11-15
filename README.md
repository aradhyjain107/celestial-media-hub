---
title: Celestial Media Hub
emoji: 🎬
colorFrom: gray
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# Celestial Media Hub

> **Obsidian Cyber-Noir Studio-Grade Local Media Processing Platform**  
> High-performance transcoding, smart lossless remuxing, procedural audio-to-video kinetic synthesis, interactive dual-track waveform editing, and hardware-calibrated batch compression—running 100% locally on your machine with zero cloud telemetry.

---

## Architecture & Technology Stack

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **Styling & Motion**: Tailwind CSS, Dark Glassmorphism, Framer Motion, HTML5 Canvas
- **Design System**: Obsidian Cyber-Noir (Void `#030304` / `#050505` with Cyber Orange `#FF5A00` telemetry accents)
- **Engine & System Binaries**: Native `ffmpeg`, `ffprobe`, `yt-dlp`, `cwebp`, and `sips`
- **Streaming & Concurrency**: Node.js sliced stream piping, Server-Sent Events (SSE) via `fetch` ReadableStreams
- **Security & Hardening**: HS256 JWT authorization, per-job BOLA ownership enforcement, SSRF protections, argument vector isolation, and HSTS/CSP security headers

---

## The 6 Core Studio Tools

1. **Universal Converter & Synthesis Studio (`/tools/converter`)**
   - Universal container conversion with `ffprobe` stream topology inspection.
   - Smart lossless remuxing: automatically copies compatible video/audio streams (`-c copy`) without re-encoding to save compute and eliminate generation loss.
   - **Audio-to-Video Synthesis Studio**: Real-time companion video attachment, dual-track trimmer, and 4 procedural kinetic visualizer backdrops (`obsidian_pulse`, `cyber_bars`, `nebula_spectrum`, `minimal_wave`) with zero-drift PTS synchronization.

2. **Interactive Audio Trimmer (`/tools/trimmer`)**
   - High-precision canvas-rendered Web Audio RMS waveforms.
   - Sub-second cue points (`0.1s` / `1.0s` keyboard nudge), logarithmic volume normalization, custom fade-in / fade-out curves, and multi-file concat demuxing.

3. **Audio Stripper & Video Muter (`/tools/muter`)**
   - Lossless audio stream stripping with zero video re-encoding (`-an -c:v copy`).
   - Selective multi-track isolation and replacement audio track injection.

4. **HEVC & Universal Compressor (`/tools/hevc`)**
   - Multi-codec (HEVC/H.265, H.264, AV1, VP9) CRF compression with dynamic hardware acceleration detection (Apple VideoToolbox `hevc_videotoolbox`, NVIDIA NVENC, Intel QSV).
   - Real-time file size savings estimation and device profile calibrations.

5. **YouTube Downloader (`/tools/youtube`)**
   - High-throughput video and audio extraction via `yt-dlp`.
   - Single video and batch playlist resolution with granular resolution/bitrate pickers and real-time SSE progress streaming.

6. **Spotify Downloader (`/tools/spotify`)**
   - Track, album, and playlist metadata resolution with robust fallback querying and high-bitrate audio rendering.

---

## Prerequisites & System Requirements

Celestial Media Hub interfaces directly with local system binaries for maximum execution speed:

- **Node.js**: v18.18.0 or v20+
- **FFmpeg & FFprobe**: Required in system `PATH` (v6.0+ recommended)
  ```bash
  # macOS (Homebrew)
  brew install ffmpeg

  # Ubuntu / Debian
  sudo apt update && sudo apt install ffmpeg poppler-utils webp zip

  # Windows (winget)
  winget install Gyan.FFmpeg
  ```
- **yt-dlp**: Required in system `PATH` (v2025.12.0+ recommended)
  ```bash
  # macOS (Homebrew)
  brew install yt-dlp

  # Windows (winget)
  winget install yt-dlp.yt-dlp

  # Standalone Binary / pip
  pip install --upgrade yt-dlp
  ```
- **PDF & Image Rasterization Tools**:
  - **Linux**: `poppler-utils` (`pdftoppm`) for PDF-to-image conversion; `webp` (`cwebp`) optional for faster WebP encoding (falls back to FFmpeg)
  - **Windows**: `poppler` (`pdftoppm.exe` via `choco install poppler` or Scoop) for PDF-to-image conversion; multi-file `.zip` batch downloads use a built-in pure-Node ZIP encoder when `zip` is not on `PATH`
  - **macOS**: Uses native PDFKit/`sips` when available

---

## Environment Configuration

Copy `.env.example` to `.env.local` (or rely on system `PATH` defaults in development):

```bash
cp .env.example .env.local
```

```env
# Optional path overrides (defaults to system PATH lookup if omitted)
# FFMPEG_PATH=/opt/homebrew/bin/ffmpeg
# YTDLP_PATH=/opt/homebrew/bin/yt-dlp

# Scratch working directory (optional; defaults to OS temp dir, e.g. /tmp/celestial or %TEMP%\celestial)
TEMP_DIR=

# Cryptographic secret for signing job authorization tokens (min 32 chars in production)
# Generate with: openssl rand -base64 32
JWT_SECRET=your-32-character-or-longer-cryptographic-salt-key-here
```

---

## Quick Start (Local, Docker, or Free Cloud)

### Option A: Run Locally (macOS / Linux / Windows)

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

Build for production:
```bash
JWT_SECRET="$(openssl rand -base64 32)" npm run build
npm run start
```

### Option B: Run Anywhere with Docker (Zero Local Dependencies)

```bash
docker build -t celestial-media-hub .
docker run --rm -p 7860:7860 -e JWT_SECRET="$(openssl rand -base64 32)" celestial-media-hub
```

Open [http://localhost:7860](http://localhost:7860) in your browser.

Run test suites:
```bash
# Run complete test suite
npm test

# Run security and adversarial regression suites
npx vitest run tests/security
```

---

## Security & Defense-in-Depth

Celestial Media Hub is hardened in compliance with the **Invicti Vibe Coding Security Standard**:

- **Command Injection Immunity**: All binary execution (`ffmpeg`, `yt-dlp`) uses structured array argument vectors (`execFile` / `spawn`) without shell invocation.
- **Strict-Transport-Security (HSTS) & CSP**: Enforced via `next.config.mjs` with `max-age=63072000; includeSubDomains; preload` and API route isolation (`default-src 'none'`).
- **Broken Object-Level Authorization (BOLA) Prevention**: Every generated media asset is cryptographically bound to its owner's session token; cross-session asset downloads are rejected with HTTP 403.
- **SSRF Mitigation**: Outbound media extractors enforce domain allowlists and strictly reject loopback/private CIDR addresses (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `::1`).
- **DoS & Payload Guardrails**: Multi-tier sliding-window IP rate limiting, 16MB stream chunk write barriers, and automated background TTL temporary file pruning.
- **Header Stripping**: Upstream spoofable authentication headers (`x-user-id`, `x-user-role`, `x-user-email`) are stripped at the `src/middleware.ts` boundary.

---

## Project Layout

```text
├── .github/
│   ├── workflows/    # CI (ci.yml) & Hugging Face Space sync (sync-hf-space.yml)
│   ├── CONTRIBUTING.md
│   └── SECURITY.md
├── public/           # Static assets, UPI QR, & Web Worker silicon probe
├── scripts/          # Docker entrypoint & optional macOS PDF rasterizer helper
├── src/
│   ├── app/          # Next.js App Router pages, UI components, & API routes
│   ├── lib/
│   │   ├── media/    # FFmpeg, yt-dlp, remux planner, PDF rasterizer, & mux engine
│   │   ├── security/ # JWT auth, BOLA ownership, rate limiting, error sanitization, SSRF
│   │   ├── system/   # Env validation, temp workspaces, & hardware/silicon profilers
│   │   └── utils/    # Filename helpers, QR encoder, & UI cursor hook
│   ├── schemas/      # Zod validation schemas per endpoint
│   └── middleware.ts # Edge CORS, Fetch Metadata, rate limit, & auth guard
├── tests/            # Unit, security, E2E, visual, & stress test suites
├── AGENTS.md         # Architecture & workflow guide for AI agents
├── Dockerfile
└── next.config.mjs
```

---

## Free Deployment via GitHub → Hugging Face Spaces (Docker)

1. Push this folder to your GitHub repository (`main` branch).
2. Create a free **Docker** Space at [huggingface.co/new-space](https://huggingface.co/new-space) (`2 vCPU • 16 GB RAM • 50 GB Disk`).
3. Add two settings in your GitHub repository (**Settings → Secrets and variables → Actions**):
   - **Variable** `HF_SPACE_REPO`: `<your-hf-username>/<your-space-name>`
   - **Secret** `HF_TOKEN`: a Hugging Face access token with **Write** permission.
4. *(Recommended)* In your Hugging Face Space (**Settings → Variables and secrets**), add a `JWT_SECRET` secret (32+ random characters) so session tokens stay valid across container restarts.
5. Every `git push` to `main` automatically syncs via [`.github/workflows/sync-hf-space.yml`](.github/workflows/sync-hf-space.yml) and rebuilds the live Space.

---

## Contributing & Open Source License

Contributions, forks, self-hosting, and pull requests are welcome! See [CONTRIBUTING.md](.github/CONTRIBUTING.md) to get started and [SECURITY.md](.github/SECURITY.md) for responsible disclosure.

Licensed under the **[MIT License](LICENSE)** — anyone is free to use, modify, self-host, and distribute this software.
