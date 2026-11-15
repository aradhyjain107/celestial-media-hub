/**
 * lib/hardwareProfiler.ts
 *
 * Client Hardware Capability Profiler & Adaptive Dynamic Limiting Engine.
 *
 * Synchronizes with native OS hardware telemetry from /api/system/hardware
 * to unlock tool- and media-specific batch queue limits.
 */

import type { DeviceHardwareProfile, MediaCategory } from "./serverHardwareProfiler";

export type HardwareTier = "TIER_1_ULTRA" | "TIER_2_PRO" | "TIER_2_BALANCED" | "TIER_3_BALANCED" | "TIER_3_SAFE" | "TIER_4_ENTRY";

export interface HardwareProfile {
  cpuModel?: string;
  cores: number;
  memoryGB: number;
  tier: HardwareTier;
  tierLabel: string;
  maxBatchFiles: number;
  maxFileSizeMB: number;
  maxConcurrency: number;
  throttleIntervalMs: number;
  gpuRenderer?: string;
  isHardwareAccelerated: boolean;
  mediaLimits?: {
    photo: number;
    audio: number;
    videoRemux: number;
    videoEncode: number;
  };
}

let activeProfileCache: HardwareProfile | null = null;

export function resetClientHardwareProfileCache() {
  activeProfileCache = null;
}

export function getClientHardwareProfile(): HardwareProfile {
  if (activeProfileCache) return activeProfileCache;

  let cores = 4;
  let memoryGB = 4;
  let gpuRenderer: string | undefined;
  let isHardwareAccelerated = false;

  if (typeof window !== "undefined") {
    if (typeof navigator !== "undefined" && typeof navigator.hardwareConcurrency === "number") {
      cores = Math.max(1, navigator.hardwareConcurrency);
    }
    if (typeof navigator !== "undefined" && "deviceMemory" in navigator) {
      const dm = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
      if (typeof dm === "number" && dm > 0) {
        memoryGB = dm;
      }
    } else {
      memoryGB = cores >= 8 ? 8 : (cores >= 4 ? 4 : 2);
    }
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl && "getExtension" in gl) {
        const debugInfo = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
        if (debugInfo) {
          gpuRenderer = (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          if (gpuRenderer) {
            isHardwareAccelerated = !/swiftshader|llvmpipe|softpipe|mesa/i.test(gpuRenderer);
          }
        }
      }
    } catch {}
  }

  let tier: HardwareTier = "TIER_2_BALANCED";
  let tierLabel = "STANDARD BALANCED";
  let maxBatchFiles = 200;
  let maxFileSizeMB = 5000;
  let maxConcurrency = 1;
  let throttleIntervalMs = 33;

  if (cores >= 8 && memoryGB >= 16) {
    tier = "TIER_1_ULTRA";
    tierLabel = "ULTRA PERFORMANCE";
    maxBatchFiles = 500;
    maxFileSizeMB = 50000;
    maxConcurrency = Math.min(4, Math.floor(cores / 2));
    throttleIntervalMs = 8;
  } else if (cores >= 8 || (cores >= 6 && memoryGB >= 8)) {
    tier = "TIER_2_BALANCED";
    tierLabel = "HIGH PERFORMANCE PRO";
    maxBatchFiles = 300;
    maxFileSizeMB = 20000;
    maxConcurrency = Math.min(3, Math.floor(cores / 2));
    throttleIntervalMs = 16;
  } else if (cores <= 2 || memoryGB <= 2) {
    tier = "TIER_3_SAFE";
    tierLabel = "SEQUENTIAL SAFE MODE";
    maxBatchFiles = 50;
    maxFileSizeMB = 3000;
    maxConcurrency = 1;
    throttleIntervalMs = 100;
  }

  activeProfileCache = {
    cores,
    memoryGB,
    tier,
    tierLabel,
    maxBatchFiles,
    maxFileSizeMB,
    maxConcurrency,
    throttleIntervalMs,
    gpuRenderer,
    isHardwareAccelerated,
    mediaLimits: {
      photo: maxBatchFiles * 5,
      audio: maxBatchFiles * 2,
      videoRemux: Math.floor(maxBatchFiles * 0.5),
      videoEncode: Math.floor(maxBatchFiles * 0.25),
    },
  };

  return activeProfileCache;
}

/**
 * Fetches exact OS-level hardware telemetry from the backend.
 */
export async function fetchNativeHardwareProfile(): Promise<HardwareProfile> {
  // In unit test runner without actual backend route active, return client profile safely
  if (typeof process !== "undefined" && process.env?.NODE_ENV === "test" && typeof window !== "undefined") {
    return getClientHardwareProfile();
  }

  try {
    const { safeFetch } = await import("../security/safeFetch");
    const res = await safeFetch("/api/system/hardware");
    if (!res.ok) throw new Error("Hardware telemetry request failed");
    const json = await res.json();
    if (!json.success || !json.profile) throw new Error("Invalid hardware payload");

    const p: DeviceHardwareProfile = json.profile;
    const isHwAccel = p.hardwareAccelerators.videoToolbox || p.hardwareAccelerators.nvenc || p.hardwareAccelerators.vaapi || p.hardwareAccelerators.qsv;

    const mapped: HardwareProfile = {
      cpuModel: p.cpuModel,
      cores: p.totalCores,
      memoryGB: p.totalMemoryGB,
      tier: p.tier as HardwareTier,
      tierLabel: p.tierLabel,
      maxBatchFiles: p.limits.maxBatchFiles.photo,
      maxFileSizeMB: p.limits.maxFileSizeMB,
      maxConcurrency: p.limits.maxParallelWorkers.video,
      throttleIntervalMs: p.tier === "TIER_1_ULTRA" ? 8 : 16,
      isHardwareAccelerated: isHwAccel,
      mediaLimits: {
        photo: p.limits.maxBatchFiles.photo,
        audio: p.limits.maxBatchFiles.audio,
        videoRemux: p.limits.maxBatchFiles.videoRemux,
        videoEncode: p.limits.maxBatchFiles.videoEncode,
      },
    };

    activeProfileCache = mapped;
    return mapped;
  } catch {
    return getClientHardwareProfile();
  }
}

/**
 * Helper to get the exact batch limit for a specific media category.
 */
export function getMediaBatchLimit(profile: HardwareProfile | null, category: MediaCategory, isRemux = false): number {
  if (!profile || !profile.mediaLimits) {
    if (category === "PHOTO") return 1000;
    if (category === "AUDIO") return 500;
    return isRemux ? 200 : 100;
  }

  if (category === "PHOTO") return profile.mediaLimits.photo;
  if (category === "AUDIO") return profile.mediaLimits.audio;
  return isRemux ? profile.mediaLimits.videoRemux : profile.mediaLimits.videoEncode;
}

export interface HardwareBenchmarkResult {
  singleCoreMops: number;
  multiCoreMops: number;
  parallelSpeedup: number;
  workerCount: number;
  measuredAt: number;
}

export interface ClientHardwareSnapshot {
  cores: number;
  memoryGB: number | null;
  gpuRenderer: string | null;
  hasDiscreteOrAppleGpu: boolean;
  isPrivacyMasked?: boolean;
  maskReason?: string | null;
  benchmark?: HardwareBenchmarkResult | null;
}

export type ExecutionRecommendationTarget = "WEBSITE" | "BALANCED" | "DESKTOP_APP" | "PRIVACY_MASKED";

export interface ExecutionRecommendation {
  target: ExecutionRecommendationTarget;
  /** 0 (use Website / Cloud) to 100 (use Native Desktop App), 50 when privacy-masked */
  score: number;
  headline: string;
  rationale: string;
  cloudSpecs: {
    label: string;
    cores: number;
    memoryGB: number;
  };
  clientSpecs: ClientHardwareSnapshot;
}

export const RENDER_CLOUD_BASELINE = {
  label: "RENDER FREE CLOUD",
  cores: 0.1,
  memoryGB: 0.5,
};

export function formatCloudMemoryLabel(memoryGB: number): string {
  if (memoryGB < 1) {
    return `${Math.round(memoryGB * 1024)} MB`;
  }
  return `${memoryGB} GB`;
}

export function formatCloudCoresLabel(cores: number): string {
  if (cores < 1) {
    return cores.toFixed(1);
  }
  return String(cores);
}

const ACCELERATED_GPU_REGEX = /(apple|m1|m2|m3|m4|nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc a\d)/i;
const MASKED_GPU_REGEX = /^(brave|webkit webgl|mozilla|firefox)$/i;

function detectWebGLRenderer(): string | null {
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl || !("getExtension" in gl)) return null;
    const webgl = gl as WebGLRenderingContext;
    const debugInfo = webgl.getExtension("WEBGL_debug_renderer_info");
    if (debugInfo) {
      const renderer = webgl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (typeof renderer === "string" && renderer.trim().length > 0) {
        return renderer.trim();
      }
    }
    const fallbackRenderer = webgl.getParameter(webgl.RENDERER);
    return typeof fallbackRenderer === "string" && fallbackRenderer.trim().length > 0
      ? fallbackRenderer.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Inspects the visitor's browser hardware directly without reading or mutating `activeProfileCache`,
 * because `fetchNativeHardwareProfile()` stores the server profile in that cache.
 */
export function inspectBrowserHardware(): ClientHardwareSnapshot {
  if (typeof navigator === "undefined") {
    return {
      cores: 2,
      memoryGB: null,
      gpuRenderer: null,
      hasDiscreteOrAppleGpu: false,
      isPrivacyMasked: false,
      maskReason: null,
    };
  }

  const nav = navigator as Navigator & { deviceMemory?: number; brave?: unknown };
  const cores = typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0
    ? nav.hardwareConcurrency
    : 2;
  const memoryGB = typeof nav.deviceMemory === "number" && nav.deviceMemory > 0
    ? nav.deviceMemory
    : null;
  const gpuRenderer = detectWebGLRenderer();
  const hasDiscreteOrAppleGpu = Boolean(gpuRenderer && ACCELERATED_GPU_REGEX.test(gpuRenderer));

  // Detect privacy-browser farbling / anti-fingerprinting (e.g. Brave spoofs GPU to "Brave",
  // alters hardwareConcurrency to odd numbers like 3/5/7, and caps/spoofs deviceMemory to 4 GB).
  const isOddFarbledCores = cores > 1 && cores % 2 === 1;
  const isGpuMasked = Boolean(gpuRenderer && MASKED_GPU_REGEX.test(gpuRenderer));
  const hasBraveObject = Boolean(nav.brave);

  let isPrivacyMasked = false;
  let maskReason: string | null = null;

  if (hasBraveObject || (gpuRenderer && /^brave$/i.test(gpuRenderer))) {
    isPrivacyMasked = true;
    maskReason = "Brave Shields anti-fingerprinting is spoofing your RAM, CPU threads, and GPU";
  } else if (isGpuMasked || isOddFarbledCores) {
    isPrivacyMasked = true;
    maskReason = "Browser privacy protection is masking or randomizing your real hardware specs";
  }

  return {
    cores,
    memoryGB,
    gpuRenderer,
    hasDiscreteOrAppleGpu,
    isPrivacyMasked,
    maskReason,
  };
}

const BENCHMARK_STORAGE_KEY = "celestial_hw_bench_v1";
const BENCHMARK_CACHE_TTL_MS = 30 * 60 * 1000;

function readCachedBenchmark(): HardwareBenchmarkResult | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage?.getItem(BENCHMARK_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HardwareBenchmarkResult;
    if (
      Number.isFinite(parsed?.singleCoreMops) &&
      parsed.singleCoreMops > 0 &&
      Number.isFinite(parsed?.multiCoreMops) &&
      parsed.multiCoreMops > 0 &&
      Number.isFinite(parsed?.parallelSpeedup) &&
      parsed.parallelSpeedup > 0 &&
      Number.isFinite(parsed?.measuredAt) &&
      Date.now() - parsed.measuredAt < BENCHMARK_CACHE_TTL_MS
    ) {
      return parsed;
    }
  } catch {
    // Ignore storage access errors under strict browser settings
  }
  return null;
}

function writeCachedBenchmark(result: HardwareBenchmarkResult): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage?.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(result));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Runs a ~140ms multi-worker silicon benchmark via `/hardware-probe-worker.js` to measure real
 * single-core and multi-core throughput even when browsers like Brave spoof `navigator` metadata.
 */
export async function runBrowserComputeBenchmark(options?: {
  force?: boolean;
  workerCount?: number;
  singleMs?: number;
  multiMs?: number;
  timeoutMs?: number;
}): Promise<HardwareBenchmarkResult | null> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }

  if (!options?.force) {
    const cached = readCachedBenchmark();
    if (cached) return cached;
  }

  const workerCount = Math.max(2, Math.min(8, options?.workerCount ?? 8));
  const singleMs = options?.singleMs ?? 60;
  const multiMs = options?.multiMs ?? 80;
  const timeoutMs = options?.timeoutMs ?? 2500;
  const workers: Worker[] = [];

  try {
    const spawnReadyWorker = () =>
      new Promise<Worker>((resolve, reject) => {
        const w = new Worker("/hardware-probe-worker.js");
        workers.push(w);
        const timer = window.setTimeout(() => {
          w.onmessage = null;
          w.onerror = null;
          reject(new Error("Worker ready timeout"));
        }, timeoutMs);
        w.onmessage = (e: MessageEvent<{ type?: string }>) => {
          if (e.data?.type === "ready") {
            window.clearTimeout(timer);
            w.onmessage = null;
            w.onerror = null;
            resolve(w);
          }
        };
        w.onerror = () => {
          window.clearTimeout(timer);
          w.onmessage = null;
          w.onerror = null;
          reject(new Error("Worker error"));
        };
      });

    const readyWorkers = await Promise.all(
      Array.from({ length: workerCount }, () => spawnReadyWorker())
    );

    const runOne = (w: Worker, durationMs: number) =>
      new Promise<{ ops: number; durationMs: number }>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          w.onmessage = null;
          w.onerror = null;
          reject(new Error("Worker run timeout"));
        }, timeoutMs);
        w.onmessage = (e: MessageEvent<{ type?: string; ops?: number; durationMs?: number }>) => {
          if (e.data?.type === "done") {
            window.clearTimeout(timer);
            w.onmessage = null;
            w.onerror = null;
            resolve({
              ops: Math.max(0, Number(e.data.ops || 0)),
              durationMs: Math.max(1, Number(e.data.durationMs || durationMs)),
            });
          }
        };
        w.onerror = () => {
          window.clearTimeout(timer);
          w.onmessage = null;
          w.onerror = null;
          reject(new Error("Worker execution error"));
        };
        w.postMessage({ type: "run", durationMs });
      });

    // Phase 1: Single-core baseline speed
    const singleStart = performance.now();
    const single = await runOne(readyWorkers[0], singleMs);
    const singleWallMs = Math.max(singleMs, performance.now() - singleStart);
    const singleCoreMops = Math.round((single.ops / 1e6) / (singleWallMs / 1000));

    // Phase 2: All workers simultaneously to probe real physical multi-core scaling
    const multiStart = performance.now();
    const multiResults = await Promise.all(readyWorkers.map((w) => runOne(w, multiMs)));
    const multiWallMs = Math.max(multiMs, performance.now() - multiStart);
    const totalOps = multiResults.reduce((sum, item) => sum + item.ops, 0);
    const multiCoreMops = Math.round((totalOps / 1e6) / (multiWallMs / 1000));

    const result: HardwareBenchmarkResult = {
      singleCoreMops: Math.max(1, singleCoreMops),
      multiCoreMops: Math.max(1, multiCoreMops),
      parallelSpeedup: singleCoreMops > 0
        ? Number((multiCoreMops / singleCoreMops).toFixed(1))
        : 1,
      workerCount,
      measuredAt: Date.now(),
    };

    writeCachedBenchmark(result);
    return result;
  } catch {
    return null;
  } finally {
    for (const w of workers) {
      try {
        w.terminate();
      } catch {
        // Ignore cleanup failure
      }
    }
  }
}

/**
 * Compares the visitor's browser hardware (plus optional silicon probe) against the active cloud
 * engine (or Render Free Cloud baseline during local dev) and returns a 0-100 score.
 */
export function recommendExecutionMode(
  client: ClientHardwareSnapshot,
  server?: HardwareProfile | null,
  options?: { isLocalhost?: boolean }
): ExecutionRecommendation {
  const isLocalhost = options?.isLocalhost ?? (
    typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
  );

  const cloudSpecs = !server || isLocalhost
    ? RENDER_CLOUD_BASELINE
    : {
        label: server.memoryGB <= 1 || server.cores < 1
          ? "RENDER FREE CLOUD"
          : "LIVE CLOUD ENGINE",
        cores: server.cores > 0 ? server.cores : RENDER_CLOUD_BASELINE.cores,
        memoryGB: server.memoryGB > 0 ? server.memoryGB : RENDER_CLOUD_BASELINE.memoryGB,
      };

  const isConstrainedCloud = cloudSpecs.memoryGB <= 1 || cloudSpecs.cores < 1;
  const cloudMemText = formatCloudMemoryLabel(cloudSpecs.memoryGB);
  const cloudCoreText = formatCloudCoresLabel(cloudSpecs.cores);

  // When live silicon probe results exist, score directly from measured multi-core + single-core
  // compute throughput so privacy-browser metadata spoofing cannot misclassify an M2/RTX workstation.
  if (client.benchmark && client.benchmark.multiCoreMops > 0) {
    const { singleCoreMops, multiCoreMops, parallelSpeedup } = client.benchmark;

    let benchScore = 24;
    if (multiCoreMops >= 650) {
      benchScore = 90;
    } else if (multiCoreMops >= 450) {
      benchScore = 80;
    } else if (multiCoreMops >= 300) {
      benchScore = 69;
    } else if (multiCoreMops >= 200) {
      benchScore = 52;
    } else if (multiCoreMops >= 140) {
      benchScore = 36;
    } else {
      benchScore = 22;
    }

    if (singleCoreMops >= 130) {
      benchScore += 6;
    } else if (singleCoreMops < 75) {
      benchScore -= 8;
    }

    if (client.hasDiscreteOrAppleGpu) {
      benchScore += 5;
    }

    if (isConstrainedCloud) {
      // Render Free (0.1 vCPU / 512 MB) is throttled & RAM-capped; almost any PC >= 110 M ops/s beats it.
      if (multiCoreMops >= 110) {
        benchScore += 36;
      } else {
        benchScore += 18;
      }
    } else if (!client.isPrivacyMasked && client.memoryGB !== null && client.memoryGB <= 4 && !client.hasDiscreteOrAppleGpu) {
      benchScore -= 14;
    }

    const score = Math.max(5, Math.min(98, Math.round(benchScore)));

    if (score <= 38) {
      return {
        target: "WEBSITE",
        score,
        headline: "USE THE WEBSITE (CLOUD RECOMMENDED)",
        rationale: `Live silicon probe measured ${multiCoreMops} M ops/s multi-core (${singleCoreMops} M ops/s single, ${parallelSpeedup}x scaling). Our ${cloudMemText} cloud container avoids choking ultra-light hardware.`,
        cloudSpecs,
        clientSpecs: client,
      };
    }

    if (score < 65) {
      return {
        target: "BALANCED",
        score,
        headline: "EITHER WORKS — APP RECOMMENDED FOR LARGE VIDEO",
        rationale: `Live silicon probe measured ${multiCoreMops} M ops/s multi-core (${parallelSpeedup}x scaling). Fine for short clips on the ${cloudMemText} web host; use the Desktop App for multi-gigabyte video.`,
        cloudSpecs,
        clientSpecs: client,
      };
    }

    return {
      target: "DESKTOP_APP",
      score,
      headline: "USE THE NATIVE DESKTOP APP (FASTEST)",
      rationale: `Live silicon probe measured ${multiCoreMops} M ops/s parallel throughput (${singleCoreMops} M ops/s single-core, ${parallelSpeedup}x scaling${client.isPrivacyMasked ? ", bypassing browser privacy spoofing" : ""}). Running natively will crush the shared ${cloudCoreText}-vCPU / ${cloudMemText} cloud container.`,
      cloudSpecs,
      clientSpecs: client,
    };
  }

  if (client.isPrivacyMasked) {
    return {
      target: "PRIVACY_MASKED",
      score: 50,
      headline: "BROWSER SHIELDS ARE HIDING YOUR REAL HARDWARE SPECS",
      rationale: `${client.maskReason || "Your browser is masking hardware telemetry"} (reporting spoofed ${client.cores} threads${client.memoryGB ? `, ${client.memoryGB} GB` : ""}${client.gpuRenderer ? `, GPU: ${client.gpuRenderer}` : ""}). Select your actual PC tier on the right to compare against the shared ${cloudCoreText} vCPU / ${cloudMemText} cloud server.`,
      cloudSpecs,
      clientSpecs: client,
    };
  }

  let score: number;
  if (isConstrainedCloud) {
    // Against Render Free (0.1 vCPU / 512 MB RAM), virtually every desktop/laptop outclasses the container.
    score = 68;
    if (client.cores >= 12) {
      score += 20;
    } else if (client.cores >= 8) {
      score += 16;
    } else if (client.cores >= 6) {
      score += 12;
    } else if (client.cores >= 4) {
      score += 6;
    } else {
      score -= 10;
    }

    if (client.memoryGB !== null) {
      if (client.memoryGB <= 2) {
        score -= 16;
      } else if (client.memoryGB <= 4) {
        score += 4;
      } else if (client.memoryGB >= 8) {
        score += 10;
      }
    }

    if (client.hasDiscreteOrAppleGpu) {
      score += 8;
    }
  } else {
    // Against a larger cloud node (e.g., 2+ vCPU / 8-16+ GB RAM), compare host resources fairly.
    score = 34;

    if (client.cores >= 12) {
      score += 34;
    } else if (client.cores >= 8) {
      score += 28;
    } else if (client.cores >= 6) {
      score += 18;
    } else if (client.cores >= 4) {
      score += 6;
    } else {
      score -= 16;
    }

    if (client.memoryGB !== null) {
      if (client.memoryGB <= 2) {
        score -= 22;
      } else if (client.memoryGB <= 4) {
        score -= client.hasDiscreteOrAppleGpu ? 4 : 15;
      } else if (client.memoryGB >= 8) {
        score += client.cores >= 6 || client.hasDiscreteOrAppleGpu ? 16 : 8;
      }
    } else if (client.hasDiscreteOrAppleGpu) {
      score += 10;
    }

    if (client.hasDiscreteOrAppleGpu) {
      score += 22;
    }

    if (cloudSpecs.cores >= 8 && !client.hasDiscreteOrAppleGpu && client.cores <= 8) {
      score -= 12;
    }
  }

  score = Math.max(5, Math.min(98, Math.round(score)));

  if (score <= 38) {
    return {
      target: "WEBSITE",
      score,
      headline: "USE THE WEBSITE (CLOUD RECOMMENDED)",
      rationale: `Your device (${client.cores} threads${client.memoryGB ? `, ${client.memoryGB} GB reported RAM` : ""}) can bog down or swap during heavy FFmpeg encodes. Our ${cloudMemText} cloud container keeps your PC cool and responsive.`,
      cloudSpecs,
      clientSpecs: client,
    };
  }

  if (score < 65) {
    return {
      target: "BALANCED",
      score,
      headline: "EITHER WORKS — APP RECOMMENDED FOR LARGE VIDEO",
      rationale: isConstrainedCloud
        ? `Quick light clips work on the shared ${cloudCoreText} vCPU / ${cloudMemText} Render container; run locally via Desktop App to avoid 512 MB RAM caps and idle spin-down waits.`
        : `Your ${client.cores}-thread system matches quick website batches well. Switch to the Desktop App for multi-gigabyte 4K encodes or zero upload wait.`,
      cloudSpecs,
      clientSpecs: client,
    };
  }

  return {
    target: "DESKTOP_APP",
    score,
    headline: "USE THE NATIVE DESKTOP APP (FASTEST)",
    rationale: isConstrainedCloud
      ? `Your hardware (${client.cores} threads${client.memoryGB ? `, ${client.memoryGB} GB RAM` : ""}${client.hasDiscreteOrAppleGpu ? ", GPU hardware acceleration" : ""}) easily outperforms the shared ${cloudCoreText} vCPU / ${cloudMemText} Render Free server with zero upload/download roundtrips or spin-down delays.`
      : `Your hardware (${client.cores} threads${client.hasDiscreteOrAppleGpu ? ", GPU hardware acceleration detected" : ""}) will run 5x–15x faster natively with zero upload/download roundtrips.`,
    cloudSpecs,
    clientSpecs: client,
  };
}
