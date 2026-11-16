'use client'

import React, { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { splitFilename } from '../../../lib/utils/filename';
import { useJob, useHardwareProfile } from '../../context/GlobalJobContext';
import { FileDropzone } from '../../components/ui/FileDropzone';
import { BatchQueue, QueueItem } from '../../components/BatchQueue';
import { ResizableOptionsPanel } from '../../components/ui/ResizableOptionsPanel';
import { JobStatus } from '../../components/ui/StatusBadge';
import { TooltipRight, TooltipTop, TooltipBottom } from '../../components/ui/Tooltip';
import { AudioToVideoStudio } from './components/AudioToVideoStudio';
import { HardwareBadge } from '../../components/ui/HardwareBadge';
import { MasterHeader } from '../../components/ui/MasterHeader';
import { getMediaBatchLimit, getClientHardwareProfile, HardwareProfile } from '../../../lib/system/hardwareProfiler';
import { authenticatedFetch, appendAuthToken, useSessionToken } from '../../../lib/security/clientAuth';

/* ── Format definitions ── */
const VIDEO_FORMATS = ['mp4', 'mkv', 'mov', 'webm', 'gif'] as const;
const AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'ogg', 'flac'] as const;
const IMAGE_FORMATS = ['png', 'jpg', 'webp', 'bmp', 'tiff', 'avif'] as const;
const ALL_FORMATS = [...VIDEO_FORMATS, ...AUDIO_FORMATS, ...IMAGE_FORMATS] as const;
type OutputFormat = (typeof ALL_FORMATS)[number];

/* ── Preset definitions ── */
const PRESETS = ['auto', 'whatsapp', 'discord', 'email', 'twitter', 'high', 'remux'] as const;
type Preset = (typeof PRESETS)[number] | 'custom';

const PRESET_CONFIG: Record<Exclude<Preset, 'custom' | 'remux' | 'auto'>, { resolution: string; quality: string }> = {
  whatsapp: { resolution: '480p', quality: 'fast' },
  discord:  { resolution: '720p', quality: 'medium' },
  email:    { resolution: '360p', quality: 'fast' },
  twitter:  { resolution: '720p', quality: 'medium' },
  high:     { resolution: '1080p', quality: 'slow' },
};

const PRESET_DESCRIPTIONS: Record<Preset, string> = {
  auto: 'Intelligent format auto-detection: streams copied losslessly when compatible, transcoded otherwise',
  whatsapp: 'WhatsApp optimized: 480p H.264 video with 96k AAC audio tailored for mobile chat limits',
  discord: 'Discord optimized: 720p H.264 video with 128k AAC audio under standard file limits',
  email: 'Email attachment: 360p compact H.264 video with 64k AAC audio for lightweight attachments',
  twitter: 'Social feed: Fast-start 720p H.264 video with 192k AAC audio for instant playback',
  high: 'Studio Master: High-bitrate 1080p H.264 video with 256k AAC audio for maximum quality',
  remux: 'Lossless Remux: Instant container rewrap without re-encoding (QuickTime audio auto-healed)',
  custom: 'Custom manual resolution, speed, and format parameters'
};

/* ── Speed / Resolution options ── */
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.5, 2, 4] as const;
const RESOLUTION_OPTIONS = ['original', '1080p', '720p', '480p', '360p'] as const;
const GIF_FPS_OPTIONS = [10, 15, 24] as const;

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

interface ConverterOptionTileProps {
  label: string;
  isSelected: boolean;
  onClick: () => void;
  testId?: string;
  ariaLabel: string;
  reducedMotion: boolean;
  delay?: number;
  style?: React.CSSProperties;
}

const ConverterOptionTile = React.forwardRef<HTMLButtonElement, ConverterOptionTileProps>(function ConverterOptionTile(
  { label, isSelected, onClick, testId, ariaLabel, reducedMotion, delay = 0, style, ...rest },
  ref
) {
  return (
    <motion.button
      ref={ref}
      type="button"
      {...rest}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={reducedMotion ? { duration: 0 } : { duration: 0.12, delay }}
      whileHover={reducedMotion ? undefined : { scale: 1.05 }}
      whileTap={reducedMotion ? undefined : { scale: 0.94 }}
      onClick={onClick}
      data-testid={testId}
      aria-pressed={isSelected}
      aria-label={ariaLabel}
      style={{
        position: 'relative',
        minHeight: '36px',
        padding: '6px 10px',
        textAlign: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.65625rem',
        fontWeight: 700,
        letterSpacing: '0.05em',
        cursor: 'pointer',
        borderRadius: '4px',
        border: isSelected ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
        background: isSelected ? 'rgba(255, 90, 0, 0.18)' : 'rgba(15, 15, 18, 0.65)',
        color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
        boxShadow: isSelected ? '0 0 12px rgba(255, 90, 0, 0.25)' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        transition: 'border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
        ...style,
      }}
    >
      {label}
    </motion.button>
  );
});

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  // eslint-disable-next-line security/detect-object-injection
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function UniversalConverter() {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const sessionToken = useSessionToken();
  /* ── State ── */
  const { jobState, startJob, clearJob, updateJob } = useJob('converter');

  const [files, setFiles] = useState<File[]>(() => jobState?.files ?? []);
  const [queueItems, setQueueItems] = useState<QueueItem[]>(() => jobState?.queueItems ?? []);
  const [activeTab, setActiveTab] = useState<'VIDEO' | 'AUDIO' | 'PHOTO'>(() => jobState?.options?.activeTab ?? 'VIDEO');

  const categoryCounts = React.useMemo(() => {
    const counts: Record<MediaCategory, number> = { VIDEO: 0, AUDIO: 0, PHOTO: 0, OTHER: 0 };
    files.forEach(f => {
      const cat = detectCategory(f.name);
      // eslint-disable-next-line security/detect-object-injection
      counts[cat]++;
    });
    return counts;
  }, [files]);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>(() => jobState?.options?.outputFormat ?? 'mp4');
  const [preset, setPreset] = useState<Preset>(() => jobState?.options?.preset ?? 'high');
  const [speed, setSpeed] = useState(() => jobState?.options?.speed ?? 1);
  const [resolution, setResolution] = useState(() => jobState?.options?.resolution ?? 'original');
  const [stripAudio, setStripAudio] = useState(() => jobState?.options?.stripAudio ?? false);
  const [stripMetadata, setStripMetadata] = useState(() => jobState?.options?.stripMetadata ?? false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [gifFps, setGifFps] = useState(() => jobState?.options?.gifFps ?? 15);
  const [gifPalette, setGifPalette] = useState(() => jobState?.options?.gifPalette ?? true);

  /* ── Audio-to-Video Studio State ── */
  const [attachedVideo, setAttachedVideo] = useState<File | null>(() => jobState?.options?.attachedVideo ?? null);
  const [videoStartTime, setVideoStartTime] = useState<number>(() => jobState?.options?.videoStartTime ?? 0);
  const [videoEndTime, setVideoEndTime] = useState<number>(() => jobState?.options?.videoEndTime ?? 0);
  const [audioSyncMode, setAudioSyncMode] = useState<'fit-audio' | 'fit-video' | 'loop-video' | 'trim-audio'>(
    () => jobState?.options?.audioSyncMode ?? 'fit-audio'
  );
  const [visualizerStyle, setVisualizerStyle] = useState<'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave'>(
    () => jobState?.options?.visualizerStyle ?? 'obsidian_pulse'
  );
  const [useVisualizer, setUseVisualizer] = useState<boolean>(() => jobState?.options?.useVisualizer ?? false);
  const [visualizerColor, setVisualizerColor] = useState<string>(() => jobState?.options?.visualizerColor ?? '#FF5A00');
  const [visualizerBg, setVisualizerBg] = useState<string>(() => jobState?.options?.visualizerBg ?? '#0A0A0C');
  const [videoLoop, setVideoLoop] = useState<boolean>(() => jobState?.options?.videoLoop ?? false);

  const status = jobState?.status === 'processing' ? 'PROCESSING'
    : jobState?.status === 'complete' ? 'COMPLETE'
    : jobState?.status === 'error' ? 'ERROR'
    : 'IDLE';
  const progress = jobState?.progress ?? 0;
  const statusText = jobState?.statusText ?? (files.length > 0 ? `LOADED: ${files.length.toLocaleString('en-US')} ${files.length === 1 ? 'FILE' : 'FILES'}` : 'AWAITING PAYLOAD');
  const strategy = jobState?.strategy ?? null;
  const strategyReason = jobState?.strategyReason ?? null;
  const processing = jobState?.status === 'processing';
  const hasFiles = files.length > 0;

  // Sync inputs to context when idle
  useEffect(() => {
    if (!jobState?.status || jobState?.status === 'idle') {
      updateJob({
        files,
        queueItems,
        options: {
          outputFormat,
          preset,
          speed,
          resolution,
          stripAudio,
          stripMetadata,
          gifFps,
          gifPalette,
          activeTab,
          attachedVideo,
          videoStartTime,
          videoEndTime,
          audioSyncMode,
          visualizerStyle,
          useVisualizer,
          visualizerColor,
          visualizerBg,
          videoLoop,
        },
      });
    }
  }, [
    files, queueItems, outputFormat, preset, speed, resolution, stripAudio, stripMetadata, gifFps, gifPalette, activeTab,
    attachedVideo, videoStartTime, videoEndTime, audioSyncMode, visualizerStyle, useVisualizer, visualizerColor, visualizerBg, videoLoop,
    jobState?.status, updateJob
  ]);

  // Sync queueItems back from context
  useEffect(() => {
    if (jobState?.queueItems) {
      setQueueItems(jobState.queueItems);
    }
  }, [jobState?.queueItems]);

  const isAudioFormat = AUDIO_FORMATS.includes(outputFormat as any);
  const isImageFormat = IMAGE_FORMATS.includes(outputFormat as any);
  const isGif = outputFormat === 'gif';

  // If user navigated away and came back after conversion finished, auto-download
  useEffect(() => {
    if (jobState?.status === 'complete' && jobState.downloadUrl) {
      const a = document.createElement('a');
      a.href = jobState.downloadUrl;
      a.download = files.length > 1 ? 'output.zip' : `output.${outputFormat}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isAudioOnlyPayload = hasFiles && categoryCounts.AUDIO > 0 && categoryCounts.VIDEO === 0 && categoryCounts.PHOTO === 0;
  const isPhotoOnlyPayload = hasFiles && categoryCounts.PHOTO > 0 && categoryCounts.VIDEO === 0 && categoryCounts.AUDIO === 0;
  const isVideoPayload = hasFiles && categoryCounts.VIDEO > 0;

  const isAudioToVideoMode = hasFiles && isAudioOnlyPayload && activeTab === 'VIDEO' && VIDEO_FORMATS.includes(outputFormat as any);

  /* ── Handlers ── */
  const handleTabChange = useCallback((tab: 'VIDEO' | 'AUDIO' | 'PHOTO') => {
    if (isAudioOnlyPayload && tab === 'PHOTO') return;
    if (isPhotoOnlyPayload && tab !== 'PHOTO') return;
    setActiveTab(tab);
    if (tab === 'VIDEO' && !VIDEO_FORMATS.includes(outputFormat as any)) {
      setOutputFormat('mp4');
    } else if (tab === 'AUDIO' && !AUDIO_FORMATS.includes(outputFormat as any)) {
      setOutputFormat('mp3');
      setStripAudio(false);
      setResolution('original');
    } else if (tab === 'PHOTO' && !IMAGE_FORMATS.includes(outputFormat as any)) {
      setOutputFormat('png');
      setStripAudio(false);
    }
  }, [outputFormat, isAudioOnlyPayload, isPhotoOnlyPayload]);

  const hardwareProfile = useHardwareProfile();
  const currentBatchLimit = getMediaBatchLimit(hardwareProfile, activeTab, preset === 'remux');

  const handleFilesSelected = useCallback((selectedFiles: File[]) => {
    if (selectedFiles.length > 0) {
      const firstCat = detectCategory(selectedFiles[0].name);
      const mappedTab: 'VIDEO' | 'AUDIO' | 'PHOTO' = firstCat === 'OTHER' ? 'VIDEO' : firstCat;
      const dynamicLimit = getMediaBatchLimit(hardwareProfile, mappedTab, preset === 'remux');
      setFiles(prev => {
        const combined = [...prev, ...selectedFiles].slice(0, dynamicLimit);
        const initialItems: QueueItem[] = combined.map((f, i) => ({
          id: `${f.name}-${f.size}-${i}`,
          filename: f.name,
          sizeBytes: f.size,
          status: 'pending' as JobStatus,
          progress: 0,
        }));
        setQueueItems(initialItems);
        return combined;
      });
      setActiveTab(mappedTab);
      if (mappedTab === 'AUDIO') setOutputFormat('mp3');
      else if (mappedTab === 'PHOTO') setOutputFormat('png');
      else setOutputFormat('mp4');
      clearJob();
    }
  }, [clearJob, hardwareProfile, preset]);

  const handleClear = useCallback(() => {
    setFiles([]);
    setQueueItems([]);
    setAttachedVideo(null);
    setVideoStartTime(0);
    setVideoEndTime(0);
    setAudioSyncMode('fit-audio');
    setUseVisualizer(false);
    clearJob();
  }, [clearJob]);

  const handleFormatSelect = useCallback((fmt: OutputFormat) => {
    setOutputFormat(fmt);
    if (AUDIO_FORMATS.includes(fmt as any)) {
      setStripAudio(false);
      setResolution('original');
    } else if (IMAGE_FORMATS.includes(fmt as any)) {
      setStripAudio(false);
    }
  }, []);

  const handlePresetSelect = useCallback((p: Exclude<Preset, 'custom'>) => {
    setPreset(p);
    if (p !== 'remux' && p !== 'auto') {
      // eslint-disable-next-line security/detect-object-injection
      const config = PRESET_CONFIG[p as Exclude<typeof p, 'remux' | 'auto'>];
      setResolution(config.resolution);
    } else {
      setResolution('original');
    }
  }, []);

  const handleCustomOverride = useCallback((setter: () => void) => {
    setter();
    setPreset('custom');
  }, []);

  const handleInitialize = useCallback(async () => {
    if (files.length === 0 || processing) return;

    const formData = new FormData();
    formData.append('outputFormat', outputFormat);
    formData.append('preset', preset);
    formData.append('speed', String(speed));
    formData.append('resolution', resolution);
    formData.append('stripAudio', String(stripAudio));
    formData.append('stripMetadata', String(stripMetadata));
    files.forEach(f => formData.append('files', f));
    if (isGif) {
      formData.append('gifFps', String(gifFps));
      formData.append('gifPalette', String(gifPalette));
    }

    // Audio-to-Video synthesis parameters
    if (isAudioToVideoMode) {
      if (attachedVideo && !useVisualizer) {
        formData.append('videoFile', attachedVideo);
        formData.append('attachedVideo', attachedVideo);
      }
      formData.append('videoStartTime', String(videoStartTime));
      formData.append('videoEndTime', String(videoEndTime));
      formData.append('audioSyncMode', audioSyncMode);
      formData.append('visualizerStyle', visualizerStyle);
      formData.append('visualizerColor', visualizerColor);
      formData.append('visualizerBg', visualizerBg);
      formData.append('videoLoop', String(audioSyncMode === 'loop-video' || videoLoop));
      formData.append('useVisualizer', String(useVisualizer || !attachedVideo));
    }

    try {
      updateJob({
        status: 'processing',
        progress: 0,
        statusText: files[0]?.size > 50 * 1024 * 1024 ? 'STREAMING MEDIA TO TRANSCODE CORE...' : 'INITIALIZING CONVERTER...',
      });

      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      let res: Response;
      const isLargeSingleFile = files.length === 1 && !isAudioToVideoMode && (files[0].size > 50 * 1024 * 1024);

      if (isLargeSingleFile) {
        // Zero-overhead direct streaming for large files > 50MB (bypasses 2GB undici multipart buffer bug)
        res = await authenticatedFetch(`${apiBase}/api/convert`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-file-name': encodeURIComponent(files[0].name),
            'x-output-format': outputFormat,
            'x-preset': preset,
            'x-speed': String(speed),
            'x-resolution': resolution,
            'x-strip-audio': String(stripAudio),
            'x-strip-metadata': String(stripMetadata),
          },
          body: files[0],
        });
      } else {
        res = await authenticatedFetch(`${apiBase}/api/convert`, {
          method: 'POST',
          body: formData,
        });
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Conversion failed' }));
        const errorMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Conversion failed';
        updateJob({
          status: 'error',
          statusText: `ERROR: ${errorMessage}`,
        });
        return;
      }

      if (res.headers.get('content-type')?.includes('text/event-stream') || res.body) {
        startJob(res);
      } else {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = files.length > 1 ? 'output.zip' : `output.${outputFormat}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        updateJob({
          status: 'complete',
          progress: 100,
          statusText: 'COMPLETE',
        });
      }
    } catch (err: any) {
      console.error('Conversion failed:', err);
      updateJob({
        status: 'error',
        statusText: `ERROR: ${err?.message || 'REQUEST FAILED'}`,
      });
    }
  }, [
    files, processing, outputFormat, preset, speed, resolution, stripAudio, stripMetadata,
    isGif, gifFps, gifPalette, isAudioToVideoMode, attachedVideo, videoStartTime, videoEndTime,
    audioSyncMode, visualizerStyle, visualizerColor, visualizerBg, videoLoop, useVisualizer, startJob, updateJob
  ]);

  /* ── Render ── */
  return (
    <>
      {/* Top utility bar */}
      <MasterHeader
        onlyUtilityBar
        toolName="UNIVERSAL CONVERTER"
        engineId="TRANSCODE-CORE"
        hwAccelText={<HardwareBadge />}
      />

      {/* Workspace */}
      <div className="workspace">
        {/* Left: Dropzone / Studio */}
        <div className="dropzone-container">
          <MasterHeader
            onlyToolHeader
            targetId={isAudioToVideoMode ? 'STUDIO // AUDIO-TO-VIDEO' : 'TARGET // 04'}
            title={
              isAudioToVideoMode ? (
                'Audio-to-Video Studio.'
              ) : (
                <>Universal<br/>Converter.</>
              )
            }
            headerStyle={{ padding: isAudioToVideoMode ? '16px 24px' : '20px 24px', flexShrink: 0 }}
            titleStyle={{ fontSize: isAudioToVideoMode ? 'clamp(1.5rem, 2.5vw, 2.2rem)' : undefined, lineHeight: isAudioToVideoMode ? 1 : undefined }}
            titleRowAlign="center"
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
                    minHeight: '36px',
                    padding: '6px 12px',
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

          <AnimatePresence mode="wait">
            {!hasFiles ? (
              <motion.div
                key="empty-dropzone"
                initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -10 }}
                transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 28 }}
                style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
              >
                <FileDropzone
                  onFilesSelected={handleFilesSelected}
                  multiple={true}
                  formatsListText={`Drop video, audio, or image files to convert. Precision limits calibrated for your device — up to ${currentBatchLimit} ${activeTab.toLowerCase()} files.`}
                />
              </motion.div>
            ) : isAudioToVideoMode ? (
              <motion.div
                key="a2v-studio"
                initial={shouldReduceMotion ? false : { opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
                transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 28 }}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', minHeight: 0 }}
                data-testid="a2v-studio-container"
                data-lenis-prevent
              >
                <AudioToVideoStudio
                  audioFile={files[0]}
                  attachedVideo={attachedVideo}
                  onAttachVideo={(file) => {
                    setAttachedVideo(file);
                    if (file) {
                      setUseVisualizer(false);
                    }
                  }}
                  videoStartTime={videoStartTime}
                  videoEndTime={videoEndTime}
                  onTrimChange={(start, end) => {
                    setVideoStartTime(start);
                    setVideoEndTime(end);
                  }}
                  audioSyncMode={audioSyncMode}
                  onSyncModeChange={setAudioSyncMode}
                  visualizerStyle={visualizerStyle}
                  onVisualizerStyleChange={setVisualizerStyle}
                  useVisualizer={useVisualizer}
                  onToggleVisualizer={setUseVisualizer}
                  onClearAudio={handleClear}
                  downloadUrl={jobState?.status === 'complete' ? jobState.downloadUrl : null}
                  outputFormat={outputFormat}
                />
              </motion.div>
            ) : (
              <motion.div
                key="standard-queue"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px 24px 24px', gap: '16px', overflowY: 'auto' }}
                data-lenis-prevent
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="tiny-label">BATCH QUEUE ({files.length.toLocaleString('en-US')} {files.length === 1 ? 'ITEM' : 'ITEMS'})</span>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <span className="mono-data" style={{ color: 'var(--accent)' }}>V: {categoryCounts.VIDEO}</span>
                    <span className="mono-data" style={{ color: 'var(--accent)' }}>A: {categoryCounts.AUDIO}</span>
                    <span className="mono-data" style={{ color: 'var(--accent)' }}>P: {categoryCounts.PHOTO}</span>
                  </div>
                </div>

                {/* Queue List with 21st.dev staggered motion */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {files.slice(0, 50).map((file, idx) => {
                    const cat = detectCategory(file.name);
                    const badgeColor = cat === 'OTHER' ? 'var(--text-muted)' : 'var(--accent)';
                    
                    return (
                      <motion.div
                        key={`${file.name}-${file.size}-${idx}`}
                        initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15, delay: Math.min(idx * 0.03, 0.3) }}
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
                              fontSize: '0.5625rem',
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
                          </span>
                          {jobState?.downloadUrl && status === 'COMPLETE' && (() => {
                            const jobId = jobState.downloadUrl.split('jobId=')[1]?.split('&')[0];
                            const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                            const isSingle = files.length === 1;
                            let targetFile = isSingle
                              ? `output.${outputFormat}`
                              : `converted_${idx + 1}_${baseName}.${outputFormat}`;
                            if (jobState.downloadUrl.includes('file=')) {
                              const paramFile = jobState.downloadUrl.split('file=')[1]?.split('&')[0];
                              if (isSingle && paramFile) targetFile = decodeURIComponent(paramFile);
                            }
                            const rawHref = `/api/download?jobId=${jobId}&file=${encodeURIComponent(targetFile)}`;
                            const downloadHref = appendAuthToken(rawHref, sessionToken);

                            return (
                              <TooltipBottom content="Download converted file">
                                <motion.a
                                  href={downloadHref}
                                  download={targetFile}
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
                    multiple={true}
                    formatsListText="+ Add more files to batch"
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Resizable options panel */}
        <ResizableOptionsPanel title="CONVERSION PARAMETERS">

            {/* ── 0. TARGET MEDIA TYPE TAB SWITCHER ── */}
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
                  const isTabDisabled = (isAudioOnlyPayload && cat === 'PHOTO') || (isPhotoOnlyPayload && cat !== 'PHOTO');
                  const tabDisabledReason = (isAudioOnlyPayload && cat === 'PHOTO')
                    ? 'Audio payload cannot be converted to photo formats'
                    : (isPhotoOnlyPayload && cat !== 'PHOTO')
                    ? 'Photo payload can only be converted to image formats'
                    : '';

                  const tabButton = (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => !isTabDisabled && handleTabChange(cat)}
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
                          layoutId={shouldReduceMotion ? undefined : 'activeMediaTabConverter'}
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

            {/* ── 1. OUTPUT FORMAT ── */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">TARGET {activeTab} FORMAT</span>
                <span className="mono-data">{outputFormat.toUpperCase()}</span>
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={`format-grid-${activeTab}`}
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))', gap: '6px', padding: '4px 2px' }}
                  data-testid="format-grid"
                >
                  {(activeTab === 'VIDEO' ? VIDEO_FORMATS : activeTab === 'AUDIO' ? AUDIO_FORMATS : IMAGE_FORMATS).map((fmt, idx) => (
                    <ConverterOptionTile
                      key={fmt}
                      label={fmt.toUpperCase()}
                      isSelected={outputFormat === fmt}
                      onClick={() => handleFormatSelect(fmt)}
                      testId={`format-${fmt}`}
                      ariaLabel={`Select ${fmt.toUpperCase()} format`}
                      reducedMotion={shouldReduceMotion}
                      delay={idx * 0.02}
                      style={{ padding: '8px 4px', textTransform: 'uppercase' }}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* ── 2. PLATFORM PRESET ── */}
            {!isAudioFormat && !isImageFormat && (
              <div className="form-group">
                <div className="form-header">
                  <span className="tiny-label">PLATFORM PRESET</span>
                  <span className="mono-data">{preset.toUpperCase()}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))', gap: '6px', padding: '4px 2px' }} data-testid="preset-grid">
                  {PRESETS.map((p, idx) => {
                    // eslint-disable-next-line security/detect-object-injection
                    const presetDesc = PRESET_DESCRIPTIONS[p];
                    return (
                      <TooltipTop key={p} content={presetDesc}>
                        <ConverterOptionTile
                          label={p.toUpperCase()}
                          isSelected={preset === p}
                          onClick={() => handlePresetSelect(p)}
                          testId={`preset-${p}`}
                          ariaLabel={`Select ${p.toUpperCase()} preset`}
                          reducedMotion={shouldReduceMotion}
                          delay={idx * 0.02}
                          style={{ width: '100%', padding: '8px 4px', textTransform: 'uppercase' }}
                        />
                      </TooltipTop>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── 3. ADVANCED OPTIONS ── */}
            <div className="form-group">
              <details
                className="cel-accordion-details"
                open={advancedOpen}
                onToggle={e => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
              >
                <summary
                  className="form-header"
                  onClick={e => {
                    // Explicit state sync so Enter/Space/click behaves consistently across browsers and jsdom
                    e.preventDefault();
                    setAdvancedOpen(prev => !prev);
                  }}
                  data-testid="advanced-toggle"
                  style={{ cursor: 'pointer', listStyle: 'none' }}
                >
                  <span className="tiny-label">ADVANCED OPTIONS</span>
                </summary>

                {advancedOpen && (
                  <div
                    data-testid="advanced-section"
                    style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingTop: '8px' }}
                  >
                    {/* Speed */}
                    <div>
                      <span className="tiny-label" style={{ marginBottom: '8px', display: 'block' }}>SPEED</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 2px' }}>
                        {SPEED_OPTIONS.map((s, idx) => (
                          <ConverterOptionTile
                            key={s}
                            label={`${s}x`}
                            isSelected={speed === s}
                            onClick={() => handleCustomOverride(() => setSpeed(s))}
                            testId={`speed-${s}`}
                            ariaLabel={`Speed ${s}x`}
                            reducedMotion={shouldReduceMotion}
                            delay={idx * 0.02}
                            style={{ padding: '6px 12px' }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* Resolution — hidden for audio formats */}
                    {!isAudioFormat && (
                      <div>
                        <span className="tiny-label" style={{ marginBottom: '8px', display: 'block' }}>RESOLUTION</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '4px 2px' }}>
                          {RESOLUTION_OPTIONS.map((r, idx) => (
                            <ConverterOptionTile
                              key={r}
                              label={r.toUpperCase()}
                              isSelected={resolution === r}
                              onClick={() => handleCustomOverride(() => setResolution(r))}
                              testId={`resolution-${r}`}
                              ariaLabel={`Resolution ${r.toUpperCase()}`}
                              reducedMotion={shouldReduceMotion}
                              delay={idx * 0.02}
                              style={{ padding: '6px 12px', textTransform: 'uppercase' }}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Strip Audio — hidden for audio and image formats */}
                    {!isAudioFormat && !isImageFormat && (
                      <label className="cel-check-row" data-testid="strip-audio-toggle">
                        <input
                          type="checkbox"
                          className="cel-check-input"
                          checked={stripAudio}
                          onChange={e => handleCustomOverride(() => setStripAudio(e.target.checked))}
                        />
                        <span className="checkbox-label">Strip Audio</span>
                      </label>
                    )}

                    {/* Strip Metadata */}
                    <label className="cel-check-row" data-testid="strip-metadata-toggle">
                      <input
                        type="checkbox"
                        className="cel-check-input"
                        checked={stripMetadata}
                        onChange={e => handleCustomOverride(() => setStripMetadata(e.target.checked))}
                      />
                      <span className="checkbox-label">Strip Metadata</span>
                    </label>
                  </div>
                )}
              </details>
            </div>

            {/* ── 4. GIF OPTIONS ── */}
            <AnimatePresence>
              {isGif && (
                <motion.div 
                  initial={shouldReduceMotion ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, height: 0 }}
                  transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="form-group" 
                  style={{ overflow: 'hidden' }}
                  data-testid="gif-options"
                >
                  <div className="form-header">
                    <span className="tiny-label">GIF OPTIONS</span>
                  </div>

                  {/* Frame Rate */}
                  <div>
                    <span className="tiny-label" style={{ marginBottom: '8px', display: 'block' }}>FRAME RATE</span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {GIF_FPS_OPTIONS.map(fps => (
                        <ConverterOptionTile
                          key={fps}
                          label={`${fps} FPS`}
                          isSelected={gifFps === fps}
                          onClick={() => setGifFps(fps)}
                          testId={`gif-fps-${fps}`}
                          ariaLabel={`${fps} FPS`}
                          reducedMotion={shouldReduceMotion}
                          style={{ padding: '6px 12px' }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Palette Optimization */}
                  <label className="cel-check-row" data-testid="gif-palette-toggle" style={{ marginTop: '8px' }}>
                    <input
                      type="checkbox"
                      className="cel-check-input"
                      checked={gifPalette}
                      onChange={e => setGifPalette(e.target.checked)}
                    />
                    <span className="checkbox-label">Palette Optimization</span>
                  </label>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Payload summary */}
            <AnimatePresence>
              {hasFiles && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="form-group"
                  style={{ overflow: 'hidden' }}
                >
                  <div className="form-header">
                    <span className="tiny-label">PAYLOAD SUMMARY</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tiny-label">FILES</span>
                      <span className="mono-data">{files.length}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tiny-label">TOTAL SIZE</span>
                      <span className="mono-data">{formatSize(files.reduce((acc, f) => acc + f.size, 0))}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tiny-label">FORMAT</span>
                      <span className="mono-data" style={{ color: 'var(--accent)' }}>{outputFormat.toUpperCase()}</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
        </ResizableOptionsPanel>
      </div>

      {/* Progress Section */}
      <div className="progress-section grid-line-top">
        <motion.button
          type="button"
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!hasFiles || status === 'PROCESSING'}
          data-testid="initialize-btn"
          whileHover={shouldReduceMotion ? undefined : { scale: (!hasFiles || status === 'PROCESSING') ? 1 : 1.01 }}
          whileTap={shouldReduceMotion ? undefined : { scale: (!hasFiles || status === 'PROCESSING') ? 1 : 0.97 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={{ opacity: (!hasFiles || status === 'PROCESSING') ? 0.5 : 1 }}
        >
          {status === 'PROCESSING' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <progress className="cel-spinner" aria-label="Processing" />
              <span>PROCESSING...</span>
            </span>
          ) : (
            'INITIALIZE'
          )}
        </motion.button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusText}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {strategy && (
                <TooltipTop content={strategyReason || `Transcode strategy: ${strategy}`}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.5625rem',
                      fontWeight: 700,
                      letterSpacing: '0.08em',
                      padding: '2px 7px',
                      border: `1px solid ${
                        strategy === 'REMUX'      ? '#22c55e' :
                        strategy.includes('COPY') ? '#eab308' : 'var(--accent)'
                      }`,
                      color: strategy === 'REMUX'      ? '#22c55e' :
                             strategy.includes('COPY') ? '#eab308' : 'var(--accent)',
                      background: strategy === 'REMUX'      ? 'rgba(34,197,94,0.08)' :
                                  strategy.includes('COPY') ? 'rgba(234,179,8,0.08)' : 'rgba(255,90,0,0.08)',
                      cursor: 'default',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {strategy === 'REMUX'         ? '⚡ REMUX'
                   : strategy === 'COPY+VIDEO'    ? '◑ COPY VIDEO'
                   : strategy === 'COPY+AUDIO'    ? '◑ COPY AUDIO'
                   : '↺ ENCODE'}
                  </span>
                </TooltipTop>
              )}
              <span className="mono-data">
                {hasFiles ? `TARGET: ${files.length.toLocaleString('en-US')} ${files.length === 1 ? 'FILE' : 'FILES'}` : 'QUEUE: 0 FILES'}
              </span>
              {jobState?.downloadUrl && (
                <motion.a
                  href={jobState.downloadUrl}
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
                  [ DOWNLOAD OUTPUT ]
                </motion.a>
              )}
            </div>
          </div>
          <progress
            className="cel-progress"
            data-testid="progress-fill"
            max={100}
            value={Math.max(0, Math.min(100, progress))}
            aria-label="Conversion progress"
            aria-valuetext={`${Math.round(Math.max(0, Math.min(100, progress)))}%`}
          />
        </div>
      </div>
    </>
  );
}
