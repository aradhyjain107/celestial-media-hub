/**
 * lib/remuxDecision.ts
 *
 * Smart remux-vs-encode decision engine.
 *
 * Analyses the detected codecs of the input file against the target output
 * container and any active user-requested transformations. Returns the most
 * efficient FFmpeg strategy — minimising re-encoding work while still
 * producing valid output.
 *
 * Strategy values (in order of preference):
 *  'remux'        — container rewrap only, full -c copy. Zero quality loss.
 *  'copy-video'   — re-encode audio only, copy video stream.
 *  'copy-audio'   — re-encode video only, copy audio stream.
 *  'encode'       — full re-encode of both streams.
 */

export type ConversionStrategy = 'remux' | 'copy-video' | 'copy-audio' | 'encode';

export interface StreamInfo {
  videoCodec?: string | undefined;
  audioCodec?: string | undefined;
}

export interface ConversionOptions {
  speed: number;
  resolution: string;
  stripAudio: boolean;
  stripMetadata: boolean;
  outputFormat: string;
  isGif: boolean;
  isImage?: boolean;
}

// ── Compatibility tables ──────────────────────────────────────────────────────
// Maps codec_name (as reported by ffprobe) to the containers it can be
// natively stored in without re-encoding.

const VIDEO_CODEC_COMPAT: Record<string, string[]> = {
  h264:        ['mp4', 'mkv', 'mov', 'ts', 'avi'],
  hevc:        ['mp4', 'mkv', 'mov', 'ts'],
  h265:        ['mp4', 'mkv', 'mov', 'ts'],       // ffprobe alias
  vp8:         ['webm', 'mkv'],
  vp9:         ['webm', 'mkv'],
  av1:         ['webm', 'mkv', 'mp4'],
  prores:      ['mov', 'mkv'],
  dnxhd:       ['mov', 'mkv', 'mxf'],
  mpeg4:       ['mp4', 'mkv', 'avi'],
  mpeg2video:  ['ts', 'mpeg', 'mpg'],
  theora:      ['ogv', 'mkv'],
  mjpeg:       ['avi', 'mkv', 'mov'],
};

const AUDIO_CODEC_COMPAT: Record<string, string[]> = {
  aac:       ['mp4', 'mkv', 'mov', 'ts', 'm4a', 'aac'],
  mp3:       ['mp4', 'mkv', 'ts', 'avi', 'mp3'],
  opus:      ['webm', 'mkv', 'ogg', 'opus'],
  vorbis:    ['webm', 'mkv', 'ogg'],
  flac:      ['mkv', 'flac', 'ogg'],
  pcm_s16le: ['wav', 'mkv', 'avi', 'mov'],
  pcm_s24le: ['wav', 'mkv', 'mov'],
  pcm_f32le: ['wav', 'mkv', 'mov'],
  ac3:       ['ts', 'mkv', 'ac3'],
  eac3:      ['ts', 'mkv'],
  truehd:    ['mkv', 'ts'],
  dts:       ['mkv', 'ts'],
  alac:      ['m4a', 'mov', 'mkv', 'mp4'],
  mp2:       ['ts', 'mpeg', 'mkv'],
};

const IMAGE_FORMATS = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'avif'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function videoCompatible(codec: string | undefined, format: string): boolean {
  if (!codec) return true; // no video stream → no concern
  // eslint-disable-next-line security/detect-object-injection
  return VIDEO_CODEC_COMPAT[codec.toLowerCase()]?.includes(format) ?? false;
}

function audioCompatible(codec: string | undefined, format: string): boolean {
  if (!codec) return true; // no audio stream → no concern
  // eslint-disable-next-line security/detect-object-injection
  return AUDIO_CODEC_COMPAT[codec.toLowerCase()]?.includes(format) ?? false;
}

/** Returns true if any user-specified option forces a video re-encode. */
function requiresVideoEncode(opts: ConversionOptions): boolean {
  return (
    opts.isGif ||
    opts.isImage ||
    IMAGE_FORMATS.includes(opts.outputFormat) ||
    opts.resolution !== 'original' ||
    opts.speed !== 1
  );
}

/** Returns true if any user-specified option forces an audio re-encode. */
function requiresAudioEncode(opts: ConversionOptions): boolean {
  return opts.stripAudio === false && opts.speed !== 1;
  // stripAudio uses -an (not -c copy) so it doesn't affect encode decision
}

// ── Main decision function ────────────────────────────────────────────────────

/**
 * Decide the most efficient FFmpeg conversion strategy given:
 * - The input file's detected stream codecs
 * - The desired output format
 * - Any active user transformations (resolution, speed, etc.)
 */
export function decideStrategy(
  streams: StreamInfo,
  opts: ConversionOptions
): { strategy: ConversionStrategy; reason: string } {
  const { videoCodec, audioCodec } = streams;
  const { outputFormat } = opts;

  // Image format export
  if (opts.isImage || IMAGE_FORMATS.includes(outputFormat)) {
    return { strategy: 'encode', reason: `Image format export (${outputFormat.toUpperCase()})` };
  }

  // GIF always requires full encode — no container copy possible
  if (opts.isGif) {
    return { strategy: 'encode', reason: 'GIF requires palette generation and frame encoding' };
  }

  // Pure audio output format — only need audio stream
  const AUDIO_ONLY_FORMATS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus'];
  if (AUDIO_ONLY_FORMATS.includes(outputFormat)) {
    if (audioCompatible(audioCodec, outputFormat) && opts.speed === 1) {
      return { strategy: 'remux', reason: `Audio codec (${audioCodec}) natively compatible with ${outputFormat}` };
    }
    return { strategy: 'encode', reason: `Audio codec (${audioCodec}) must be re-encoded for ${outputFormat}` };
  }

  // Speed change requires re-encoding both streams (setpts + atempo filters)
  if (opts.speed !== 1) {
    return { strategy: 'encode', reason: 'Speed change requires full re-encode' };
  }

  // Resolution change requires video re-encode
  const videoNeedsEncode = requiresVideoEncode(opts) || !videoCompatible(videoCodec, outputFormat);
  const audioNeedsEncode = !audioCompatible(audioCodec, outputFormat);

  if (!videoNeedsEncode && !audioNeedsEncode) {
    return {
      strategy: 'remux',
      reason: `Both streams (${videoCodec ?? 'none'} / ${audioCodec ?? 'none'}) are natively compatible with ${outputFormat}`,
    };
  }

  if (!videoNeedsEncode && audioNeedsEncode) {
    return {
      strategy: 'copy-video',
      reason: `Video (${videoCodec}) compatible — only re-encoding audio (${audioCodec} → ${outputFormat})`,
    };
  }

  if (videoNeedsEncode && !audioNeedsEncode) {
    return {
      strategy: 'copy-audio',
      reason: `Audio (${audioCodec}) compatible — only re-encoding video (${videoCodec} → ${outputFormat})`,
    };
  }

  return {
    strategy: 'encode',
    reason: `Both streams must be re-encoded for ${outputFormat}`,
  };
}

// ── FFmpeg args builder ───────────────────────────────────────────────────────

/**
 * Build the FFmpeg encoding arguments for a given strategy.
 * Does NOT include -i, -threads, -y, or the output path (caller adds those).
 */
export function buildStrategyArgs(
  strategy: ConversionStrategy,
  opts: ConversionOptions
): string[] {
  const args: string[] = [];
  const { outputFormat, resolution, speed, stripAudio, stripMetadata } = opts;

  const AUDIO_ONLY_FORMATS = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus'];
  if (AUDIO_ONLY_FORMATS.includes(outputFormat)) {
    args.push('-vn'); // Disable video stream
    const targetAudioCodec = getDefaultAudioCodec(outputFormat);
    if (strategy === 'remux') {
      args.push('-c:a', 'copy');
    } else {
      args.push('-c:a', targetAudioCodec);
      if (speed !== 1) {
        args.push('-af', buildAudioSpeedFilter(speed));
      }
    }
    if (stripMetadata) args.push('-map_metadata', '-1');
    return args;
  }

  if (opts.isImage || IMAGE_FORMATS.includes(outputFormat)) {

    args.push('-vframes', '1');

    const filters: string[] = [];
    if (resolution !== 'original') {
      const scaleMap: Record<string, string> = {
        '1080p': 'scale=-2:1080',
        '720p':  'scale=-2:720',
        '480p':  'scale=-2:480',
        '360p':  'scale=-2:360',
      };
      // eslint-disable-next-line security/detect-object-injection
      const scale = scaleMap[resolution];
      if (scale) filters.push(scale);
    }

    if (filters.length > 0) {
      args.push('-vf', filters.join(','));
    }

    // Explicit pixel format compatibility for 16-bit / RAW inputs (e.g. CR2, NEF, ARW, DNG rgb48le)
    if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
      args.push('-pix_fmt', 'yuv420p');
    } else if (outputFormat === 'png') {
      args.push('-pix_fmt', 'rgba');
    } else if (outputFormat === 'webp' || outputFormat === 'avif') {
      args.push('-pix_fmt', 'yuv420p');
    } else if (outputFormat === 'bmp') {
      args.push('-pix_fmt', 'rgb24');
    }

    if (stripMetadata) args.push('-map_metadata', '-1');
    return args;
  }

  switch (strategy) {
    case 'remux':
      args.push('-c', 'copy');
      break;

    case 'copy-video': {
      args.push('-c:v', 'copy');
      // Re-encode audio to a format compatible with the output container
      const targetAudioCodec = getDefaultAudioCodec(outputFormat);
      args.push('-c:a', targetAudioCodec);
      break;
    }

    case 'copy-audio': {
      args.push('-c:a', 'copy');
      // Re-encode video
      const videoArgs = buildVideoEncodeArgs(outputFormat, resolution, speed, opts.isGif);
      args.push(...videoArgs);
      break;
    }

    case 'encode': {
      const videoArgs = buildVideoEncodeArgs(outputFormat, resolution, speed, opts.isGif);
      args.push(...videoArgs);
      if (!opts.isGif) {
        const targetAudioCodec = getDefaultAudioCodec(outputFormat);
        if (!stripAudio) args.push('-c:a', targetAudioCodec);
      }
      break;
    }
  }

  // Strip audio stream entirely (overrides any -c:a flags above; GIF has no audio track)
  if (stripAudio || opts.isGif) args.push('-an');

  // Strip metadata
  if (stripMetadata) args.push('-map_metadata', '-1');

  // Speed filter (requires re-encode — already forced strategy to 'encode')
  if (speed !== 1 && strategy === 'encode' && !opts.isGif) {
    const audioFilters = buildAudioSpeedFilter(speed);
    if (!stripAudio) args.push('-af', audioFilters);
  }

  // GIF palette generation
  if (opts.isGif) {
    const gifFilters: string[] = [];
    if (speed !== 1) {
      const videoSpeed = 1 / speed;
      gifFilters.push(`setpts=${videoSpeed.toFixed(4)}*(PTS-STARTPTS)`);
    }
    const gifWidthMap: Record<string, string> = { '1080p': '1080', '720p': '720', '480p': '480', '360p': '360' };
    // eslint-disable-next-line security/detect-object-injection
    const gifWidth = gifWidthMap[resolution] || '720';
    gifFilters.push(`fps=15,scale=${gifWidth}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`);
    args.push('-vf', gifFilters.join(','), '-loop', '0');
  }

  // faststart for web-compatible MP4 and QuickTime MOV
  if (outputFormat === 'mp4' || outputFormat === 'mov' || outputFormat === 'm4a') {
    args.push('-movflags', '+faststart');
  }

  return args;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function getDefaultAudioCodec(outputFormat: string): string {
  switch (outputFormat) {
    case 'opus':
    case 'webm':       return 'libopus';
    case 'ogg':        return 'libvorbis';
    case 'flac':       return 'flac';
    case 'wav':        return 'pcm_s16le';
    case 'mp3':        return 'libmp3lame';
    case 'm4a':        return 'aac';
    default:           return 'aac';
  }
}

function getDefaultVideoCodec(outputFormat: string): string {
  if (outputFormat === 'gif') return 'gif';
  if (outputFormat === 'webm') return 'libvpx-vp9';
  if (process.platform === 'darwin' && !process.env.VITEST) return 'h264_videotoolbox';
  return 'libx264';
}

function buildVideoEncodeArgs(outputFormat: string, resolution: string, speed: number, isGif: boolean = false): string[] {
  const args: string[] = [];
  const codec = getDefaultVideoCodec(outputFormat);

  args.push('-c:v', codec);

  if (codec === 'gif') {
    return args;
  } else if (codec === 'h264_videotoolbox') {
    args.push('-b:v', '6M', '-pix_fmt', 'yuv420p');
  } else if (codec === 'libx264') {
    args.push('-preset', 'ultrafast', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p');
  } else if (codec === 'libvpx-vp9') {
    args.push('-b:v', '0', '-crf', '30');
  }

  if (!isGif) {
    const vfFilters: string[] = [];
    if (resolution !== 'original') {
      const scaleMap: Record<string, string> = {
        '1080p': 'scale=-2:1080',
        '720p':  'scale=-2:720',
        '480p':  'scale=-2:480',
        '360p':  'scale=-2:360',
      };
      // eslint-disable-next-line security/detect-object-injection
      const scale = scaleMap[resolution];
      if (scale) vfFilters.push(scale);
    }

    if (speed !== 1) {
      const videoSpeed = 1 / speed;
      vfFilters.push(`setpts=${videoSpeed.toFixed(4)}*(PTS-STARTPTS)`);
    }

    if (vfFilters.length > 0) {
      args.push('-vf', vfFilters.join(','));
    }
  }

  return args;
}

/** atempo only supports 0.5–2.0 per filter — chain for larger ranges */
function buildAudioSpeedFilter(speed: number): string {
  const filters: string[] = [];
  let remaining = speed;
  while (remaining > 2.0) {
    filters.push('atempo=2.0');
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5');
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(4)}`);
  return filters.join(',');
}
