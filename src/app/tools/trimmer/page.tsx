// app/tools/trimmer/page.tsx – Audio Trimmer UI (TRIM & MERGE modes)
// ---------------------------------------------------------------
'use client'

import React, { useState, useEffect, useRef, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { FileDropzone } from '../../components/ui/FileDropzone';
import { ResizableOptionsPanel } from '../../components/ui/ResizableOptionsPanel';
import WaveformCanvas from '../../components/waveform/WaveformCanvas';
import WaveformControls, { TrimmerMode } from '../../components/waveform/WaveformControls';
import { generateWaveform, WaveformResult } from '../../components/waveform/WaveformEngine';
import { TooltipTop } from '../../components/ui/Tooltip';
import { MasterHeader } from '../../components/ui/MasterHeader';
import { MasterOptionGrid, OptionItem } from '../../components/ui/MasterOptionGrid';
import { safeFetch } from '../../../lib/security/safeFetch';
import { ensureSessionToken, appendAuthToken, useSessionToken } from '../../../lib/security/clientAuth';

// Helper to read a File as ArrayBuffer
const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('Failed to read file as ArrayBuffer'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

const MODE_OPTIONS: OptionItem<TrimmerMode>[] = [
  { id: 'TRIM', label: 'TRIM' },
  { id: 'MERGE', label: 'MERGE' },
];

const FORMAT_OPTIONS: OptionItem<string>[] = [
  { id: 'mp3', label: 'MP3' },
  { id: 'wav', label: 'WAV' },
  { id: 'flac', label: 'FLAC' },
  { id: 'm4a', label: 'M4A' },
  { id: 'aac', label: 'AAC' },
];

import { useJob } from '../../context/GlobalJobContext';

export default function AudioTrimmerPage() {
  const fadeInId = useId();
  const fadeOutId = useId();
  const crossfadeId = useId();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const sessionToken = useSessionToken();
  const { jobState, startJob, updateJob, clearJob } = useJob('trimmer');

  const [mode, setMode] = useState<TrimmerMode>(() => jobState?.options?.mode ?? 'TRIM');
  const [selectedFormat, setSelectedFormat] = useState<string>('mp3');
  const [files, setFiles] = useState<File[]>(() => jobState?.files ?? []);
  const [audioUrl, setAudioUrl] = useState<string>(() => jobState?.options?.audioUrl ?? '');
  const [waveform, setWaveform] = useState<WaveformResult | null>(() => jobState?.options?.waveform ?? null);
  const [duration, setDuration] = useState(() => jobState?.options?.duration ?? 0);
  const [currentTime, setCurrentTime] = useState(() => jobState?.options?.currentTime ?? 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(() => jobState?.options?.trimStart ?? 0);
  const [trimEnd, setTrimEnd] = useState(() => jobState?.options?.trimEnd ?? 0);
  const [fadeIn, setFadeIn] = useState(() => jobState?.options?.fadeIn ?? 0);
  const [fadeOut, setFadeOut] = useState(() => jobState?.options?.fadeOut ?? 0);
  const [crossfade, setCrossfade] = useState(() => jobState?.options?.crossfade ?? 0);
  const [zoom, setZoom] = useState(() => jobState?.options?.zoom ?? 10); // seconds visible

  // Derived state from context
  const progress = jobState?.progress ?? 0;
  const statusText = jobState?.statusText ?? 'AWAITING PAYLOAD';
  const processing = jobState?.status === 'processing';

  const audioRef = useRef<HTMLAudioElement>(null);

  // Sync inputs to context
  useEffect(() => {
    if (!processing) {
      updateJob({
        files,
        options: { mode, audioUrl, duration, currentTime, trimStart, trimEnd, fadeIn, fadeOut, crossfade, zoom, waveform },
      });
    }
  }, [files, mode, audioUrl, duration, currentTime, trimStart, trimEnd, fadeIn, fadeOut, crossfade, zoom, waveform, processing, updateJob]);

  // Clean up blob URL on unmount or audioUrl change
  useEffect(() => {
    return () => {
      if (audioUrl && audioUrl.startsWith('blob:')) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  // Handle file drop – single file for TRIM, multiple for MERGE
  const handleFilesSelected = async (selected: File[]) => {
    if (mode === 'TRIM') {
      const file = selected[0];
      setFiles([file]);
      if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      updateJob({ statusText: `LOADED: ${file.name}` });
      const buffer = await readFileAsArrayBuffer(file);
      // Use a temporary Audio element to get duration (needed before waveform)
      const tempAudio = new Audio(url);
      tempAudio.addEventListener('loadedmetadata', async () => {
        const dur = tempAudio.duration;
        setDuration(dur);
        setTrimEnd(dur);
        // Approximate window size as canvas width
        const canvasWidth = 800; 
        const result = await generateWaveform(buffer, canvasWidth);
        setWaveform(result);
        tempAudio.remove();
      });
    } else {
      // MERGE mode: deduplicate incoming files by name & size
      const uniqueSelected = selected.filter(s => !files.some(f => f.name === s.name && f.size === s.size));
      const nextFiles = [...files, ...uniqueSelected];
      setFiles(nextFiles);
      updateJob({ statusText: `${nextFiles.length} FILES QUEUED`, files: nextFiles });
    }
  };

  // Playback controls
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => setCurrentTime(audio.currentTime);
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play();
  };

  const handleSeek = (time: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleSelect = (start: number, end: number) => {
    setTrimStart(Math.min(start, end));
    setTrimEnd(Math.max(start, end));
  };

  const handleZoomIn = () => setZoom((z: number) => Math.max(1, z - 1));
  const handleZoomOut = () => setZoom((z: number) => z + 1);

  const handleModeToggle = (newMode: TrimmerMode) => {
    if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    setMode(newMode);
    setFiles([]);
    setAudioUrl('');
    setWaveform(null);
    setDuration(0);
    setCurrentTime(0);
    setTrimStart(0);
    setTrimEnd(0);
    setFadeIn(0);
    setFadeOut(0);
    setCrossfade(0);
    setZoom(10);
    clearJob();
  };

  const handleClear = () => {
    if (audioUrl && audioUrl.startsWith('blob:')) URL.revokeObjectURL(audioUrl);
    setFiles([]);
    setAudioUrl('');
    setWaveform(null);
    setDuration(0);
    setCurrentTime(0);
    setTrimStart(0);
    setTrimEnd(0);
    setFadeIn(0);
    setFadeOut(0);
    setCrossfade(0);
    setZoom(10);
    clearJob();
  };

  const handleInitialize = async () => {
    if (files.length === 0 || processing) return;

    const formData = new FormData();
    formData.append('mode', mode.toLowerCase());
    formData.append('outputFormat', selectedFormat.toLowerCase());

    if (mode === 'TRIM') {
      formData.append('startTime', String(trimStart));
      formData.append('endTime', String(trimEnd));
      formData.append('fadeIn', String(fadeIn));
      formData.append('fadeOut', String(fadeOut));
    } else {
      formData.append('crossfade', String(crossfade));
    }
    files.forEach(f => formData.append('files', f));

    try {
      updateJob({
        status: 'processing',
        progress: 0,
        statusText: files[0]?.size > 50 * 1024 * 1024 ? 'UPLOADING MEDIA PAYLOAD...' : 'INITIALIZING AUDIO PROCESSOR...',
      });

      const authToken = await ensureSessionToken();
      const res = await safeFetch('/api/audio-trim', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Request failed' }));
        const errorMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Request failed';
        updateJob({ status: 'error', statusText: `ERROR: ${errorMessage}` });
        return;
      }
      
      startJob(res);
    } catch (err: any) {
      updateJob({ status: 'error', statusText: `ERROR: ${err.message || 'Request failed'}` });
    }
  };

  const hasFiles = files.length > 0;

  return (
    <>
      {/* Top utility bar */}
      <MasterHeader
        onlyUtilityBar
        toolName="AUDIO TRIMMER"
        engineId="AUDIO-PRECISION"
      />

      {/* Workspace */}
      <div className="workspace">
        {/* Left: dropzone or waveform */}
        <div className="dropzone-container">
          <MasterHeader
            onlyToolHeader
            targetId="TARGET // 06"
            title={<>Audio<br/>Trimmer.</>}
            rightAction={hasFiles && (
              <TooltipTop content="Clear audio and start over">
                <button
                  type="button"
                  onClick={handleClear}
                  className="tiny-label"
                  data-testid="clear-btn"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6, padding: '6px 10px', minHeight: '36px' }}
                >
                  [ CLEAR ]
                </button>
              </TooltipTop>
            )}
          />

          {(!hasFiles || mode === 'MERGE') && (
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              acceptedTypes={['mp3', 'wav', 'flac', 'm4a', 'aac']}
              multiple={mode === 'MERGE'}
              formatsListText="Accepted formats: MP3, WAV, FLAC, M4A, AAC"
            />
          )}

          {hasFiles && mode === 'TRIM' && waveform && (
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px 24px 24px', gap: '16px', overflow: 'hidden' }}>
              <WaveformCanvas
                left={waveform.left}
                right={waveform.right}
                duration={duration}
                currentTime={currentTime}
                trimStart={trimStart}
                trimEnd={trimEnd}
                zoom={zoom}
                onSeek={handleSeek}
                onSelect={handleSelect}
              />
              <WaveformControls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                trimStart={trimStart}
                trimEnd={trimEnd}
                zoom={zoom}
                onPlayPause={togglePlay}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onTrimChange={(s, e) => {
                  setTrimStart(s);
                  setTrimEnd(e);
                }}
              />
            </div>
          )}

          {/* Hidden audio element for playback */}
          <audio ref={audioRef} src={audioUrl} preload="metadata" />
        </div>

        {/* Right: Resizable options panel */}
        <ResizableOptionsPanel title="AUDIO TRIM PARAMETERS">

            {/* Mode toggle */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">MODE</span>
                <span className="mono-data" style={{ color: 'var(--accent)' }}>{mode}</span>
              </div>
              <MasterOptionGrid
                options={MODE_OPTIONS}
                value={mode}
                onChange={val => handleModeToggle(val)}
                columns={2}
                layoutId="trimmerModePill"
                testIdPrefix="mode-option"
              />
              <select
                value={mode}
                onChange={e => handleModeToggle(e.target.value as TrimmerMode)}
                data-testid="mode-select"
                aria-hidden="true"
                tabIndex={-1}
                className="sr-only"
              >
                <option value="TRIM">TRIM</option>
                <option value="MERGE">MERGE</option>
              </select>
            </div>

            {/* Output format */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">OUTPUT FORMAT</span>
                <span className="mono-data" style={{ color: 'var(--accent)' }}>{selectedFormat.toUpperCase()}</span>
              </div>
              <MasterOptionGrid
                options={FORMAT_OPTIONS}
                value={selectedFormat}
                onChange={val => setSelectedFormat(val)}
                columns={3}
                layoutId="trimmerFormatPill"
                testIdPrefix="format-option"
              />
              <select
                value={selectedFormat}
                onChange={e => setSelectedFormat(e.target.value)}
                data-testid="format-select"
                aria-hidden="true"
                tabIndex={-1}
                className="sr-only"
              >
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
                <option value="flac">FLAC</option>
                <option value="m4a">M4A</option>
                <option value="aac">AAC</option>
              </select>
            </div>

            {/* Fade inputs (only in TRIM) */}
            <AnimatePresence initial={false}>
              {mode === 'TRIM' && (
                <motion.div 
                  initial={false}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden', padding: '2px 0 8px' }}
                >
                  <div className="form-group">
                    <div className="form-header">
                      <label htmlFor={fadeInId} className="tiny-label" style={{ cursor: 'pointer' }}>FADE IN</label>
                      <span 
                        className="mono-data" 
                        data-testid="fade-in-value"
                      >
                        {fadeIn}s
                      </span>
                    </div>
                    <input
                      id={fadeInId}
                      type="range"
                      min={0}
                      max={5}
                      step={0.1}
                      value={fadeIn}
                      onChange={e => setFadeIn(parseFloat(e.target.value))}
                      data-testid="fade-in-slider"
                      style={{ width: '100%', accentColor: 'var(--accent)' }}
                    />
                  </div>
                  <div className="form-group">
                    <div className="form-header">
                      <label htmlFor={fadeOutId} className="tiny-label" style={{ cursor: 'pointer' }}>FADE OUT</label>
                      <span 
                        className="mono-data" 
                        data-testid="fade-out-value"
                      >
                        {fadeOut}s
                      </span>
                    </div>
                    <input
                      id={fadeOutId}
                      type="range"
                      min={0}
                      max={5}
                      step={0.1}
                      value={fadeOut}
                      onChange={e => setFadeOut(parseFloat(e.target.value))}
                      data-testid="fade-out-slider"
                      style={{ width: '100%', accentColor: 'var(--accent)' }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Crossfade input (only in MERGE) */}
            <AnimatePresence initial={false}>
              {mode === 'MERGE' && (
                <motion.div 
                  initial={false}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflow: 'hidden', padding: '2px 0 8px' }}
                >
                  <div className="form-group">
                    <div className="form-header">
                      <label htmlFor={crossfadeId} className="tiny-label" style={{ cursor: 'pointer' }}>CROSSFADE</label>
                      <span 
                        className="mono-data" 
                        data-testid="crossfade-value"
                      >
                        {crossfade}s
                      </span>
                    </div>
                    <input
                      id={crossfadeId}
                      type="range"
                      min={0}
                      max={5}
                      step={0.1}
                      value={crossfade}
                      onChange={e => setCrossfade(parseFloat(e.target.value))}
                      data-testid="crossfade-slider"
                      style={{ width: '100%', accentColor: 'var(--accent)' }}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Merge file list */}
            {mode === 'MERGE' && files.length > 0 && (
              <div className="form-group">
                <div className="form-header">
                  <span className="tiny-label">FILES TO MERGE</span>
                  <span className="mono-data">{files.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {files.map((f, idx) => (
                    <div key={idx} className="mono-data" data-testid="merge-file-item" style={{ padding: '4px 0', borderBottom: '1px solid rgba(42,42,42,0.5)' }}>
                      {f.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
        </ResizableOptionsPanel>
      </div>

      {/* Bottom progress section — INITIALIZE button lives here */}
      <div className="progress-section grid-line-top">
        <motion.button
          type="button"
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!hasFiles || processing}
          data-testid="initialize-btn"
          whileHover={shouldReduceMotion ? undefined : { scale: (!hasFiles || processing) ? 1 : 1.01 }}
          whileTap={shouldReduceMotion ? undefined : { scale: (!hasFiles || processing) ? 1 : 0.97 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={{
            opacity: (!hasFiles || processing) ? 0.5 : 1,
            cursor: (!hasFiles || processing) ? 'not-allowed' : 'pointer'
          }}
        >
          {processing ? (
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
            <span className="tiny-label">{statusText}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {jobState?.status === 'complete' && jobState?.downloadUrl && (
                <a
                  href={appendAuthToken(jobState.downloadUrl, sessionToken)}
                  download={files[0] ? `trimmed_${files[0].name}` : 'trimmed_audio.mp3'}
                  data-testid="download-btn"
                  className="mono-data"
                  style={{
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                    background: 'rgba(255, 90, 0, 0.1)',
                    borderRadius: '3px',
                    padding: '2px 8px',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                >
                  [ DOWNLOAD PROCESSED AUDIO ]
                </a>
              )}
              <span className="mono-data">
                {hasFiles ? `TARGET: ${files[0].name}` : 'QUEUE: 0 FILES'}
              </span>
            </div>
          </div>
          <progress
            className="cel-progress"
            data-testid="progress-fill"
            max={100}
            value={Math.max(0, Math.min(100, progress))}
            aria-label="Audio trim progress"
            aria-valuetext={`${Math.round(Math.max(0, Math.min(100, progress)))}%`}
          />
        </div>
      </div>
    </>
  );
}
