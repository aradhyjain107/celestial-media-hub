FROM node:20-bookworm-slim

# Install system media binaries: ffmpeg/ffprobe, cwebp, python3 (required by yt-dlp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    webp \
    python3 \
    ca-certificates \
    curl \
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

# Build production bundle (JWT_SECRET is validated by lib/env.ts during build)
RUN JWT_SECRET="build-time-only-jwt-secret-min-32-chars-ok" npm run build \
  && npm prune --omit=dev

# Hugging Face Spaces runs containers as UID 1000 (default `node` user in node:20 image)
RUN mkdir -p /tmp/celestial \
  && chmod +x /app/docker-entrypoint.sh \
  && chown -R node:node /app /tmp/celestial

USER node

ENV NODE_ENV=production \
    PORT=7860 \
    HOSTNAME=0.0.0.0 \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    YTDLP_PATH=yt-dlp \
    TEMP_DIR=/tmp/celestial

EXPOSE 7860

ENTRYPOINT ["./docker-entrypoint.sh"]
