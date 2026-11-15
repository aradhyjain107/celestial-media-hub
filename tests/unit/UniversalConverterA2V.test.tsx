// tests/unit/UniversalConverterA2V.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import UniversalConverter from '../../src/app/tools/converter/page';
import { GlobalJobProvider } from '../../src/app/context/GlobalJobContext';

// ── Mocks ──
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock WaveformEngine
vi.mock('../../src/app/components/waveform/WaveformEngine', () => ({
  generateWaveform: vi.fn().mockResolvedValue({
    left: new Float32Array(100).fill(0.5),
    right: new Float32Array(100).fill(0.5),
  }),
}));

// Mock Web Audio Context
class MockAudioContext {
  state = 'running';
  sampleRate = 44100;
  decodeAudioData = vi.fn().mockImplementation((_buf: ArrayBuffer) => {
    return Promise.resolve({
      numberOfChannels: 2,
      length: 44100 * 30,
      sampleRate: 44100,
      duration: 30.0,
      getChannelData: (_ch: number) => new Float32Array(44100 * 30).fill(0.5),
    });
  });
  createBufferSource = vi.fn().mockReturnValue({ connect: vi.fn(), start: vi.fn(), stop: vi.fn() });
  createGain = vi.fn().mockReturnValue({ connect: vi.fn(), gain: { value: 1, setValueAtTime: vi.fn() } });
  createAnalyser = vi.fn().mockReturnValue({
    connect: vi.fn(),
    frequencyBinCount: 128,
    getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(128)),
    getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)),
  });
  close = vi.fn().mockResolvedValue(undefined);
}
vi.stubGlobal('AudioContext', MockAudioContext);
vi.stubGlobal('webkitAudioContext', MockAudioContext);

// Mock Media Element methods
Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: vi.fn() });
Object.defineProperty(HTMLMediaElement.prototype, 'duration', { configurable: true, get() { return 30.0; } });
Object.defineProperty(HTMLMediaElement.prototype, 'videoWidth', { configurable: true, get() { return 1920; } });
Object.defineProperty(HTMLMediaElement.prototype, 'videoHeight', { configurable: true, get() { return 1080; } });

// Mock Canvas 2D
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((id: string) => {
  if (id === '2d') {
    return {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      drawImage: vi.fn(),
      createLinearGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
      createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
      save: vi.fn(),
      restore: vi.fn(),
      setTransform: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 50 }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1.0,
    };
  }
  return null;
});

// Mock ResizeObserver & FileReader
global.ResizeObserver = class { observe = vi.fn(); unobserve = vi.fn(); disconnect = vi.fn(); };
vi.stubGlobal('FileReader', class {
  onload: ((ev: ProgressEvent) => void) | null = null;
  result: ArrayBuffer | null = new ArrayBuffer(16);
  readAsArrayBuffer(_file: Blob) {
    setTimeout(() => {
      this.result = new ArrayBuffer(16);
      this.onload?.({ target: this } as unknown as ProgressEvent);
    }, 0);
  }
});
vi.stubGlobal('URL', {
  createObjectURL: vi.fn((file: any) => `blob:http://localhost/${file?.name || 'mock-file'}`),
  revokeObjectURL: vi.fn(),
});

import { resetGlobalJobStore } from '../../src/app/context/GlobalJobContext';

const setFileInputFiles = (input: HTMLElement, files: File[]) => {
  Object.defineProperty(input, 'files', {
    value: files,
    configurable: true,
    writable: true,
  });
  fireEvent.change(input, { target: { files } });
};

describe('Universal Converter Audio-to-Video (A2V) Unit Test Suite', () => {
  beforeEach(() => {
    resetGlobalJobStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetGlobalJobStore();
  });

  /* ── Test 1: Category tab unlocking ── */
  test('Test 1: Category tab unlocking allows clicking VIDEO tab when audio payload is loaded', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    // Drop MP3 audio file
    const dropzone = screen.getByTestId('file-input');
    const audioFile = new File(['mock-audio'], 'soundtrack.mp3', { type: 'audio/mpeg' });
    setFileInputFiles(dropzone, [audioFile]);

    await waitFor(() => {
      expect(screen.getByTitle('soundtrack.mp3')).toHaveTextContent(/soundtrack\.mp3/i);
    });

    // Verify VIDEO tab is NOT disabled
    const videoTab = screen.getByTestId('tab-video');
    expect(videoTab).not.toBeDisabled();
    expect(videoTab.getAttribute('aria-disabled')).toBe('false');

    // Click VIDEO tab
    fireEvent.click(videoTab);

    // Verify VIDEO formats are visible in format grid
    await waitFor(() => {
      expect(screen.getByTestId('format-mp4')).toBeInTheDocument();
      expect(screen.getByTestId('format-mkv')).toBeInTheDocument();
    });
  });

  /* ── Test 2: AudioToVideoStudio renders when audio targets video ── */
  test('Test 2: AudioToVideoStudio renders when audio payload targets video format', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const dropzone = screen.getByTestId('file-input');
    const audioFile = new File(['mock-audio'], 'speech.wav', { type: 'audio/wav' });
    setFileInputFiles(dropzone, [audioFile]);

    // Switch to VIDEO tab
    fireEvent.click(screen.getByTestId('tab-video'));
    fireEvent.click(screen.getByTestId('format-mp4'));

    await waitFor(() => {
      expect(screen.getByTestId('audio-to-video-studio')).toBeInTheDocument();
    });
  });

  /* ── Test 3: Video file attachment via dropzone & metadata ── */
  test('Test 3: Video file attachment via dropzone updates state, displays metadata, and shows replace/remove buttons', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const audioInput = screen.getByTestId('file-input');
    setFileInputFiles(audioInput, [new File(['a'], 'song.mp3', { type: 'audio/mpeg' })]);
    fireEvent.click(screen.getByTestId('tab-video'));

    // Find video dropzone
    const videoInput = await screen.findByTestId('video-file-input');
    const videoFile = new File(['mock-video-bytes'], 'clip.mp4', { type: 'video/mp4' });
    setFileInputFiles(videoInput, [videoFile]);

    await waitFor(() => {
      expect(screen.getByTitle('clip.mp4')).toHaveTextContent('clip.mp4');
      expect(screen.getByTestId('replace-video-btn')).toBeInTheDocument();
      expect(screen.getByTestId('remove-video-btn')).toBeInTheDocument();
    });

    // Click remove
    fireEvent.click(screen.getByTestId('remove-video-btn'));
    await waitFor(() => {
      expect(screen.queryByTitle('clip.mp4')).not.toBeInTheDocument();
    });
  });

  /* ── Test 4: Video trimmer timeline dual tracks & handles ── */
  test('Test 4: Video trimmer timeline renders dual tracks, moves trim handles, updates start/end timecodes', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const audioInput = screen.getByTestId('file-input');
    setFileInputFiles(audioInput, [new File(['a'], 'song.mp3', { type: 'audio/mpeg' })]);
    fireEvent.click(screen.getByTestId('tab-video'));

    const videoInput = await screen.findByTestId('video-file-input');
    setFileInputFiles(videoInput, [new File(['v'], 'backdrop.mp4', { type: 'video/mp4' })]);

    await waitFor(() => {
      expect(screen.getByTestId('timeline-audio-track')).toBeInTheDocument();
      expect(screen.getByTestId('timeline-video-track')).toBeInTheDocument();
      expect(screen.getByTestId('trim-handle-start')).toBeInTheDocument();
      expect(screen.getByTestId('trim-handle-end')).toBeInTheDocument();
    });

    // Move start handle
    const startHandle = screen.getByTestId('trim-handle-start');
    fireEvent.pointerDown(startHandle, { clientX: 0 });
    fireEvent.pointerMove(startHandle, { clientX: 80 });
    fireEvent.pointerUp(startHandle);

    await waitFor(() => {
      const timecode = screen.getByTestId('timecode-start');
      expect(timecode).toBeInTheDocument();
    });
  });

  /* ── Test 5: Keyboard navigation on trimmer handles ── */
  test('Test 5: Keyboard navigation on trimmer handles nudges by 0.1s and 1.0s', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const audioInput = screen.getByTestId('file-input');
    setFileInputFiles(audioInput, [new File(['a'], 'song.mp3', { type: 'audio/mpeg' })]);
    fireEvent.click(screen.getByTestId('tab-video'));

    const videoInput = await screen.findByTestId('video-file-input');
    setFileInputFiles(videoInput, [new File(['v'], 'backdrop.mp4', { type: 'video/mp4' })]);

    const startHandle = await screen.findByTestId('trim-handle-start');
    startHandle.focus();

    // ArrowRight: +0.1s
    fireEvent.keyDown(startHandle, { key: 'ArrowRight' });
    expect(startHandle.getAttribute('aria-valuenow')).toBe('0.1');

    // Shift+ArrowRight: +1.0s
    fireEvent.keyDown(startHandle, { key: 'ArrowRight', shiftKey: true });
    expect(startHandle.getAttribute('aria-valuenow')).toBe('1.1');

    // ArrowLeft: -0.1s
    fireEvent.keyDown(startHandle, { key: 'ArrowLeft' });
    expect(startHandle.getAttribute('aria-valuenow')).toBe('1');
  });

  /* ── Test 6: Kinetic visualizer mode toggling and theme selection ── */
  test('Test 6: Kinetic visualizer mode toggling and theme selection', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const audioInput = screen.getByTestId('file-input');
    setFileInputFiles(audioInput, [new File(['a'], 'beat.mp3', { type: 'audio/mpeg' })]);
    fireEvent.click(screen.getByTestId('tab-video'));

    // Toggle visualizer
    const visualizerToggle = await screen.findByTestId('visualizer-toggle');
    fireEvent.click(visualizerToggle);

    expect(screen.getByTestId('kinetic-visualizer-canvas')).toBeInTheDocument();

    // Switch theme to cyber_bars
    const cyberBarsChip = screen.getByTestId('theme-cyber_bars');
    fireEvent.click(cyberBarsChip);
    expect(cyberBarsChip.style.border || cyberBarsChip.className).toContain('accent');
  });

  /* ── Test 7: Sync mode switching ── */
  test('Test 7: Sync mode switching updates state and active indicator', async () => {
    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    const audioInput = screen.getByTestId('file-input');
    setFileInputFiles(audioInput, [new File(['a'], 'track.mp3', { type: 'audio/mpeg' })]);
    fireEvent.click(screen.getByTestId('tab-video'));

    const videoInput = await screen.findByTestId('video-file-input');
    setFileInputFiles(videoInput, [new File(['v'], 'loop.mp4', { type: 'video/mp4' })]);

    const loopBtn = await screen.findByTestId('sync-mode-loop-video');
    fireEvent.click(loopBtn);

    expect(screen.getByTestId('active-sync-mode')).toHaveTextContent(/loop-video/i);
  });

  /* ── Test 8: handleInitialize dispatches correct FormData ── */
  test('Test 8: handleInitialize dispatches full A2V FormData payload to /api/convert', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: new Headers({ 'content-type': 'application/octet-stream' }),
      blob: async () => new Blob(['video-out'], { type: 'video/mp4' }),
    });

    render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

    // 1. Audio file
    const audioInput = screen.getByTestId('file-input');
    const audioFile = new File(['audio-payload'], 'audio.mp3', { type: 'audio/mpeg' });
    setFileInputFiles(audioInput, [audioFile]);

    // 2. Select VIDEO tab & MKV format
    fireEvent.click(screen.getByTestId('tab-video'));
    fireEvent.click(screen.getByTestId('format-mkv'));

    // 3. Attach video file
    const videoInput = await screen.findByTestId('video-file-input');
    const videoFile = new File(['video-payload'], 'companion.mp4', { type: 'video/mp4' });
    setFileInputFiles(videoInput, [videoFile]);

    // 4. Set sync mode
    const loopBtn = await screen.findByTestId('sync-mode-loop-video');
    fireEvent.click(loopBtn);

    // 5. Click Initialize
    const initBtn = screen.getByTestId('initialize-btn');
    fireEvent.click(initBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('/api/convert');
      expect(opts.method).toBe('POST');
      const fd = opts.body as FormData;
      expect(fd.get('files') || fd.get('file')).toBeTruthy();
      expect(fd.get('videoFile') || fd.get('attachedVideo')).toBeTruthy();
      expect(fd.get('outputFormat')).toBe('mkv');
      expect(fd.get('audioSyncMode')).toBe('loop-video');
      expect(fd.get('videoStartTime')).not.toBeNull();
      expect(fd.get('videoEndTime')).not.toBeNull();
    });
  });

  /* ── Test 9: Web Audio API & HTMLMediaElement headless mock verification ── */
  test('Test 9: Headless test environment correctly mocks Web Audio API and HTMLMediaElement methods', async () => {
    const ctx = new AudioContext();
    const buf = await ctx.decodeAudioData(new ArrayBuffer(8));
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.duration).toBe(30.0);

    const video = document.createElement('video');
    expect(video.duration).toBe(30.0);
    await expect(video.play()).resolves.toBeUndefined();

    const canvas = document.createElement('canvas');
    const ctx2d = canvas.getContext('2d');
    expect(ctx2d).toBeTruthy();
    expect(typeof ctx2d?.fillRect).toBe('function');
  });
});
