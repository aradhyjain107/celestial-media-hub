'use client'

import { useState, useMemo, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { FileDropzone } from '../../components/ui/FileDropzone';
import { useJob, useHardwareProfile, safeCreateObjectURL, safeRevokeObjectURL } from '../../context/GlobalJobContext';
import { getMediaBatchLimit } from '../../../lib/system/hardwareProfiler';
import { ResizableOptionsPanel } from '../../components/ui/ResizableOptionsPanel';
import { TooltipTop, TooltipBottom } from '../../components/ui/Tooltip';
import { MasterHeader } from '../../components/ui/MasterHeader';
import { authenticatedFetch, appendAuthToken, useSessionToken } from '../../../lib/security/clientAuth';

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  // eslint-disable-next-line security/detect-object-injection
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function splitFilename(name: string): { stem: string; ext: string } {
  const extIndex = name.lastIndexOf('.');
  if (extIndex > 0 && extIndex > name.length - 10) {
    return { stem: name.slice(0, extIndex), ext: name.slice(extIndex) };
  }
  return { stem: name, ext: '' };
}

interface HevcOptionItem<T extends string> {
  value: T;
  label: string;
  testId?: string;
}

function HevcOptionGrid<T extends string>({
  items,
  selected,
  onSelect,
  reducedMotion,
}: {
  items: readonly HevcOptionItem<T>[];
  selected: T;
  onSelect: (val: T) => void;
  reducedMotion: boolean;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '6px', padding: '4px 2px' }}>
      {items.map((item, idx) => {
        const isSel = selected === item.value;
        return (
          <motion.button
            key={item.value}
            type="button"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={reducedMotion ? { duration: 0 } : { duration: 0.12, delay: idx * 0.02 }}
            whileHover={reducedMotion ? undefined : { scale: 1.05 }}
            whileTap={reducedMotion ? undefined : { scale: 0.94 }}
            onClick={() => onSelect(item.value)}
            aria-pressed={isSel}
            data-testid={item.testId}
            style={{
              position: 'relative',
              minHeight: '36px',
              padding: '8px 4px',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.65625rem',
              fontWeight: 700,
              letterSpacing: '0.05em',
              cursor: 'pointer',
              borderRadius: '4px',
              border: isSel ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
              background: isSel ? 'rgba(255, 90, 0, 0.18)' : 'rgba(15, 15, 18, 0.65)',
              color: isSel ? 'var(--accent)' : 'var(--text-muted)',
              boxShadow: isSel ? '0 0 14px rgba(255, 90, 0, 0.28)' : 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
            }}
          >
            {item.label}
          </motion.button>
        );
      })}
    </div>
  );
}

type MediaCategory = 'VIDEO' | 'AUDIO' | 'PHOTO' | 'OTHER';

function detectCategory(fileName: string): MediaCategory {
  if (!fileName) return 'OTHER';
  const parts = fileName.split('.');
  if (parts.length <= 1) return 'OTHER';
  const ext = parts.pop()?.toLowerCase() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'cr2', 'pdf', 'heic', 'heif'].includes(ext)) return 'PHOTO';
  if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus', 'wma'].includes(ext)) return 'AUDIO';
  if (['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'flv', 'wmv'].includes(ext)) return 'VIDEO';
  return 'OTHER';
}

function getFileKey(f: File): string {
  return `${f.name}_${f.size}_${f.lastModified || 0}`;
}

interface ClientMediaMeta {
  duration: number;
  width: number;
  height: number;
}

export default function UniversalCompressorPage() {
  const crfId = useId();
  const imageQualityId = useId();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const sessionToken = useSessionToken();
  const [files, setFiles] = useState<File[]>([]);
  const [activeTab, setActiveTab] = useState<'VIDEO' | 'AUDIO' | 'PHOTO'>('VIDEO');
  const [clientMeta, setClientMeta] = useState<Record<string, ClientMediaMeta>>({});
  const [serverEstimates, setServerEstimates] = useState<{ signature: string; byKey: Record<string, number> }>({
    signature: '',
    byKey: {},
  });
  const uploadedKeysRef = useRef<Set<string>>(new Set());
  const inFlightUploadRef = useRef<Promise<boolean> | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const completedSignatureRef = useRef<string>('');

  // Video Parameters
  const [videoCodec, setVideoCodec] = useState<'hevc' | 'h264' | 'av1' | 'vp9'>('hevc');
  const [videoCrf, setVideoCrf] = useState<number>(28);
  const [resolution, setResolution] = useState<'original' | '1080p' | '720p' | '480p'>('original');

  // Audio Parameters
  const [audioBitrate, setAudioBitrate] = useState<'64k' | '128k' | '192k' | '320k'>('128k');
  const [audioFormat, setAudioFormat] = useState<'mp3' | 'aac' | 'ogg' | 'flac'>('mp3');

  // Photo Parameters
  const [imageQuality, setImageQuality] = useState<number>(80);
  const [imageFormat, setImageFormat] = useState<'webp' | 'jpeg' | 'png' | 'avif'>('webp');
  const [maxDimension, setMaxDimension] = useState<'original' | '3840' | '1920' | '1080' | '800'>('original');

  const [hardwareAccel, setHardwareAccel] = useState<boolean>(false);

  const { jobState, startJob, updateJob, clearJob } = useJob('hevc');
  const hardwareProfile = useHardwareProfile();
  const currentBatchLimit = getMediaBatchLimit(hardwareProfile, activeTab, false);
  const status = jobState?.status || 'idle';
  const progress = jobState?.progress || 0;
  const statusText = jobState?.statusText || '';
  const downloadUrl = jobState?.downloadUrl || null;

  const handleFilesSelected = (newFiles: File[]) => {
    if (newFiles.length > 0) {
      const firstCat = detectCategory(newFiles[0].name);
      const mappedTab: 'VIDEO' | 'AUDIO' | 'PHOTO' = firstCat === 'OTHER' ? 'VIDEO' : firstCat;
      const dynamicLimit = getMediaBatchLimit(hardwareProfile, mappedTab, false);
      setFiles(prev => {
        const combined = [...prev, ...newFiles];
        return combined.slice(0, dynamicLimit);
      });
      setActiveTab(mappedTab);
    }
  };

  const handleClear = () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    inFlightUploadRef.current = null;
    setFiles([]);
    setClientMeta({});
    setServerEstimates({ signature: '', byKey: {} });
    completedSignatureRef.current = '';
    clearJob();
  };

  const paramsSignature = useMemo(
    () =>
      JSON.stringify({
        keys: files.map(getFileKey),
        videoCodec,
        videoCrf,
        resolution,
        audioBitrate,
        audioFormat,
        imageQuality,
        imageFormat,
        maxDimension,
        hardwareAccel,
      }),
    [files, videoCodec, videoCrf, resolution, audioBitrate, audioFormat, imageQuality, imageFormat, maxDimension, hardwareAccel]
  );

  // Probe real media duration & dimensions in the browser for immediate physics-accurate estimation
  useEffect(() => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return;
    if (typeof window === 'undefined' || files.length === 0) return;

    let cancelled = false;
    files.forEach(f => {
      const key = getFileKey(f);
      // eslint-disable-next-line security/detect-object-injection
      if (clientMeta[key]) return;

      const cat = detectCategory(f.name);
      if (cat === 'AUDIO' || cat === 'VIDEO') {
        const url = safeCreateObjectURL(f);
        if (!url) return;
        const el = document.createElement(cat === 'VIDEO' ? 'video' : 'audio');
        el.preload = 'metadata';
        const cleanup = () => {
          el.onloadedmetadata = null;
          el.onerror = null;
          el.src = '';
          safeRevokeObjectURL(url);
        };
        el.onloadedmetadata = () => {
          const duration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
          const width = cat === 'VIDEO' ? (el as HTMLVideoElement).videoWidth || 0 : 0;
          const height = cat === 'VIDEO' ? (el as HTMLVideoElement).videoHeight || 0 : 0;
          cleanup();
          if (!cancelled && duration > 0) {
            setClientMeta(prev => ({ ...prev, [key]: { duration, width, height } }));
          }
        };
        el.onerror = () => cleanup();
        el.src = url;
      } else if (cat === 'PHOTO') {
        const url = safeCreateObjectURL(f);
        if (!url) return;
        const img = new window.Image();
        img.onload = () => {
          const width = img.naturalWidth || 0;
          const height = img.naturalHeight || 0;
          safeRevokeObjectURL(url);
          if (!cancelled && width > 0 && height > 0) {
            setClientMeta(prev => ({ ...prev, [key]: { duration: 0, width, height } }));
          }
        };
        img.onerror = () => safeRevokeObjectURL(url);
        img.src = url;
      }
    });

    return () => {
      cancelled = true;
    };
  }, [files, clientMeta]);

  // Debounced server-side exact dry-run / slice estimation (/api/compress/estimate)
  useEffect(() => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') return;
    if (files.length === 0) return;

    const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
    if (totalBytes > 4 * 1024 * 1024 * 1024) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

        const requestJsonEstimate = async () => {
          const res = await authenticatedFetch(`${apiBase}/api/compress/estimate`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              videoCodec,
              videoCrf,
              resolution,
              audioBitrate,
              audioFormat,
              imageQuality,
              imageFormat,
              maxDimension,
              hardwareAccel,
              files: files.map(f => ({ key: getFileKey(f), name: f.name, size: f.size })),
            }),
            signal: controller.signal,
          });
          if (!res.ok) return null;
          return res.json();
        };

        const ensureUploadedToCache = async (): Promise<boolean> => {
          if (inFlightUploadRef.current) {
            return inFlightUploadRef.current;
          }
          const uploadCtrl = new AbortController();
          uploadAbortRef.current = uploadCtrl;
          const uploadTask = (async () => {
            try {
              const fd = new FormData();
              fd.append('cacheOnly', 'true');
              files.forEach(f => {
                fd.append('fileKeys', getFileKey(f));
                fd.append('files', f);
              });
              const res = await authenticatedFetch(`${apiBase}/api/compress/estimate`, {
                method: 'POST',
                body: fd,
                signal: uploadCtrl.signal,
              });
              if (!res.ok) return false;
              files.forEach(f => uploadedKeysRef.current.add(getFileKey(f)));
              return true;
            } catch {
              return false;
            } finally {
              inFlightUploadRef.current = null;
            }
          })();
          inFlightUploadRef.current = uploadTask;
          return uploadTask;
        };

        let resultData: any = await requestJsonEstimate();
        if (resultData?.needsUpload) {
          const uploaded = await ensureUploadedToCache();
          if (uploaded && !controller.signal.aborted) {
            resultData = await requestJsonEstimate();
          }
        } else if (resultData?.estimates) {
          files.forEach(f => uploadedKeysRef.current.add(getFileKey(f)));
        }

        if (!controller.signal.aborted && resultData?.estimates) {
          setServerEstimates({
            signature: paramsSignature,
            byKey: resultData.estimates,
          });
        }
      } catch {
        // Ignore abort or transient estimation errors
      }
    }, 150);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    files,
    paramsSignature,
    videoCodec,
    videoCrf,
    resolution,
    audioBitrate,
    audioFormat,
    imageQuality,
    imageFormat,
    maxDimension,
    hardwareAccel,
  ]);

  const categoryCounts = useMemo(() => {
    const counts: Record<MediaCategory, number> = { VIDEO: 0, AUDIO: 0, PHOTO: 0, OTHER: 0 };
    files.forEach(f => {
      const cat = detectCategory(f.name);
      // eslint-disable-next-line security/detect-object-injection
      counts[cat]++;
    });
    return counts;
  }, [files]);

  // Dynamic size reduction calculator: prioritizes actual completed output -> server dry-run -> client metadata -> heuristic fallback
  const estimatedStats = useMemo(() => {
    let totalOriginal = 0;
    let totalEstimated = 0;
    const perFileEstimated: Record<string, number> = {};

    const generatedFiles = jobState?.generatedFiles || (jobState as any)?.files;
    const hasMatchingCompleted =
      status === 'complete' &&
      Array.isArray(generatedFiles) &&
      generatedFiles.length === files.length &&
      completedSignatureRef.current === paramsSignature;

    const hasMatchingServerEstimate = serverEstimates.signature === paramsSignature;

    files.forEach((f, idx) => {
      totalOriginal += f.size;
      const key = getFileKey(f);

      if (hasMatchingCompleted) {
        // eslint-disable-next-line security/detect-object-injection
        const genFile = generatedFiles[idx];
        if (genFile && typeof genFile.size === 'number' && genFile.size > 0) {
          // eslint-disable-next-line security/detect-object-injection
          perFileEstimated[key] = genFile.size;
          totalEstimated += genFile.size;
          return;
        }
      }

      // eslint-disable-next-line security/detect-object-injection
      if (hasMatchingServerEstimate && typeof serverEstimates.byKey[key] === 'number') {
        // eslint-disable-next-line security/detect-object-injection
        const srvBytes = serverEstimates.byKey[key];
        // eslint-disable-next-line security/detect-object-injection
        perFileEstimated[key] = srvBytes;
        totalEstimated += srvBytes;
        return;
      }

      const cat = detectCategory(f.name);
      const ext = f.name.split('.').pop()?.toLowerCase() || '';
      // eslint-disable-next-line security/detect-object-injection
      const meta = clientMeta[key];
      let fileEst = f.size;

      if (cat === 'VIDEO') {
        if (meta && meta.duration > 0) {
          const kbpsAudio = parseInt(audioBitrate, 10) || 128;
          const audioBytes = meta.duration * ((kbpsAudio * 1000) / 8);
          const inputVideoBytes = Math.max(f.size * 0.1, f.size - audioBytes);

          let outW = meta.width;
          let outH = meta.height;
          if (resolution !== 'original' && meta.height > 0 && meta.width > 0) {
            const targetH = resolution === '1080p' ? 1080 : resolution === '720p' ? 720 : 480;
            outH = targetH;
            outW = Math.round((meta.width / meta.height) * targetH);
          }

          // Calibrated target 1080p (1920x1080) video bytes/sec at CRF 28
          let baseBytesPerSec1080p = 136_000;
          let crfFactor = Math.pow(2, (28 - videoCrf) / 5.6);

          if (hardwareAccel && (videoCodec === 'hevc' || videoCodec === 'h264')) {
            baseBytesPerSec1080p = videoCodec === 'hevc' ? 162_000 : 245_000;
            crfFactor = Math.pow(2, (28 - videoCrf) / 3.05);
          } else if (videoCodec === 'av1') {
            baseBytesPerSec1080p = 102_000;
          } else if (videoCodec === 'vp9') {
            baseBytesPerSec1080p = 128_000;
          } else if (videoCodec === 'h264') {
            baseBytesPerSec1080p = 228_000;
          }

          let resFactor = 1;
          if (outW > 0 && outH > 0) {
            const pixelRatio = (outW * outH) / (1920 * 1080);
            resFactor = Math.pow(pixelRatio, 0.61);
          } else if (resolution !== 'original') {
            if (resolution === '1080p') resFactor = 0.75;
            if (resolution === '720p') resFactor = 0.48;
            if (resolution === '480p') resFactor = 0.28;
          }

          let complexity = 1;
          if (meta.width > 0 && meta.height > 0) {
            const inPixelRatio = (meta.width * meta.height) / (1920 * 1080);
            const refSourceBytesPerSec = 1_000_000 * Math.pow(inPixelRatio, 0.65);
            const actualSourceBytesPerSec = inputVideoBytes / meta.duration;
            complexity = Math.pow(actualSourceBytesPerSec / Math.max(1, refSourceBytesPerSec), 0.22);
            complexity = Math.max(0.6, Math.min(1.35, complexity));
          }

          const estVideoBytes = meta.duration * baseBytesPerSec1080p * resFactor * crfFactor * complexity;
          fileEst = Math.round(estVideoBytes + audioBytes);
        } else {
          const deltaCrf = (28 - videoCrf) * 0.036;
          let scaleFactor = 1;
          if (resolution === '1080p') scaleFactor = 0.85;
          if (resolution === '720p') scaleFactor = 0.55;
          if (resolution === '480p') scaleFactor = 0.35;

          let codecEfficiency = 0.5; // default HEVC
          if (videoCodec === 'av1') codecEfficiency = 0.38;
          if (videoCodec === 'vp9') codecEfficiency = 0.48;
          if (videoCodec === 'h264') codecEfficiency = 0.72;

          const estRatio = Math.max(0.1, Math.min(1.5, (codecEfficiency + deltaCrf) * scaleFactor));
          fileEst = Math.round(f.size * estRatio);
        }
      } else if (cat === 'AUDIO') {
        const kbps = parseInt(audioBitrate, 10) || 128;
        if (meta && meta.duration > 0) {
          if (audioFormat === 'flac') {
            fileEst = Math.round(meta.duration * 92000);
          } else if (audioFormat === 'aac') {
            const effectiveKbps = Math.min(kbps, 210);
            fileEst = Math.round(meta.duration * ((effectiveKbps * 1000) / 8) * 1.02 + 1024);
          } else if (audioFormat === 'ogg') {
            fileEst = Math.round(meta.duration * ((kbps * 1000) / 8) * 0.94 + 2048);
          } else {
            fileEst = Math.round(meta.duration * ((kbps * 1000) / 8) + 960);
          }
        } else {
          let formatFactor = 1;
          if (audioFormat === 'flac') formatFactor = 2.2;
          if (audioFormat === 'aac' || audioFormat === 'ogg') formatFactor = 0.9;
          const estRatio = Math.max(0.15, Math.min(1.5, (kbps / 320) * formatFactor));
          fileEst = Math.round(f.size * estRatio);
        }
      } else {
        const q = imageQuality / 100;
        let formatBaseRatio = 0.15;
        if (imageFormat === 'webp') {
          formatBaseRatio = 0.04 + q * 0.18;
        } else if (imageFormat === 'avif') {
          formatBaseRatio = 0.03 + q * 0.15;
        } else if (imageFormat === 'jpeg') {
          formatBaseRatio = 0.08 + q * 0.28;
        } else if (imageFormat === 'png') {
          formatBaseRatio = ext === 'png' ? 0.85 : 1.2;
        }

        let dimFactor = 1;
        if (meta && meta.width > 0 && meta.height > 0 && maxDimension !== 'original') {
          const maxDim = parseInt(maxDimension, 10);
          const currentMax = Math.max(meta.width, meta.height);
          if (currentMax > maxDim) {
            dimFactor = Math.pow(maxDim / currentMax, 1.6);
          }
        } else {
          if (maxDimension === '1920') dimFactor = 0.75;
          if (maxDimension === '1080') dimFactor = 0.5;
          if (maxDimension === '800') dimFactor = 0.3;
        }

        const estRatio = Math.max(0.02, Math.min(1.5, formatBaseRatio * dimFactor));
        fileEst = Math.round(f.size * estRatio);
      }

      // eslint-disable-next-line security/detect-object-injection
      perFileEstimated[key] = fileEst;
      totalEstimated += fileEst;
    });

    const percentReduction =
      totalOriginal > 0 ? Math.round((1 - totalEstimated / totalOriginal) * 100) : 0;

    return {
      totalOriginal,
      totalEstimated,
      percentReduction,
      perFileEstimated,
      isExactActual: hasMatchingCompleted,
      isServerVerified: hasMatchingServerEstimate || hasMatchingCompleted,
    };
  }, [
    files,
    videoCrf,
    resolution,
    videoCodec,
    audioBitrate,
    audioFormat,
    imageQuality,
    imageFormat,
    maxDimension,
    hardwareAccel,
    clientMeta,
    serverEstimates,
    jobState,
    status,
    paramsSignature,
  ]);

  const handleInitialize = async () => {
    if (files.length === 0 || status === 'processing') return;
    completedSignatureRef.current = paramsSignature;

    const formData = new FormData();
    formData.append('videoCodec', videoCodec);
    formData.append('videoCrf', String(videoCrf));
    formData.append('resolution', resolution);
    formData.append('audioBitrate', audioBitrate);
    formData.append('audioFormat', audioFormat);
    formData.append('imageQuality', String(imageQuality));
    formData.append('imageFormat', imageFormat);
    formData.append('maxDimension', maxDimension);
    formData.append('hardwareAccel', String(hardwareAccel));

    files.forEach(f => formData.append('files', f));

    try {
      updateJob({
        status: 'processing',
        progress: 0,
        statusText: files[0]?.size > 50 * 1024 * 1024 ? 'UPLOADING MEDIA PAYLOAD...' : 'INITIALIZING COMPRESSOR...',
      });

      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const res = await authenticatedFetch(`${apiBase}/api/compress`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Compression request failed' }));
        const errorMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Compression request failed';
        updateJob({ status: 'error', statusText: `ERROR: ${errorMessage}` });
        return;
      }

      startJob(res);
    } catch (err: any) {
      console.error('[HEVC COMPRESSOR] Network/Fetch Error:', err);
      updateJob({
        status: 'error',
        statusText: `NETWORK ERROR: ${err?.message || 'Failed to fetch'}`
      });
    }
  };

  const hasFiles = files.length > 0;
  const isProcessing = status === 'processing';

  return (
    <>
      {/* Top utility bar */}
      <MasterHeader
        onlyUtilityBar
        toolName="UNIVERSAL COMPRESSOR"
        engineId="FFMPEG-BATCH"
        hwAccelText="HW ACCEL: AUTO (VIDEOTOOLBOX)"
      />

      {/* Workspace */}
      <div className="workspace">
        {/* Left: Dropzone or Batch File List */}
        <div className="dropzone-container">
          <MasterHeader
            onlyToolHeader
            targetId="TARGET // 03"
            title={<>Universal<br/>Compressor.</>}
            rightAction={hasFiles && (
              <TooltipTop content="Remove all files from queue">
                <motion.button
                  type="button"
                  onClick={handleClear}
                  className="tiny-label"
                  data-testid="clear-btn"
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.05 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    padding: '6px 12px',
                    minHeight: '36px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    color: 'var(--text-muted)'
                  }}
                >
                  [ CLEAR ALL ]
                </motion.button>
              </TooltipTop>
            )}
          />

          {!hasFiles ? (
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              acceptedTypes={[
                'mp4', 'mov', 'mkv', 'webm', 'avi',
                'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg',
                'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'
              ]}
              multiple={true}
              formatsListText="Supports Video (MP4, MOV, MKV), Audio (MP3, WAV, FLAC), and Photos (WEBP, PNG, JPG, AVIF)"
            />
          ) : (
            <div data-lenis-prevent style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px 24px 24px', gap: '16px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="tiny-label">BATCH QUEUE ({files.length.toLocaleString('en-US')} {files.length === 1 ? 'ITEM' : 'ITEMS'})</span>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <span className="mono-data" style={{ color: 'var(--accent)' }}>V: {categoryCounts.VIDEO}</span>
                  <span className="mono-data" style={{ color: 'var(--accent)' }}>A: {categoryCounts.AUDIO}</span>
                  <span className="mono-data" style={{ color: 'var(--accent)' }}>P: {categoryCounts.PHOTO}</span>
                  {categoryCounts.OTHER > 0 && (
                    <span className="mono-data" style={{ color: 'var(--text-muted)' }}>O: {categoryCounts.OTHER}</span>
                  )}
                </div>
              </div>

              {/* Queue List with 21st.dev staggered motion */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {files.slice(0, 50).map((file, idx) => {
                  const cat = detectCategory(file.name);
                  const badgeColor = cat === 'OTHER' ? 'var(--text-muted)' : 'var(--accent)';
                  
                  return (
                    <motion.div
                      key={`${file.name}-${idx}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: Math.min(idx * 0.03, 0.3) }}
                      data-testid="batch-file-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'rgba(15, 15, 18, 0.65)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '4px',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '2px',
                            border: `1px solid ${badgeColor}`,
                            color: badgeColor,
                            background: cat === 'OTHER' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 90, 0, 0.1)',
                            letterSpacing: '0.06em',
                            flexShrink: 0
                          }}
                        >
                          {cat}
                        </span>
                        {(() => {
                          const { stem, ext } = splitFilename(file.name);
                          return (
                            <span
                              className="mono-data filename-truncate"
                              title={file.name}
                              dir="auto"
                            >
                              <span className="filename-stem">{stem}</span>
                              {ext && <span className="filename-ext">{ext}</span>}
                            </span>
                          );
                        })()}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                        <span className="tiny-label" style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                          {formatSize(file.size)}
                          {estimatedStats.perFileEstimated[getFileKey(file)] !== undefined && (
                            <span style={{ color: 'var(--accent)', marginLeft: '6px' }}>
                              &rarr; {estimatedStats.isExactActual ? '' : '~'}{formatSize(estimatedStats.perFileEstimated[getFileKey(file)])}
                            </span>
                          )}
                        </span>
                        {downloadUrl && status === 'complete' && (() => {
                          const jobId = downloadUrl.split('jobId=')[1]?.split('&')[0];
                          const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                          const ext = cat === 'PHOTO' ? (imageFormat === 'jpeg' ? '.jpg' : `.${imageFormat}`) : cat === 'AUDIO' ? `.${audioFormat}` : '.mp4';
                          const expectedName = `compressed_${baseName}${ext}`;
                          const genList = jobState?.generatedFiles || (jobState as any)?.files;
                          const matchingGen = genList?.find((gf: any) => gf.name?.includes(baseName) || gf.name === expectedName);
                          const rawHref = matchingGen?.downloadUrl || `/api/download?jobId=${jobId}&file=${encodeURIComponent(expectedName)}`;
                          const downloadHref = appendAuthToken(rawHref, sessionToken);

                          return (
                            <TooltipBottom content="Download this file">
                              <motion.a
                                href={downloadHref}
                                download={matchingGen?.name || expectedName}
                                className="tiny-label"
                                whileHover={shouldReduceMotion ? undefined : { scale: 1.05 }}
                                whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
                                style={{
                                  color: 'var(--accent)',
                                  border: '1px solid var(--accent)',
                                  background: 'rgba(255, 90, 0, 0.1)',
                                  borderRadius: '3px',
                                  padding: '3px 10px',
                                  textDecoration: 'none',
                                  fontWeight: 600
                                }}
                              >
                                [ DOWNLOAD ]
                              </motion.a>
                            </TooltipBottom>
                          );
                        })()}
                      </div>
                    </motion.div>
                  );
                })}

                {files.length > 50 && (
                  <div 
                    style={{ 
                      padding: '10px 14px', 
                      textAlign: 'center', 
                      borderRadius: '4px',
                      border: '1px dashed rgba(255, 255, 255, 0.15)',
                      background: 'rgba(255, 90, 0, 0.04)' 
                    }}
                  >
                    <span className="tiny-label" style={{ color: 'var(--accent)', letterSpacing: '0.06em' }}>
                      + {(files.length - 50).toLocaleString('en-US')} MORE FILES QUEUED (SHOWING FIRST 50)
                    </span>
                  </div>
                )}
              </div>

              {/* Add more files dropzone strip */}
              <div style={{ marginTop: '8px' }}>
                <FileDropzone
                  onFilesSelected={handleFilesSelected}
                  acceptedTypes={[
                    'mp4', 'mov', 'mkv', 'webm', 'avi',
                    'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg',
                    'jpg', 'jpeg', 'png', 'webp', 'avif', 'gif'
                  ]}
                  multiple={true}
                  formatsListText="+ Add more files to batch"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right options sidebar — Resizable StitchMCP Celestial Obsidian Panel */}
        <ResizableOptionsPanel title="COMPRESSION PARAMETERS">
          {/* StitchMCP Segmented Animated Tab Switcher */}
          <div className="form-group">
            <div className="form-header" style={{ marginBottom: '10px' }}>
              <span className="tiny-label" style={{ fontSize: '10px', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>TARGET MEDIA TYPE</span>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
              background: 'rgba(10, 10, 12, 0.85)',
              padding: '5px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '8px',
              minHeight: '44px'
            }}>
              {(['VIDEO', 'AUDIO', 'PHOTO'] as const).map(cat => {
                const isSelected = activeTab === cat;
                const isAudioOnlyPayload = hasFiles && categoryCounts.AUDIO > 0 && categoryCounts.VIDEO === 0 && categoryCounts.PHOTO === 0;
                const isPhotoOnlyPayload = hasFiles && categoryCounts.PHOTO > 0 && categoryCounts.VIDEO === 0 && categoryCounts.AUDIO === 0;
                const isTabDisabled = (isAudioOnlyPayload && cat !== 'AUDIO') || (isPhotoOnlyPayload && cat !== 'PHOTO');
                const tabDisabledReason = isAudioOnlyPayload
                  ? 'Audio payload cannot be compressed as video or photo'
                  : isPhotoOnlyPayload
                  ? 'Photo payload can only be compressed as image'
                  : '';

                const tabButton = (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => !isTabDisabled && setActiveTab(cat)}
                    disabled={isTabDisabled}
                    aria-pressed={isSelected}
                    aria-disabled={isTabDisabled}
                    data-testid={`tab-${cat.toLowerCase()}`}
                    style={{
                      position: 'relative',
                      minHeight: '36px',
                      padding: '10px 6px',
                      fontSize: '0.6875rem',
                      fontFamily: 'var(--font-mono)',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      border: 'none',
                      background: 'transparent',
                      color: isSelected ? 'var(--accent)' : isTabDisabled ? 'rgba(255, 255, 255, 0.2)' : 'var(--text-muted)',
                      cursor: isTabDisabled ? 'not-allowed' : 'pointer',
                      borderRadius: '6px',
                      transition: 'color 0.2s ease, opacity 0.2s ease',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: isTabDisabled ? 0.4 : 1
                    }}
                  >
                    {isSelected && (
                      <motion.span
                        aria-hidden="true"
                        layoutId={shouldReduceMotion ? undefined : 'activeMediaTab'}
                        transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 30 }}
                        style={{
                          position: 'absolute',
                          inset: 0,
                          background: 'rgba(255, 90, 0, 0.15)',
                          border: '1px solid var(--accent)',
                          borderRadius: '6px',
                          boxShadow: '0 0 14px rgba(255, 90, 0, 0.25)'
                        }}
                      />
                    )}
                    <span style={{ position: 'relative', zIndex: 1 }}>{cat}</span>
                  </button>
                );

                return isTabDisabled ? (
                  <TooltipTop key={cat} content={tabDisabledReason}>
                    {tabButton}
                  </TooltipTop>
                ) : (
                  tabButton
                );
              })}
            </div>
          </div>

          {/* Parameter Content Switcher with Framer Motion Animation */}
          <AnimatePresence mode="wait" initial={false}>
            {activeTab === 'VIDEO' && (
              <motion.div
                key="video-params"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}
                style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
              >
                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px' }}>
                    <span className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>VIDEO CODEC</span>
                    <span className="mono-data">{videoCodec.toUpperCase()}</span>
                  </div>
                  <HevcOptionGrid
                    items={(['hevc', 'h264', 'av1', 'vp9'] as const).map(c => ({
                      value: c,
                      label: c.toUpperCase(),
                      testId: `codec-${c}`,
                    }))}
                    selected={videoCodec}
                    onSelect={setVideoCodec}
                    reducedMotion={shouldReduceMotion}
                  />
                </div>

                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <label htmlFor={crfId} className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        CONSTANT RATE FACTOR (CRF)
                      </label>
                      <span className="tiny-label" style={{ display: 'block', fontSize: '0.5625rem', color: 'var(--text-muted)', marginTop: '2px', opacity: 0.85 }}>
                        {videoCrf <= 20 ? 'Visually Lossless / High Fidelity' : videoCrf <= 27 ? 'Balanced Quality & File Size' : 'High Compression / Web Optimized'}
                      </span>
                    </div>
                    <span className="mono-data" data-testid="crf-value" style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.8125rem' }}>
                      CRF {videoCrf}
                    </span>
                  </div>
                  <input
                    id={crfId}
                    type="range"
                    min={18}
                    max={35}
                    step={1}
                    value={videoCrf}
                    onChange={e => setVideoCrf(parseInt(e.target.value, 10))}
                    data-testid="crf-slider"
                    style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                    <span className="tiny-label" style={{ fontSize: '0.5625rem', opacity: 0.7 }}>CRF 18 (MAX QUALITY)</span>
                    <span className="tiny-label" style={{ fontSize: '0.5625rem', opacity: 0.7 }}>CRF 35 (MAX COMPRESSION)</span>
                  </div>
                </div>

                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px' }}>
                    <span className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>RESOLUTION SCALING</span>
                    <span className="mono-data">{resolution.toUpperCase()}</span>
                  </div>
                  <HevcOptionGrid
                    items={(['original', '1080p', '720p', '480p'] as const).map(r => ({
                      value: r,
                      label: r.toUpperCase(),
                    }))}
                    selected={resolution}
                    onSelect={setResolution}
                    reducedMotion={shouldReduceMotion}
                  />
                </div>

                <div className="form-group" style={{ paddingTop: '6px' }}>
                  <label className="cel-check-row" style={{
                    fontSize: '0.6875rem',
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 600,
                    letterSpacing: '0.06em',
                    color: 'var(--text-main)',
                    padding: '10px 14px',
                    background: 'rgba(15, 15, 18, 0.65)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '6px'
                  }}>
                    <input
                      type="checkbox"
                      className="cel-check-input"
                      checked={hardwareAccel}
                      onChange={e => setHardwareAccel(e.target.checked)}
                      data-testid="hw-accel-toggle"
                    />
                    <span>HARDWARE ACCELERATION (GPU)</span>
                  </label>
                </div>
              </motion.div>
            )}

            {activeTab === 'AUDIO' && (
              <motion.div
                key="audio-params"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}
                style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
              >
                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px' }}>
                    <span className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>AUDIO BITRATE</span>
                    <span className="mono-data">{audioBitrate.toUpperCase()}</span>
                  </div>
                  <HevcOptionGrid
                    items={(['64k', '128k', '192k', '320k'] as const).map(b => ({
                      value: b,
                      label: b.toUpperCase(),
                      testId: `bitrate-${b}`,
                    }))}
                    selected={audioBitrate}
                    onSelect={setAudioBitrate}
                    reducedMotion={shouldReduceMotion}
                  />
                </div>

                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px' }}>
                    <span className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>AUDIO FORMAT</span>
                    <span className="mono-data">{audioFormat.toUpperCase()}</span>
                  </div>
                  <HevcOptionGrid
                    items={(['mp3', 'aac', 'ogg', 'flac'] as const).map(f => ({
                      value: f,
                      label: f.toUpperCase(),
                    }))}
                    selected={audioFormat}
                    onSelect={setAudioFormat}
                    reducedMotion={shouldReduceMotion}
                  />
                </div>
              </motion.div>
            )}

            {activeTab === 'PHOTO' && (
              <motion.div
                key="photo-params"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
                transition={{ duration: shouldReduceMotion ? 0 : 0.18, ease: [0.23, 1, 0.32, 1] }}
                style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}
              >
                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label htmlFor={imageQualityId} className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)', cursor: 'pointer' }}>
                      IMAGE QUALITY (%)
                    </label>
                    <span className="mono-data" data-testid="image-quality-value" style={{ color: 'var(--accent)', fontWeight: 800, fontSize: '0.8125rem' }}>
                      {imageQuality}%
                    </span>
                  </div>
                  <input
                    id={imageQualityId}
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={imageQuality}
                    onChange={e => setImageQuality(parseInt(e.target.value, 10))}
                    data-testid="image-quality-slider"
                    style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                  />
                </div>

                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px' }}>
                    <span className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>TARGET FORMAT</span>
                    <span className="mono-data">{imageFormat.toUpperCase()}</span>
                  </div>
                  <HevcOptionGrid
                    items={(['webp', 'jpeg', 'png', 'avif'] as const).map(f => ({
                      value: f,
                      label: f.toUpperCase(),
                      testId: `image-format-${f}`,
                    }))}
                    selected={imageFormat}
                    onSelect={setImageFormat}
                    reducedMotion={shouldReduceMotion}
                  />
                </div>

                <div className="form-group">
                  <div className="form-header" style={{ marginBottom: '10px' }}>
                    <span className="tiny-label" style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>MAX DIMENSION</span>
                    <span className="mono-data">{maxDimension === 'original' ? 'ORIGINAL' : `${maxDimension}PX`}</span>
                  </div>
                  <HevcOptionGrid
                    items={(['original', '3840', '1920', '1080', '800'] as const).map(d => ({
                      value: d,
                      label: d === 'original' ? 'ORIGINAL' : `${d}PX`,
                    }))}
                    selected={maxDimension}
                    onSelect={setMaxDimension}
                    reducedMotion={shouldReduceMotion}
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Estimated Reduction Card */}
          <AnimatePresence>
            {hasFiles && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{
                  background: 'rgba(15, 15, 18, 0.65)',
                  backdropFilter: 'blur(8px)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '6px',
                  padding: '16px'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="tiny-label">TOTAL QUEUE SIZE</span>
                    <span className="mono-data">{formatSize(estimatedStats.totalOriginal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="tiny-label">{estimatedStats.isExactActual ? 'ACTUAL OUTPUT' : 'ESTIMATED OUTPUT'}</span>
                    <span className="mono-data" data-testid="estimated-output-size" style={{ color: 'var(--accent)' }}>
                      {estimatedStats.isExactActual ? '' : '~'}{formatSize(estimatedStats.totalEstimated)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(255, 255, 255, 0.06)', paddingTop: '8px' }}>
                    <span className="tiny-label" style={{ fontWeight: 700 }}>
                      {estimatedStats.isExactActual ? 'ACTUAL' : 'ESTIMATED'} {estimatedStats.percentReduction < 0 ? 'EXPANSION' : 'REDUCTION'}
                    </span>
                    <span className="mono-data" data-testid="estimated-reduction" style={{ color: estimatedStats.percentReduction < 0 ? 'var(--text-muted)' : 'var(--accent)', fontWeight: 700 }}>
                      {estimatedStats.percentReduction < 0 ? `+${Math.abs(estimatedStats.percentReduction)}%` : `${estimatedStats.isExactActual ? '' : '~'}${estimatedStats.percentReduction}%`}
                    </span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </ResizableOptionsPanel>
      </div>

      {/* Bottom progress section */}
      <div className="progress-section grid-line-top">
        <motion.button
          type="button"
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!hasFiles || isProcessing}
          data-testid="initialize-btn"
          whileHover={shouldReduceMotion ? undefined : { scale: (!hasFiles || isProcessing) ? 1 : 1.01 }}
          whileTap={shouldReduceMotion ? undefined : { scale: (!hasFiles || isProcessing) ? 1 : 0.97 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={{
            opacity: (!hasFiles || isProcessing) ? 0.5 : 1,
            cursor: (!hasFiles || isProcessing) ? 'not-allowed' : 'pointer'
          }}
        >
          {isProcessing ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <progress className="cel-spinner" aria-label="Processing" />
              PROCESSING...
            </span>
          ) : (
            'INITIALIZE'
          )}
        </motion.button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusText || 'AWAITING PAYLOAD'}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="mono-data" data-testid="queue-count">
                {files.length > 0 ? `QUEUE: ${files.length.toLocaleString('en-US')} ${files.length === 1 ? 'FILE' : 'FILES'}` : 'QUEUE: 0 FILES'}
              </span>
              {downloadUrl && (
                <motion.a
                  href={downloadUrl}
                  download
                  className="tiny-label"
                  data-testid="download-all-zip-btn"
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.05 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
                  style={{
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                    background: 'rgba(255, 90, 0, 0.15)',
                    borderRadius: '4px',
                    padding: '4px 12px',
                    textDecoration: 'none',
                    fontWeight: 700,
                    boxShadow: '0 0 10px rgba(255, 90, 0, 0.2)'
                  }}
                >
                  [ BATCH DOWNLOAD (.ZIP) ]
                </motion.a>
              )}
            </div>
          </div>
          <progress
            className="cel-progress"
            data-testid="progress-fill"
            max={100}
            value={Math.max(0, Math.min(100, progress))}
            aria-label="Batch compression progress"
            aria-valuetext={`${Math.round(Math.max(0, Math.min(100, progress)))}%`}
          />
        </div>
      </div>
    </>
  );
}
