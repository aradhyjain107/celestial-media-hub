# task.md — Celestial Media Hub v2

---

## Phase 1 — Planning
- [x] Requirements gathered and approved [LOW]
- [x] Feature set defined and expanded [MED]
- [x] Data models and Zod schemas defined [MED]
- [x] SLOs defined [LOW]
- [x] Stack and architecture decided [MED]
- [x] task.md and implementation_plan.md approved [LOW]

---

## Phase 2 — Design
- [x] Stitch project created [LOW]
- [x] Design system defined (colors, typography, spacing tokens) [MED]
- [x] Dashboard / home screen generated [LOW]
- [x] Video Muter screen generated [LOW]
- [x] HEVC Compressor screen generated [LOW]
- [x] Universal Converter screen generated [MED]
- [x] YouTube Downloader screen generated [LOW]
- [x] Audio Trimmer screen generated (including waveform canvas area) [HIGH]
- [x] Spotify Converter screen generated [MED]
- [x] Media Inspector screen generated [LOW]
- [x] Shared components: Sidebar, ProgressBar, FileDropzone, StatusBadge [MED]
- [x] All screens approved and exported to stitch-exports/ [LOW]
- [x] Baseline screenshots saved to tests/screenshots/baseline/ [LOW]

---

## Phase 3 — Execution

### Setup
- [x] Project scaffolded and dependencies installed [LOW]
- [x] GitHub Actions CI pipeline created [LOW]
- [x] ESLint + security plugin configured [LOW]
- [x] Environment variable structure set up (.env.local + .env.example) [LOW]
- [x] Zod schemas written as code files [LOW]
- [x] Error boundary set up [LOW]
- [x] Playwright + pixelmatch installed and configured [LOW]
- [x] Vitest configured [LOW]

### Shared Infrastructure
- [x] Design system tokens (CSS custom properties) [LOW]
- [x] Layout shell: Sidebar + main content area [MED]
- [x] FileDropzone component [MED]
- [x] ProgressBar component (supports streaming SSE updates) [MED]
- [x] StatusBadge component [LOW]
- [x] BatchQueue component (shared across all batch tools) [HIGH]
- [x] Unit tests: FileDropzone [LOW]
- [x] Unit tests: ProgressBar [LOW]
- [x] Unit tests: BatchQueue [MED]

### API Layer — Backend (FFmpeg & yt-dlp)
- [x] FFmpeg wrapper utility (spawn, stream stderr, parse progress) [HIGH]
- [x] /api/mute route [MED]
- [x] /api/hevc route [MED]
- [x] /api/convert route [HIGH]
- [x] /api/youtube route [HIGH]
- [x] /api/audio-trim route [MED]
- [x] /api/spotify-convert route [HIGH]
- [x] /api/inspect route [LOW]
- [x] Temp file cleanup utility [LOW]
- [x] Unit tests for all API routes [HIGH]
- [x] Unit tests: FFmpeg wrapper [HIGH]
- [x] Unit tests: each API route (mock FFmpeg) [MED]

### Features
- [x] Dashboard page [LOW]
- [x] Unit tests: Dashboard [LOW]
- [x] Video Muter page [MED]
- [x] Unit tests: Video Muter [MED]
- [x] HEVC Compressor page [MED]
- [x] Unit tests: HEVC Compressor [MED]
- [x] Universal Converter page [HIGH]
- [x] Unit tests: Universal Converter [MED]
- [x] YouTube Downloader page [MED]
- [x] Unit tests: YouTube Downloader [MED]
- [x] Audio Trimmer page [HIGH]
- [x] Custom waveform canvas engine [HIGH]
- [x] Unit tests: Waveform engine [HIGH]
- [x] Unit tests: Audio Trimmer [MED]
- [x] Spotify Converter page [HIGH]
- [x] Unit tests: Spotify Converter [MED]
- [x] Media Inspector page [LOW]
- [x] Unit tests: Media Inspector [LOW]

### Git Checkpoints
- [x] Checkpoint: shared infrastructure complete [LOW]
- [x] Checkpoint: API layer complete [LOW]
- [x] Checkpoint: Dashboard + Video Muter verified [LOW]
- [x] Checkpoint: HEVC + Converter verified [LOW]
- [x] Checkpoint: YouTube + Audio Trimmer verified [LOW]
- [x] Checkpoint: Spotify + Inspector verified [LOW]

---

## Phase 4 — Verification
- [ ] Dev server boots cleanly [LOW]
- [ ] Vitest unit suite passes (all tests) [MED]
- [ ] ESLint passes with zero warnings [LOW]
- [ ] Playwright visual diff: Dashboard [MED]
- [ ] Playwright visual diff: Video Muter [MED]
- [ ] Playwright visual diff: HEVC Compressor [MED]
- [ ] Playwright visual diff: Universal Converter [MED]
- [ ] Playwright visual diff: YouTube Downloader [MED]
- [ ] Playwright visual diff: Audio Trimmer [MED]
- [ ] Playwright visual diff: Spotify Converter [MED]
- [ ] Playwright visual diff: Media Inspector [MED]
- [ ] All interaction flows tested manually [HIGH]
- [ ] FFmpeg error handling tested (bad file, unsupported format) [MED]
- [ ] Temp file cleanup verified (no leftovers after processing) [LOW]
- [ ] SLOs verified (load time, bundle size, LCP) [MED]
- [ ] Zero console errors in production build [LOW]
- [ ] No hardcoded secrets or API keys [LOW]
- [ ] Local deployment tested: npm run dev [LOW]
- [ ] Production build tested: npm run build [LOW]

---

## Phase 5 — Handoff
- [ ] Production build passes clean [LOW]
- [ ] CI pipeline green on main branch [LOW]
- [ ] walkthrough.md written [LOW]
- [ ] MEMORY.md updated to final state [LOW]
- [ ] Final task.md audit — all items checked [LOW]
