# Contributing to Celestial Media Hub

Thank you for helping improve Celestial Media Hub! This project is open source under the [MIT License](./LICENSE).

## Local Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/<your-username>/celestial-media-hub.git
   cd celestial-media-hub
   ```
2. Install system binaries (`ffmpeg`, `ffprobe`, `yt-dlp`) and ensure they are available in your `PATH`.
3. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
4. Install Node dependencies and start the dev server:
   ```bash
   npm install
   npm run dev
   ```

## Checks Before Opening a Pull Request

Please verify all checks pass locally:

```bash
npx tsc --noEmit
npm run lint
npm test
JWT_SECRET="build-check-secret-min-32-characters-ok" npm run build
```

## Security & Privacy Guidelines

- Never commit `.env*.local`, API tokens, `JWT_SECRET` values, or personal filesystem paths.
- Keep shell-free binary execution (`spawn` / `execFile` with explicit `--` separators) and `sanitizeError` / `sanitizeSseError` intact on all API routes.
- For vulnerability reports, please review [SECURITY.md](./SECURITY.md).
