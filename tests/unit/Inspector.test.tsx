import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, describe, test, vi, beforeEach } from 'vitest';
import { ResizableOptionsPanel } from '../../app/components/ui/ResizableOptionsPanel';
import { MasterGlassCard } from '../../app/components/ui/MasterGlassCard';
import { decideStrategy, buildStrategyArgs } from '../../lib/remuxDecision';
import { getClientHardwareProfile } from '../../lib/hardwareProfiler';

describe('Media Inspector & Inspection UI Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Resizable Options Panel UI Component ───────────────────────────────
  describe('1. ResizableOptionsPanel Interactive Inspection', () => {
    test('renders panel title, children, and ARIA separator attributes', () => {
      render(
        <ResizableOptionsPanel title="TOOLBOX // CONFIG" defaultWidth={400} minWidth={250} maxWidth={600}>
          <div data-testid="child-content">Active Settings</div>
        </ResizableOptionsPanel>
      );

      expect(screen.getByText('TOOLBOX // CONFIG')).toBeInTheDocument();
      expect(screen.getByTestId('child-content')).toBeInTheDocument();

      const separator = screen.getByRole('separator');
      expect(separator).toBeInTheDocument();
      expect(separator).toHaveAttribute('aria-orientation', 'vertical');
      expect(separator).toHaveAttribute('aria-valuenow', '400');
      expect(separator).toHaveAttribute('aria-valuemin', '250');
      expect(separator).toHaveAttribute('aria-valuemax', '600');
    });

    test('resizes width on mouse drag and clamps within minWidth and maxWidth bounds', () => {
      render(
        <ResizableOptionsPanel title="RESIZE TEST" defaultWidth={350} minWidth={200} maxWidth={500} testId="test-panel">
          <div>Options</div>
        </ResizableOptionsPanel>
      );

      const handle = screen.getByTestId('toolbox-resize-handle');

      // Drag expanding leftward (startX = 500, move to clientX = 400 -> delta = +100px -> newWidth = 450px)
      fireEvent.mouseDown(handle, { clientX: 500 });
      fireEvent.mouseMove(window, { clientX: 400 });
      fireEvent.mouseUp(window);

      const panel = screen.getByTestId('test-panel');
      expect(panel.style.width).toBe('450px');

      // Drag exceeding maxWidth (startX = 450, move to clientX = 100 -> delta = +350px -> clamped at maxWidth 500px)
      fireEvent.mouseDown(handle, { clientX: 450 });
      fireEvent.mouseMove(window, { clientX: 100 });
      fireEvent.mouseUp(window);

      expect(panel.style.width).toBe('500px');

      // Drag below minWidth (startX = 500, move to clientX = 900 -> delta = -400px -> clamped at minWidth 200px)
      fireEvent.mouseDown(handle, { clientX: 500 });
      fireEvent.mouseMove(window, { clientX: 900 });
      fireEvent.mouseUp(window);

      expect(panel.style.width).toBe('200px');
    });

    test('handles touch drag events smoothly', () => {
      render(
        <ResizableOptionsPanel title="TOUCH TEST" defaultWidth={300} minWidth={200} maxWidth={500} testId="touch-panel">
          <div>Touch Content</div>
        </ResizableOptionsPanel>
      );

      const handle = screen.getByTestId('toolbox-resize-handle');

      fireEvent.touchStart(handle, { touches: [{ clientX: 400 }] });
      fireEvent.touchMove(window, { touches: [{ clientX: 350 }] });
      fireEvent.touchEnd(window);

      const panel = screen.getByTestId('touch-panel');
      expect(panel.style.width).toBe('350px');
    });
  });

  // ── 2. Master Glass Card Component ────────────────────────────────────────
  describe('2. MasterGlassCard Visual Styling & Spotlight', () => {
    test('renders card content with specular border and surface variants', () => {
      const { rerender } = render(
        <MasterGlassCard variant="surface1" testId="glass-card">
          <span>Surface 1 Content</span>
        </MasterGlassCard>
      );

      const card = screen.getByTestId('glass-card');
      expect(card).toBeInTheDocument();
      expect(screen.getByText('Surface 1 Content')).toBeInTheDocument();

      rerender(
        <MasterGlassCard variant="surface3" testId="glass-card">
          <span>Surface 3 Content</span>
        </MasterGlassCard>
      );
      expect(screen.getByText('Surface 3 Content')).toBeInTheDocument();
    });

    test('tracks mouse movement for dynamic spotlight glow without crashing', () => {
      render(
        <MasterGlassCard enableSpotlight={true} testId="spotlight-card">
          <span>Hover Target</span>
        </MasterGlassCard>
      );

      const card = screen.getByTestId('spotlight-card');
      vi.spyOn(card, 'getBoundingClientRect').mockReturnValue({
        left: 10,
        top: 20,
        right: 310,
        bottom: 220,
        width: 300,
        height: 200,
        x: 10,
        y: 20,
        toJSON: () => ({}),
      });
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

      fireEvent.pointerEnter(card, { clientX: 60, clientY: 70, pointerType: 'mouse' });
      expect(card.style.getPropertyValue('--mouse-x')).toBe('50px');
      expect(card.style.getPropertyValue('--mouse-y')).toBe('50px');

      fireEvent.pointerMove(card, { clientX: 110, clientY: 120, pointerType: 'mouse' });
      expect(card.style.getPropertyValue('--mouse-x')).toBe('100px');
      expect(card.style.getPropertyValue('--mouse-y')).toBe('100px');

      fireEvent.pointerLeave(card);
      rafSpy.mockRestore();

      expect(card).toBeInTheDocument();
    });
  });

  // ── 3. Media Stream Remux Decision Engine Inspection ──────────────────────
  describe('3. Remux Decision Engine Codec Matrix Inspection', () => {
    test('detects pure container remux when input codecs match output container natively', () => {
      const decision = decideStrategy(
        { videoCodec: 'h264', audioCodec: 'aac' },
        {
          speed: 1,
          resolution: 'original',
          stripAudio: false,
          stripMetadata: false,
          outputFormat: 'mp4',
          isGif: false,
        }
      );

      expect(decision.strategy).toBe('remux');
      expect(decision.reason).toContain('natively compatible');

      const args = buildStrategyArgs('remux', {
        speed: 1,
        resolution: 'original',
        stripAudio: false,
        stripMetadata: false,
        outputFormat: 'mp4',
        isGif: false,
      });

      expect(args).toContain('-c');
      expect(args).toContain('copy');
    });

    test('selects copy-video when video is compatible but audio requires re-encoding', () => {
      const decision = decideStrategy(
        { videoCodec: 'h264', audioCodec: 'flac' },
        {
          speed: 1,
          resolution: 'original',
          stripAudio: false,
          stripMetadata: false,
          outputFormat: 'mp4',
          isGif: false,
        }
      );

      expect(decision.strategy).toBe('copy-video');

      const args = buildStrategyArgs('copy-video', {
        speed: 1,
        resolution: 'original',
        stripAudio: false,
        stripMetadata: false,
        outputFormat: 'mp4',
        isGif: false,
      });

      expect(args).toContain('-c:v');
      expect(args).toContain('copy');
      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
    });

    test('selects copy-audio when audio is compatible but video requires resolution scaling', () => {
      const decision = decideStrategy(
        { videoCodec: 'h264', audioCodec: 'aac' },
        {
          speed: 1,
          resolution: '720p',
          stripAudio: false,
          stripMetadata: false,
          outputFormat: 'mp4',
          isGif: false,
        }
      );

      expect(decision.strategy).toBe('copy-audio');

      const args = buildStrategyArgs('copy-audio', {
        speed: 1,
        resolution: '720p',
        stripAudio: false,
        stripMetadata: false,
        outputFormat: 'mp4',
        isGif: false,
      });

      expect(args).toContain('-c:a');
      expect(args).toContain('copy');
      expect(args).toContain('-vf');
      expect(args).toContain('scale=-2:720');
    });

    test('forces full encode for GIF format with palette generation', () => {
      const decision = decideStrategy(
        { videoCodec: 'h264', audioCodec: 'aac' },
        {
          speed: 1,
          resolution: 'original',
          stripAudio: false,
          stripMetadata: false,
          outputFormat: 'gif',
          isGif: true,
        }
      );

      expect(decision.strategy).toBe('encode');
      expect(decision.reason).toContain('GIF requires palette generation');

      const args = buildStrategyArgs('encode', {
        speed: 1,
        resolution: 'original',
        stripAudio: false,
        stripMetadata: false,
        outputFormat: 'gif',
        isGif: true,
      });

      expect(args).toContain('-loop');
      expect(args).toContain('0');
    });

    test('correctly configures image export arguments with 1 frame and pixel format', () => {
      const args = buildStrategyArgs('encode', {
        speed: 1,
        resolution: '1080p',
        stripAudio: true,
        stripMetadata: true,
        outputFormat: 'png',
        isGif: false,
        isImage: true,
      });

      expect(args).toContain('-vframes');
      expect(args).toContain('1');
      expect(args).toContain('-pix_fmt');
      expect(args).toContain('rgba');
      expect(args).toContain('-map_metadata');
      expect(args).toContain('-1');
    });
  });

  // ── 4. Hardware Profiler Inspection ───────────────────────────────────────
  describe('4. Hardware Profiler & Concurrency Inspection', () => {
    test('profiles hardware capabilities in test environment gracefully', () => {
      const profile = getClientHardwareProfile();
      expect(profile).toBeDefined();
      expect(profile.cores).toBeGreaterThanOrEqual(1);
      expect(profile.memoryGB).toBeGreaterThanOrEqual(2);
      expect(['TIER_1_ULTRA', 'TIER_2_BALANCED', 'TIER_3_SAFE']).toContain(profile.tier);
      expect(profile.maxBatchFiles).toBeGreaterThanOrEqual(5);
      expect(profile.maxConcurrency).toBeGreaterThanOrEqual(1);
    });
  });
});
