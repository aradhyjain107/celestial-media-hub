// tests/unit/UniversalConverterAdversarial.test.tsx
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import UniversalConverter from '../../src/app/tools/converter/page';
import { VideoTrimmerTimeline, formatTimecode } from '../../src/app/tools/converter/components/VideoTrimmerTimeline';
import { KineticBackdropVisualizer } from '../../src/app/tools/converter/components/KineticBackdropVisualizer';
import { VideoPreviewCanvas } from '../../src/app/tools/converter/components/VideoPreviewCanvas';
import { VideoAttachmentDropzone } from '../../src/app/tools/converter/components/VideoAttachmentDropzone';
import { GlobalJobProvider, resetGlobalJobStore } from '../../src/app/context/GlobalJobContext';

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

const setFileInputFiles = (input: HTMLElement, files: File[]) => {
  Object.defineProperty(input, 'files', {
    value: files,
    configurable: true,
    writable: true,
  });
  fireEvent.change(input, { target: { files } });
};

describe('Universal Converter Frontend Adversarial Stress Suite', () => {
  beforeEach(() => {
    cleanup();
    resetGlobalJobStore();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    resetGlobalJobStore();
  });

  /* ── SECTION 1: Adversarial State Transitions & Payload Combinations ── */
  describe('1. Adversarial State Transitions', () => {
    test('Rapid tab oscillation between AUDIO and VIDEO does not corrupt A2V state', async () => {
      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const input = screen.getByTestId('file-input');
      const audioFile = new File(['sound'], 'track.mp3', { type: 'audio/mpeg' });
      setFileInputFiles(input, [audioFile]);

      await waitFor(() => {
        expect(screen.getByTitle('track.mp3')).toHaveTextContent('track.mp3');
      });

      const videoTab = screen.getByTestId('tab-video');
      const audioTab = screen.getByTestId('tab-audio');

      // Rapidly switch back and forth 3 times
      for (let i = 0; i < 3; i++) {
        fireEvent.click(videoTab);
        await waitFor(() => {
          expect(screen.getByTestId('format-mp4')).toBeInTheDocument();
        });

        fireEvent.click(audioTab);
        await waitFor(() => {
          expect(screen.getByTestId('format-mp3')).toBeInTheDocument();
        });
      }

      // Switch back to VIDEO and verify format is valid video format
      fireEvent.click(videoTab);
      await waitFor(() => {
        expect(screen.getByTestId('audio-to-video-studio')).toBeInTheDocument();
        expect(screen.getByTestId('format-mp4')).toBeInTheDocument();
      });
    });

    test('Audio-only payload blocks switching to PHOTO tab', async () => {
      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const input = screen.getByTestId('file-input');
      const audioFile = new File(['sound'], 'track.mp3', { type: 'audio/mpeg' });
      setFileInputFiles(input, [audioFile]);

      const photoTab = screen.getByTestId('tab-photo');
      expect(photoTab).toBeDisabled();

      // Click attempt should not change active tab to PHOTO
      fireEvent.click(photoTab);
      expect(screen.queryByTestId('format-png')).not.toBeInTheDocument();
    });

    test('Photo-only payload blocks switching to VIDEO and AUDIO tabs', async () => {
      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const input = screen.getByTestId('file-input');
      const imageFile = new File(['image-bytes'], 'photo.png', { type: 'image/png' });
      setFileInputFiles(input, [imageFile]);

      await waitFor(() => {
        expect(screen.getByTitle('photo.png')).toHaveTextContent('photo.png');
      });

      const videoTab = screen.getByTestId('tab-video');
      const audioTab = screen.getByTestId('tab-audio');
      expect(videoTab).toBeDisabled();
      expect(audioTab).toBeDisabled();

      fireEvent.click(videoTab);
      expect(screen.queryByTestId('audio-to-video-studio')).not.toBeInTheDocument();
    });

    test('Video payload does not activate A2V studio (activates standard video batch queue)', async () => {
      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const input = screen.getByTestId('file-input');
      const videoFile = new File(['video-bytes'], 'movie.mp4', { type: 'video/mp4' });
      setFileInputFiles(input, [videoFile]);

      await waitFor(() => {
        expect(screen.getByTitle('movie.mp4')).toHaveTextContent('movie.mp4');
      });

      // A2V Studio is ONLY for audio payloads targeting video
      expect(screen.queryByTestId('audio-to-video-studio')).not.toBeInTheDocument();
      expect(screen.getByTestId('batch-file-item')).toBeInTheDocument();
    });

    test('Mixed batch (audio + video + photo) displays batch queue and disables A2V studio', async () => {
      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const input = screen.getByTestId('file-input');
      const files = [
        new File(['audio'], 'music.mp3', { type: 'audio/mpeg' }),
        new File(['video'], 'intro.mp4', { type: 'video/mp4' }),
        new File(['photo'], 'cover.jpg', { type: 'image/jpeg' }),
      ];
      setFileInputFiles(input, files);

      await waitFor(() => {
        expect(screen.getAllByTestId('batch-file-item').length).toBe(3);
      });

      // Mixed batch cannot trigger A2V studio
      expect(screen.queryByTestId('audio-to-video-studio')).not.toBeInTheDocument();
    });

    test('Clear audio resets A2V studio cleanly', async () => {
      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const input = screen.getByTestId('file-input');
      const audioFile = new File(['sound'], 'track.mp3', { type: 'audio/mpeg' });
      setFileInputFiles(input, [audioFile]);

      fireEvent.click(screen.getByTestId('tab-video'));
      await waitFor(() => {
        expect(screen.getByTestId('audio-to-video-studio')).toBeInTheDocument();
      });

      // Click CLEAR AUDIO button inside studio
      const clearAudioBtn = screen.getByTestId('clear-audio-btn');
      fireEvent.click(clearAudioBtn);

      await waitFor(() => {
        expect(screen.getByTestId('dropzone')).toBeInTheDocument();
      });
    });
  });

  /* ── SECTION 2: Extreme Timeline Trimming Boundaries ── */
  describe('2. Extreme Timeline Trimming Boundaries', () => {
    test('formatTimecode helper formats normal, zero, and boundary values', () => {
      expect(formatTimecode(0)).toBe('00:00.00');
      expect(formatTimecode(-5)).toBe('00:00.00');
      expect(formatTimecode(NaN)).toBe('00:00.00');
      expect(formatTimecode(0.25)).toBe('00:00.25');
      expect(formatTimecode(12.5)).toBe('00:12.50');
      expect(formatTimecode(65.5)).toBe('01:05.50');
    });

    test('Direct VideoTrimmerTimeline: Dragging start handle past end clamps strictly to end - 0.25s', () => {
      const mockTrimChange = vi.fn();
      const mockSeek = vi.fn();
      const mockTogglePlay = vi.fn();
      const audioFile = new File(['a'], 'audio.mp3', { type: 'audio/mpeg' });
      const videoFile = new File(['v'], 'video.mp4', { type: 'video/mp4' });

      const { container } = render(
        <VideoTrimmerTimeline
          audioFile={audioFile}
          attachedVideo={videoFile}
          videoStartTime={5}
          videoEndTime={10}
          onTrimChange={mockTrimChange}
          currentTime={0}
          onSeek={mockSeek}
          isPlaying={false}
          onTogglePlay={mockTogglePlay}
        />
      );

      // Mock getBoundingClientRect
      const timelineEl = container.querySelector('.video-trimmer-timeline') as HTMLElement;
      vi.spyOn(timelineEl, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 100,
        right: 1000,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const startHandle = screen.getByTestId('trim-handle-start');

      // Drag start handle past end (clientX = 800px on 30s timeline = 24s > effectiveEnd 10s)
      fireEvent.pointerDown(startHandle, { clientX: 100 });
      fireEvent.pointerMove(timelineEl, { clientX: 800 });
      fireEvent.pointerUp(timelineEl);

      // Clamped to effectiveEnd - 0.25 = 10 - 0.25 = 9.75
      expect(mockTrimChange).toHaveBeenCalledWith(9.75, 10);
    });

    test('Direct VideoTrimmerTimeline: Dragging end handle before start clamps strictly to start + 0.25s', () => {
      const mockTrimChange = vi.fn();
      const mockSeek = vi.fn();
      const mockTogglePlay = vi.fn();
      const audioFile = new File(['a'], 'audio.mp3', { type: 'audio/mpeg' });
      const videoFile = new File(['v'], 'video.mp4', { type: 'video/mp4' });

      const { container } = render(
        <VideoTrimmerTimeline
          audioFile={audioFile}
          attachedVideo={videoFile}
          videoStartTime={15}
          videoEndTime={25}
          onTrimChange={mockTrimChange}
          currentTime={0}
          onSeek={mockSeek}
          isPlaying={false}
          onTogglePlay={mockTogglePlay}
        />
      );

      const timelineEl = container.querySelector('.video-trimmer-timeline') as HTMLElement;
      vi.spyOn(timelineEl, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 100,
        right: 1000,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      const endHandle = screen.getByTestId('trim-handle-end');

      // Drag end handle to clientX = 100px (3s < videoStartTime 15s)
      fireEvent.pointerDown(endHandle, { clientX: 900 });
      fireEvent.pointerMove(timelineEl, { clientX: 100 });
      fireEvent.pointerUp(timelineEl);

      // Clamped to videoStartTime + 0.25 = 15.25
      expect(mockTrimChange).toHaveBeenCalledWith(15, 15.25);
    });

    test('Keyboard navigation boundary tests (Home, End, overshoot with Shift+Arrow)', () => {
      const mockTrimChange = vi.fn();
      const audioFile = new File(['a'], 'audio.mp3', { type: 'audio/mpeg' });
      const videoFile = new File(['v'], 'video.mp4', { type: 'video/mp4' });

      render(
        <VideoTrimmerTimeline
          audioFile={audioFile}
          attachedVideo={videoFile}
          videoStartTime={5}
          videoEndTime={10}
          onTrimChange={mockTrimChange}
          currentTime={0}
          onSeek={vi.fn()}
          isPlaying={false}
          onTogglePlay={vi.fn()}
        />
      );

      const startHandle = screen.getByTestId('trim-handle-start');
      const endHandle = screen.getByTestId('trim-handle-end');

      // Home on start handle -> sets to 0
      fireEvent.keyDown(startHandle, { key: 'Home' });
      expect(mockTrimChange).toHaveBeenCalledWith(0, 10);

      // End on start handle -> sets to effectiveEnd - 0.25 = 9.75
      fireEvent.keyDown(startHandle, { key: 'End' });
      expect(mockTrimChange).toHaveBeenCalledWith(9.75, 10);

      // Home on end handle -> sets to videoStartTime + 0.25 = 5.25
      fireEvent.keyDown(endHandle, { key: 'Home' });
      expect(mockTrimChange).toHaveBeenCalledWith(5, 5.25);
    });

    test('Duration matching badge computes 1:1 match, loop required, and trim to audio correctly', () => {
      const audioFile = new File(['a'], 'audio.mp3', { type: 'audio/mpeg' });
      const videoFile = new File(['v'], 'video.mp4', { type: 'video/mp4' });

      // Case 1: Video trim duration = 30s (audio duration = 30s) -> 1:1 Match
      const { rerender } = render(
        <VideoTrimmerTimeline
          audioFile={audioFile}
          attachedVideo={videoFile}
          videoStartTime={0}
          videoEndTime={30}
          onTrimChange={vi.fn()}
          currentTime={0}
          onSeek={vi.fn()}
          isPlaying={false}
          onTogglePlay={vi.fn()}
        />
      );
      expect(screen.getByTestId('duration-matching-indicator')).toHaveTextContent(/1:1 DURATION MATCH/i);

      // Case 2: Video trim duration = 10s < audio duration 30s -> Loop required
      rerender(
        <VideoTrimmerTimeline
          audioFile={audioFile}
          attachedVideo={videoFile}
          videoStartTime={0}
          videoEndTime={10}
          onTrimChange={vi.fn()}
          currentTime={0}
          onSeek={vi.fn()}
          isPlaying={false}
          onTogglePlay={vi.fn()}
        />
      );
      expect(screen.getByTestId('duration-matching-indicator')).toHaveTextContent(/LOOP REQUIRED/i);

      // Case 3: Video trim duration = 20s with audio duration = 10s -> Will trim to audio
      // (audio duration is set via mock loadedmetadata duration = 30s in default, so trim 30s with trim = 35s or similar)
      rerender(
        <VideoTrimmerTimeline
          audioFile={audioFile}
          attachedVideo={videoFile}
          videoStartTime={0}
          videoEndTime={45}
          onTrimChange={vi.fn()}
          currentTime={0}
          onSeek={vi.fn()}
          isPlaying={false}
          onTogglePlay={vi.fn()}
        />
      );
      expect(screen.getByTestId('duration-matching-indicator')).toHaveTextContent(/WILL TRIM TO AUDIO/i);
    });

    test('Clicking timeline body triggers onSeek with computed timestamp', () => {
      const mockSeek = vi.fn();
      const audioFile = new File(['a'], 'audio.mp3', { type: 'audio/mpeg' });

      const { container } = render(
        <VideoTrimmerTimeline
          audioFile={audioFile}
          attachedVideo={null}
          videoStartTime={0}
          videoEndTime={30}
          onTrimChange={vi.fn()}
          currentTime={0}
          onSeek={mockSeek}
          isPlaying={false}
          onTogglePlay={vi.fn()}
        />
      );

      const timelineEl = container.querySelector('.video-trimmer-timeline') as HTMLElement;
      vi.spyOn(timelineEl, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 1000,
        height: 100,
        right: 1000,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => {},
      });

      // Click at 50% width (500px) -> seek to 15s
      const trackContainer = screen.getByTestId('timeline-audio-track').parentElement as HTMLElement;
      fireEvent.click(trackContainer, { clientX: 500 });

      expect(mockSeek).toHaveBeenCalledWith(15);
    });
  });

  /* ── SECTION 3: Kinetic Backdrop Visualizer & Theme Switching Stress Test ── */
  describe('3. Kinetic Backdrop Visualizer Stress Test', () => {
    test('All 4 themes mount, animate, and clean up without errors', () => {
      const audioFile = new File(['audio'], 'beat.mp3', { type: 'audio/mpeg' });
      const themes: Array<'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave'> = [
        'obsidian_pulse',
        'cyber_bars',
        'nebula_spectrum',
        'minimal_wave',
      ];

      themes.forEach((theme) => {
        const { unmount } = render(
          <KineticBackdropVisualizer
            audioFile={audioFile}
            style={theme}
            isPlaying={true}
            currentTime={5.2}
            accentColor="#FF5A00"
            bgColor="#0A0A0C"
          />
        );

        expect(screen.getByTestId('kinetic-visualizer-canvas')).toBeInTheDocument();
        expect(screen.getByText(`THEME: ${theme.toUpperCase()}`)).toBeInTheDocument();
        unmount();
      });
    });

    test('Rapid theme switching maintains stable canvas animation loop', async () => {
      const audioFile = new File(['audio'], 'beat.mp3', { type: 'audio/mpeg' });
      const { rerender } = render(
        <KineticBackdropVisualizer
          audioFile={audioFile}
          style="obsidian_pulse"
          isPlaying={true}
        />
      );

      // Rapidly rerender across different themes
      rerender(<KineticBackdropVisualizer audioFile={audioFile} style="cyber_bars" isPlaying={true} />);
      rerender(<KineticBackdropVisualizer audioFile={audioFile} style="nebula_spectrum" isPlaying={false} />);
      rerender(<KineticBackdropVisualizer audioFile={audioFile} style="minimal_wave" isPlaying={true} />);
      rerender(<KineticBackdropVisualizer audioFile={audioFile} style="obsidian_pulse" isPlaying={false} />);

      expect(screen.getByTestId('kinetic-visualizer-canvas')).toBeInTheDocument();
    });
  });

  /* ── SECTION 4: Video Attachment Dropzone & Preview Canvas ── */
  describe('4. Video Attachment Dropzone & Preview Canvas', () => {
    test('VideoAttachmentDropzone rejects non-video files on drop', () => {
      const mockAttach = vi.fn();
      const mockToggleVis = vi.fn();

      render(
        <VideoAttachmentDropzone
          attachedVideo={null}
          onAttachVideo={mockAttach}
          useVisualizer={false}
          onToggleVisualizer={mockToggleVis}
        />
      );

      const dropzone = screen.getByTestId('video-dropzone-empty');
      const textFile = new File(['text'], 'notes.txt', { type: 'text/plain' });

      fireEvent.drop(dropzone, {
        dataTransfer: {
          files: [textFile],
        },
      });

      expect(mockAttach).not.toHaveBeenCalled();
    });

    test('VideoPreviewCanvas loops when currentTime exceeds trimEnd', () => {
      const mockTimeUpdate = vi.fn();
      const mockTogglePlay = vi.fn();
      const videoFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

      render(
        <VideoPreviewCanvas
          videoFile={videoFile}
          currentTime={12}
          isPlaying={true}
          trimStart={2}
          trimEnd={10}
          onTimeUpdate={mockTimeUpdate}
          onTogglePlay={mockTogglePlay}
        />
      );

      const videoEl = screen.getByTestId('preview-video-element') as HTMLVideoElement;
      Object.defineProperty(videoEl, 'currentTime', { value: 11, writable: true });

      fireEvent.timeUpdate(videoEl);

      // Should loop back to trimStart (2)
      expect(mockTimeUpdate).toHaveBeenCalledWith(2);
      expect(videoEl.currentTime).toBe(2);
    });

    test('VideoPreviewCanvas mute toggle button switches state', () => {
      const videoFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

      render(
        <VideoPreviewCanvas
          videoFile={videoFile}
          currentTime={0}
          isPlaying={false}
          onTimeUpdate={vi.fn()}
          onTogglePlay={vi.fn()}
        />
      );

      const muteBtn = screen.getByTestId('preview-mute-toggle');
      expect(muteBtn).toHaveTextContent('MUTE VID');

      fireEvent.click(muteBtn);
      expect(muteBtn).toHaveTextContent('UNMUTE VID');
    });
  });

  /* ── SECTION 5: Exhaustive FormData Dispatch Permutations ── */
  describe('5. Exhaustive FormData Dispatch Permutations', () => {
    test('Permutation 1: Audio + Video + MKV + fit-video + Custom Trimming [3.5s -> 18.2s]', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        blob: async () => new Blob(['mkv-data'], { type: 'video/x-matroska' }),
      });

      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      // 1. Load Audio
      const audioInput = screen.getByTestId('file-input');
      const audioFile = new File(['audio-raw'], 'song.flac', { type: 'audio/flac' });
      setFileInputFiles(audioInput, [audioFile]);

      // 2. Select VIDEO Tab & MKV format
      fireEvent.click(screen.getByTestId('tab-video'));
      fireEvent.click(screen.getByTestId('format-mkv'));

      // 3. Attach Companion Video
      const videoInput = await screen.findByTestId('video-file-input');
      const videoFile = new File(['video-raw'], 'scenery.mp4', { type: 'video/mp4' });
      setFileInputFiles(videoInput, [videoFile]);

      // 4. Select Sync Mode 'fit-video'
      const fitVideoBtn = await screen.findByTestId('sync-mode-fit-video');
      fireEvent.click(fitVideoBtn);

      // 5. Initialize Conversion
      const initBtn = screen.getByTestId('initialize-btn');
      fireEvent.click(initBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [url, opts] = mockFetch.mock.calls[0];
        expect(url).toContain('/api/convert');
        const fd = opts.body as FormData;
        expect(fd.get('files') || fd.get('file')).toBeTruthy();
        expect(fd.get('attachedVideo')).toBeTruthy();
        expect(fd.get('outputFormat')).toBe('mkv');
        expect(fd.get('audioSyncMode')).toBe('fit-video');
      });
    });

    test('Permutation 2: Audio without Video (Procedural Visualizer mode with cyber_bars theme)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        blob: async () => new Blob(['mp4-data'], { type: 'video/mp4' }),
      });

      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      // 1. Load Audio
      const audioInput = screen.getByTestId('file-input');
      const audioFile = new File(['audio-raw'], 'synth.wav', { type: 'audio/wav' });
      setFileInputFiles(audioInput, [audioFile]);

      // 2. Select VIDEO Tab & MP4 format
      fireEvent.click(screen.getByTestId('tab-video'));
      fireEvent.click(screen.getByTestId('format-mp4'));

      // 3. Select Theme cyber_bars
      const themeBtn = await screen.findByTestId('theme-cyber_bars');
      fireEvent.click(themeBtn);

      // 4. Click Initialize
      const initBtn = screen.getByTestId('initialize-btn');
      fireEvent.click(initBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, opts] = mockFetch.mock.calls[0];
        const fd = opts.body as FormData;
        expect(fd.get('files') || fd.get('file')).toBeTruthy();
        expect(fd.get('outputFormat')).toBe('mp4');
        expect(fd.get('useVisualizer')).toBe('true');
        expect(fd.get('visualizerStyle')).toBe('cyber_bars');
        expect(fd.get('attachedVideo')).toBeNull();
      });
    });

    test('Permutation 3: Audio + Video + GIF format with custom FPS and palette options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        blob: async () => new Blob(['gif-data'], { type: 'image/gif' }),
      });

      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const audioInput = screen.getByTestId('file-input');
      setFileInputFiles(audioInput, [new File(['a'], 'sound.mp3', { type: 'audio/mpeg' })]);

      fireEvent.click(screen.getByTestId('tab-video'));
      fireEvent.click(screen.getByTestId('format-gif'));

      const initBtn = screen.getByTestId('initialize-btn');
      fireEvent.click(initBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, opts] = mockFetch.mock.calls[0];
        const fd = opts.body as FormData;
        expect(fd.get('outputFormat')).toBe('gif');
        expect(fd.get('gifFps')).not.toBeNull();
        expect(fd.get('gifPalette')).not.toBeNull();
      });
    });

    test('Permutation 4: loop-video sync mode correctly serializes videoLoop as true', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'content-type': 'application/octet-stream' }),
        blob: async () => new Blob(['mp4-data'], { type: 'video/mp4' }),
      });

      render(<GlobalJobProvider><UniversalConverter /></GlobalJobProvider>);

      const audioInput = screen.getByTestId('file-input');
      setFileInputFiles(audioInput, [new File(['a'], 'loop.mp3', { type: 'audio/mpeg' })]);

      fireEvent.click(screen.getByTestId('tab-video'));
      fireEvent.click(screen.getByTestId('format-webm'));

      const videoInput = await screen.findByTestId('video-file-input');
      setFileInputFiles(videoInput, [new File(['v'], 'short_clip.mp4', { type: 'video/mp4' })]);

      const loopBtn = await screen.findByTestId('sync-mode-loop-video');
      fireEvent.click(loopBtn);

      const initBtn = screen.getByTestId('initialize-btn');
      fireEvent.click(initBtn);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        const [, opts] = mockFetch.mock.calls[0];
        const fd = opts.body as FormData;
        expect(fd.get('videoLoop')).toBe('true');
        expect(fd.get('audioSyncMode')).toBe('loop-video');
        expect(fd.get('outputFormat')).toBe('webm');
      });
    });
  });
});

