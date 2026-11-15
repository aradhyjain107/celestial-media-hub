# QA Automation & `agent-desktop` / `agent-browser` Integration

Celestial Media Hub utilizes a dual-engine automation harness that bridges the native operating system layer (`agent-desktop`) and the browser DOM/Canvas execution context (`agent-browser`).

---

## 1. Dual-Engine Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CELESTIAL QA ORCHESTRATION                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
         ┌──────────────────────────┴──────────────────────────┐
         ▼                                                     ▼
┌───────────────────────────────────┐ ┌───────────────────────────────────┐
│     agent-desktop (OS Level)      │ │     agent-browser (DOM Level)     │
├───────────────────────────────────┤ ├───────────────────────────────────┤
│ • Native macOS Open File Dialogs  │ │ • DOM Accessibility Tree (@ref)   │
│ • System Clipboard manipulation   │ │ • Web Audio API / FFT Analyzers   │
│ • Window sizing & OS DPI Scaling  │ │ • 60 FPS Canvas visualizers       │
│ • Electron App Shell & Menu Bar   │ │ • Pixel-perfect screenshot diffs  │
│ • Native file drag-and-drop       │ │ • Network payload inspection      │
└───────────────────────────────────┘ └───────────────────────────────────┘
```

### Why Both Are Essential:
1. **Web Sandbox Limitations**: Standard browser automation (Playwright/Puppeteer) cannot drive the native macOS file picker modal (`NSOpenPanel` or Cmd+Shift+G go-to-folder sheet), cannot test native OS menu items, and cannot inspect system-level clipboard integrations.
2. **OS Permission Boundary**: `agent-desktop` interacts directly with the macOS Accessibility Tree (`AXUIElement`), allowing it to drive native dialogs and verify clipboard operations across application boundaries.
3. **Canvas & WebGL Verification**: `agent-browser` provides direct access to Chromium's CDP and DOM, rendering procedural canvas visualizers (Obsidian Pulse, Cyber Bars, Nebula Spectrum, Minimal Wave) and verifying Web Audio context state.

---

## 2. Integration Points in Celestial Media Hub

### A. Native macOS File Dialog & Dropzone Automation
- When a user clicks "Drop video clip or click to browse", the browser triggers a native file selector.
- `agent-desktop` can interact with native file dialogues using keyboard shortcuts (`press cmd+shift+g`, `type "/path/to/sample.mp4"`, `press return`).
- For headless CLI flows, `agent-browser` injects files into `<input type="file">` elements, which is then validated against the UI dropzone state.

### B. System Clipboard Integration
- Tools like **YouTube Downloader** (`/tools/youtube`) and **Spotify Converter** (`/tools/spotify`) have clipboard paste handlers.
- `agent-desktop clipboard-set "<url>"` writes directly to the macOS NSPasteboard.
- Automated tests focus the URL input element and simulate `press cmd+v` or inspect `clipboard-get` to verify end-to-end sync without browser security prompts blocking clipboard reads.

### C. Responsive Window Management & DPI Scaling
- `agent-desktop resize-window` resizes the OS-level application window to test break points:
  - **Desktop Ultra-wide**: 1920x1080
  - **Standard MacBook Pro**: 1512x945
  - **Compact Laptop**: 1280x800
- `agent-browser resize 390 844` validates mobile viewport behavior, ensuring drawers, bottom navigation bars, and timeline scrubber handles remain touch-accessible.

### D. Audio/Video Render & Stream Verification
- The pipeline doesn't just verify UI buttons; it validates actual generated media.
- `scripts/qa/download-verify.sh`:
  1. Synthesizes a 1s test media fixture with video (`testsrc`, `libx264`) and audio (`sine`, `aac`).
  2. Submits the transcode job to `$BASE_URL/api/mute` with `mode=remove` to test audio stripping without re-encoding.
  3. Parses the real-time SSE stream for the completed `/api/download` URL.
  4. Downloads and unzips the resulting media artifact package.
  5. Executes `ffprobe` to inspect stream topologies, asserting that audio streams are stripped (`A_COUNT=0`), the video codec is preserved (`h264`), and duration is maintained.

### E. Zero-Console-Error Policy
- `scripts/qa/console-gate.sh` visits every route in the application:
  - `/` (Dashboard)
  - `/tools/muter`
  - `/tools/hevc`
  - `/tools/converter`
  - `/tools/youtube`
  - `/tools/trimmer`
  - `/tools/spotify`
- Asserts that no uncaught JavaScript exceptions, unhandled Promise rejections, or React hydration mismatches occur.

---

## 3. Command Reference

### Quick Commands (NPM)

| Command | Description | Tooling |
|---|---|---|
| `npm run test:qa:console` | Crawls all routes and checks for console/runtime errors | `agent-browser` |
| `npm run test:qa:clipboard` | Verifies clipboard pasting into URL tools | `agent-desktop` + `agent-browser` |
| `npm run test:qa:desktop` | Verifies file selection & dropzone handling | `agent-desktop` / `agent-browser` |
| `npm run test:qa:download` | End-to-end transcode & `ffprobe` stream verification | `curl` + `ffprobe` |
| `npm run test:qa:all` | Executes the complete QA verification suite | Unified Runner |

### Manual `agent-desktop` Diagnostics
```bash
# Check accessibility and screen recording permissions
npx agent-desktop permissions

# Take an OS-level accessibility tree snapshot
npx agent-desktop snapshot --app "Google Chrome" -i

# Inspect system clipboard
npx agent-desktop clipboard-get

# Set clipboard for testing
npx agent-desktop clipboard-set "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

### Manual `agent-browser` Diagnostics
```bash
# Open interactive session
npx agent-browser open "http://localhost:3000/tools/converter"

# Inspect interactive element tree with assigned @refs
npx agent-browser snapshot -i

# Check for console errors
npx agent-browser errors

# Take a screenshot to artifacts
npx agent-browser screenshot /tmp/capture.png
```
