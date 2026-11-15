/**
 * tests/unit/a2v-challenger-m1-m2.test.tsx
 *
 * Empirical Challenger Test Suite for Milestones M1 & M2
 * 1. Mathematical precision of timecode formatting (formatTimecode)
 * 2. Waveform downsampling algorithm in WaveformEngine.ts & VideoTrimmerTimeline.tsx
 * 3. WAI-ARIA slider value assertions & complete keyboard event navigation
 * 4. Kinetic visualizer canvas rendering loop lifecycle & mid-animation unmount resilience
 */

import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimecode, VideoTrimmerTimeline } from '../../app/tools/converter/components/VideoTrimmerTimeline';
import { KineticBackdropVisualizer } from '../../app/tools/converter/components/KineticBackdropVisualizer';
import { generateWaveform } from '../../app/components/waveform/WaveformEngine';

// ── Mock WaveformEngine for Timeline tests ──
vi.mock('../../app/components/waveform/WaveformEngine', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    generateWaveform: vi.fn().mockImplementation((buf: ArrayBuffer, windowSize: number, ctx?: AudioContext) => {
      // If ctx is provided, use real compute logic
      if (ctx) {
        return actual.generateWaveform(buf, windowSize, ctx);
      }
      return Promise.resolve({
        left: new Float32Array(100).fill(0.5),
        right: new Float32Array(100).fill(0.5),
      });
    }),
  };
});

// Mock Canvas 2D Context
const mockCtx = {
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
  shadowBlur: 0,
  shadowColor: '',
};

HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((id: string) => {
  if (id === '2d') return mockCtx;
  return null;
});

describe('Milestones M1 & M2 Empirical Challenge Suite', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // =========================================================================
  // SECTION 1: Mathematical Precision of formatTimecode Helper
  // =========================================================================
  describe('1. Mathematical Precision of formatTimecode', () => {

    test('1.1 Base Cases: Zero, Negative, and NaN Values', () => {
      expect(formatTimecode(0)).toBe('00:00.00');
      expect(formatTimecode(-0.01)).toBe('00:00.00');
      expect(formatTimecode(-5)).toBe('00:00.00');
      expect(formatTimecode(-99999)).toBe('00:00.00');
      expect(formatTimecode(NaN)).toBe('00:00.00');
      expect(formatTimecode(Number.NaN)).toBe('00:00.00');
      expect(formatTimecode(null as unknown as number)).toBe('00:00.00');
      expect(formatTimecode(undefined as unknown as number)).toBe('00:00.00');
    });

    test('1.2 Standard Durations: Sub-minute, Minutes, and Exact Boundaries', () => {
      expect(formatTimecode(0.5)).toBe('00:00.50');
      expect(formatTimecode(5.25)).toBe('00:05.25');
      expect(formatTimecode(10.0)).toBe('00:10.00');
      expect(formatTimecode(59.0)).toBe('00:59.00');
      expect(formatTimecode(60.0)).toBe('01:00.00');
      expect(formatTimecode(65.75)).toBe('01:05.75');
      expect(formatTimecode(599.99)).toBe('09:59.99');
    });

    test('1.3 Multi-Hour Durations without Numeric Breakdown or NaN', () => {
      // 1 hour = 3600s -> 60:00.00
      expect(formatTimecode(3600)).toBe('60:00.00');
      // 1 hour 1 minute 5 seconds = 3665.42s -> 61:05.42
      expect(formatTimecode(3665.42)).toBe('61:05.42');
      // 2 hours = 7200s -> 120:00.00
      expect(formatTimecode(7200)).toBe('120:00.00');
      // 10 hours = 36000s -> 600:00.00
      expect(formatTimecode(36000)).toBe('600:00.00');
      // 100 hours = 360000s -> 6000:00.00
      expect(formatTimecode(360000)).toBe('6000:00.00');
    });

    test('1.4 Fractional Sub-Second Precision & Floating-Point Floor Truncation Analysis', () => {
      // 0.25s -> 00:00.25
      expect(formatTimecode(0.25)).toBe('00:00.25');
      // 0.75s -> 00:00.75
      expect(formatTimecode(0.75)).toBe('00:00.75');
      // 0.01s -> 00:00.01
      expect(formatTimecode(0.01)).toBe('00:00.01');
      // 0.001s (sub-millisecond) -> 00:00.00
      expect(formatTimecode(0.001)).toBe('00:00.00');
      
      // RESOLVED: Floating-point precision in JS handled with epsilon offset:
      // 9.09 -> '00:09.09'
      // 0.29 -> '00:00.29'
      // 0.58 -> '00:00.58'
      // 125.10 -> '02:05.10'
      expect(formatTimecode(9.09)).toBe('00:09.09');
      expect(formatTimecode(0.29)).toBe('00:00.29');
      expect(formatTimecode(0.58)).toBe('00:00.58');
      expect(formatTimecode(125.10)).toBe('02:05.10');

      // Micro-seconds 0.999s -> 00:00.99
      expect(formatTimecode(0.999)).toBe('00:00.99');
    });

    test('1.5 Extreme Values: Infinity behavior', () => {
      // In JS, isFinite(Infinity) is false, but isNaN(Infinity) is false.
      // Math.floor(Infinity / 60) -> Infinity, Infinity % 60 -> NaN.
      const infResult = formatTimecode(Infinity);
      expect(infResult).toBe('Infinity:NaN.NaN');
    });
  });

  // =========================================================================
  // SECTION 2: Waveform Downsampling Algorithm Verification
  // =========================================================================
  describe('2. Waveform Downsampling Algorithm (WaveformEngine.ts & Timeline)', () => {

    function makeMockAudioBuffer(channels: Float32Array[]): AudioBuffer {
      return {
        numberOfChannels: channels.length,
        length: channels[0]?.length ?? 0,
        sampleRate: 44100,
        duration: (channels[0]?.length ?? 0) / 44100,
        getChannelData(n: number): Float32Array {
          return channels[n] ?? new Float32Array(0);
        },
        copyFromChannel: vi.fn(),
        copyToChannel: vi.fn(),
      } as unknown as AudioBuffer;
    }

    function makeMockContext(buf: AudioBuffer) {
      return {
        decodeAudioData: (_data: ArrayBuffer) => Promise.resolve(buf),
      } as unknown as AudioContext;
    }

    test('2.1 Empty Audio Buffer (0 samples) downsampling resilience', async () => {
      const emptyBuf = makeMockAudioBuffer([new Float32Array(0)]);
      const ctx = makeMockContext(emptyBuf);

      const result = await generateWaveform(new ArrayBuffer(0), 800, ctx);
      expect(result.left).toBeInstanceOf(Float32Array);
      expect(result.left.length).toBe(0);
      expect(result.right).toBeUndefined();
    });

    test('2.2 Buffer length strictly smaller than window size (10 samples, window 800)', async () => {
      const smallData = new Float32Array(10).fill(0.6);
      const buf = makeMockAudioBuffer([smallData]);
      const ctx = makeMockContext(buf);

      const result = await generateWaveform(new ArrayBuffer(10), 800, ctx);
      expect(result.left.length).toBe(1);
      expect(result.left[0]).toBeCloseTo(1.0, 4); // normalized max to 1.0
    });

    test('2.3 Non-divisible sample lengths (1000 samples, window 800 -> 2 windows)', async () => {
      // First 800 samples = 0.5, last 200 samples = 1.0
      const data = new Float32Array(1000);
      data.fill(0.5, 0, 800);
      data.fill(1.0, 800, 1000);
      const buf = makeMockAudioBuffer([data]);
      const ctx = makeMockContext(buf);

      const result = await generateWaveform(new ArrayBuffer(1000), 800, ctx);
      expect(result.left.length).toBe(2);
      expect(result.left[0]).toBeCloseTo(0.5, 4);
      expect(result.left[1]).toBeCloseTo(1.0, 4);
    });

    test('2.4 High Sample Count Downsampling (44,100 * 60 = 2,646,000 samples for 1-minute audio)', async () => {
      const sampleCount = 44100 * 60;
      const windowSize = 800;
      const expectedWindows = Math.ceil(sampleCount / windowSize); // 3308 windows
      
      const data = new Float32Array(sampleCount);
      // Alternate blocks of high and low amplitude
      for (let i = 0; i < sampleCount; i++) {
        data[i] = Math.sin(i / 100) * 0.8;
      }
      const buf = makeMockAudioBuffer([data]);
      const ctx = makeMockContext(buf);

      const result = await generateWaveform(new ArrayBuffer(16), windowSize, ctx);
      expect(result.left.length).toBe(expectedWindows);
      
      // All values must be bounded in [0, 1] without NaN or Infinity
      for (let i = 0; i < result.left.length; i++) {
        expect(result.left[i]).toBeGreaterThanOrEqual(0);
        expect(result.left[i]).toBeLessThanOrEqual(1.0001);
        expect(Number.isNaN(result.left[i])).toBe(false);
      }
    });

    test('2.5 Stereo Asymmetric Amplitude Normalization across channels', async () => {
      // Left channel has peak 0.5, Right channel has peak 1.0
      const leftData = new Float32Array(800).fill(0.5);
      const rightData = new Float32Array(800).fill(1.0);
      const buf = makeMockAudioBuffer([leftData, rightData]);
      const ctx = makeMockContext(buf);

      const result = await generateWaveform(new ArrayBuffer(800), 800, ctx);
      expect(result.right).toBeDefined();
      expect(result.left[0]).toBeCloseTo(0.5, 4);
      expect(result.right![0]).toBeCloseTo(1.0, 4);
    });

    test('2.6 Silent Audio (All zeros) avoids zero-division and produces clean 0.0', async () => {
      const silentData = new Float32Array(1600).fill(0.0);
      const buf = makeMockAudioBuffer([silentData]);
      const ctx = makeMockContext(buf);

      const result = await generateWaveform(new ArrayBuffer(1600), 800, ctx);
      expect(result.left.length).toBe(2);
      expect(result.left[0]).toBe(0);
      expect(result.left[1]).toBe(0);
    });
  });

  // =========================================================================
  // SECTION 3: WAI-ARIA Slider Value Assertions & Complete Keyboard Navigation
  // =========================================================================
  describe('3. WAI-ARIA Slider Attributes & Keyboard Event Navigation', () => {

    const mockAudioFile = new File(['mock audio'], 'audio.mp3', { type: 'audio/mpeg' });
    const mockVideoFile = new File(['mock video'], 'video.mp4', { type: 'video/mp4' });

    function InteractiveTrimmerWrapper({ initialStart = 0, initialEnd = 30 }: { initialStart?: number; initialEnd?: number }) {
      const [start, setStart] = useState(initialStart);
      const [end, setEnd] = useState(initialEnd);
      const [currentTime, setCurrentTime] = useState(0);
      const [isPlaying, setIsPlaying] = useState(false);

      return (
        <VideoTrimmerTimeline
          audioFile={mockAudioFile}
          attachedVideo={mockVideoFile}
          videoStartTime={start}
          videoEndTime={end}
          onTrimChange={(s, e) => {
            setStart(s);
            setEnd(e);
          }}
          currentTime={currentTime}
          onSeek={setCurrentTime}
          isPlaying={isPlaying}
          onTogglePlay={() => setIsPlaying(!isPlaying)}
        />
      );
    }

    test('3.1 WAI-ARIA Slider Role and Attribute Conformance', () => {
      render(<InteractiveTrimmerWrapper initialStart={2.5} initialEnd={12.0} />);

      const startSlider = screen.getByTestId('trim-handle-start');
      const endSlider = screen.getByTestId('trim-handle-end');

      expect(startSlider).toHaveAttribute('role', 'slider');
      expect(startSlider).toHaveAttribute('tabindex', '0');
      expect(startSlider).toHaveAttribute('aria-label', 'Video Trim Start Time');
      expect(startSlider).toHaveAttribute('aria-valuenow', '2.5');
      expect(startSlider).toHaveAttribute('aria-valuemin', '0');
      expect(startSlider).toHaveAttribute('aria-valuemax', '12');

      expect(endSlider).toHaveAttribute('role', 'slider');
      expect(endSlider).toHaveAttribute('tabindex', '0');
      expect(endSlider).toHaveAttribute('aria-label', 'Video Trim End Time');
      expect(endSlider).toHaveAttribute('aria-valuenow', '12');
      expect(endSlider).toHaveAttribute('aria-valuemin', '2.5');
      expect(endSlider).toHaveAttribute('aria-valuemax', '30');
    });

    test('3.2 Start Handle Keyboard Navigation: ArrowRight, ArrowUp, ArrowLeft, ArrowDown, Shift Keys', () => {
      render(<InteractiveTrimmerWrapper initialStart={2.0} initialEnd={10.0} />);
      const startSlider = screen.getByTestId('trim-handle-start');

      // ArrowRight (+0.1s)
      fireEvent.keyDown(startSlider, { key: 'ArrowRight' });
      expect(startSlider).toHaveAttribute('aria-valuenow', '2.1');

      // ArrowUp (+0.1s)
      fireEvent.keyDown(startSlider, { key: 'ArrowUp' });
      expect(startSlider).toHaveAttribute('aria-valuenow', '2.2');

      // Shift+ArrowRight (+1.0s)
      fireEvent.keyDown(startSlider, { key: 'ArrowRight', shiftKey: true });
      expect(startSlider).toHaveAttribute('aria-valuenow', '3.2');

      // Shift+ArrowUp (+1.0s)
      fireEvent.keyDown(startSlider, { key: 'ArrowUp', shiftKey: true });
      expect(startSlider).toHaveAttribute('aria-valuenow', '4.2');

      // ArrowLeft (-0.1s)
      fireEvent.keyDown(startSlider, { key: 'ArrowLeft' });
      expect(startSlider).toHaveAttribute('aria-valuenow', '4.1');

      // ArrowDown (-0.1s)
      fireEvent.keyDown(startSlider, { key: 'ArrowDown' });
      expect(startSlider).toHaveAttribute('aria-valuenow', '4');

      // Shift+ArrowLeft (-1.0s)
      fireEvent.keyDown(startSlider, { key: 'ArrowLeft', shiftKey: true });
      expect(startSlider).toHaveAttribute('aria-valuenow', '3');

      // Shift+ArrowDown (-1.0s)
      fireEvent.keyDown(startSlider, { key: 'ArrowDown', shiftKey: true });
      expect(startSlider).toHaveAttribute('aria-valuenow', '2');
    });

    test('3.3 Start Handle Boundary Clamping (Min=0, Max=effectiveEnd - 0.25)', () => {
      render(<InteractiveTrimmerWrapper initialStart={0.2} initialEnd={2.0} />);
      const startSlider = screen.getByTestId('trim-handle-start');

      // Nudge left past 0 -> should clamp strictly to 0
      fireEvent.keyDown(startSlider, { key: 'ArrowLeft', shiftKey: true });
      expect(startSlider).toHaveAttribute('aria-valuenow', '0');

      // Home key -> jumps to 0
      fireEvent.keyDown(startSlider, { key: 'Home' });
      expect(startSlider).toHaveAttribute('aria-valuenow', '0');

      // End key -> jumps to effectiveEnd - 0.25 (2.0 - 0.25 = 1.75)
      fireEvent.keyDown(startSlider, { key: 'End' });
      expect(startSlider).toHaveAttribute('aria-valuenow', '1.75');

      // Attempt to nudge right past end - 0.25
      fireEvent.keyDown(startSlider, { key: 'ArrowRight' });
      expect(startSlider).toHaveAttribute('aria-valuenow', '1.75');
    });

    test('3.4 End Handle Keyboard Navigation: Arrow Keys, Shift, Home, End & Collision Clamping', () => {
      render(<InteractiveTrimmerWrapper initialStart={5.0} initialEnd={20.0} />);
      const endSlider = screen.getByTestId('trim-handle-end');

      // ArrowRight (+0.1s) -> 20.1
      fireEvent.keyDown(endSlider, { key: 'ArrowRight' });
      expect(endSlider).toHaveAttribute('aria-valuenow', '20.1');

      // Shift+ArrowRight (+1.0s) -> 21.1
      fireEvent.keyDown(endSlider, { key: 'ArrowRight', shiftKey: true });
      expect(endSlider).toHaveAttribute('aria-valuenow', '21.1');

      // ArrowLeft (-0.1s) -> 21
      fireEvent.keyDown(endSlider, { key: 'ArrowLeft' });
      expect(endSlider).toHaveAttribute('aria-valuenow', '21');

      // Shift+ArrowLeft (-1.0s) -> 20
      fireEvent.keyDown(endSlider, { key: 'ArrowLeft', shiftKey: true });
      expect(endSlider).toHaveAttribute('aria-valuenow', '20');

      // End key -> jumps to videoDuration (30)
      fireEvent.keyDown(endSlider, { key: 'End' });
      expect(endSlider).toHaveAttribute('aria-valuenow', '30');

      // Attempt to nudge past videoDuration (30)
      fireEvent.keyDown(endSlider, { key: 'ArrowRight', shiftKey: true });
      expect(endSlider).toHaveAttribute('aria-valuenow', '30');

      // Home key -> jumps to videoStartTime + 0.25 (5.0 + 0.25 = 5.25)
      fireEvent.keyDown(endSlider, { key: 'Home' });
      expect(endSlider).toHaveAttribute('aria-valuenow', '5.25');

      // Attempt to nudge left past start + 0.25
      fireEvent.keyDown(endSlider, { key: 'ArrowLeft' });
      expect(endSlider).toHaveAttribute('aria-valuenow', '5.25');
    });
  });

  // =========================================================================
  // SECTION 4: Visualizer Canvas Rendering Loop Resilience on Unmount
  // =========================================================================
  describe('4. Visualizer Canvas Rendering Loop Resilience & Mid-Animation Unmount', () => {

    const mockAudioFile = new File(['mock audio'], 'song.mp3', { type: 'audio/mpeg' });

    test('4.1 Visualizer starts requestAnimationFrame loop and cancels it cleanly on unmount', () => {
      const originalRAF = window.requestAnimationFrame;
      const originalCAF = window.cancelAnimationFrame;

      let rafCount = 0;
      let cafCount = 0;
      let lastId = 100;

      window.requestAnimationFrame = vi.fn().mockImplementation((_cb) => {
        rafCount++;
        return ++lastId;
      });

      window.cancelAnimationFrame = vi.fn().mockImplementation((_id) => {
        cafCount++;
      });

      const { unmount } = render(
        <KineticBackdropVisualizer
          audioFile={mockAudioFile}
          style="obsidian_pulse"
          isPlaying={true}
        />
      );

      expect(rafCount).toBeGreaterThan(0);
      expect(screen.getByTestId('kinetic-visualizer-canvas')).toBeInTheDocument();

      // Unmount mid-animation
      unmount();

      expect(cafCount).toBeGreaterThan(0);

      window.requestAnimationFrame = originalRAF;
      window.cancelAnimationFrame = originalCAF;
    });

    test('4.2 Stress-testing all 4 visualizer themes rendering without unhandled canvas errors', () => {
      const themes: Array<'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave'> = [
        'obsidian_pulse',
        'cyber_bars',
        'nebula_spectrum',
        'minimal_wave',
      ];

      for (const theme of themes) {
        const { unmount } = render(
          <KineticBackdropVisualizer
            audioFile={mockAudioFile}
            style={theme}
            isPlaying={true}
          />
        );

        expect(screen.getByText(`THEME: ${theme.toUpperCase()}`)).toBeInTheDocument();
        unmount();
      }
    });

    test('4.3 Rapid mount/unmount thrashing (50 consecutive lifecycle cycles)', () => {
      for (let i = 0; i < 50; i++) {
        const { unmount } = render(
          <KineticBackdropVisualizer
            audioFile={mockAudioFile}
            style={i % 2 === 0 ? 'cyber_bars' : 'nebula_spectrum'}
            isPlaying={i % 3 === 0}
          />
        );
        unmount();
      }
      expect(true).toBe(true);
    });

    test('4.4 Resilience when CanvasRenderingContext2D is null (headless environment fallback)', () => {
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);

      // Should not throw exception
      expect(() => {
        const { unmount } = render(
          <KineticBackdropVisualizer
            audioFile={mockAudioFile}
            style="obsidian_pulse"
            isPlaying={true}
          />
        );
        unmount();
      }).not.toThrow();

      HTMLCanvasElement.prototype.getContext = originalGetContext;
    });
  });
});
