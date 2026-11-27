FROM node:20-bookworm-slim

# Install system media binaries: ffmpeg/ffprobe, cwebp, python3 (yt-dlp), deno, and quickjs-ng (low-RAM JS solver for 512MB containers)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    webp \
    python3 \
    ca-certificates \
    curl \
    zip \
    unzip \
  && ARCH="$(dpkg --print-architecture)" \
  && if [ "$ARCH" = "arm64" ]; then DENO_TARGET="aarch64-unknown-linux-gnu"; QJS_TARGET="qjs-linux-aarch64"; else DENO_TARGET="x86_64-unknown-linux-gnu"; QJS_TARGET="qjs-linux-x86_64"; fi \
  && curl -fsSL "https://github.com/denoland/deno/releases/latest/download/deno-${DENO_TARGET}.zip" -o /tmp/deno.zip \
  && unzip -q /tmp/deno.zip -d /usr/local/bin \
  && rm -f /tmp/deno.zip \
  && chmod a+rx /usr/local/bin/deno \
  && curl -fsSL "https://github.com/quickjs-ng/quickjs/releases/latest/download/${QJS_TARGET}" -o /usr/local/bin/qjs \
  && chmod a+rx /usr/local/bin/qjs \
  && rm -rf /var/lib/apt/lists/*

# Install latest official yt-dlp release (>= 2025.12.0 security baseline)
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Install dependencies first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy application source
COPY . .

# Build production bundle (JWT_SECRET is validated by src/lib/system/env.ts during build)
RUN JWT_SECRET="build-time-only-jwt-secret-min-32-chars-ok" npm run build \
  && npm prune --omit=dev

# Ensure writable temp and JS/extractor cache dirs for UID 1000 (`node`)
RUN mkdir -p /tmp/celestial /tmp/.cache /tmp/.deno \
  && chmod +x /app/scripts/docker-entrypoint.sh \
  && chown -R node:node /app /tmp/celestial /tmp/.cache /tmp/.deno

USER node

ENV NODE_ENV=production \
    PORT=7860 \
    HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=/usr/bin/ffmpeg \
    FFPROBE_PATH=/usr/bin/ffprobe \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    TEMP_DIR=/tmp/celestial \
    XDG_CACHE_HOME=/tmp/.cache \
    DENO_DIR=/tmp/.deno

EXPOSE 7860

ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
