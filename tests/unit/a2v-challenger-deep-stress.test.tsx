/**
 * tests/unit/a2v-challenger-deep-stress.test.tsx
 *
 * Deep Adversarial Challenger Test Suite:
 * - Ultra-extreme Floating Point timecodes & Edge cases
 * - High-frequency rapid drag simulation & violent handle collision attacks
 * - Boundary invariants: start <= end - 0.25, end >= start + 0.25, start >= 0, end <= duration
 * - Visualizer canvas stress & rapid unmount / lifecycle resource leak prevention
 */

import React, { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatTimecode, VideoTrimmerTimeline } from '../../src/app/tools/converter/components/VideoTrimmerTimeline';
import { KineticBackdropVisualizer } from '../../src/app/tools/converter/components/KineticBackdropVisualizer';

// Mock WaveformEngine
vi.mock('../../src/app/components/waveform/WaveformEngine', () => ({
  generateWaveform: vi.fn().mockResolvedValue({
    left: new Float32Array(100).fill(0.5),
    right: new Float32Array(100).fill(0.5),
  }),
}));

// Mock Canvas 2D
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

describe('Challenger Deep Adversarial Stress Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  /* ─────────────────────────────────────────────────────────────────────────
     1. Ultra-Extreme Floating-Point Timecode Calculations
  ───────────────────────────────────────────────────────────────────────── */
  describe('1. Ultra-Extreme Floating-Point Timecode Calculations', () => {
    test('Handles sub-millisecond precision, epsilon boundaries, and floating-point roundings', () => {
      // 0.0001s -> '00:00.00'
      expect(formatTimecode(0.0001)).toBe('00:00.00');
      // 0.009s -> '00:00.00' (centisecond truncation)
      expect(formatTimecode(0.009)).toBe('00:00.00');
      // 0.010s -> '00:00.01'
      expect(formatTimecode(0.010)).toBe('00:00.01');
      // 0.0999s -> '00:00.09' (centisecond floor)
      expect(formatTimecode(0.0999)).toBe('00:00.09');
      // 0.9999s -> '00:00.99'
      expect(formatTimecode(0.9999)).toBe('00:00.99');
      // 59.999s -> '00:59.99'
      expect(formatTimecode(59.999)).toBe('00:59.99');
    });

    test('Handles classic IEEE-754 problematic floats without off-by-one centisecond errors', () => {
      // 1.09, 2.09, 3.09 ... 10.09
      for (let i = 0; i <= 20; i++) {
        const val = i + 0.09;
        const expectedCs = '09';
        const expectedSec = (i % 60).toString().padStart(2, '0');
        const expectedMin = Math.floor(i / 60).toString().padStart(2, '0');
        expect(formatTimecode(val)).toBe(`${expectedMin}:${expectedSec}.${expectedCs}`);
      }

      // 0.29, 0.58, 0.87
      expect(formatTimecode(0.29)).toBe('00:00.29');
      expect(formatTimecode(0.58)).toBe('00:00.58');
      expect(formatTimecode(0.87)).toBe('00:00.87');
    });

    test('Handles multi-hour and massive duration timestamps without overflow', () => {
      // 1 hour: 3600s
      expect(formatTimecode(3600)).toBe('60:00.00');
      // 24 hours: 86400s -> 1440 minutes
      expect(formatTimecode(86400)).toBe('1440:00.00');
      // 100 hours + 30.5s: 360030.5s -> 6000:30.50
      expect(formatTimecode(360030.5)).toBe('6000:30.50');
    });

    test('Handles non-numeric, negative, and invalid values gracefully', () => {
      expect(formatTimecode(-0)).toBe('00:00.00');
      expect(formatTimecode(-123.456)).toBe('00:00.00');
      expect(formatTimecode(Number.MIN_VALUE)).toBe('00:00.00');
      expect(formatTimecode(NaN)).toBe('00:00.00');
    });
  });

  /* ─────────────────────────────────────────────────────────────────────────
     2. Violent Handle Dragging, Rapid Collision & Invariant Verification
  ───────────────────────────────────────────────────────────────────────── */
  describe('2. Violent Handle Dragging & Boundary Collision Invariants', () => {
    const mockAudioFile = new File(['mock audio'], 'audio.mp3', { type: 'audio/mpeg' });
    const mockVideoFile = new File(['mock video'], 'video.mp4', { type: 'video/mp4' });

    test('Violent drag right: start handle dragged past end handle must clamp to (end - 0.25)', () => {
      const mockTrimChange = vi.fn();
      const { container } = render(
        <VideoTrimmerTimeline
          audioFile={mockAudioFile}
          attachedVideo={mockVideoFile}
          videoStartTime={2.0}
          videoEndTime={10.0}
          onTrimChange={mockTrimChange}
          currentTime={0}
          onSeek={vi.fn()}
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

      const startHandle = screen.getByTestId('trim-handle-start');

      // Start drag at x=50px (1.5s)
      fireEvent.pointerDown(startHandle, { clientX: 50, pointerId: 1 });

      // High frequency rapid drag sequence past end (10s = 333.3px on 30s timeline)
      const dragPositions = [200, 300, 333, 400, 600, 900, 1000, 1500, 5000];
      for (const pos of dragPositions) {
        fireEvent.pointerMove(timelineEl, { clientX: pos, pointerId: 1 });
      }
      fireEvent.pointerUp(timelineEl, { pointerId: 1 });

      // For all calls where clientX exceeded effectiveEnd (10s), start must be clamped to 9.75
      const lastCall = mockTrimChange.mock.calls[mockTrimChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe(9.75); // start = effectiveEnd - 0.25
      expect(lastCall[1]).toBe(10.0); // end = 10.0
      expect(lastCall[1] - lastCall[0]).toBeCloseTo(0.25, 2);
    });

    test('Violent drag left: end handle dragged before start handle must clamp to (start + 0.25)', () => {
      const mockTrimChange = vi.fn();
      const { container } = render(
        <VideoTrimmerTimeline
          audioFile={mockAudioFile}
          attachedVideo={mockVideoFile}
          videoStartTime={12.0}
          videoEndTime={25.0}
          onTrimChange={mockTrimChange}
          currentTime={0}
          onSeek={vi.fn()}
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

      const endHandle = screen.getByTestId('trim-handle-end');

      fireEvent.pointerDown(endHandle, { clientX: 800, pointerId: 1 });

      // High frequency rapid drag left past start (12s = 400px on 30s timeline)
      const dragPositions = [600, 450, 400, 300, 100, 0, -500, -2000];
      for (const pos of dragPositions) {
        fireEvent.pointerMove(timelineEl, { clientX: pos, pointerId: 1 });
      }
      fireEvent.pointerUp(timelineEl, { pointerId: 1 });

      const lastCall = mockTrimChange.mock.calls[mockTrimChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe(12.0); // start = 12.0
      expect(lastCall[1]).toBe(12.25); // end = start + 0.25
      expect(lastCall[1] - lastCall[0]).toBeCloseTo(0.25, 2);
    });

    test('Inverted initial props (start >= end) are clamped safely upon interaction', () => {
      const mockTrimChange = vi.fn();
      const { container } = render(
        <VideoTrimmerTimeline
          audioFile={mockAudioFile}
          attachedVideo={mockVideoFile}
          videoStartTime={15.0}
          videoEndTime={15.0} // Collided zero-width interval
          onTrimChange={mockTrimChange}
          currentTime={0}
          onSeek={vi.fn()}
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

      const startHandle = screen.getByTestId('trim-handle-start');
      fireEvent.pointerDown(startHandle, { clientX: 500, pointerId: 1 });
      fireEvent.pointerMove(timelineEl, { clientX: 550, pointerId: 1 });
      fireEvent.pointerUp(timelineEl, { pointerId: 1 });

      // start must be clamped to 15.0 - 0.25 = 14.75
      const lastCall = mockTrimChange.mock.calls[mockTrimChange.mock.calls.length - 1];
      expect(lastCall[0]).toBe(14.75);
      expect(lastCall[1]).toBe(15.0);
    });
  });

  /* ─────────────────────────────────────────────────────────────────────────
     3. Visualizer Canvas Animation Loop Stress & Lifecycle Cleanup
  ───────────────────────────────────────────────────────────────────────── */
  describe('3. Visualizer Canvas Animation Loop Stress & Lifecycle Cleanup', () => {
    const mockAudioFile = new File(['mock audio'], 'track.mp3', { type: 'audio/mpeg' });

    test('Rapid theme switching loop (100 switches) does not create dangling RAF loops or memory leaks', () => {
      let activeRAF = 0;
      const originalRAF = window.requestAnimationFrame;
      const originalCAF = window.cancelAnimationFrame;

      window.requestAnimationFrame = vi.fn().mockImplementation(() => {
        activeRAF++;
        return activeRAF;
      });

      window.cancelAnimationFrame = vi.fn().mockImplementation(() => {
        activeRAF--;
      });

      const themes: Array<'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave'> = [
        'obsidian_pulse',
        'cyber_bars',
        'nebula_spectrum',
        'minimal_wave',
      ];

      const { rerender, unmount } = render(
        <KineticBackdropVisualizer
          audioFile={mockAudioFile}
          style="obsidian_pulse"
          isPlaying={true}
        />
      );

      for (let i = 0; i < 100; i++) {
        const nextTheme = themes[i % themes.length];
        rerender(
          <KineticBackdropVisualizer
            audioFile={mockAudioFile}
            style={nextTheme}
            isPlaying={i % 2 === 0}
          />
        );
      }

      unmount();

      // After unmount, exactly zero dangling animation frame requests remain active
      expect(activeRAF).toBe(0);

      window.requestAnimationFrame = originalRAF;
      window.cancelAnimationFrame = originalCAF;
    });

    test('Zero dimension canvas (hidden or collapsed container) does not throw or crash renderer', () => {
      const { unmount } = render(
        <KineticBackdropVisualizer
          audioFile={mockAudioFile}
          style="obsidian_pulse"
          isPlaying={true}
        />
      );

      const canvas = screen.getByTestId('kinetic-visualizer-canvas');
      Object.defineProperty(canvas, 'clientWidth', { value: 0, configurable: true });
      Object.defineProperty(canvas, 'clientHeight', { value: 0, configurable: true });

      // Trigger frame render without exception
      expect(() => {
        render(
          <KineticBackdropVisualizer
            audioFile={mockAudioFile}
            style="nebula_spectrum"
            isPlaying={true}
          />
        );
      }).not.toThrow();

      unmount();
    });
  });
});
