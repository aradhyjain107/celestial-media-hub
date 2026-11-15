import { Page } from '@playwright/test';

// Minimal 44-byte PCM WAV file header (1 sec 8kHz mono 8-bit silence)
export function createMinimalWavBuffer(): Buffer {
  const buf = Buffer.alloc(44 + 8000);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + 8000, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // Subchunk1Size
  buf.writeUInt16LE(1, 20);  // AudioFormat (PCM)
  buf.writeUInt16LE(1, 22);  // NumChannels (1)
  buf.writeUInt32LE(8000, 24); // SampleRate (8000)
  buf.writeUInt32LE(8000, 28); // ByteRate
  buf.writeUInt16LE(1, 32);  // BlockAlign
  buf.writeUInt16LE(8, 34);  // BitsPerSample
  buf.write('data', 36);
  buf.writeUInt32LE(8000, 40);
  buf.fill(128, 44); // 8-bit PCM silence centered at 128
  return buf;
}

// Minimal valid MP4 container buffer
export function createMinimalMp4Buffer(): Buffer {
  // ftyp box (24 bytes) + moov (empty)
  const ftyp = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // size 24, 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // 'isom', minor 512
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32  // compatible brands
  ]);
  const moov = Buffer.from([
    0x00, 0x00, 0x00, 0x08, 0x6d, 0x6f, 0x6f, 0x76  // size 8, 'moov'
  ]);
  return Buffer.concat([ftyp, moov]);
}

// Zero-byte buffer
export function createZeroByteBuffer(): Buffer {
  return Buffer.alloc(0);
}

// Corrupt buffer
export function createCorruptBuffer(sizeBytes = 1024): Buffer {
  const buf = Buffer.alloc(sizeBytes);
  buf.fill(0xDE);
  return buf;
}

export const HOSTILE_STRINGS = {
  LONG_255_CHAR: 'a'.repeat(250) + '.mp4',
  UNICODE_EMOJI: 'файл_🎵_#1_unicode_test_with_symbols_&_spaces_🔥.wav',
  SPECIAL_CHARS: "sample'\"`;&|<>$().mp3",
  XSS_PAYLOAD: '<script>window.__pwned=1</script>.mp4',
  RTL_STRING: 'مقطع_صوتي_اختبار_تجريبي.mp3',
  DIACRITICS: 'Tiếng_Việt_với_dấu_thanh_huyền_sắc_hỏi_ngã_nặng.wav',
  VERY_LONG_NAME_MIDDLE_DIFF: 'super_long_project_asset_media_archive_render_node_version_01_final_master_export.mov',
  COMMAND_INJECTION: 'test; rm -rf /; echo pwned.mp4',
};

export const VIEWPORTS = {
  MOBILE: { width: 320, height: 568 },
  TABLET: { width: 768, height: 1024 },
  DESKTOP: { width: 1440, height: 900 },
  ULTRAWIDE: { width: 3840, height: 1600 },
};

export interface ConsoleCollector {
  errors: string[];
  warnings: string[];
  logs: string[];
}

export function attachConsoleCollector(page: Page): ConsoleCollector {
  const collector: ConsoleCollector = {
    errors: [],
    warnings: [],
    logs: [],
  };

  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') {
      collector.errors.push(text);
    } else if (msg.type() === 'warning') {
      collector.warnings.push(text);
    } else {
      collector.logs.push(text);
    }
  });

  page.on('pageerror', err => {
    collector.errors.push(`UNCAUGHT PAGE ERROR: ${err.message}\n${err.stack}`);
  });

  return collector;
}
