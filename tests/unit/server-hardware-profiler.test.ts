import { describe, it, expect } from "vitest";
import { getServerHardwareProfile, resolveBatchLimit } from "../../src/lib/system/serverHardwareProfiler";

describe("Server Hardware Profiler & Precision Calibration Engine", () => {
  it("queries host OS and computes structured hardware profile with memory and CPU topology", async () => {
    const profile = await getServerHardwareProfile();

    expect(profile).toBeDefined();
    expect(profile.totalCores).toBeGreaterThanOrEqual(1);
    expect(profile.totalMemoryGB).toBeGreaterThan(0);
    expect(profile.freeMemoryGB).toBeGreaterThanOrEqual(0);
    expect(profile.cpuModel).toBeDefined();
    expect(["TIER_1_ULTRA", "TIER_2_PRO", "TIER_3_BALANCED", "TIER_4_ENTRY"]).toContain(profile.tier);
    expect(profile.tierLabel).toBeDefined();
    expect(profile.limits.maxFileSizeMB).toBeGreaterThanOrEqual(3000);
    expect(profile.limits.optimalFfmpegThreads).toBeGreaterThanOrEqual(1);
  });

  it("applies media-weight scaling: photo batch > audio batch > video batch", async () => {
    const profile = await getServerHardwareProfile();

    const photoLimit = resolveBatchLimit(profile, "PHOTO");
    const audioLimit = resolveBatchLimit(profile, "AUDIO");
    const videoRemuxLimit = resolveBatchLimit(profile, "VIDEO", true);
    const videoEncodeLimit = resolveBatchLimit(profile, "VIDEO", false);

    expect(photoLimit).toBeGreaterThanOrEqual(audioLimit);
    expect(audioLimit).toBeGreaterThanOrEqual(videoRemuxLimit);
    expect(videoRemuxLimit).toBeGreaterThanOrEqual(videoEncodeLimit);

    // Photos should have massive batch allowance
    expect(photoLimit).toBeGreaterThanOrEqual(200);
  });
});
