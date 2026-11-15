import '@testing-library/jest-dom'
import { beforeEach } from 'vitest'
import { resetGlobalJobStore } from './app/context/GlobalJobContext'

process.env.FFMPEG_PATH = process.env.FFMPEG_PATH || '/opt/homebrew/bin/ffmpeg';
process.env.YTDLP_PATH = process.env.YTDLP_PATH || '/opt/homebrew/bin/yt-dlp';
process.env.TEMP_DIR = process.env.TEMP_DIR || '/tmp/celestial';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-min-32-chars-long-security-token';

// Reset MockEventSource.instances before each test so instances[0] always
// refers to the EventSource created during the current test, not a stale one.
beforeEach(() => {
  resetGlobalJobStore()
  const ES = (globalThis as any).EventSource
  if (ES && Array.isArray(ES.instances)) {
    ES.instances.length = 0
  }
})
