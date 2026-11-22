import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { expect, describe, test, vi, beforeEach, afterEach } from 'vitest';
import Dashboard from '../../src/app/page';
import { DashboardGrid } from '../../src/app/components/DashboardGrid';
import { CursorGlowController } from '../../src/app/components/ui/CursorGlowController';
import { HardwareBadge } from '../../src/app/components/ui/HardwareBadge';
import { ServerGuard } from '../../src/app/components/ui/ServerGuard';
import { GlobalJobProvider } from '../../src/app/context/GlobalJobContext';
import * as hwProfiler from '../../src/lib/system/hardwareProfiler';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('Dashboard & System UI Suite — Deep Test Matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Central Dashboard Page & Utility Bar ───────────────────────────────
  describe('1. Central Dashboard Page & Header', () => {
    test('renders system dashboard with system overview target and utility bar indicators', () => {
      render(
        <GlobalJobProvider>
          <Dashboard />
        </GlobalJobProvider>
      );

      expect(screen.getByText('CELESTIAL // SYSTEM DASHBOARD')).toBeInTheDocument();
      expect(screen.getByText('SYSTEM: READY')).toBeInTheDocument();
      expect(screen.getByText('STATUS: ONLINE ●')).toBeInTheDocument();
      expect(screen.getByText('V. 2.0.0')).toBeInTheDocument();
      expect(screen.getByText('TARGET // 01')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/SystemOverview/i);
    });
  });

  // ── 2. Tool Grid Navigation Across All Tools ──────────────────────────────
  describe('2. Tool Grid Navigation Across All Media Tools', () => {
    const allTools = [
      { num: '02', name: 'Video Muter', desc: 'Remove or replace audio streams in video files.', path: '/tools/muter' },
      { num: '03', name: 'Universal Compressor', desc: 'Hardware-accelerated multi-media batch compressor.', path: '/tools/hevc' },
      { num: '04', name: 'Universal Converter', desc: 'Convert media between standard formats.', path: '/tools/converter' },
      { num: '05', name: 'YouTube Downloader', desc: 'Extract streams natively to filesystem.', path: '/tools/youtube' },
      { num: '06', name: 'Audio Trimmer', desc: 'Merge and split audio with crossfade.', path: '/tools/trimmer' },
      { num: '07', name: 'Spotify Converter', desc: 'Scrape and extract audio from embeds.', path: '/tools/spotify' },
    ];

    test('renders all 6 tool cards with correct numbers, names, descriptions, and action links', () => {
      render(<DashboardGrid tools={allTools} />);

      for (const tool of allTools) {
        expect(screen.getByText(`${tool.num} //`)).toBeInTheDocument();
        expect(screen.getByText(tool.name)).toBeInTheDocument();
        expect(screen.getByText(tool.desc)).toBeInTheDocument();
        
        const link = screen.getByText(tool.name).closest('a');
        expect(link).toHaveAttribute('href', tool.path);
      }

      const initializeButtons = screen.getAllByText(/INITIALIZE/i);
      expect(initializeButtons).toHaveLength(6);
    });

    test('supports custom dynamic tool items in DashboardGrid', () => {
      const customTools = [
        { num: '08', name: 'Experimental Turbo Streamer', desc: 'Zero-copy direct MP4 streaming.', path: '/api/experimental/turbo-download' },
      ];
      render(<DashboardGrid tools={customTools} />);

      expect(screen.getByText('08 //')).toBeInTheDocument();
      expect(screen.getByText('Experimental Turbo Streamer')).toBeInTheDocument();
      expect(screen.getByText('Zero-copy direct MP4 streaming.')).toBeInTheDocument();
    });

    test('updates cursor glow coordinates on pointer move across dashboard tool cards', () => {
      const customTools = [
        { num: '07', name: 'Spotify Converter', desc: 'Extract high-bitrate audio.', path: '/tools/spotify' },
      ];
      render(<DashboardGrid tools={customTools} />);

      const link = screen.getByText('Spotify Converter').closest('a') as HTMLAnchorElement;
      expect(link).toHaveClass('cel-glow-host');
      vi.spyOn(link, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        top: 50,
        right: 400,
        bottom: 242,
        width: 300,
        height: 192,
        x: 100,
        y: 50,
        toJSON: () => ({}),
      });

      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

      fireEvent.pointerEnter(link, { clientX: 160, clientY: 90, pointerType: 'mouse' });
      expect(link.style.getPropertyValue('--mouse-x')).toBe('60px');
      expect(link.style.getPropertyValue('--mouse-y')).toBe('40px');

      fireEvent.pointerMove(link, { clientX: 280, clientY: 170, pointerType: 'mouse' });
      expect(link.style.getPropertyValue('--mouse-x')).toBe('180px');
      expect(link.style.getPropertyValue('--mouse-y')).toBe('120px');

      rafSpy.mockRestore();
    });

    test('CursorGlowController delegates fine-pointer button tracking and skips touch and reduced motion', () => {
      const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

      render(
        <>
          <CursorGlowController />
          <button type="button" data-testid="glow-target-btn">Run Action</button>
        </>
      );

      const btn = screen.getByTestId('glow-target-btn');
      vi.spyOn(btn, 'getBoundingClientRect').mockReturnValue({
        left: 20,
        top: 10,
        right: 220,
        bottom: 54,
        width: 200,
        height: 44,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      });

      fireEvent.pointerOver(btn, { clientX: 70, clientY: 25, pointerType: 'mouse' });
      expect(btn.style.getPropertyValue('--mouse-x')).toBe('50px');
      expect(btn.style.getPropertyValue('--mouse-y')).toBe('15px');

      fireEvent.pointerMove(btn, { clientX: 145, clientY: 40, pointerType: 'mouse' });
      expect(btn.style.getPropertyValue('--mouse-x')).toBe('125px');
      expect(btn.style.getPropertyValue('--mouse-y')).toBe('30px');

      // Touch input should not move the cursor spotlight
      fireEvent.pointerMove(btn, { clientX: 30, clientY: 15, pointerType: 'touch' });
      expect(btn.style.getPropertyValue('--mouse-x')).toBe('125px');

      // Reduced motion disables continuous pointer updates
      const matchMediaSpy = vi.fn((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
      vi.stubGlobal('matchMedia', matchMediaSpy);

      fireEvent.pointerMove(btn, { clientX: 40, clientY: 20, pointerType: 'mouse' });
      expect(btn.style.getPropertyValue('--mouse-x')).toBe('125px');

      vi.unstubAllGlobals();
      rafSpy.mockRestore();
    });
  });

  // ── 3. Hardware Badge Tier Classification & Rendering ─────────────────────
  describe('3. HardwareBadge Tier Classification & Display', () => {
    test('renders TIER_1_ULTRA badge with cores and memory info in accent color', async () => {
      vi.spyOn(hwProfiler, 'getClientHardwareProfile').mockReturnValue({
        cores: 16,
        memoryGB: 32,
        tier: 'TIER_1_ULTRA',
        tierLabel: 'HIGH PERFORMANCE (MULTI-THREADED)',
        maxBatchFiles: 50,
        maxFileSizeMB: 4000,
        maxConcurrency: 3,
        throttleIntervalMs: 16,
        isHardwareAccelerated: true,
      });

      render(<HardwareBadge />);

      const badge = screen.getByTestId('hardware-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('HW: ULTRA (16C/32GB)');
      expect(badge).toHaveAttribute('title', 'Client Profile: 16 Cores | 32 GB RAM | Max Batch: 50 Files');
    });

    test('renders TIER_2_BALANCED badge with standard profile', async () => {
      vi.spyOn(hwProfiler, 'getClientHardwareProfile').mockReturnValue({
        cores: 8,
        memoryGB: 8,
        tier: 'TIER_2_BALANCED',
        tierLabel: 'STANDARD BALANCED',
        maxBatchFiles: 20,
        maxFileSizeMB: 1500,
        maxConcurrency: 1,
        throttleIntervalMs: 33,
        isHardwareAccelerated: false,
      });

      render(<HardwareBadge />);

      const badge = screen.getByTestId('hardware-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('HW: BALANCED (8C/8GB)');
    });

    test('renders TIER_3_SAFE badge with safe mode warning styling', async () => {
      vi.spyOn(hwProfiler, 'getClientHardwareProfile').mockReturnValue({
        cores: 2,
        memoryGB: 2,
        tier: 'TIER_3_SAFE',
        tierLabel: 'SEQUENTIAL SAFE MODE (LOW MEMORY)',
        maxBatchFiles: 5,
        maxFileSizeMB: 300,
        maxConcurrency: 1,
        throttleIntervalMs: 100,
        isHardwareAccelerated: false,
      });

      render(<HardwareBadge />);

      const badge = screen.getByTestId('hardware-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent('HW: SAFE MODE (2C)');
    });
  });

  // ── 4. ServerGuard Health Check & Offline Diagnostic Modal ────────────────
  describe('4. ServerGuard Health Monitoring & Offline Diagnostic Modal', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    test('remains hidden when health endpoint returns 200 OK', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'healthy', uptime: 100, memoryMB: 120 }),
      } as any);

      render(<ServerGuard />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    test('displays diagnostic modal after 5 consecutive health failures and allows retry and dismiss', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      } as any);

      render(<ServerGuard />);

      // Advance timers for 5 failed ping cycles
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10000);
        });
      }

      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      expect(screen.getByText('CELESTIAL // SYSTEM DIAGNOSTIC')).toBeInTheDocument();
      expect(screen.getByText('SERVER OFFLINE ●')).toBeInTheDocument();
      expect(screen.getByText(/The Celestial dev server is not responding to health checks/i)).toBeInTheDocument();
      expect(screen.getByText('$ npm run dev:supervised')).toBeInTheDocument();
      expect(screen.getByText('$ npm run dev:restart')).toBeInTheDocument();

      const retryBtn = screen.getByTestId('server-guard-retry-now');
      const dismissBtn = screen.getByTestId('server-guard-dismiss');
      expect(retryBtn).toBeInTheDocument();
      expect(dismissBtn).toBeInTheDocument();

      // Test Retry Now button triggers ping
      await act(async () => {
        fireEvent.click(retryBtn);
      });
      expect(global.fetch).toHaveBeenCalled();

      // Test Dismiss button resets modal
      act(() => {
        fireEvent.click(dismissBtn);
      });
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });

    test('times out hanging health requests cleanly without AbortError', async () => {
      // Simulate a hanging /api/health request (e.g. cold dev compilation)
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));

      render(<ServerGuard />);

      // Advance past the 8s per-request timeout without crashing
      await act(async () => {
        await vi.advanceTimersByTimeAsync(9000);
      });

      // Only 1 failure so far (< threshold of 5), modal stays hidden and no AbortError thrown
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/health',
        expect.not.objectContaining({ signal: expect.anything() })
      );
    });
  });
});
