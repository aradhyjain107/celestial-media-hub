import { describe, it, expect, vi, beforeEach } from "vitest";
import { getClientHardwareProfile, resetClientHardwareProfileCache, getMediaBatchLimit } from "../../src/lib/hardwareProfiler";

describe("getClientHardwareProfile", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetClientHardwareProfileCache();
  });

  it("detects high-spec client hardware profile (Tier 1 Ultra)", () => {
    Object.defineProperty(global, "navigator", {
      value: {
        hardwareConcurrency: 8,
        deviceMemory: 16,
      },
      configurable: true,
      writable: true,
    });

    const profile = getClientHardwareProfile();
    expect(profile.tier).toBe("TIER_1_ULTRA");
    expect(profile.cores).toBe(8);
    expect(profile.memoryGB).toBe(16);
    expect(profile.maxBatchFiles).toBeGreaterThanOrEqual(50);
    expect(profile.maxConcurrency).toBeGreaterThanOrEqual(2);
  });

  it("detects constrained client hardware profile (Tier 3 Safe Mode)", () => {
    Object.defineProperty(global, "navigator", {
      value: {
        hardwareConcurrency: 2,
        deviceMemory: 2,
      },
      configurable: true,
      writable: true,
    });

    const profile = getClientHardwareProfile();
    expect(profile.tier).toBe("TIER_3_SAFE");
    expect(profile.cores).toBe(2);
    expect(profile.memoryGB).toBe(2);
    expect(profile.maxBatchFiles).toBeLessThanOrEqual(100);
    expect(profile.maxConcurrency).toBe(1);
  });

  it("detects standard balanced hardware profile (Tier 3 Balanced)", () => {
    Object.defineProperty(global, "navigator", {
      value: {
        hardwareConcurrency: 4,
        deviceMemory: 4,
      },
      configurable: true,
      writable: true,
    });

    const profile = getClientHardwareProfile();
    expect(profile.tier).toBe("TIER_2_BALANCED");
    expect(profile.cores).toBe(4);
    expect(profile.memoryGB).toBe(4);
  });

  it("computes dynamic media-specific limits (Photo > Audio > Video)", () => {
    const profile = getClientHardwareProfile();
    const photoLimit = getMediaBatchLimit(profile, "PHOTO");
    const audioLimit = getMediaBatchLimit(profile, "AUDIO");
    const videoLimit = getMediaBatchLimit(profile, "VIDEO", false);

    expect(photoLimit).toBeGreaterThanOrEqual(audioLimit);
    expect(audioLimit).toBeGreaterThanOrEqual(videoLimit);
  });
});
