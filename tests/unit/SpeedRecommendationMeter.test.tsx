import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  formatCloudCoresLabel,
  formatCloudMemoryLabel,
  inspectBrowserHardware,
  recommendExecutionMode,
  type ClientHardwareSnapshot,
  type HardwareProfile,
} from '../../src/lib/system/hardwareProfiler';
import { parseCgroupLimits } from '../../src/lib/system/serverHardwareProfiler';
import { SpeedRecommendationMeter } from '../../src/app/components/ui/SpeedRecommendationMeter';

const RENDER_SERVER_MOCK: HardwareProfile = {
  cpuModel: 'AMD EPYC 7R13 Processor',
  cores: 0.1,
  memoryGB: 0.5,
  tier: 'TIER_4_ENTRY',
  tierLabel: 'RENDER FREE CONTAINER (512MB)',
  maxBatchFiles: 100,
  maxFileSizeMB: 250,
  maxConcurrency: 1,
  throttleIntervalMs: 16,
  isHardwareAccelerated: false,
  mediaLimits: {
    photo: 100,
    audio: 40,
    videoRemux: 15,
    videoEncode: 5,
  },
};

const BEEFY_CLOUD_MOCK: HardwareProfile = {
  cpuModel: 'Cloud Xeon 2 vCPU',
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
};

vi.mock('../../src/app/context/GlobalJobContext', () => ({
  useHardwareProfile: vi.fn((): HardwareProfile | null => RENDER_SERVER_MOCK),
}));

describe('parseCgroupLimits Linux container quota detection', () => {
  const hostMem = 32 * 1024 * 1024 * 1024;
  const hostCores = 8;

  test('reads Render Free cgroup v2 limits (512 MB RAM, 0.1 vCPU) instead of 32 GB host RAM', () => {
    const quota = parseCgroupLimits(
      {
        memMaxV2: '536870912',
        memCurV2: '134217728',
        cpuMaxV2: '10000 100000',
      },
      hostMem,
      hostCores
    );

    expect(quota.memoryLimitBytes).toBe(536870912);
    expect(quota.memoryUsageBytes).toBe(134217728);
    expect(quota.cpuCores).toBe(0.1);
  });

  test('falls back cleanly to cgroup v1 limits and ignores unlimited sentinels', () => {
    const quota = parseCgroupLimits(
      {
        memMaxV2: 'max',
        cpuMaxV2: 'max 100000',
        memMaxV1: '2147483648',
        cpuQuotaV1: '50000',
        cpuPeriodV1: '100000',
      },
      hostMem,
      hostCores
    );

    expect(quota.memoryLimitBytes).toBe(2147483648);
    expect(quota.cpuCores).toBe(0.5);

    const unlimited = parseCgroupLimits(
      { memMaxV1: '9223372036854771712' },
      hostMem,
      hostCores
    );
    expect(unlimited.memoryLimitBytes).toBeNull();
  });
});

describe('recommendExecutionMode hardware logic', () => {
  test('recommends DESKTOP_APP for 4 GB Intel i3 PC against constrained 0.1 vCPU / 512 MB Render server', () => {
    const i3Pc: ClientHardwareSnapshot = {
      cores: 4,
      memoryGB: 4,
      gpuRenderer: 'Intel(R) UHD Graphics 620',
      hasDiscreteOrAppleGpu: false,
    };

    const result = recommendExecutionMode(i3Pc, RENDER_SERVER_MOCK, { isLocalhost: false });
    expect(result.target).toBe('DESKTOP_APP');
    expect(result.score).toBeGreaterThanOrEqual(65);
    expect(result.cloudSpecs.label).toBe('RENDER FREE CLOUD');
    expect(result.cloudSpecs.cores).toBe(0.1);
    expect(result.cloudSpecs.memoryGB).toBe(0.5);
    expect(result.rationale).toContain('512 MB');
  });

  test('recommends BALANCED for ultra-constrained 2-core 2 GB device on Render Free', () => {
    const ultraLight: ClientHardwareSnapshot = {
      cores: 2,
      memoryGB: 2,
      gpuRenderer: 'Basic Integrated Graphics',
      hasDiscreteOrAppleGpu: false,
    };

    const result = recommendExecutionMode(ultraLight, RENDER_SERVER_MOCK, { isLocalhost: false });
    expect(result.target).toBe('BALANCED');
    expect(result.score).toBeGreaterThan(38);
    expect(result.score).toBeLessThan(65);
  });

  test('recommends WEBSITE on larger 16 GB / 2 vCPU cloud server for low-spec 4 GB PC', () => {
    const lowSpec: ClientHardwareSnapshot = {
      cores: 4,
      memoryGB: 4,
      gpuRenderer: 'Intel(R) UHD Graphics 620',
      hasDiscreteOrAppleGpu: false,
    };

    const result = recommendExecutionMode(lowSpec, BEEFY_CLOUD_MOCK, { isLocalhost: false });
    expect(result.target).toBe('WEBSITE');
    expect(result.score).toBeLessThanOrEqual(38);
    expect(result.headline).toMatch(/USE THE WEBSITE/i);
  });

  test('recommends BALANCED for mid-range 8 GB laptop against larger 16 GB / 2 vCPU cloud server', () => {
    const midSpec: ClientHardwareSnapshot = {
      cores: 4,
      memoryGB: 8,
      gpuRenderer: 'Intel(R) Iris(R) Xe Graphics',
      hasDiscreteOrAppleGpu: false,
    };

    const result = recommendExecutionMode(midSpec, BEEFY_CLOUD_MOCK, { isLocalhost: false });
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

    const result = recommendExecutionMode(appleSilicon, RENDER_SERVER_MOCK, { isLocalhost: false });
    expect(result.target).toBe('DESKTOP_APP');
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.headline).toMatch(/DESKTOP APP/i);
  });

  test('uses Render 512 MB / 0.1 vCPU baseline when running on localhost', () => {
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
    expect(result.cloudSpecs.label).toBe('RENDER FREE CLOUD');
    expect(result.cloudSpecs.cores).toBe(0.1);
    expect(result.cloudSpecs.memoryGB).toBe(0.5);
  });

  test('flags PRIVACY_MASKED instead of guessing when Brave spoofs 5 odd threads or Brave GPU', () => {
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

    const result = recommendExecutionMode(snapshot, RENDER_SERVER_MOCK, { isLocalhost: false });
    expect(result.target).toBe('PRIVACY_MASKED');
    expect(result.score).toBe(50);
    expect(result.headline).toMatch(/BROWSER SHIELDS/i);
    expect(result.rationale).toContain('0.1 vCPU / 512 MB');
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

    const result = recommendExecutionMode(braveSpoofedM2, RENDER_SERVER_MOCK, { isLocalhost: false });
    expect(result.target).toBe('DESKTOP_APP');
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.headline).toMatch(/DESKTOP APP/i);
  });

  test('recommends WEBSITE on large 16 GB cloud server when silicon probe measures low dual-core i3 throughput', () => {
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

    const result = recommendExecutionMode(lowSpecProbe, BEEFY_CLOUD_MOCK, { isLocalhost: false });
    expect(result.target).toBe('WEBSITE');
    expect(result.score).toBeLessThanOrEqual(38);
  });

  test('formats fractional cloud specs cleanly', () => {
    expect(formatCloudMemoryLabel(0.5)).toBe('512 MB');
    expect(formatCloudMemoryLabel(16)).toBe('16 GB');
    expect(formatCloudCoresLabel(0.1)).toBe('0.1');
    expect(formatCloudCoresLabel(2)).toBe('2');
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

  test('renders compact single-strip recommendation showing accurate Render Free cloud comparison', () => {
    render(<SpeedRecommendationMeter />);

    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent(/USE DESKTOP APP/i);
    expect(screen.getByText(/0\.1 vCPU \/ 512 MB RAM/i)).toBeInTheDocument();
    expect(screen.getByTestId('meter-needle')).toBeInTheDocument();
    expect(screen.queryByTestId('meter-details-drawer')).not.toBeInTheDocument();
  });

  test('expands details drawer to show Render Free specs, switch presets, and open desktop guide modal', () => {
    render(<SpeedRecommendationMeter />);

    fireEvent.click(screen.getByRole('button', { name: /Details/i }));
    expect(screen.getByTestId('meter-details-drawer')).toBeInTheDocument();
    expect(screen.getByText('RENDER FREE CLOUD')).toBeInTheDocument();
    expect(screen.getByText('0.1 vCPU · 512 MB RAM')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '16GB+ / M-SERIES / RTX' }));
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent(/USE DESKTOP APP/i);

    fireEvent.click(screen.getByRole('button', { name: '4GB / i3 PC' }));
    expect(screen.getByTestId('recommendation-badge')).toHaveTextContent(/USE DESKTOP APP/i);

    fireEvent.click(screen.getByRole('button', { name: /Desktop App/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Native Desktop App \/\/ Maximum Speed Mode/i)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/github\.com\/aradhyjain107\/celestial-media-hub\.git/)).toBeInTheDocument();
    expect(screen.queryByText(/<your-repo-url>/)).not.toBeInTheDocument();
  });
});
