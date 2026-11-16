/**
 * lib/serverHardwareProfiler.ts
 *
 * Native OS-Level Hardware Capability Profiler & Dynamic Calibration Engine.
 *
 * Directly inspects host CPU topology, physical RAM capacity, Performance vs.
 * Efficiency core layout (Apple Silicon), and hardware acceleration capabilities
 * to dynamically unlock optimal batch limits and concurrency per media type.
 */

import os from "node:os";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { isEncoderAvailable } from "../media/ffmpeg";

export type MediaCategory = "VIDEO" | "AUDIO" | "PHOTO";

export interface DeviceHardwareProfile {
  cpuModel: string;
  totalCores: number;
  performanceCores?: number;
  efficiencyCores?: number;
  totalMemoryBytes: number;
  totalMemoryGB: number;
  freeMemoryGB: number;
  architecture: string;
  platform: string;
  hardwareAccelerators: {
    videoToolbox: boolean;
    nvenc: boolean;
    vaapi: boolean;
    qsv: boolean;
  };
  tier: "TIER_1_ULTRA" | "TIER_2_PRO" | "TIER_3_BALANCED" | "TIER_4_ENTRY";
  tierLabel: string;
  limits: {
    maxBatchFiles: {
      photo: number;
      audio: number;
      videoRemux: number;
      videoEncode: number;
    };
    maxFileSizeMB: number;
    maxParallelWorkers: {
      photo: number;
      audio: number;
      video: number;
    };
    optimalFfmpegThreads: number;
  };
}

let cachedProfile: DeviceHardwareProfile | null = null;
let lastProfileTime = 0;
const CACHE_TTL_MS = 30_000; // Cache hardware specs for 30s (free memory refreshed)

export interface LinuxContainerQuota {
  memoryLimitBytes: number | null;
  memoryUsageBytes: number | null;
  cpuCores: number | null;
}

function safeReadLiteral(reader: () => string): string | null {
  try {
    return reader().trim();
  } catch {
    return null;
  }
}

/**
 * Parses Linux cgroup v2/v1 CPU and memory limits so containers (e.g. Render Free 512 MB / 0.1 vCPU)
 * report their actual allocated quota rather than the underlying EC2/VM host specs.
 */
export function parseCgroupLimits(files: {
  memMaxV2?: string | null;
  memCurV2?: string | null;
  memMaxV1?: string | null;
  memCurV1?: string | null;
  cpuMaxV2?: string | null;
  cpuQuotaV1?: string | null;
  cpuPeriodV1?: string | null;
}, hostMemoryBytes: number, hostCores: number): LinuxContainerQuota {
  let memoryLimitBytes: number | null = null;
  let memoryUsageBytes: number | null = null;
  let cpuCores: number | null = null;

  const parseMemValue = (raw: string | null | undefined): number | null => {
    if (!raw || raw === "max") return null;
    const val = Number.parseInt(raw, 10);
    if (!Number.isFinite(val) || val <= 0) return null;
    // Ignore cgroup v1 unlimited sentinel (near 2^63) or limits >= physical host RAM
    if (val >= hostMemoryBytes || val >= 1e15) return null;
    return val;
  };

  memoryLimitBytes =
    parseMemValue(files.memMaxV2) ?? parseMemValue(files.memMaxV1);

  const rawUsage = files.memCurV2 ?? files.memCurV1;
  if (rawUsage) {
    const usage = Number.parseInt(rawUsage, 10);
    if (Number.isFinite(usage) && usage >= 0) {
      memoryUsageBytes = usage;
    }
  }

  if (files.cpuMaxV2) {
    const [quotaStr, periodStr] = files.cpuMaxV2.split(/\s+/);
    if (quotaStr && periodStr && quotaStr !== "max") {
      const quota = Number.parseInt(quotaStr, 10);
      const period = Number.parseInt(periodStr, 10);
      if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
        cpuCores = Math.min(hostCores, Math.max(0.1, Number((quota / period).toFixed(2))));
      }
    }
  }
  if (cpuCores === null && files.cpuQuotaV1 && files.cpuPeriodV1) {
    const quota = Number.parseInt(files.cpuQuotaV1, 10);
    const period = Number.parseInt(files.cpuPeriodV1, 10);
    if (Number.isFinite(quota) && Number.isFinite(period) && quota > 0 && period > 0) {
      cpuCores = Math.min(hostCores, Math.max(0.1, Number((quota / period).toFixed(2))));
    }
  }

  return { memoryLimitBytes, memoryUsageBytes, cpuCores };
}

function readLinuxCgroupLimits(hostMemoryBytes: number, hostCores: number): LinuxContainerQuota {
  if (os.platform() !== "linux") {
    return { memoryLimitBytes: null, memoryUsageBytes: null, cpuCores: null };
  }
  return parseCgroupLimits(
    {
      memMaxV2: safeReadLiteral(() => fs.readFileSync("/sys/fs/cgroup/memory.max", "utf8")),
      memCurV2: safeReadLiteral(() => fs.readFileSync("/sys/fs/cgroup/memory.current", "utf8")),
      memMaxV1: safeReadLiteral(() => fs.readFileSync("/sys/fs/cgroup/memory/memory.limit_in_bytes", "utf8")),
      memCurV1: safeReadLiteral(() => fs.readFileSync("/sys/fs/cgroup/memory/memory.usage_in_bytes", "utf8")),
      cpuMaxV2: safeReadLiteral(() => fs.readFileSync("/sys/fs/cgroup/cpu.max", "utf8")),
      cpuQuotaV1: safeReadLiteral(() => fs.readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_quota_us", "utf8")),
      cpuPeriodV1: safeReadLiteral(() => fs.readFileSync("/sys/fs/cgroup/cpu/cpu.cfs_period_us", "utf8")),
    },
    hostMemoryBytes,
    hostCores
  );
}

/** Returns true when running inside a low-memory / fractional-CPU container (e.g. Render 512 MB / 0.15 vCPU). */
export function isConstrainedContainer(): boolean {
  if (os.platform() !== "linux") return false;
  const cpus = os.cpus() || [];
  const cgroup = readLinuxCgroupLimits(os.totalmem(), Math.max(1, cpus.length));
  const lowMem = cgroup.memoryLimitBytes !== null && cgroup.memoryLimitBytes <= 1.5 * 1024 * 1024 * 1024;
  const lowCpu = cgroup.cpuCores !== null && cgroup.cpuCores < 2;
  return lowMem || lowCpu;
}

/**
 * Inspects host OS (and Linux container cgroup limits) directly and calculates device-specific precision limits.
 */
export async function getServerHardwareProfile(): Promise<DeviceHardwareProfile> {
  const now = Date.now();
  const hostMemoryBytes = os.totalmem();
  const cpus = os.cpus() || [];
  const hostCores = Math.max(1, cpus.length);
  const cgroup = readLinuxCgroupLimits(hostMemoryBytes, hostCores);

  if (cachedProfile && now - lastProfileTime < CACHE_TTL_MS) {
    // Refresh real-time free memory
    const freeBytes = cgroup.memoryLimitBytes && cgroup.memoryUsageBytes !== null
      ? Math.max(0, cgroup.memoryLimitBytes - cgroup.memoryUsageBytes)
      : os.freemem();
    cachedProfile.freeMemoryGB = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;
    return cachedProfile;
  }

  const totalCores = cgroup.cpuCores ?? hostCores;
  const totalMemoryBytes = cgroup.memoryLimitBytes ?? hostMemoryBytes;
  const freeBytes = cgroup.memoryLimitBytes && cgroup.memoryUsageBytes !== null
    ? Math.max(0, cgroup.memoryLimitBytes - cgroup.memoryUsageBytes)
    : os.freemem();

  const totalMemoryGB = Math.round((totalMemoryBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const freeMemoryGB = Math.round((freeBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const architecture = os.arch();
  const platform = os.platform();
  const isRender = process.env.RENDER === "true";

  let cpuModel = cpus[0]?.model || "Generic Processor";
  let performanceCores: number | undefined;
  let efficiencyCores: number | undefined;

  // macOS specific hardware inspection
  if (platform === "darwin") {
    try {
      const brand = execSync("sysctl -n machdep.cpu.brand_string", { timeout: 1000 }).toString().trim();
      if (brand) cpuModel = brand;
    } catch {}

    try {
      const pCoresStr = execSync("sysctl -n hw.perflevel0.logicalcpu", { timeout: 1000 }).toString().trim();
      const pCores = parseInt(pCoresStr, 10);
      if (!isNaN(pCores) && pCores > 0) {
        performanceCores = pCores;
      }
    } catch {}

    try {
      const eCoresStr = execSync("sysctl -n hw.perflevel1.logicalcpu", { timeout: 1000 }).toString().trim();
      const eCores = parseInt(eCoresStr, 10);
      if (!isNaN(eCores) && eCores > 0) {
        efficiencyCores = eCores;
      }
    } catch {}
  }

  // Probe hardware video encoder availability
  const [videoToolbox, nvenc, vaapi, qsv] = await Promise.all([
    isEncoderAvailable("h264_videotoolbox").catch(() => false),
    isEncoderAvailable("h264_nvenc").catch(() => false),
    isEncoderAvailable("h264_vaapi").catch(() => false),
    isEncoderAvailable("h264_qsv").catch(() => false),
  ]);

  const hasHwAccel = videoToolbox || nvenc || vaapi || qsv;

  // Precision Tier Calculation
  let tier: DeviceHardwareProfile["tier"] = "TIER_3_BALANCED";
  let tierLabel = "BALANCED PERFORMANCE";

  if (totalMemoryGB >= 32 || (totalMemoryGB >= 24 && totalCores >= 10)) {
    tier = "TIER_1_ULTRA";
    tierLabel = "ULTRA WORKSTATION";
  } else if (totalMemoryGB >= 16 || (totalMemoryGB >= 12 && totalCores >= 8)) {
    tier = "TIER_2_PRO";
    tierLabel = "HIGH-PERFORMANCE PRO";
  } else if (totalMemoryGB <= 4 || totalCores <= 2) {
    tier = "TIER_4_ENTRY";
    tierLabel = totalMemoryGB <= 1
      ? (isRender ? "RENDER FREE CONTAINER (512MB)" : "CONSTRAINED CONTAINER (512MB)")
      : "ENERGY SAVER / ENTRY";
  } else {
    tier = "TIER_3_BALANCED";
    tierLabel = "STANDARD BALANCED";
  }

  // Precision Media-Specific Limit Calibration
  let photoBatch = 500;
  let audioBatch = 250;
  let videoRemux = 100;
  let videoEncode = 50;
  let maxFileSizeMB = 5000;
  let maxParallelPhoto = 4;
  let maxParallelAudio = 2;
  let maxParallelVideo = 1;

  if (tier === "TIER_1_ULTRA") {
    photoBatch = Math.min(10000, Math.floor(totalMemoryGB * 150));   // e.g. 32GB -> 4800, 64GB -> 9600
    audioBatch = Math.min(4000, Math.floor(totalMemoryGB * 60));     // e.g. 32GB -> 1920, 64GB -> 3840
    videoRemux = Math.min(1500, Math.floor(totalMemoryGB * 20));     // e.g. 32GB -> 640, 64GB -> 1280
    videoEncode = Math.min(500, Math.floor(totalMemoryGB * 8));      // e.g. 32GB -> 256, 64GB -> 500
    maxFileSizeMB = 50000; // 50 GB
    maxParallelPhoto = Math.min(16, Math.floor(totalCores));
    maxParallelAudio = Math.min(8, Math.max(1, Math.floor(totalCores / 2)));
    maxParallelVideo = hasHwAccel ? Math.min(4, Math.max(1, Math.floor(totalCores / 3))) : 2;
  } else if (tier === "TIER_2_PRO") {
    photoBatch = Math.min(5000, Math.max(1000, Math.floor(totalMemoryGB * 150))); // e.g. 16GB -> 2400
    audioBatch = Math.min(2000, Math.max(500, Math.floor(totalMemoryGB * 60)));   // e.g. 16GB -> 960
    videoRemux = Math.min(600, Math.max(200, Math.floor(totalMemoryGB * 20)));    // e.g. 16GB -> 320
    videoEncode = Math.min(250, Math.max(100, Math.floor(totalMemoryGB * 8)));    // e.g. 16GB -> 128
    maxFileSizeMB = 25000; // 25 GB
    maxParallelPhoto = Math.min(8, Math.floor(totalCores));
    maxParallelAudio = Math.min(4, Math.max(1, Math.floor(totalCores / 2)));
    maxParallelVideo = hasHwAccel ? 2 : 1;
  } else if (tier === "TIER_4_ENTRY") {
    if (totalMemoryGB <= 1 || totalCores < 1) {
      // Constrained free-tier container (e.g. Render 512 MB / 0.1 vCPU)
      photoBatch = 100;
      audioBatch = 40;
      videoRemux = 15;
      videoEncode = 5;
      maxFileSizeMB = 250;
      maxParallelPhoto = 1;
      maxParallelAudio = 1;
      maxParallelVideo = 1;
    } else {
      photoBatch = 200;
      audioBatch = 100;
      videoRemux = 50;
      videoEncode = 20;
      maxFileSizeMB = 3000;
      maxParallelPhoto = 2;
      maxParallelAudio = 1;
      maxParallelVideo = 1;
    }
  } else {
    // TIER_3_BALANCED (e.g. 8GB RAM, 4-8 cores)
    photoBatch = 1000;
    audioBatch = 400;
    videoRemux = 150;
    videoEncode = 50;
    maxFileSizeMB = 10000; // 10 GB
    maxParallelPhoto = Math.min(4, Math.max(1, Math.floor(totalCores)));
    maxParallelAudio = 2;
    maxParallelVideo = 1;
  }

  const optimalFfmpegThreads = performanceCores
    ? Math.max(2, performanceCores)
    : totalCores < 2
      ? 1
      : Math.min(8, Math.max(2, Math.floor(totalCores * 0.75)));

  cachedProfile = {
    cpuModel,
    totalCores,
    performanceCores,
    efficiencyCores,
    totalMemoryBytes,
    totalMemoryGB,
    freeMemoryGB,
    architecture,
    platform,
    hardwareAccelerators: {
      videoToolbox,
      nvenc,
      vaapi,
      qsv,
    },
    tier,
    tierLabel,
    limits: {
      maxBatchFiles: {
        photo: photoBatch,
        audio: audioBatch,
        videoRemux,
        videoEncode,
      },
      maxFileSizeMB,
      maxParallelWorkers: {
        photo: maxParallelPhoto,
        audio: maxParallelAudio,
        video: maxParallelVideo,
      },
      optimalFfmpegThreads,
    },
  };

  lastProfileTime = now;
  return cachedProfile;
}

/**
 * Resolves the dynamic upload limit for a given media category on the current machine.
 */
export function resolveBatchLimit(profile: DeviceHardwareProfile, category: MediaCategory, isRemux = false): number {
  if (category === "PHOTO") return profile.limits.maxBatchFiles.photo;
  if (category === "AUDIO") return profile.limits.maxBatchFiles.audio;
  return isRemux ? profile.limits.maxBatchFiles.videoRemux : profile.limits.maxBatchFiles.videoEncode;
}
