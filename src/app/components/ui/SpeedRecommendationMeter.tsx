'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useHardwareProfile } from '../../context/GlobalJobContext';
import {
  ClientHardwareSnapshot,
  inspectBrowserHardware,
  recommendExecutionMode,
  runBrowserComputeBenchmark,
} from '../../../lib/system/hardwareProfiler';

function SvgIcon({ children, className = 'w-4 h-4' }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

const DownloadIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </SvgIcon>
);

const LaptopIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16" />
  </SvgIcon>
);

const TerminalIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </SvgIcon>
);

const CloseIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </SvgIcon>
);

const ChevronIcon = ({ rotated, className }: { rotated?: boolean; className?: string }) => (
  <SvgIcon className={`${className ?? 'w-3.5 h-3.5'} transition-transform duration-150 ${rotated ? 'rotate-180' : ''}`}>
    <polyline points="6 9 12 15 18 9" />
  </SvgIcon>
);

type PresetId = 'DETECTED' | 'LOW_SPEC' | 'MID_RANGE' | 'HIGH_SPEC';

interface PresetOption {
  id: Exclude<PresetId, 'DETECTED'>;
  label: string;
  spec: ClientHardwareSnapshot;
}

const PRESET_OPTIONS: readonly PresetOption[] = [
  {
    id: 'LOW_SPEC',
    label: '4GB / i3 PC',
    spec: {
      cores: 4,
      memoryGB: 4,
      gpuRenderer: 'Intel(R) UHD Graphics 620',
      hasDiscreteOrAppleGpu: false,
    },
  },
  {
    id: 'MID_RANGE',
    label: '8GB LAPTOP',
    spec: {
      cores: 4,
      memoryGB: 8,
      gpuRenderer: 'Intel(R) Iris(R) Xe Graphics',
      hasDiscreteOrAppleGpu: false,
    },
  },
  {
    id: 'HIGH_SPEC',
    label: '16GB+ / M-SERIES / RTX',
    spec: {
      cores: 8,
      memoryGB: 8,
      gpuRenderer: 'Apple M2 / M3 / NVIDIA RTX',
      hasDiscreteOrAppleGpu: true,
    },
  },
];

function getSafeDesktopAppUrl(): string | null {
  const raw = process.env.NEXT_PUBLIC_DESKTOP_APP_URL?.trim();
  if (!raw) return null;
  if (raw.startsWith('https://') || raw.startsWith('http://')) {
    return raw;
  }
  return null;
}

export function SpeedRecommendationMeter() {
  const serverProfile = useHardwareProfile();
  const shouldReduceMotion = useReducedMotion();
  const [preset, setPreset] = useState<PresetId>('DETECTED');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detectedClient, setDetectedClient] = useState<ClientHardwareSnapshot>({
    cores: 4,
    memoryGB: null,
    gpuRenderer: null,
    hasDiscreteOrAppleGpu: false,
    isPrivacyMasked: false,
    maskReason: null,
  });
  const [hasDetected, setHasDetected] = useState(false);
  const [hasWorkerSupport, setHasWorkerSupport] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const isMountedRef = useRef(true);

  const executeSiliconProbe = async (force: boolean) => {
    if (!hasWorkerSupport) return;
    setIsProbing(true);
    try {
      const benchmark = await runBrowserComputeBenchmark({ force });
      if (isMountedRef.current && benchmark) {
        setDetectedClient((prev) => ({
          ...prev,
          benchmark,
        }));
      }
    } finally {
      if (isMountedRef.current) {
        setIsProbing(false);
      }
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    let active = true;
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    setIsLocalhost(host === 'localhost' || host === '127.0.0.1');

    const snapshot = inspectBrowserHardware();
    setDetectedClient(snapshot);
    setHasDetected(true);
    const workerAvailable = typeof Worker !== 'undefined';
    setHasWorkerSupport(workerAvailable);

    const navWithBrave = navigator as Navigator & {
      brave?: { isBrave?: () => Promise<boolean> };
    };
    if (navWithBrave.brave?.isBrave) {
      navWithBrave.brave
        .isBrave()
        .then((isBrave) => {
          if (!active || !isBrave) return;
          setDetectedClient((prev) => ({
            ...prev,
            isPrivacyMasked: true,
            maskReason:
              prev.maskReason ||
              'Brave Shields anti-fingerprinting is spoofing your RAM, CPU threads, and GPU',
          }));
        })
        .catch(() => undefined);
    }

    let probeTimer: ReturnType<typeof setTimeout> | null = null;
    if (workerAvailable) {
      setIsProbing(true);
      probeTimer = setTimeout(() => {
        runBrowserComputeBenchmark()
          .then((benchmark) => {
            if (!active || !benchmark) return;
            setDetectedClient((prev) => ({
              ...prev,
              benchmark,
            }));
          })
          .finally(() => {
            if (active) setIsProbing(false);
          });
      }, 30);
    }

    return () => {
      isMountedRef.current = false;
      active = false;
      if (probeTimer) clearTimeout(probeTimer);
    };
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setModalOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen]);

  const selectedPreset = PRESET_OPTIONS.find((item) => item.id === preset) ?? null;
  const activeClient = selectedPreset ? selectedPreset.spec : detectedClient;

  const recommendation = useMemo(
    () => recommendExecutionMode(activeClient, serverProfile),
    [activeClient, serverProfile]
  );

  const desktopAppUrl = getSafeDesktopAppUrl();

  const verdictBadge = useMemo(() => {
    if (recommendation.target === 'PRIVACY_MASKED') {
      return {
        label: 'SPECS SHIELDED',
        dotClass: 'bg-[#C084FC]',
        accentClass: 'text-[#C084FC] border-[#C084FC]/40 bg-[#C084FC]/10',
        compactSummary:
          'Cloud site uses shared 2-vCPU servers — expand Details to verify your PC vs. the Desktop App.',
      };
    }
    if (recommendation.target === 'WEBSITE') {
      return {
        label: 'USE WEBSITE',
        dotClass: 'bg-[#38BDF8]',
        accentClass: 'text-[#38BDF8] border-[#38BDF8]/40 bg-[#38BDF8]/10',
        compactSummary: `Shared ${recommendation.cloudSpecs.memoryGB} GB cloud site runs safer & smoother than your low-spec PC.`,
      };
    }
    if (recommendation.target === 'BALANCED') {
      return {
        label: 'BALANCED FIT',
        dotClass: 'bg-[#F59E0B]',
        accentClass: 'text-[#F59E0B] border-[#F59E0B]/40 bg-[#F59E0B]/10',
        compactSummary:
          'Free cloud site works for quick clips; Desktop App avoids uploads for large 4K video.',
      };
    }
    return {
      label: 'USE DESKTOP APP',
      dotClass: 'bg-[#FF5A00]',
      accentClass: 'text-[#FF5A00] border-[#FF5A00]/45 bg-[#FF5A00]/12',
      compactSummary:
        'Cloud site runs on shared 2-vCPU servers (not fastest) — your device runs much faster natively.',
    };
  }, [recommendation.target, recommendation.cloudSpecs.memoryGB]);

  const ramLabel = activeClient.memoryGB !== null
    ? `${activeClient.memoryGB} GB${activeClient.memoryGB === 8 ? '+' : ''}`
    : 'Hidden';

  return (
    <>
      <div className="w-full px-6 pt-6">
        <section
          aria-label="Execution Speed Disclaimer and Hardware Recommendation Meter"
          data-testid="speed-recommendation-meter"
          className="w-full border border-[var(--border-subtle)] bg-[#08080A] rounded-sm overflow-hidden"
        >
          {/* Compact Single-Strip Primary Bar */}
          <div className="px-4 py-3 flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <span
                data-testid="recommendation-badge"
                className={`inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider px-2 py-1 border rounded-sm shrink-0 ${verdictBadge.accentClass}`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${verdictBadge.dotClass}`} />
                {verdictBadge.label} ({recommendation.score}%)
              </span>

              <h2 className="sr-only">Device vs Cloud Execution Fit</h2>
              <p className="text-xs text-[var(--text-secondary)] truncate max-w-2xl">
                {verdictBadge.compactSummary}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {/* Compact Inline Gauge */}
              <div className="flex items-center gap-2" aria-label={`Recommendation score ${recommendation.score} percent`}>
                <span className="font-mono text-[9px] uppercase tracking-wider text-[#38BDF8]/80">Web</span>
                <div className="relative h-1.5 w-28 sm:w-36 rounded-full overflow-hidden bg-[#141418] border border-white/10">
                  <div
                    className="absolute inset-0 opacity-45"
                    style={{
                      background:
                        'linear-gradient(90deg, #38BDF8 0%, #F59E0B 50%, #FF5A00 100%)',
                    }}
                  />
                  <motion.div
                    data-testid="meter-needle"
                    className="absolute top-0 bottom-0 w-1.5 -ml-[3px] rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.9)]"
                    initial={false}
                    animate={{ left: `${recommendation.score}%` }}
                    transition={
                      shouldReduceMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 260, damping: 24 }
                    }
                  />
                </div>
                <span className="font-mono text-[9px] uppercase tracking-wider text-[#FF5A00]/90">App</span>
              </div>

              <button
                type="button"
                aria-expanded={detailsOpen}
                onClick={() => setDetailsOpen((open) => !open)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-sm border border-[var(--border-subtle)] bg-black/40 text-[var(--text-secondary)] hover:text-white font-mono text-[10px] uppercase tracking-wider transition-colors cursor-pointer"
              >
                {detailsOpen ? 'Hide' : 'Details'}
                <ChevronIcon rotated={detailsOpen} className="w-3 h-3" />
              </button>

              {desktopAppUrl ? (
                <a
                  href={desktopAppUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm bg-[#FF5A00] text-black font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-[#FF7A33] transition-colors"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  Desktop App
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-sm bg-[#FF5A00] text-black font-mono text-[10px] font-bold uppercase tracking-wider hover:bg-[#FF7A33] transition-colors cursor-pointer"
                >
                  <LaptopIcon className="w-3.5 h-3.5" />
                  Desktop App
                </button>
              )}
            </div>
          </div>

          {/* Expandable Details Drawer (Collapsed by Default for Minimal Clutter) */}
          <AnimatePresence initial={false}>
            {detailsOpen && (
              <motion.div
                data-testid="meter-details-drawer"
                initial={shouldReduceMotion ? { opacity: 1 } : { height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                transition={{ duration: 0.16 }}
                className="overflow-hidden border-t border-[var(--border-subtle)] bg-[#050507]"
              >
                <div className="p-4 space-y-3">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <p className="text-xs text-[var(--text-secondary)] max-w-3xl leading-relaxed">
                      <span className="text-[var(--text-primary)] font-medium mr-1.5">
                        {recommendation.headline}:
                      </span>
                      {recommendation.rationale}
                    </p>

                    <div
                      className="flex flex-wrap items-center gap-1.5 shrink-0"
                      role="group"
                      aria-label="Simulate device hardware profile"
                    >
                      <button
                        type="button"
                        onClick={() => setPreset('DETECTED')}
                        className={`px-2 py-1 rounded-sm font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer ${
                          preset === 'DETECTED'
                            ? 'bg-white text-black border-white font-bold'
                            : 'bg-black/40 text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-white'
                        }`}
                      >
                        {hasDetected ? 'Detected PC' : 'Scanning...'}
                      </button>
                      {PRESET_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setPreset(option.id)}
                          className={`px-2 py-1 rounded-sm font-mono text-[10px] uppercase tracking-wider border transition-colors cursor-pointer ${
                            preset === option.id
                              ? 'bg-[#FF5A00] text-black border-[#FF5A00] font-bold'
                              : 'bg-black/40 text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-white'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
                    <div className="p-2.5 rounded-sm bg-black/50 border border-[var(--border-subtle)] flex items-center justify-between gap-3">
                      <div className="min-w-0 space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                          {selectedPreset ? `Simulated: ${selectedPreset.label}` : 'Your Device'}
                        </div>
                        <div className="text-[var(--text-primary)] truncate">
                          {activeClient.cores} Threads · {ramLabel} RAM
                          {activeClient.isPrivacyMasked && !selectedPreset ? ' (Spoofed)' : ''}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] truncate">
                          {activeClient.benchmark
                            ? `Silicon Probe: ${activeClient.benchmark.multiCoreMops} M ops/s (${activeClient.benchmark.parallelSpeedup}x scaling)`
                            : !selectedPreset && isProbing
                              ? 'Running ~140ms silicon speed probe...'
                              : `GPU: ${activeClient.gpuRenderer || 'Standard / Integrated'}`}
                          {isLocalhost && !selectedPreset && activeClient.isPrivacyMasked && serverProfile
                            ? ` · Local OS: ${serverProfile.cores}C / ${serverProfile.memoryGB} GB`
                            : ''}
                        </div>
                      </div>
                      {!selectedPreset && hasWorkerSupport && (
                        <button
                          type="button"
                          disabled={isProbing}
                          onClick={() => void executeSiliconProbe(true)}
                          className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-white disabled:opacity-50 cursor-pointer"
                        >
                          {isProbing ? 'Probing...' : 'Re-Probe'}
                        </button>
                      )}
                    </div>

                    <div className="p-2.5 rounded-sm bg-black/50 border border-[var(--border-subtle)] space-y-0.5">
                      <div className="text-[10px] uppercase tracking-wider text-[var(--text-secondary)]">
                        {recommendation.cloudSpecs.label}
                      </div>
                      <div className="text-[var(--text-primary)]">
                        {recommendation.cloudSpecs.cores} vCPU · {recommendation.cloudSpecs.memoryGB} GB RAM
                      </div>
                      <div className="text-[10px] text-[var(--text-secondary)]">
                        Free shared container · Requires upload/download roundtrip
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </div>

      {/* Native Desktop App Info / Local Launch Modal */}
      <AnimatePresence>
        {modalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-app-modal-title"
          >
            <motion.div
              initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.16 }}
              className="w-full max-w-lg rounded-sm border border-[#FF5A00]/40 bg-[#0A0A0C] p-5 space-y-4 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
                <div className="flex items-center gap-2">
                  <LaptopIcon className="w-4 h-4 text-[#FF5A00]" />
                  <h3 id="desktop-app-modal-title" className="font-mono text-xs uppercase tracking-widest text-white font-bold">
                    Native Desktop App // Maximum Speed Mode
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  aria-label="Close Desktop App modal"
                  className="p-1 text-[var(--text-secondary)] hover:text-white cursor-pointer"
                >
                  <CloseIcon className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-[var(--text-secondary)] leading-relaxed">
                <p className="text-[var(--text-primary)]">
                  Run Celestial Media Hub locally on macOS, Linux, or Windows to unlock your CPU/GPU hardware encoder (Apple VideoToolbox, NVIDIA NVENC, Intel QSV) with zero upload/download roundtrips or cloud queue limits.
                </p>
                <div className="p-3 rounded-sm bg-black border border-[var(--border-subtle)] space-y-1.5 font-mono text-[11px] text-[#E4E4E7]">
                  <div className="flex items-center gap-1.5 text-[#FF5A00] text-[10px] uppercase tracking-wider">
                    <TerminalIcon className="w-3.5 h-3.5" />
                    Run Locally (macOS / Linux / Windows)
                  </div>
                  <p className="select-all">git clone https://github.com/aradhyjain107/celestial-media-hub.git</p>
                  <p className="select-all">cd celestial-media-hub &amp;&amp; npm install &amp;&amp; npm run dev</p>
                </div>
                <p>
                  Requires <span className="font-mono text-[var(--text-primary)]">Node.js 18+</span>,{' '}
                  <span className="font-mono text-[var(--text-primary)]">ffmpeg</span>, and{' '}
                  <span className="font-mono text-[var(--text-primary)]">yt-dlp</span> in your{' '}
                  <code className="font-mono text-[#FF5A00]">PATH</code> (or run zero-install via{' '}
                  <span className="font-mono text-[var(--text-primary)]">Docker</span>).
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[var(--border-subtle)]">
                <a
                  href="https://github.com/aradhyjain107/celestial-media-hub"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-1.5 rounded-sm border border-[var(--border-subtle)] text-[var(--text-primary)] hover:border-white/40 font-mono text-[11px] uppercase tracking-wider transition-colors"
                >
                  Open GitHub Repo
                </a>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-1.5 rounded-sm bg-[#FF5A00] text-black font-mono text-[11px] font-bold uppercase tracking-wider hover:bg-[#FF7A33] cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
