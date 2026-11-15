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
import { execSync } from "node:child_process";
import { isEncoderAvailable } from "./ffmpeg";

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

/**
 * Inspects host OS directly and calculates device-specific precision limits.
 */
export async function getServerHardwareProfile(): Promise<DeviceHardwareProfile> {
  const now = Date.now();
  if (cachedProfile && now - lastProfileTime < CACHE_TTL_MS) {
    // Refresh real-time free memory
    cachedProfile.freeMemoryGB = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10;
    return cachedProfile;
  }

  const cpus = os.cpus() || [];
  const totalCores = Math.max(1, cpus.length);
  const totalMemoryBytes = os.totalmem();
  const totalMemoryGB = Math.round((totalMemoryBytes / (1024 * 1024 * 1024)) * 10) / 10;
  const freeMemoryGB = Math.round((os.freemem() / (1024 * 1024 * 1024)) * 10) / 10;
  const architecture = os.arch();
  const platform = os.platform();

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
    tierLabel = "ENERGY SAVER / ENTRY";
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
    maxParallelPhoto = Math.min(16, totalCores);
    maxParallelAudio = Math.min(8, Math.floor(totalCores / 2));
    maxParallelVideo = hasHwAccel ? Math.min(4, Math.floor(totalCores / 3)) : 2;
  } else if (tier === "TIER_2_PRO") {
    photoBatch = Math.min(5000, Math.max(1000, Math.floor(totalMemoryGB * 150))); // e.g. 16GB -> 2400
    audioBatch = Math.min(2000, Math.max(500, Math.floor(totalMemoryGB * 60)));   // e.g. 16GB -> 960
    videoRemux = Math.min(600, Math.max(200, Math.floor(totalMemoryGB * 20)));    // e.g. 16GB -> 320
    videoEncode = Math.min(250, Math.max(100, Math.floor(totalMemoryGB * 8)));    // e.g. 16GB -> 128
    maxFileSizeMB = 25000; // 25 GB
    maxParallelPhoto = Math.min(8, totalCores);
    maxParallelAudio = Math.min(4, Math.floor(totalCores / 2));
    maxParallelVideo = hasHwAccel ? 2 : 1;
  } else if (tier === "TIER_4_ENTRY") {
    photoBatch = 200;
    audioBatch = 100;
    videoRemux = 50;
    videoEncode = 20;
    maxFileSizeMB = 3000;
    maxParallelPhoto = 2;
    maxParallelAudio = 1;
    maxParallelVideo = 1;
  } else {
    // TIER_3_BALANCED (e.g. 8GB RAM, 4-8 cores)
    photoBatch = 1000;
    audioBatch = 400;
    videoRemux = 150;
    videoEncode = 50;
    maxFileSizeMB = 10000; // 10 GB
    maxParallelPhoto = Math.min(4, totalCores);
    maxParallelAudio = 2;
    maxParallelVideo = 1;
  }

  const optimalFfmpegThreads = performanceCores
    ? Math.max(2, performanceCores)
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
