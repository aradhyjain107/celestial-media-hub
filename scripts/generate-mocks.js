const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

function getMockDirs() {
  const dirs = [];
  const primary = '/tmp/celestial-mocks';
  try {
    if (!fs.existsSync(primary)) {
      fs.mkdirSync(primary, { recursive: true });
    }
    fs.accessSync(primary, fs.constants.W_OK);
    dirs.push(primary);
  } catch (e) {
    // Primary /tmp is read-only or restricted in sandbox
  }

  const fallback = path.join(os.tmpdir(), 'celestial-mocks');
  try {
    if (!fs.existsSync(fallback)) {
      fs.mkdirSync(fallback, { recursive: true });
    }
    dirs.push(fallback);
  } catch (e) {
    // ignore
  }

  if (dirs.length === 0) {
    const local = path.join(__dirname, '../.tmp/celestial-mocks');
    if (!fs.existsSync(local)) {
      fs.mkdirSync(local, { recursive: true });
    }
    dirs.push(local);
  }
  return dirs;
}

const targetDirs = getMockDirs();
console.log(`[MockGen] Generating synthetic mock files in target directories:`, targetDirs);

const ffmpegCmd = process.env.FFMPEG_PATH || 'ffmpeg';

targetDirs.forEach(MOCK_DIR => {
  function createAlias(sourceName, aliasName) {
    const sourcePath = path.join(MOCK_DIR, sourceName);
    const aliasPath = path.join(MOCK_DIR, aliasName);
    if (fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, aliasPath);
    }
  }

  // 1. Corrupted files
  // 1.1 Truncated MP4
  const tempValidMp4 = path.join(MOCK_DIR, 'temp_valid.mp4');
  execFileSync(ffmpegCmd, ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=1:size=160x120:rate=10', '-c:v', 'libx264', tempValidMp4], { stdio: 'ignore' });
  const validBuf = fs.readFileSync(tempValidMp4);
  fs.writeFileSync(path.join(MOCK_DIR, 'corrupt_truncated.mp4'), validBuf.subarray(0, 64));
  fs.unlinkSync(tempValidMp4);

  // 1.2 Garbage MKV
  fs.writeFileSync(path.join(MOCK_DIR, 'corrupt_garbage.mkv'), crypto.randomBytes(1024));

  // 2. Empty 0-byte files
  fs.writeFileSync(path.join(MOCK_DIR, 'empty.mp4'), Buffer.alloc(0));
  fs.writeFileSync(path.join(MOCK_DIR, 'empty.mp3'), Buffer.alloc(0));

  // 3. Multi-stream containers
  // 3.1 MKV with 1 video, 2 audio streams
  execFileSync(ffmpegCmd, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
    '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'libx264', '-c:a', 'aac',
    path.join(MOCK_DIR, 'multistream_tracks.mkv')
  ], { stdio: 'ignore' });
  createAlias('multistream_tracks.mkv', 'multistream_2audio_1sub.mkv');

  // 3.2 MP4 with 1 video, 2 audio streams
  execFileSync(ffmpegCmd, [
    '-y',
    '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=2',
    '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'libx264', '-c:a', 'aac',
    path.join(MOCK_DIR, 'multistream_tracks.mp4')
  ], { stdio: 'ignore' });
  createAlias('multistream_tracks.mp4', 'multistream_2video.mp4');

  // 4. High bitrate audio files
  // 4.1 192kHz/24bit WAV
  execFileSync(ffmpegCmd, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2:sample_rate=192000',
    '-c:a', 'pcm_s24le', path.join(MOCK_DIR, 'high_bitrate_192k24b.wav')
  ], { stdio: 'ignore' });
  createAlias('high_bitrate_192k24b.wav', 'high_bitrate_192k_24bit.wav');

  // 4.2 192kHz/24bit FLAC
  execFileSync(ffmpegCmd, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=2:sample_rate=192000',
    '-c:a', 'flac', path.join(MOCK_DIR, 'high_bitrate_extreme.flac')
  ], { stdio: 'ignore' });
  createAlias('high_bitrate_extreme.flac', 'high_bitrate_flac_extreme.flac');

  // 5. Invalid media headers
  // 5.1 PNG image renamed to .mp4
  const pngBuf = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d0b0000000049454e44ae426082', 'hex');
  fs.writeFileSync(path.join(MOCK_DIR, 'invalid_image_header.mp4'), pngBuf);

  // 5.2 Plain text file renamed to .mkv
  fs.writeFileSync(path.join(MOCK_DIR, 'invalid_text_header.mkv'), 'INVALID_HEADER_NOT_MEDIA_FILE_CONTENT');

  // 6. RAW / Non-standard wrappers
  // 6.1 CR2 camera wrapper dummy
  fs.writeFileSync(path.join(MOCK_DIR, 'raw_wrapper.cr2'), Buffer.concat([Buffer.from('II*\x00\x10\x00\x00\x00CR'), crypto.randomBytes(512)]));
  createAlias('raw_wrapper.cr2', 'cr2_wrapper.cr2');

  // 6.2 Raw 16-bit PCM audio stream
  execFileSync(ffmpegCmd, [
    '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2',
    '-f', 's16le', path.join(MOCK_DIR, 'raw_pcm.raw')
  ], { stdio: 'ignore' });
  createAlias('raw_pcm.raw', 'raw_pcm_wrapper.raw');

  console.log(`[MockGen] Successfully generated synthetic mock files in ${MOCK_DIR}`);
});
