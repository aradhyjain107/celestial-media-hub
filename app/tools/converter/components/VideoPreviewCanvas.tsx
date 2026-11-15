'use client'

import React, { useRef, useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface VideoPreviewCanvasProps {
  /** Video file to render */
  videoFile: File | null;
  /** Current playhead time in seconds */
  currentTime: number;
  /** Active playback status */
  isPlaying: boolean;
  /** Trim start time constraint */
  trimStart?: number;
  /** Trim end time constraint */
  trimEnd?: number;
  /** Time update callback */
  onTimeUpdate: (time: number) => void;
  /** Play/pause toggle callback */
  onTogglePlay: () => void;
  /** Seek callback */
  onSeek?: (time: number) => void;
}

export function VideoPreviewCanvas({
  videoFile,
  currentTime,
  isPlaying,
  trimStart = 0,
  trimEnd,
  onTimeUpdate,
  onTogglePlay,
  onSeek,
}: VideoPreviewCanvasProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const blobUrlRef = useRef<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState(false);
  const isSeekingInternalRef = useRef(false);

  // Load video blob
  useEffect(() => {
    if (!videoFile) return;
    const url = URL.createObjectURL(videoFile);
    blobUrlRef.current = url;
    if (videoRef.current) {
      videoRef.current.src = url;
      videoRef.current.load();
    }
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoFile]);

  // Sync play/pause state
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isPlaying) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  }, [isPlaying]);

  // Sync external seek time (from trimmer timeline or master playhead)
  useEffect(() => {
    const video = videoRef.current;
    if (!video || isSeekingInternalRef.current) return;
    if (Math.abs(video.currentTime - currentTime) > 0.3) {
      video.currentTime = currentTime;
    }
  }, [currentTime]);

  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration || 0);
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;

    // Loop within trim range if bounds are set
    if (trimEnd !== undefined && trimEnd > (trimStart || 0)) {
      if (t >= trimEnd) {
        videoRef.current.currentTime = trimStart || 0;
        onTimeUpdate(trimStart || 0);
        return;
      }
      if (t < (trimStart || 0)) {
        videoRef.current.currentTime = trimStart || 0;
      }
    }
    onTimeUpdate(t);
  };

  const formatTime = (sec: number) => {
    if (isNaN(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div
      data-testid="video-preview-canvas"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: '#050508',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <video
        ref={videoRef}
        data-testid="preview-video-element"
        width={1280}
        height={720}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => {
          if (videoRef.current) {
            videoRef.current.currentTime = trimStart || 0;
            if (isPlaying) videoRef.current.play().catch(() => {});
          }
        }}
        muted={isMuted}
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          display: 'block',
        }}
      >
        <track kind="captions" srcLang="en" label="English" />
        Your browser does not support HTML5 video playback.
      </video>

      {/* Cyber Reticle Top HUD */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '14px',
          right: '14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          pointerEvents: 'none',
          zIndex: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isPlaying ? '#10b981' : '#f59e0b',
              boxShadow: isPlaying ? '0 0 8px #10b981' : '0 0 6px #f59e0b',
            }}
          />
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.5625rem',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.75)',
              letterSpacing: '0.08em',
            }}
          >
            {isPlaying ? 'REC [●] LIVE PREVIEW' : 'STANDBY // PAUSED'}
          </span>
        </div>

        <span
          style={{
            fontFamily: 'var(--font-mono, monospace)',
            fontSize: '0.5625rem',
            color: 'rgba(255, 255, 255, 0.6)',
            letterSpacing: '0.06em',
          }}
        >
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Center Big Play/Pause Button on Hover */}
      <motion.button
        type="button"
        onClick={onTogglePlay}
        data-testid="preview-play-toggle"
        aria-label={isPlaying ? 'Pause video preview' : 'Play video preview'}
        whileHover={shouldReduceMotion ? undefined : { scale: 1.1 }}
        whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
        transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 28 }}
        style={{
          position: 'absolute',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: 'rgba(10, 10, 12, 0.75)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 90, 0, 0.5)',
          color: 'var(--accent, #FF5A00)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          boxShadow: '0 0 20px rgba(255, 90, 0, 0.25)',
          zIndex: 6,
        }}
      >
        <span aria-hidden="true" style={{ fontSize: '1.125rem', marginLeft: isPlaying ? '0' : '3px' }}>
          {isPlaying ? '❚❚' : '▶'}
        </span>
      </motion.button>

      {/* Bottom Transport Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: '10px',
          left: '14px',
          right: '14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setIsMuted(!isMuted)}
            data-testid="preview-mute-toggle"
            aria-label={isMuted ? 'Unmute video audio' : 'Mute video audio'}
            style={{
              background: 'rgba(0, 0, 0, 0.65)',
              border: '1px solid rgba(255, 255, 255, 0.14)',
              borderRadius: '3px',
              minHeight: '36px',
              padding: '6px 10px',
              color: 'var(--text-muted, #888)',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.625rem',
              cursor: 'pointer',
            }}
          >
            {isMuted ? 'UNMUTE VID' : 'MUTE VID'}
          </button>
        </div>

        {trimEnd !== undefined && (
          <span
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '0.5625rem',
              color: 'var(--accent, #FF5A00)',
              letterSpacing: '0.06em',
            }}
          >
            LOOP RANGE: {formatTime(trimStart)} → {formatTime(trimEnd)}
          </span>
        )}
      </div>
    </div>
  );
}
