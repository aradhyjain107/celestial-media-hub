import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  inspectBrowserHardware,
  recommendExecutionMode,
  type ClientHardwareSnapshot,
  type HardwareProfile,
} from '../../lib/hardwareProfiler';
import { SpeedRecommendationMeter } from '../../app/components/ui/SpeedRecommendationMeter';

vi.mock('../../app/context/GlobalJobContext', () => ({
  useHardwareProfile: vi.fn((): HardwareProfile | null => ({
    cpuModel: 'HF Cloud Xeon',
    cores: 2,
    memoryGB: 16,
    tier: 'TIER_3_BALANCED',
    tierLabel: '2 vCPU Cloud Container',
    maxBatchFiles: 25,
    maxFileSizeMB: 1024,
    maxConcurrency: 1,
    throttleIntervalMs: 0,
    isHardwareAccelerated: false,
    mediaLimits: {
      photo: 500,
      audio: 200,
      videoRemux: 100,
      videoEncode: 30,
    },
  })),
}));

describe('recommendExecutionMode hardware logic', () => {
  test('recommends WEBSITE for low-spec 4 GB Intel i3 PC', () => {
    const lowSpec: ClientHardwareSnapshot = {
      cores: 4,
      memoryGB: 4,
      gpuRenderer: 'Intel(R) UHD Graphics 620',
      hasDiscreteOrAppleGpu: false,
    };

    const result = recommendExecutionMode(lowSpec, null, { isLocalhost: false });
    expect(result.target).toBe('WEBSITE');
    expect(result.score).toBeLessThanOrEqual(38);
    expect(result.headline).toMatch(/USE THE WEBSITE/i);
  });

  test('recommends BALANCED for mid-range 8 GB 4-thread laptop', () => {
    const midSpec: ClientHardwareSnapshot = {
      cores: 4,
      memoryGB: 8,
      gpuRenderer: 'Intel(R) Iris(R) Xe Graphics',
      hasDiscreteOrAppleGpu: false,
    };

    const result = recommendExecutionMode(midSpec, null, { isLocalhost: false });
    expect(result.target).toBe('BALANCED');
    expect(result.score).toBeGreaterThan(38);
    expect(result.score).toBeLessThan(65);
  });

  test('recommends DESKTOP_APP for Apple Silicon or discrete GPU workstations', () => {
    const appleSilicon: ClientHardwareSnapshot = {
      cores: 8,
      memoryGB: 8,
      gpuRenderer: 'Apple M3 Pro',
      hasDiscreteOrAppleGpu: true,
    };

    const result = recommendExecutionMode(appleSilicon, null, { isLocalhost: false });
    expect(result.target).toBe('DESKTOP_APP');
    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(result.headline).toMatch(/DESKTOP APP/i);
  });

  test('uses Hugging Face 16 GB / 2 vCPU baseline when running on localhost', () => {
    const client: ClientHardwareSnapshot = {
      cores: 4,
      memoryGB: 4,
      gpuRenderer: null,
      hasDiscreteOrAppleGpu: false,
    };
    const localMacAsServer: HardwareProfile = {
      cpuModel: 'Apple M3 Max',
      cores: 14,
      memoryGB: 36,
      tier: 'TIER_1_ULTRA',
      tierLabel: 'Local dev machine',
      maxBatchFiles: 250,
      maxFileSizeMB: 10240,
      maxConcurrency: 6,
      throttleIntervalMs: 0,
      isHardwareAccelerated: true,
      mediaLimits: { photo: 2000, audio: 1000, videoRemux: 500, videoEncode: 200 },
    };

    const result = recommendExecutionMode(client, localMacAsServer, { isLocalhost: true });
    expect(result.cloudSpecs.label).toBe('HF FREE CLOUD');
    expect(result.cloudSpecs.cores).toBe(2);
    expect(result.cloudSpecs.memoryGB).toBe(16);
  });

  test('flags PRIVACY_MASKED instead of low-spec WEBSITE when Brave spoofs 5 odd threads or Brave GPU', () => {
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 5,
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      value: 4,
    });
    Object.defineProperty(navigator, 'brave', {
      configurable: true,
      value: { isBrave: async () => true },
    });

    const snapshot = inspectBrowserHardware();
    expect(snapshot.isPrivacyMasked).toBe(true);

    const result = recommendExecutionMode(snapshot, null, { isLocalhost: false });
    expect(result.target).toBe('PRIVACY_MASKED');
    expect(result.score).toBe(50);
    expect(result.headline).toMatch(/BROWSER SHIELDS/i);
  });

  test('bypasses Brave spoofing automatically when silicon probe measures high parallel throughput', () => {
    const braveSpoofedM2: ClientHardwareSnapshot = {
      cores: 5,
      memoryGB: 4,
      gpuRenderer: 'Brave',
      hasDiscreteOrAppleGpu: false,
      isPrivacyMasked: true,
      maskReason: 'Brave Shields anti-fingerprinting',
      benchmark: {
        singleCoreMops: 159,
        multiCoreMops: 923,
        parallelSpeedup: 5.8,
        workerCount: 8,
        measuredAt: Date.now(),
      },
    };

    const result = recommendExecutionMode(braveSpoofedM2, null, { isLocalhost: false });
    expect(result.target).toBe('DESKTOP_APP');
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.headline).toMatch(/DESKTOP APP/i);
  });

  test('recommends WEBSITE when silicon probe measures low dual-core i3 throughput', () => {
    const lowSpecProbe: ClientHardwareSnapshot = {
      cores: 4,
      memoryGB: 4,
      gpuRenderer: 'Intel UHD Graphics',
      hasDiscreteOrAppleGpu: false,
      isPrivacyMasked: false,
      benchmark: {
        singleCoreMops: 55,
        multiCoreMops: 120,
        parallelSpeedup: 2.2,
        workerCount: 8,
        measuredAt: Date.now(),
      },
    };

    const result = recommendExecutionMode(lowSpecProbe, null, { isLocalhost: false });
    expect(result.target).toBe('WEBSITE');
    expect(result.score).toBeLessThanOrEqual(38);
  });
});

describe('SpeedRecommendationMeter component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      configurable: true,
      value: 4,
    });
    Object.defineProperty(navigator, 'deviceMemory', {
      configurable: true,
      value: 4,
    });
    Object.defineProperty(navigator, 'brave', {
      configurable: true,
      value: undefined,
    });
  });

  test('renders compact single-strip recommendation without details drawer expanded by default or an h1', () => {
    render(<SpeedRecommendationMeter />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent(/USE WEBSITE/i);
    expect(screen.getByTestId('meter-needle')).toBeInTheDocument();
    expect(screen.queryByTestId('meter-details-drawer')).not.toBeInTheDocument();
  });

  test('expands details drawer to switch presets and opens desktop guide modal', () => {
    render(<SpeedRecommendationMeter />);

    fireEvent.click(screen.getByRole('button', { name: /Details/i }));
    expect(screen.getByTestId('meter-details-drawer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '16GB+ / M-SERIES / RTX' }));
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent(/USE DESKTOP APP/i);

    fireEvent.click(screen.getByRole('button', { name: '4GB / i3 PC' }));
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent(/USE WEBSITE/i);

    fireEvent.click(screen.getByRole('button', { name: /Desktop App/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Native Desktop App \/\/ Maximum Speed Mode/i)).toBeInTheDocument();
  });
});
