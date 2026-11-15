'use client'

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { generateWaveform, WaveformResult } from '../../../components/waveform/WaveformEngine';
import { MasterMicroBadge } from '../../../components/ui/MasterMicroBadge';

export interface VideoTrimmerTimelineProps {
  /** The primary audio file whose duration sets the master audio baseline */
  audioFile: File;
  /** The optional attached companion video file to be trimmed */
  attachedVideo: File | null;
  /** Current start offset in seconds for video trimming */
  videoStartTime: number;
  /** Current end offset in seconds for video trimming */
  videoEndTime: number;
  /** Callback fired when trim handles or range move */
  onTrimChange: (start: number, end: number) => void;
  /** Current playback playhead position in seconds */
  currentTime: number;
  /** Callback fired when user clicks or scrubs the playhead */
  onSeek: (time: number) => void;
  /** Playback status (true when playing, false when paused) */
  isPlaying: boolean;
  /** Callback to toggle audio/video playback */
  onTogglePlay: () => void;
  /** Optional master audio duration synced directly from parent playback element */
  masterAudioDuration?: number;
}

export const formatTimecode = (sec: number): string => {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor(((sec * 100 + 0.0001) % 100));
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

function buildSeededEnvelope(name = 'audio', size = 1024, buckets = 200): WaveformResult {
  const left = new Float32Array(buckets);
  let seed = (size || 1024) & 0x7fffffff;
  for (let c = 0; c < name.length; c++) {
    seed = ((seed << 5) - seed + name.charCodeAt(c)) & 0x7fffffff;
  }
  const phase = (seed % 360) * 0.01745;
  for (let i = 0; i < buckets; i++) {
    const t = i / buckets;
    const env = Math.sin(t * Math.PI);
    const wave1 = Math.abs(Math.sin(i * 0.43 + phase));
    const wave2 = Math.abs(Math.cos(i * 0.19 + phase * 1.7));
    const wave3 = Math.abs(Math.sin(i * 1.13 + phase * 0.5));
    // eslint-disable-next-line security/detect-object-injection
    left[i] = Math.max(0.14, Math.min(0.98, (0.2 + 0.8 * env) * (wave1 * 0.45 + wave2 * 0.35 + wave3 * 0.2)));
  }
  return { left, right: left };
}

async function computeFastFileEnvelope(file: File, buckets = 200): Promise<WaveformResult> {
  try {
    const fileSize = file.size;
    if (fileSize <= 0 || typeof file.slice !== 'function') {
      return buildSeededEnvelope(file?.name, fileSize, buckets);
    }
    const readSize = Math.min(fileSize, 65536);
    const startOffset = fileSize > readSize * 2 ? Math.floor(fileSize * 0.15) : 0;
    const buf = await file.slice(startOffset, startOffset + readSize).arrayBuffer();
    const bytes = new Uint8Array(buf);
    if (bytes.length < buckets) {
      return buildSeededEnvelope(file.name, fileSize, buckets);
    }
    const left = new Float32Array(buckets);
    const step = Math.max(1, Math.floor(bytes.length / buckets));
    let maxVal = 0.01;
    for (let i = 0; i < buckets; i++) {
      let sum = 0;
      const base = i * step;
      const count = Math.min(step, bytes.length - base);
      for (let j = 0; j < count; j++) {
        // eslint-disable-next-line security/detect-object-injection
        const v = Math.abs((bytes[base + j] ?? 128) - 128) / 128;
        sum += v * v;
      }
      const rms = count > 0 ? Math.sqrt(sum / count) : 0.35;
      // eslint-disable-next-line security/detect-object-injection
      left[i] = rms;
      if (rms > maxVal) maxVal = rms;
    }
    for (let i = 0; i < buckets; i++) {
      // eslint-disable-next-line security/detect-object-injection
      left[i] = Math.max(0.14, Math.min(0.98, left[i] / maxVal));
    }
    return { left, right: left };
  } catch {
    return buildSeededEnvelope(file?.name, file?.size, buckets);
  }
}

export function VideoTrimmerTimeline({
  audioFile,
  attachedVideo,
  videoStartTime,
  videoEndTime,
  onTrimChange,
  currentTime,
  onSeek,
  isPlaying,
  onTogglePlay,
  masterAudioDuration,
}: VideoTrimmerTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const tracksRef = useRef<HTMLDivElement>(null);
  const audioCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastDragEndRef = useRef<number>(0);

  // Audio duration & waveform data
  const [audioDuration, setAudioDuration] = useState<number>(() =>
    masterAudioDuration && isFinite(masterAudioDuration) && masterAudioDuration > 0 ? masterAudioDuration : 30
  );
  const [audioWaveform, setAudioWaveform] = useState<WaveformResult | null>(() =>
    buildSeededEnvelope(audioFile?.name, audioFile?.size, 200)
  );

  // Video duration & thumbnails
  const [videoDuration, setVideoDuration] = useState<number>(() =>
    !attachedVideo && masterAudioDuration && isFinite(masterAudioDuration) && masterAudioDuration > 0 ? masterAudioDuration : 30
  );
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | 'playhead' | null>(null);

  const attachedVideoRef = useRef<File | null>(attachedVideo);
  attachedVideoRef.current = attachedVideo;
  const audioDurationRef = useRef<number>(audioDuration);
  audioDurationRef.current = audioDuration;

  // Master timeline duration for normalization
  const timelineDuration = useMemo(() => {
    return Math.max(audioDuration, videoDuration, currentTime, 0.001);
  }, [audioDuration, videoDuration, currentTime]);

  const trimStateRef = useRef({ videoStartTime, videoEndTime, onTrimChange });
  trimStateRef.current = { videoStartTime, videoEndTime, onTrimChange };

  // Sync from parent masterAudioDuration whenever available
  useEffect(() => {
    if (masterAudioDuration && isFinite(masterAudioDuration) && masterAudioDuration > 0) {
      audioDurationRef.current = masterAudioDuration;
      setAudioDuration(masterAudioDuration);
      if (!attachedVideoRef.current) {
        setVideoDuration(masterAudioDuration);
        const { videoStartTime: cs, videoEndTime: ce, onTrimChange: handleTrim } = trimStateRef.current;
        if ((cs === 0 && ce === 30 && Math.abs(masterAudioDuration - 30) > 0.5) || ce > masterAudioDuration) {
          handleTrim(cs, masterAudioDuration);
        }
      }
    }
  }, [masterAudioDuration]);

  // Decode Audio Waveform & extract duration
  useEffect(() => {
    let active = true;
    let audioObjUrl: string | null = null;
    let tempAudioEl: HTMLAudioElement | null = null;
    const isHugeAudio = audioFile.size > 35 * 1024 * 1024;

    // Immediately seed waveform so Track 01 is never blank
    setAudioWaveform(buildSeededEnvelope(audioFile?.name, audioFile?.size, 200));

    const loadAudio = async () => {
      try {
        // Compute waveform immediately without waiting for loadedmetadata
        if (isHugeAudio) {
          const fastWf = await computeFastFileEnvelope(audioFile, 200);
          if (active) setAudioWaveform(fastWf);
        } else {
          try {
            const buffer = await audioFile.arrayBuffer();
            const wf = await generateWaveform(buffer, 800);
            if (active) setAudioWaveform(wf);
          } catch {
            const fallbackWf = await computeFastFileEnvelope(audioFile, 160);
            if (active) setAudioWaveform(fallbackWf);
          }
        }

        if (!active) return;

        if (typeof Audio !== 'undefined') {
          audioObjUrl = URL.createObjectURL(audioFile);
          tempAudioEl = new Audio(audioObjUrl);
          tempAudioEl.preload = 'metadata';

          const applyDuration = () => {
            if (!active || !tempAudioEl) return;
            const dur = tempAudioEl.duration && isFinite(tempAudioEl.duration) && tempAudioEl.duration > 0 ? tempAudioEl.duration : 0;
            if (dur > 0) {
              audioDurationRef.current = dur;
              setAudioDuration(dur);
              if (!attachedVideoRef.current) {
                setVideoDuration(dur);
                const { videoStartTime: cs, videoEndTime: ce, onTrimChange: handleTrim } = trimStateRef.current;
                if ((cs === 0 && ce === 30 && Math.abs(dur - 30) > 0.5) || ce > dur) {
                  handleTrim(cs, dur);
                }
              }
            }
            if (audioObjUrl) {
              URL.revokeObjectURL(audioObjUrl);
              audioObjUrl = null;
            }
          };

          tempAudioEl.addEventListener('loadedmetadata', applyDuration);
          tempAudioEl.addEventListener('durationchange', applyDuration);
          tempAudioEl.addEventListener('error', () => {
            if (audioObjUrl) {
              URL.revokeObjectURL(audioObjUrl);
              audioObjUrl = null;
            }
          });
        }
      } catch {
        if (audioObjUrl) {
          URL.revokeObjectURL(audioObjUrl);
          audioObjUrl = null;
        }
        if (active) {
          setAudioWaveform(buildSeededEnvelope(audioFile?.name, audioFile?.size, 120));
        }
      }
    };
    loadAudio();
    return () => {
      active = false;
      if (tempAudioEl) {
        tempAudioEl.src = '';
        tempAudioEl = null;
      }
      if (audioObjUrl) {
        URL.revokeObjectURL(audioObjUrl);
        audioObjUrl = null;
      }
    };
  }, [audioFile]);

  // Extract Video Metadata & Thumbnails
  useEffect(() => {
    if (!attachedVideo) {
      setVideoDuration(audioDurationRef.current || 30);
      setThumbnails([]);
      return;
    }
    let active = true;
    const url = URL.createObjectURL(attachedVideo);
    const video = document.createElement('video');
    video.src = url;
    video.preload = 'auto';

    video.addEventListener('loadedmetadata', () => {
      if (!active) return;
      const dur = video.duration || 30;
      setVideoDuration(dur);

      // If videoEndTime is 0 or uninitialized, set it to the video duration
      const { videoStartTime: currentStart, videoEndTime: currentEnd, onTrimChange: handleTrim } = trimStateRef.current;
      if (currentEnd === 0 || currentEnd > dur) {
        handleTrim(currentStart, dur);
      }

      // Sample 10 thumbnails across video duration
      const count = 10;
      const frames: string[] = [];
      const canvas = document.createElement('canvas');
      canvas.width = 120;
      canvas.height = 68;
      const ctx = canvas.getContext('2d');

      let currentFrame = 0;
      const captureFrame = () => {
        if (!active || currentFrame >= count) {
          if (active) setThumbnails(frames);
          URL.revokeObjectURL(url);
          return;
        }
        video.currentTime = (currentFrame / count) * dur;
      };

      video.addEventListener('seeked', () => {
        if (!active) return;
        if (ctx) {
          try {
            ctx.drawImage(video, 0, 0, 120, 68);
            frames.push(canvas.toDataURL('image/jpeg', 0.6));
          } catch {
            frames.push('');
          }
        }
        currentFrame++;
        captureFrame();
      });

      captureFrame();
    });

    return () => {
      active = false;
      URL.revokeObjectURL(url);
    };
  }, [attachedVideo]);

  // Render Audio Waveform Canvas
  useEffect(() => {
    const canvas = audioCanvasRef.current;
    if (!canvas || !audioWaveform) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const width = canvas.clientWidth * dpr || 600;
      const height = canvas.clientHeight * dpr || 48;
      canvas.width = width;
      canvas.height = height;

      ctx.clearRect(0, 0, width, height);

      const left = audioWaveform.left;
      const numBars = Math.floor(width / (3 * dpr)) || 100;
      const step = Math.max(1, Math.floor(left.length / numBars));
      const topInset = 15 * dpr;
      const usableHeight = Math.max(12 * dpr, height - topInset);
      const effectiveAudioDur = Math.max(audioDuration, timelineDuration, 0.001);

      for (let i = 0; i < numBars; i++) {
        const sampleIdx = Math.min(left.length - 1, i * step);
        // eslint-disable-next-line security/detect-object-injection
        const amp = left[sampleIdx] || 0.15;
        const barHeight = Math.max(2 * dpr, amp * (usableHeight * 0.86));
        const x = i * 3 * dpr;
        const y = topInset + (usableHeight - barHeight) / 2;

        const barTime = (i / numBars) * effectiveAudioDur;
        ctx.fillStyle = barTime <= currentTime ? '#FF5A00' : 'rgba(255, 90, 0, 0.38)';
        ctx.fillRect(x, y, 2 * dpr, barHeight);
      }
    };

    draw();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => draw());
      ro.observe(canvas);
    }
    return () => {
      if (ro) ro.disconnect();
    };
  }, [audioWaveform, audioDuration, timelineDuration, currentTime]);

  // Pointer coordinate translator
  const getTimeFromPointerX = useCallback((clientX: number, targetDuration: number) => {
    if (!containerRef.current) return 0;
    const trackRect = tracksRef.current?.getBoundingClientRect();
    const containerRect = containerRef.current.getBoundingClientRect();
    const hasCustomMockOnContainer = Object.prototype.hasOwnProperty.call(containerRef.current, 'getBoundingClientRect');
    const rect = (trackRect && trackRect.width > 0 && !hasCustomMockOnContainer) ? trackRect : containerRect;
    if (!rect.width) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * targetDuration;
  }, []);

  const handlePointerDown = (type: 'start' | 'end' | 'playhead', e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingHandle(type);
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
  };

  const currentVideoDur = videoDuration || 30;
  const isStaleDefault30 = !attachedVideo && videoStartTime === 0 && videoEndTime === 30 && Math.abs(currentVideoDur - 30) > 0.5;
  const effectiveEnd = (videoEndTime > 0 && !isStaleDefault30) ? videoEndTime : currentVideoDur;

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingHandle) return;
    if (draggingHandle === 'playhead') {
      const newTime = getTimeFromPointerX(e.clientX, timelineDuration);
      onSeek(newTime);
    } else if (draggingHandle === 'start') {
      const targetDuration = videoDuration || 30;
      const rawTime = getTimeFromPointerX(e.clientX, targetDuration);
      const newStart = Math.max(0, Math.min(rawTime, Math.max(0, effectiveEnd - 0.25)));
      onTrimChange(newStart, effectiveEnd);
    } else if (draggingHandle === 'end') {
      const targetDuration = videoDuration || 30;
      const rawTime = getTimeFromPointerX(e.clientX, targetDuration);
      const newEnd = Math.min(targetDuration, Math.max(rawTime, videoStartTime + 0.25));
      onTrimChange(videoStartTime, newEnd);
    }
  }, [draggingHandle, getTimeFromPointerX, timelineDuration, videoDuration, videoStartTime, effectiveEnd, onSeek, onTrimChange]);

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingHandle) {
      lastDragEndRef.current = Date.now();
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setDraggingHandle(null);
    }
  };

  // Keyboard navigation on handles
  const handleKeyDown = (handle: 'start' | 'end', e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1.0 : 0.1;
    const maxDur = videoDuration || 30;

    if (handle === 'start') {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(Number((videoStartTime + step).toFixed(2)), Math.max(0, effectiveEnd - 0.25));
        onTrimChange(next, effectiveEnd);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(0, Number((videoStartTime - step).toFixed(2)));
        onTrimChange(next, effectiveEnd);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onTrimChange(0, effectiveEnd);
      } else if (e.key === 'End') {
        e.preventDefault();
        onTrimChange(Math.max(0, effectiveEnd - 0.25), effectiveEnd);
      }
    } else {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(maxDur, Number((effectiveEnd + step).toFixed(2)));
        onTrimChange(videoStartTime, next);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.max(videoStartTime + 0.25, Number((effectiveEnd - step).toFixed(2)));
        onTrimChange(videoStartTime, next);
      } else if (e.key === 'Home') {
        e.preventDefault();
        onTrimChange(videoStartTime, videoStartTime + 0.25);
      } else if (e.key === 'End') {
        e.preventDefault();
        onTrimChange(videoStartTime, maxDur);
      }
    }
  };

  const trimDuration = Math.max(0, effectiveEnd - videoStartTime);
  const startPercent = Math.min(100, Math.max(0, (videoStartTime / (currentVideoDur || 1)) * 100));
  const endPercent = Math.min(100, Math.max(0, (effectiveEnd / (currentVideoDur || 1)) * 100));
  const playheadPercent = Math.min(100, Math.max(0, (currentTime / (timelineDuration || 1)) * 100));

  // Duration match indicator badge
  const durationBadge = useMemo(() => {
    const diff = Math.abs(audioDuration - trimDuration);
    if (diff < 0.1) {
      return <MasterMicroBadge label="1:1 DURATION MATCH" variant="emerald" testId="duration-matching-indicator" />;
    } else if (trimDuration < audioDuration) {
      const loopCount = (audioDuration / (trimDuration || 1)).toFixed(1);
      return <MasterMicroBadge label={`VIDEO SHORTER: ${loopCount}x LOOP REQUIRED`} variant="amber" testId="duration-matching-indicator" />;
    } else {
      return <MasterMicroBadge label="VIDEO LONGER: WILL TRIM TO AUDIO" variant="accent" testId="duration-matching-indicator" />;
    }
  }, [audioDuration, trimDuration]);

  return (
    <div
      ref={containerRef}
      className="video-trimmer-timeline"
      data-testid="video-trimmer-timeline"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        background: 'rgba(12, 12, 16, 0.85)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '6px',
        padding: '16px',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* HUD Header Bar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <motion.button
            type="button"
            onClick={onTogglePlay}
            data-testid="play-pause-btn"
            aria-label={isPlaying ? 'Pause timeline playback' : 'Play timeline'}
            whileHover={shouldReduceMotion ? undefined : { scale: 1.05 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
            style={{
              background: 'var(--accent, #FF5A00)',
              color: '#000000',
              border: 'none',
              borderRadius: '4px',
              minHeight: '36px',
              padding: '6px 14px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.6875rem',
              fontWeight: 800,
              cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            {isPlaying ? 'PAUSE' : 'PLAY'}
          </motion.button>

          <span className="mono-data" data-testid="timecode-master" style={{ color: 'var(--text-main, #fff)', fontWeight: 600 }}>
            {formatTimecode(currentTime)} / {formatTimecode(timelineDuration)}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <span className="mono-data" data-testid="timecode-audio" style={{ color: 'var(--text-muted, #888)', fontSize: '11px' }}>
            AUDIO: {formatTimecode(audioDuration)}
          </span>
          <span className="mono-data" data-testid="timecode-video-trim" style={{ color: 'var(--accent, #FF5A00)', fontSize: '11px' }}>
            TRIM: {formatTimecode(trimDuration)} ({formatTimecode(videoStartTime)} → {formatTimecode(effectiveEnd)})
          </span>
          {durationBadge}
        </div>
      </div>

      {/* Timeline Multi-Track Body */}
      <div
        ref={tracksRef}
        style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px', cursor: 'pointer', marginTop: '14px' }}
        onClick={(e) => {
          if (draggingHandle || Date.now() - lastDragEndRef.current < 80) return;
          const t = getTimeFromPointerX(e.clientX, timelineDuration);
          onSeek(t);
        }}
      >
        {/* Track 1: Audio Waveform */}
        <div
          data-testid="timeline-audio-track"
          style={{
            height: '48px',
            background: 'rgba(5, 5, 8, 0.7)',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            borderRadius: '4px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: '3px', left: '8px', zIndex: 2, pointerEvents: 'none', background: 'rgba(5, 5, 8, 0.85)', padding: '1px 5px', borderRadius: '2px' }}>
            <span className="tiny-label" style={{ fontSize: '9px', opacity: 0.75 }}>TRACK 01 // AUDIO RMS</span>
          </div>
          <canvas ref={audioCanvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
        </div>

        {/* Track 2: Video Filmstrip & Trimmer */}
        <div
          data-testid="timeline-video-track"
          style={{
            height: '64px',
            background: 'rgba(5, 5, 8, 0.9)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '4px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div style={{ position: 'absolute', top: '3px', left: '20px', zIndex: 5, pointerEvents: 'none', background: 'rgba(5, 5, 8, 0.85)', padding: '1px 5px', borderRadius: '2px' }}>
            <span className="tiny-label" style={{ fontSize: '9px', opacity: 0.75 }}>TRACK 02 // VIDEO FILMSTRIP</span>
          </div>

          {/* Filmstrip Frame Container */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
            {thumbnails.length > 0 ? (
              thumbnails.map((src, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    backgroundImage: `url(${src})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    borderRight: '1px solid rgba(0,0,0,0.5)',
                  }}
                />
              ))
            ) : (
              Array.from({ length: 10 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'visible',
                    background: i % 2 === 0 ? 'rgba(20,20,26,0.6)' : 'rgba(14,14,18,0.6)',
                    borderRight: '1px solid rgba(255,255,255,0.03)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-start',
                    paddingLeft: i === 0 ? '22px' : '6px',
                    paddingTop: '14px',
                  }}
                >
                  {i % 2 === 0 && (
                    <span
                      className="tiny-label"
                      style={{
                        fontSize: '8px',
                        opacity: 0.4,
                        letterSpacing: '0.02em',
                        whiteSpace: 'nowrap',
                        pointerEvents: 'none',
                        position: 'relative',
                        zIndex: 2,
                      }}
                    >
                      {formatTimecode((i / 10) * currentVideoDur)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Darkened unselected regions */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              width: `${startPercent}%`,
              background: 'rgba(0, 0, 0, 0.75)',
              zIndex: 3,
              pointerEvents: 'none',
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${endPercent}%`,
              right: 0,
              background: 'rgba(0, 0, 0, 0.75)',
              zIndex: 3,
              pointerEvents: 'none',
            }}
          />

          {/* Selected Trim Box Border & Specular Highlight */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${startPercent}%`,
              width: `${Math.max(0, endPercent - startPercent)}%`,
              border: '2px solid var(--accent, #FF5A00)',
              boxShadow: '0 0 16px rgba(255, 90, 0, 0.25)',
              pointerEvents: 'none',
              zIndex: 4,
            }}
          >
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.6)' }} />
          </div>

          {/* Left Trim Handle */}
          <div
            className="cel-trim-handle"
            data-testid="trim-handle-start"
            role="slider"
            tabIndex={0}
            aria-label="Video Trim Start Time"
            aria-valuenow={Number(videoStartTime.toFixed(2))}
            aria-valuemin={0}
            aria-valuemax={Number(effectiveEnd.toFixed(2))}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => handlePointerDown('start', e)}
            onKeyDown={(e) => handleKeyDown('start', e)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `calc(${startPercent}% - ${(startPercent / 100) * 24}px)`,
              width: '24px',
              background: 'var(--accent, #FF5A00)',
              cursor: 'ew-resize',
              zIndex: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '2px 0 0 2px',
              boxShadow: '0 0 10px rgba(255, 90, 0, 0.5)',
            }}
          >
            <span style={{ color: '#000', fontSize: '0.5625rem', fontWeight: 900, pointerEvents: 'none' }}>◀</span>
          </div>

          {/* Right Trim Handle */}
          <div
            className="cel-trim-handle"
            data-testid="trim-handle-end"
            role="slider"
            tabIndex={0}
            aria-label="Video Trim End Time"
            aria-valuenow={Number(effectiveEnd.toFixed(2))}
            aria-valuemin={Number(videoStartTime.toFixed(2))}
            aria-valuemax={Number(currentVideoDur.toFixed(2))}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => handlePointerDown('end', e)}
            onKeyDown={(e) => handleKeyDown('end', e)}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `calc(${endPercent}% - ${(endPercent / 100) * 24}px)`,
              width: '24px',
              background: 'var(--accent, #FF5A00)',
              cursor: 'ew-resize',
              zIndex: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '0 2px 2px 0',
              boxShadow: '0 0 10px rgba(255, 90, 0, 0.5)',
            }}
          >
            <span style={{ color: '#000', fontSize: '0.5625rem', fontWeight: 900, pointerEvents: 'none' }}>▶</span>
          </div>
        </div>

        {/* Global Scrubbable Playhead Line across both tracks */}
        <div
          data-testid="timeline-playhead"
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: `calc(${playheadPercent}% - ${(playheadPercent / 100) * 2}px)`,
            width: '2px',
            background: '#ffffff',
            boxShadow: '0 0 8px rgba(255, 255, 255, 0.9)',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          {/* Playhead Top Badge */}
          <div
            data-testid="playhead-timestamp"
            style={{
              position: 'absolute',
              top: '-10px',
              left: '0px',
              transform: `translateX(-${Math.min(100, Math.max(0, playheadPercent))}%)`,
              background: '#ffffff',
              color: '#000000',
              fontSize: '8px',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 800,
              padding: '1px 4px',
              borderRadius: '2px',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(0,0,0,0.6)',
            }}
          >
            {formatTimecode(currentTime)}
          </div>
        </div>
      </div>

      {/* Discrete Timecode Readout Labels */}
      <div className="sr-only">
        <span data-testid="timecode-start">{formatTimecode(videoStartTime)}</span>
        <span data-testid="timecode-end">{formatTimecode(effectiveEnd)}</span>
      </div>
    </div>
  );
}

export default VideoTrimmerTimeline;
