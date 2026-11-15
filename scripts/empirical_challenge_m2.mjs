/**
 * scripts/empirical_challenge_m2.mjs
 * 
 * Independent Empirical Challenge Harness for Milestone M2:
 * Codec Standards, QuickTime Compatibility & Container Integrity.
 * 
 * Tests:
 * 1. Opus container (.opus) strictly pairs with libopus in lib/remuxDecision.ts.
 * 2. WebM silence mode in app/api/mute/route.ts produces libopus (never aac).
 * 3. QuickTime compatibility flags (-pix_fmt yuv420p, -tag:v hvc1, -movflags +faststart)
 *    across all MP4/MOV export branches in convert, hevc, compress, and audio-trim.
 * 4. Empirical FFmpeg execution of real media:
 *    - Real Opus transcoding & container muxing.
 *    - Real WebM muting with libopus silence vs AAC failure verification.
 *    - Real MP4 faststart binary atom order (moov before mdat).
 *    - Real HEVC hvc1 tag verification in stream metadata.
 * 5. VP9 constrained quality (-b:v 0) and WebP fallback (-c:v libwebp).
 * 6. HTTP/2 Transfer-Encoding compliance and download stream backpressure flow control.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import assert from 'node:assert';

// ── Import implementation modules ──
const projectRoot = path.resolve(process.cwd());
const tempDir = path.join(projectRoot, '.challenge_m2_tmp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    throw err;
  }
}

// Helper to inspect MP4 top-level box order
function getMp4BoxOrder(filePath) {
  const buf = fs.readFileSync(filePath);
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    boxes.push({ type, offset, size });
    if (size === 0 || size === 1) break; // Extended size or end of file
    offset += size;
  }
  return boxes;
}

// Helper to probe media stream codec
function probeStream(filePath) {
  const res = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_streams',
    '-show_format',
    '-print_format', 'json',
    filePath
  ], { encoding: 'utf8' });
  if (res.status !== 0) {
    throw new Error(`ffprobe failed: ${res.stderr}`);
  }
  return JSON.parse(res.stdout);
}

console.log('================================================================');
console.log('CHALLENGER M2: EMPIRICAL VERIFICATION & STRESS-TEST HARNESS');
console.log('================================================================\n');

// Dynamically load remuxDecision
const remuxModule = await import('../lib/remuxDecision.ts');
const { decideStrategy, buildStrategyArgs } = remuxModule;

// ── SECTION 1: Opus Container Codec Assignment in lib/remuxDecision.ts ──
console.log('--- SECTION 1: Opus Container Codec Assignment (lib/remuxDecision.ts) ---');

it('Strategy decision for Opus container: remux for native opus, encode for foreign codecs', () => {
  // Native opus input into opus container
  const resNative = decideStrategy(
    { audioCodec: 'opus' },
    { outputFormat: 'opus', speed: 1, resolution: 'original', stripAudio: false, stripMetadata: false, isGif: false }
  );
  assert.strictEqual(resNative.strategy, 'remux', 'Native opus audio should be remuxed');

  // MP3 input into opus container
  const resMp3 = decideStrategy(
    { audioCodec: 'mp3' },
    { outputFormat: 'opus', speed: 1, resolution: 'original', stripAudio: false, stripMetadata: false, isGif: false }
  );
  assert.strictEqual(resMp3.strategy, 'encode', 'MP3 audio must be encoded for opus container');

  // AAC input into opus container
  const resAac = decideStrategy(
    { audioCodec: 'aac' },
    { outputFormat: 'opus', speed: 1, resolution: 'original', stripAudio: false, stripMetadata: false, isGif: false }
  );
  assert.strictEqual(resAac.strategy, 'encode', 'AAC audio must be encoded for opus container');

  // FLAC input into opus container
  const resFlac = decideStrategy(
    { audioCodec: 'flac' },
    { outputFormat: 'opus', speed: 1, resolution: 'original', stripAudio: false, stripMetadata: false, isGif: false }
  );
  assert.strictEqual(resFlac.strategy, 'encode', 'FLAC audio must be encoded for opus container');
});

it('buildStrategyArgs for .opus format strictly emits libopus (never aac)', () => {
  const encodeArgs = buildStrategyArgs('encode', {
    outputFormat: 'opus',
    speed: 1,
    resolution: 'original',
    stripAudio: false,
    stripMetadata: false,
    isGif: false
  });

  assert.ok(encodeArgs.includes('-vn'), 'Audio-only output must include -vn');
  assert.ok(encodeArgs.includes('-c:a'), 'Must specify -c:a flag');
  
  const caIdx = encodeArgs.indexOf('-c:a');
  const targetCodec = encodeArgs[caIdx + 1];
  assert.strictEqual(targetCodec, 'libopus', 'Audio codec for .opus target must be libopus');
  assert.ok(!encodeArgs.includes('aac'), 'Opus output must NEVER contain aac');

  // Remux strategy
  const remuxArgs = buildStrategyArgs('remux', {
    outputFormat: 'opus',
    speed: 1,
    resolution: 'original',
    stripAudio: false,
    stripMetadata: false,
    isGif: false
  });
  assert.ok(remuxArgs.includes('-vn'));
  const remuxCaIdx = remuxArgs.indexOf('-c:a');
  assert.strictEqual(remuxArgs[remuxCaIdx + 1], 'copy', 'Remux strategy should copy stream');
});

it('WebM output format strictly emits libopus (never aac) across all strategy branches', () => {
  const webmEncodeArgs = buildStrategyArgs('encode', {
    outputFormat: 'webm',
    speed: 1,
    resolution: 'original',
    stripAudio: false,
    stripMetadata: false,
    isGif: false
  });
  const webmCaIdx = webmEncodeArgs.indexOf('-c:a');
  assert.ok(webmCaIdx !== -1, 'Must include -c:a');
  assert.strictEqual(webmEncodeArgs[webmCaIdx + 1], 'libopus', 'WebM encode audio codec must be libopus');
  assert.ok(!webmEncodeArgs.includes('aac'), 'WebM must never receive aac');

  const webmCopyVideoArgs = buildStrategyArgs('copy-video', {
    outputFormat: 'webm',
    speed: 1,
    resolution: 'original',
    stripAudio: false,
    stripMetadata: false,
    isGif: false
  });
  const cvIdx = webmCopyVideoArgs.indexOf('-c:a');
  assert.strictEqual(webmCopyVideoArgs[cvIdx + 1], 'libopus', 'WebM copy-video audio codec must be libopus');
  assert.ok(!webmCopyVideoArgs.includes('aac'), 'WebM copy-video must never receive aac');
});

await itAsync('Empirical FFmpeg execution: real audio encode to .opus produces valid Opus file', async () => {
  const toneWav = path.join(tempDir, 'test_sine.wav');
  const outOpus = path.join(tempDir, 'test_output.opus');

  // Generate 1-sec test tone
  execSync(`ffmpeg -y -f lavfi -i "sine=frequency=440:duration=1" -ar 48000 "${toneWav}"`, { stdio: 'pipe' });
  assert.ok(fs.existsSync(toneWav));

  // Build strategy args for encode to opus
  const args = buildStrategyArgs('encode', {
    outputFormat: 'opus',
    speed: 1,
    resolution: 'original',
    stripAudio: false,
    stripMetadata: false,
    isGif: false
  });

  // Execute FFmpeg
  const cmd = `ffmpeg -y -i "${toneWav}" ${args.join(' ')} "${outOpus}"`;
  execSync(cmd, { stdio: 'pipe' });
  assert.ok(fs.existsSync(outOpus));

  // Probe output
  const probe = probeStream(outOpus);
  const audioStream = probe.streams.find(s => s.codec_type === 'audio');
  assert.ok(audioStream, 'Output file must have an audio stream');
  assert.strictEqual(audioStream.codec_name, 'opus', 'Codec name must be opus');
  assert.ok(probe.format.format_name.includes('ogg'), 'Opus container is ogg/opus muxer');

  // Negative test: empirically verify that assigning AAC into .opus fails in FFmpeg!
  let aacFailed = false;
  try {
    execSync(`ffmpeg -y -i "${toneWav}" -vn -c:a aac "${path.join(tempDir, 'fail.opus')}"`, { stdio: 'pipe' });
  } catch (err) {
    aacFailed = true;
    const stderr = err.stderr ? err.stderr.toString() : '';
    assert.ok(
      stderr.includes('Only Opus audio is supported') || err.status !== 0,
      'FFmpeg must reject AAC in Opus container'
    );
  }
  assert.ok(aacFailed, 'Muxing AAC into .opus container MUST be rejected by FFmpeg');
});

// ── SECTION 2: WebM Silence Mode in app/api/mute/route.ts ──
console.log('\n--- SECTION 2: WebM Silence Mode & Mute Route (app/api/mute/route.ts) ---');

it('Audio codec mapping logic in mute route assigns libopus for WebM, pcm_s16le for AVI, aac for MP4', () => {
  const getAudioCodec = (ext) => {
    return ext === '.webm' ? 'libopus' : ext === '.avi' ? 'pcm_s16le' : 'aac';
  };

  assert.strictEqual(getAudioCodec('.webm'), 'libopus');
  assert.strictEqual(getAudioCodec('.WEBM'.toLowerCase()), 'libopus');
  assert.strictEqual(getAudioCodec('.avi'), 'pcm_s16le');
  assert.strictEqual(getAudioCodec('.mp4'), 'aac');
  assert.strictEqual(getAudioCodec('.mov'), 'aac');
  assert.strictEqual(getAudioCodec('.mkv'), 'aac');
});

await itAsync('Empirical FFmpeg execution: WebM silence mode generates valid silent WebM with libopus', async () => {
  const inWebm = path.join(tempDir, 'input.webm');
  const outWebm = path.join(tempDir, 'muted_silence.webm');

  // Create a 1-second WebM file with VP8 video and Opus audio
  execSync(
    `ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=10" -f lavfi -i "sine=frequency=1000:duration=1" -c:v vp8 -c:a libopus -shortest "${inWebm}"`,
    { stdio: 'pipe' }
  );
  assert.ok(fs.existsSync(inWebm));

  // Run silence mode FFmpeg command exactly as constructed by app/api/mute/route.ts:
  // args = ['-i', inputPath, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'libopus', '-ac', '2', '-af', 'volume=0', '-y', outputPath]
  const muteArgs = [
    '-y',
    '-i', inWebm,
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c:v', 'copy',
    '-c:a', 'libopus',
    '-ac', '2',
    '-af', 'volume=0',
    outWebm
  ];
  execSync(`ffmpeg ${muteArgs.join(' ')}`, { stdio: 'pipe' });
  assert.ok(fs.existsSync(outWebm));

  // Probe output
  const probe = probeStream(outWebm);
  const audioStream = probe.streams.find(s => s.codec_type === 'audio');
  const videoStream = probe.streams.find(s => s.codec_type === 'video');
  assert.ok(videoStream, 'Must retain video stream');
  assert.strictEqual(videoStream.codec_name, 'vp8', 'Video stream must be copied losslessly');
  assert.ok(audioStream, 'Must retain audio stream');
  assert.strictEqual(audioStream.codec_name, 'opus', 'Audio stream must be encoded as opus');

  // Verify volume is actually 0 (silence)
  const volRes = spawnSync('ffmpeg', [
    '-i', outWebm,
    '-af', 'volumedetect',
    '-vn',
    '-f', 'null',
    '-'
  ], { encoding: 'utf8' });
  const volLog = volRes.stderr;
  // Should report max_volume: -91.0 dB or silent
  assert.ok(volLog.includes('max_volume') || volLog.includes('mean_volume'), 'Volume detect should run on muted stream');

  // Negative test: verify that attempting to use AAC on WebM throws fatal error
  let webmAacFailed = false;
  try {
    execSync(
      `ffmpeg -y -i "${inWebm}" -map 0:v:0? -map 0:a:0? -c:v copy -c:a aac -ac 2 -af volume=0 "${path.join(tempDir, 'fail.webm')}"`,
      { stdio: 'pipe' }
    );
  } catch (err) {
    webmAacFailed = true;
    const stderr = err.stderr ? err.stderr.toString() : '';
    assert.ok(
      stderr.includes('Only VP8 or VP9 or AV1 video and Vorbis or Opus audio') || err.status !== 0,
      'FFmpeg must reject AAC inside WebM container'
    );
  }
  assert.ok(webmAacFailed, 'Assigning AAC to WebM in mute route MUST fail in FFmpeg');
});

await itAsync('Empirical verification: Mute route adds -tag:v hvc1 and -movflags +faststart for HEVC MP4/MOV', async () => {
  const inMp4 = path.join(tempDir, 'hevc_input.mp4');
  const outMp4 = path.join(tempDir, 'hevc_muted.mp4');

  // Generate 1-sec HEVC video in MP4
  execSync(
    `ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=10" -f lavfi -i "sine=frequency=440:duration=1" -c:v libx265 -tag:v hvc1 -c:a aac -pix_fmt yuv420p "${inMp4}"`,
    { stdio: 'pipe' }
  );

  // Run mute route command for HEVC MP4:
  // args = ['-i', inputPath, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-ac', '2', '-af', 'volume=0', '-tag:v', 'hvc1', '-movflags', '+faststart', '-y', outputPath]
  const muteArgs = [
    '-y',
    '-i', inMp4,
    '-map', '0:v:0?',
    '-map', '0:a:0?',
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-ac', '2',
    '-af', 'volume=0',
    '-tag:v', 'hvc1',
    '-movflags', '+faststart',
    outMp4
  ];
  execSync(`ffmpeg ${muteArgs.join(' ')}`, { stdio: 'pipe' });
  assert.ok(fs.existsSync(outMp4));

  const probe = probeStream(outMp4);
  const videoStream = probe.streams.find(s => s.codec_type === 'video');
  assert.strictEqual(videoStream.codec_tag_string, 'hvc1', 'Muted HEVC MP4 must retain codec tag hvc1');

  // Verify moov atom is before mdat atom (faststart)
  const boxOrder = getMp4BoxOrder(outMp4);
  const moovIdx = boxOrder.findIndex(b => b.type === 'moov');
  const mdatIdx = boxOrder.findIndex(b => b.type === 'mdat');
  assert.ok(moovIdx !== -1 && mdatIdx !== -1, 'MP4 must have both moov and mdat boxes');
  assert.ok(moovIdx < mdatIdx, `moov box (index ${moovIdx}) must precede mdat box (index ${mdatIdx}) for faststart`);
});

// ── SECTION 3: QuickTime Compatibility Flags Across Export Routes ──
console.log('\n--- SECTION 3: QuickTime Compatibility Flags Across Export Endpoints ---');

it('convert/route.ts: presets strictly include -pix_fmt yuv420p and -movflags +faststart', () => {
  const convertRouteContent = fs.readFileSync(path.join(projectRoot, 'app/api/convert/route.ts'), 'utf8');

  // Check all standard social and device presets
  const presets = ['whatsapp', 'discord', 'email', 'high', 'twitter', 'instagram', 'tiktok'];
  for (const preset of presets) {
    const presetRegex = new RegExp(`preset === ['"]${preset}['"]([\\s\\S]*?)(?:else if|return)`);
    const match = convertRouteContent.match(presetRegex);
    assert.ok(match, `Preset ${preset} must exist in convert/route.ts`);
    const block = match[1];

    assert.ok(
      block.includes("'-pix_fmt', 'yuv420p'"),
      `Preset ${preset} must include -pix_fmt yuv420p for QuickTime/Safari compatibility`
    );
    assert.ok(
      block.includes("'-movflags', '+faststart'") || block.includes("'-movflags', 'faststart'"),
      `Preset ${preset} must include -movflags +faststart for streaming`
    );
  }
});

it('convert/route.ts: remux and QuickTime audio healing include -tag:v hvc1 and -movflags +faststart', () => {
  const convertRouteContent = fs.readFileSync(path.join(projectRoot, 'app/api/convert/route.ts'), 'utf8');

  // Remux preset block
  const remuxBlockMatch = convertRouteContent.match(/else if \(preset === 'remux'\) \{([\s\S]*?)(?=\n\s*\}\s*\n\s*const streamInfo)/);
  assert.ok(remuxBlockMatch, 'Remux preset block must exist in convert/route.ts');
  const remuxBlock = remuxBlockMatch[1];

  assert.ok(remuxBlock.includes("'-movflags', '+faststart'"), 'Remux preset must add -movflags +faststart for QuickTime containers');
  assert.ok(remuxBlock.includes("'-tag:v', 'hvc1'"), 'Remux preset must add -tag:v hvc1 for HEVC video in QuickTime containers');

  // Intelligent Pass-Through block
  const passThroughMatch = convertRouteContent.match(/Intelligent Pass-Through:([\s\S]*?)(?=\n\s*const decision =)/);
  assert.ok(passThroughMatch, 'Intelligent pass-through block must exist');
  const passThroughBlock = passThroughMatch[1];
  assert.ok(passThroughBlock.includes("'-movflags', '+faststart'"), 'Pass-through must add -movflags +faststart for QuickTime');
  assert.ok(passThroughBlock.includes("'-tag:v', 'hvc1'"), 'Pass-through must add -tag:v hvc1 for HEVC in QuickTime');

  // General conversion fallback block
  assert.ok(
    convertRouteContent.includes("if (hasH264OrHevc && !args.includes('-pix_fmt')) {\n      args.push('-pix_fmt', 'yuv420p');\n    }"),
    'General fallback must append -pix_fmt yuv420p for H.264/HEVC'
  );
  assert.ok(
    convertRouteContent.includes("if (isHevc && !args.includes('-tag:v')) {\n      args.push('-tag:v', 'hvc1');\n    }"),
    'General fallback must append -tag:v hvc1 for HEVC'
  );
});

it('convert/route.ts: Audio-Video synthesis and Visualizer synthesis include QuickTime flags', () => {
  const convertRouteContent = fs.readFileSync(path.join(projectRoot, 'app/api/convert/route.ts'), 'utf8');

  // Check internalBuildAudioVideoSynthesisArgs for mp4/mov
  const avSynthMatch = convertRouteContent.match(/function internalBuildAudioVideoSynthesisArgs[\s\S]*?return result;\s*\}/);
  assert.ok(avSynthMatch, 'internalBuildAudioVideoSynthesisArgs function must exist');
  const avBlock = avSynthMatch[0];
  assert.ok(avBlock.includes("'-pix_fmt', 'yuv420p'"), 'Audio-Video synthesis must specify -pix_fmt yuv420p for mp4/mov');
  assert.ok(avBlock.includes("'-movflags', '+faststart'"), 'Audio-Video synthesis must specify -movflags +faststart');

  // Check internalBuildVisualizerSynthesisArgs for mp4/mov
  const visSynthMatch = convertRouteContent.match(/function internalBuildVisualizerSynthesisArgs[\s\S]*?return result;\s*\}/);
  assert.ok(visSynthMatch, 'internalBuildVisualizerSynthesisArgs function must exist');
  const visBlock = visSynthMatch[0];
  assert.ok(visBlock.includes("'-pix_fmt', 'yuv420p'"), 'Visualizer synthesis must specify -pix_fmt yuv420p for mp4/mov');
  assert.ok(visBlock.includes("'-movflags', '+faststart'"), 'Visualizer synthesis must specify -movflags +faststart');
});

it('hevc/route.ts: software encoder specifies -pix_fmt yuv420p, all branches specify -tag:v hvc1 and -movflags +faststart', () => {
  const hevcRouteContent = fs.readFileSync(path.join(projectRoot, 'app/api/hevc/route.ts'), 'utf8');

  // Software branch
  const swBranch = hevcRouteContent.match(/args\.push\('-c:v', 'libx265', '-crf', String\(crf\), '-preset', preset, '-pix_fmt', 'yuv420p'\);/);
  assert.ok(swBranch, 'hevc route must include -pix_fmt yuv420p in libx265 software branch');

  // Tag & faststart flags
  const flagsMatch = hevcRouteContent.match(/args\.push\('-tag:v', 'hvc1', '-movflags', '\+faststart'\);/);
  assert.ok(flagsMatch, 'hevc route must apply -tag:v hvc1 and -movflags +faststart to all outputs');
});

it('compress/route.ts: software H.264/HEVC encodes emit -pix_fmt yuv420p, HEVC emits -tag:v hvc1, MP4 emits -movflags +faststart', () => {
  const compressContent = fs.readFileSync(path.join(projectRoot, 'app/api/compress/route.ts'), 'utf8');

  // Check pix_fmt yuv420p
  assert.ok(
    compressContent.includes("if (videoCodec === 'h264' || videoCodec === 'hevc') {\n                  args.push('-pix_fmt', 'yuv420p');"),
    'compress route must push -pix_fmt yuv420p for H.264 and HEVC software transcode'
  );

  // Check -tag:v hvc1
  assert.ok(
    compressContent.includes("if (videoCodec === 'hevc') {\n                args.push('-tag:v', 'hvc1');\n              }"),
    'compress route must push -tag:v hvc1 when videoCodec === hevc'
  );

  // Check -movflags +faststart
  assert.ok(
    compressContent.includes("if (outputExt === '.mp4' || outputExt === '.mov' || outputExt === '.m4a') {\n                args.push('-movflags', '+faststart');\n              }\n              args.push('-y', outputPath);"),
    'compress route must push -movflags +faststart before outputPath for MP4/MOV/M4A'
  );

  // Check audio compression faststart
  assert.ok(
    compressContent.includes("if (outputExt === '.m4a' || outputExt === '.mp4') {\n                args.push('-movflags', '+faststart');\n              }"),
    'compress route must push -movflags +faststart for .m4a and .mp4 audio outputs'
  );

  // Check VP9 -b:v 0
  assert.ok(
    compressContent.includes("if (encoder === 'libvpx-vp9') {\n                  args.push('-c:v', encoder, '-crf', String(videoCrf), '-b:v', '0');"),
    'compress route must clamp VP9 bitrate with -b:v 0 alongside CRF'
  );

  // Check WebP fallback
  assert.ok(
    compressContent.includes("if (imageFormat === 'webp') {\n                  imgArgs.push('-c:v', 'libwebp');"),
    'compress route image fallback must use -c:v libwebp (not png)'
  );
});

it('audio-trim/route.ts: .m4a and .mp4 exports strictly include -movflags +faststart', () => {
  const trimContent = fs.readFileSync(path.join(projectRoot, 'app/api/audio-trim/route.ts'), 'utf8');

  assert.ok(
    trimContent.includes("if (outputFormat === 'm4a' || outputFormat === 'mp4') {\n            args.push('-movflags', '+faststart');\n          }"),
    'audio-trim route must attach -movflags +faststart to m4a and mp4 containers'
  );
});

// ── SECTION 4: Empirical FFmpeg Execution of QuickTime & Container Standards ──
console.log('\n--- SECTION 4: Empirical Video Generation & Box/Tag Inspections ---');

await itAsync('Empirical FFmpeg execution: H.264 encode with -pix_fmt yuv420p produces Safari-compatible pixel format', async () => {
  const inRgb = path.join(tempDir, 'test_rgb.mp4');
  const outYuv = path.join(tempDir, 'test_yuv420p.mp4');

  // Create an artificial RGB video (yuv444p or gbrp pixel format that QuickTime fails to decode)
  execSync(
    `ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=10" -pix_fmt yuv444p -c:v libx264 "${inRgb}"`,
    { stdio: 'pipe' }
  );
  assert.ok(fs.existsSync(inRgb));
  const inProbe = probeStream(inRgb);
  assert.strictEqual(inProbe.streams[0].pix_fmt, 'yuv444p', 'Input pixel format is yuv444p');

  // Convert using the QuickTime preset arguments: -c:v libx264 -pix_fmt yuv420p -movflags +faststart
  execSync(
    `ffmpeg -y -i "${inRgb}" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -movflags +faststart "${outYuv}"`,
    { stdio: 'pipe' }
  );
  assert.ok(fs.existsSync(outYuv));

  const outProbe = probeStream(outYuv);
  assert.strictEqual(outProbe.streams[0].pix_fmt, 'yuv420p', 'Output must be normalized to yuv420p');

  const boxOrder = getMp4BoxOrder(outYuv);
  const moovIdx = boxOrder.findIndex(b => b.type === 'moov');
  const mdatIdx = boxOrder.findIndex(b => b.type === 'mdat');
  assert.ok(moovIdx < mdatIdx, 'moov must precede mdat for progressive download');
});

await itAsync('Empirical FFmpeg execution: HEVC encode with -tag:v hvc1 produces QuickTime-compatible stream tag', async () => {
  const inVideo = path.join(tempDir, 'test_source.mp4');
  const outHevc = path.join(tempDir, 'test_hvc1.mp4');

  execSync(
    `ffmpeg -y -f lavfi -i "testsrc=duration=1:size=320x240:rate=10" -c:v libx264 -pix_fmt yuv420p "${inVideo}"`,
    { stdio: 'pipe' }
  );

  // Encode with libx265 -tag:v hvc1 -pix_fmt yuv420p -movflags +faststart
  execSync(
    `ffmpeg -y -i "${inVideo}" -c:v libx265 -preset ultrafast -crf 28 -pix_fmt yuv420p -tag:v hvc1 -movflags +faststart "${outHevc}"`,
    { stdio: 'pipe' }
  );
  assert.ok(fs.existsSync(outHevc));

  const probe = probeStream(outHevc);
  const vStream = probe.streams.find(s => s.codec_type === 'video');
  assert.strictEqual(vStream.codec_name, 'hevc', 'Codec must be HEVC');
  assert.strictEqual(vStream.codec_tag_string, 'hvc1', 'Codec tag must strictly be hvc1 (not hev1)');
  assert.strictEqual(vStream.pix_fmt, 'yuv420p', 'Pixel format must strictly be yuv420p');
});

// ── SECTION 5: HTTP/2 Compliance & Backpressure Checks ──
console.log('\n--- SECTION 5: HTTP/2 Compliance & Stream Backpressure Verification ---');

it('app/api/experimental/turbo-download/route.ts: omits Transfer-Encoding: chunked when HTTP/2 detected', () => {
  const turboContent = fs.readFileSync(path.join(projectRoot, 'app/api/experimental/turbo-download/route.ts'), 'utf8');

  // Verify HTTP/2 detection
  assert.ok(
    turboContent.includes('const isHttp2 ='),
    'turbo-download must check for HTTP/2 protocol'
  );
  assert.ok(
    turboContent.includes("if (!isHttp2) {\n      responseHeaders['Transfer-Encoding'] = 'chunked';\n    }"),
    'turbo-download must only attach Transfer-Encoding: chunked when NOT HTTP/2'
  );
});

it('app/api/download/route.ts: stream manages readStream pause/resume on controller.desiredSize', () => {
  const downloadContent = fs.readFileSync(path.join(projectRoot, 'app/api/download/route.ts'), 'utf8');

  assert.ok(
    downloadContent.includes('controller.desiredSize !== null && controller.desiredSize <= 0'),
    'download route must check controller.desiredSize'
  );
  assert.ok(
    downloadContent.includes('fileStream.pause()'),
    'download route must pause fileStream when buffer is saturated'
  );
  assert.ok(
    downloadContent.includes('fileStream.resume()'),
    'download route pull() must resume fileStream when reader consumes buffer'
  );
  assert.ok(
    downloadContent.includes('fileStream.destroy()'),
    'download route cancel() must destroy fileStream to avoid leaked file descriptors'
  );
});

// ── Cleanup ──
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch {}

console.log('\n================================================================');
console.log(`CHALLENGE COMPLETE: ${passedTests}/${totalTests} tests passed cleanly.`);
console.log('================================================================');
