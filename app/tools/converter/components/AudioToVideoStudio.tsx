'use client'

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { MasterGlassCard } from '../../../components/ui/MasterGlassCard';
import { MasterMicroBadge } from '../../../components/ui/MasterMicroBadge';
import { VideoAttachmentDropzone } from './VideoAttachmentDropzone';
import { VideoPreviewCanvas } from './VideoPreviewCanvas';
import { KineticBackdropVisualizer } from './KineticBackdropVisualizer';
import { VideoTrimmerTimeline } from './VideoTrimmerTimeline';
import { appendAuthToken, useSessionToken } from '../../../../lib/clientAuth';

export interface AudioToVideoStudioProps {
  /** The primary audio file loaded in converter */
  audioFile: File;
  /** Attached companion video file, or null */
  attachedVideo: File | null;
  /** Callback when video is attached, replaced, or removed */
  onAttachVideo: (file: File | null) => void;
  /** Selected video segment start time in seconds */
  videoStartTime: number;
  /** Selected video segment end time in seconds */
  videoEndTime: number;
  /** Callback when trimmer handles are dragged or timecode nudged */
  onTrimChange: (start: number, end: number) => void;
  /** Audio-to-Video synchronization strategy */
  audioSyncMode: 'fit-audio' | 'fit-video' | 'loop-video' | 'trim-audio';
  /** Callback when user changes sync strategy */
  onSyncModeChange: (mode: 'fit-audio' | 'fit-video' | 'loop-video' | 'trim-audio') => void;
  /** Kinetic visualizer procedural theme */
  visualizerStyle: 'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave';
  /** Callback when visualizer theme is changed */
  onVisualizerStyleChange: (style: 'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave') => void;
  /** Toggle whether visualizer is active (overriding video playback) */
  useVisualizer: boolean;
  /** Callback to toggle procedural visualizer mode */
  onToggleVisualizer: (enabled: boolean) => void;
  /** Callback to clear audio file and reset studio */
  onClearAudio: () => void;
  /** Completed synthesis download URL */
  downloadUrl?: string | null;
  /** Target output format */
  outputFormat?: string;
}

export function AudioToVideoStudio({
  audioFile,
  attachedVideo,
  onAttachVideo,
  videoStartTime,
  videoEndTime,
  onTrimChange,
  audioSyncMode,
  onSyncModeChange,
  visualizerStyle,
  onVisualizerStyleChange,
  useVisualizer,
  onToggleVisualizer,
  onClearAudio,
  downloadUrl,
  outputFormat = 'mp4',
}: AudioToVideoStudioProps) {
  const sessionToken = useSessionToken();
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [masterAudioDuration, setMasterAudioDuration] = useState<number>(0);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const isVisualizerActive = useVisualizer || !attachedVideo;

  // Master audio element lifecycle for synchronized timeline & visualizer playback
  React.useEffect(() => {
    if (!audioFile) return;
    const url = URL.createObjectURL(audioFile);
    const audio = new Audio(url);
    audio.preload = 'auto';
    audioRef.current = audio;

    const syncDuration = () => {
      if (audioRef.current && audioRef.current.duration && isFinite(audioRef.current.duration) && audioRef.current.duration > 0) {
        setMasterAudioDuration(audioRef.current.duration);
      }
    };

    const handleTimeUpdate = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
        syncDuration();
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
    };

    audio.addEventListener('loadedmetadata', syncDuration);
    audio.addEventListener('durationchange', syncDuration);
    audio.addEventListener('canplay', syncDuration);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('loadedmetadata', syncDuration);
      audio.removeEventListener('durationchange', syncDuration);
      audio.removeEventListener('canplay', syncDuration);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
      audio.pause();
      URL.revokeObjectURL(url);
    };
  }, [audioFile]);

  // Ensure duration stays synced across Fast Refresh if audioRef is already loaded
  React.useEffect(() => {
    const audio = audioRef.current;
    if (audio && audio.duration && isFinite(audio.duration) && audio.duration > 0 && masterAudioDuration !== audio.duration) {
      setMasterAudioDuration(audio.duration);
    }
  }, [currentTime, isPlaying, masterAudioDuration]);

  // Sync play/pause commands to master audio
  const handleTogglePlay = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      if (audio.duration && isFinite(audio.duration) && audio.currentTime >= audio.duration - 0.05) {
        audio.currentTime = 0;
        setCurrentTime(0);
      }
      audio.play().then(() => {
        setIsPlaying(true);
      }).catch((e) => {
        console.warn('Audio play prevented:', e);
      });
    }
  }, [isPlaying]);

  // Sync seek commands to master audio
  const handleSeek = React.useCallback((time: number) => {
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  }, []);

  const syncModes: Array<{ id: 'fit-audio' | 'fit-video' | 'loop-video' | 'trim-audio'; label: string; badge?: string }> = [
    { id: 'fit-audio', label: 'FIT AUDIO', badge: 'DEFAULT' },
    { id: 'fit-video', label: 'FIT VIDEO' },
    { id: 'loop-video', label: 'LOOP VIDEO' },
    { id: 'trim-audio', label: 'TRIM AUDIO' },
  ];

  const visualizerThemes: Array<{ id: 'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave'; label: string }> = [
    { id: 'obsidian_pulse', label: 'OBSIDIAN PULSE' },
    { id: 'cyber_bars', label: 'CYBER BARS' },
    { id: 'nebula_spectrum', label: 'NEBULA' },
    { id: 'minimal_wave', label: 'MINIMAL WAVE' },
  ];

  return (
    <div
      className="a2v-studio-container"
      data-testid="audio-to-video-studio"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        gap: '16px',
        padding: '20px 24px 24px',
        overflowY: 'auto',
      }}
    >
      {/* Studio Header Banner */}
      <MasterGlassCard variant="surface2" style={{ padding: '12px 16px', minHeight: '48px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
            <MasterMicroBadge label="A2V SYNTHESIS MODE" variant="accent" />
            <span className="mono-data" style={{ fontWeight: 700, color: 'var(--text-main, #fff)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {audioFile.name}
            </span>
            <span className="tiny-label" style={{ color: 'var(--text-muted, #888)', flexShrink: 0 }}>
              ({(audioFile.size / (1024 * 1024)).toFixed(2)} MB)
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            {downloadUrl && (
              <a
                href={appendAuthToken(downloadUrl, sessionToken)}
                download={`output.${outputFormat}`}
                data-testid="a2v-download-btn"
                style={{
                  color: 'var(--accent, #FF5A00)',
                  border: '1px solid var(--accent, #FF5A00)',
                  background: 'rgba(255, 90, 0, 0.12)',
                  borderRadius: '3px',
                  padding: '4px 10px',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '10px',
                  fontWeight: 700,
                }}
              >
                [ DOWNLOAD ]
              </a>
            )}
            <button
              type="button"
              onClick={onClearAudio}
              data-testid="clear-audio-btn"
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                padding: '4px 10px',
                borderRadius: '3px',
                cursor: 'pointer',
                color: 'var(--text-muted, #888)',
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: '10px',
                fontWeight: 700,
              }}
            >
              [ CLEAR AUDIO ]
            </button>
          </div>
        </div>
      </MasterGlassCard>

      {/* Main 2-Column Studio Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: '16px',
        }}
      >
        {/* Left Column: Canvas Preview & Multi-Track Trimmer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Dual Preview Box */}
          <MasterGlassCard variant="surface1" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="tiny-label">
                {isVisualizerActive ? 'PROCEDURAL KINETIC BACKDROP' : 'SYNCHRONIZED VIDEO CANVAS'}
              </span>
              <MasterMicroBadge 
                label={isVisualizerActive ? visualizerStyle.toUpperCase() : 'VIDEO SYNC'} 
                variant={isVisualizerActive ? 'amber' : 'emerald'} 
              />
            </div>

            <div
              style={{
                width: '100%',
                aspectRatio: '16/9',
                background: '#000000',
                borderRadius: '4px',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {isVisualizerActive ? (
                <KineticBackdropVisualizer
                  audioFile={audioFile}
                  style={visualizerStyle}
                  isPlaying={isPlaying}
                  currentTime={currentTime}
                  audioElement={audioRef.current}
                  onTogglePlay={handleTogglePlay}
                />
              ) : (
                <VideoPreviewCanvas
                  videoFile={attachedVideo}
                  currentTime={currentTime}
                  isPlaying={isPlaying}
                  trimStart={videoStartTime}
                  trimEnd={videoEndTime}
                  onTimeUpdate={setCurrentTime}
                  onTogglePlay={handleTogglePlay}
                  onSeek={handleSeek}
                />
              )}
            </div>
          </MasterGlassCard>

          {/* Interactive Multi-Track Timeline Trimmer */}
          <VideoTrimmerTimeline
            audioFile={audioFile}
            attachedVideo={attachedVideo}
            videoStartTime={videoStartTime}
            videoEndTime={videoEndTime}
            onTrimChange={onTrimChange}
            currentTime={currentTime}
            onSeek={handleSeek}
            isPlaying={isPlaying}
            onTogglePlay={handleTogglePlay}
            masterAudioDuration={masterAudioDuration}
          />
        </div>

        {/* Right Column: Video Attachment & Configuration */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Video Attachment Dropzone */}
          <VideoAttachmentDropzone
            attachedVideo={attachedVideo}
            onAttachVideo={onAttachVideo}
            useVisualizer={useVisualizer}
            onToggleVisualizer={onToggleVisualizer}
          />

          {/* Sync Mode Selector */}
          <MasterGlassCard variant="surface2" style={{ padding: '16px' }}>
            <div className="form-group">
              <div className="form-header" style={{ marginBottom: '10px', gap: '10px' }}>
                <span className="tiny-label" style={{ letterSpacing: '0.06em' }}>AUDIO / VIDEO SYNC STRATEGY</span>
                <span className="mono-data" data-testid="active-sync-mode" style={{ fontSize: '10px', flexShrink: 0 }}>{audioSyncMode.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {syncModes.map((mode) => {
                  const isSelected = audioSyncMode === mode.id;
                  return (
                    <motion.button
                      key={mode.id}
                      type="button"
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      data-testid={`sync-mode-${mode.id}`}
                      onClick={() => onSyncModeChange(mode.id)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      style={{
                        position: 'relative',
                        padding: '10px 8px',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        border: isSelected ? '1px solid var(--accent, #FF5A00)' : '1px solid rgba(255, 255, 255, 0.08)',
                        background: isSelected ? 'rgba(255, 90, 0, 0.15)' : 'rgba(15, 15, 18, 0.6)',
                        color: isSelected ? 'var(--accent, #FF5A00)' : 'var(--text-muted, #888)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                        boxShadow: isSelected ? '0 0 12px rgba(255, 90, 0, 0.25)' : 'none',
                      }}
                    >
                      <span>{mode.label}</span>
                      {mode.badge && (
                        <span
                          style={{
                            fontSize: '8px',
                            padding: '1px 4px',
                            borderRadius: '2px',
                            background: 'rgba(255, 255, 255, 0.1)',
                            color: isSelected ? 'var(--accent, #FF5A00)' : 'var(--text-muted, #888)',
                          }}
                        >
                          {mode.badge}
                        </span>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </MasterGlassCard>

          {/* Visualizer Theme Selector */}
          <MasterGlassCard variant="surface2" style={{ padding: '16px' }}>
            <div className="form-group">
              <div className="form-header" style={{ marginBottom: '10px', gap: '10px' }}>
                <span className="tiny-label" style={{ letterSpacing: '0.06em' }}>PROCEDURAL VISUALIZER THEME</span>
                <span className="mono-data" style={{ fontSize: '10px', flexShrink: 0 }}>{visualizerStyle.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {visualizerThemes.map((theme) => {
                  const isSelected = visualizerStyle === theme.id;
                  return (
                    <motion.button
                      key={theme.id}
                      type="button"
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      data-testid={`theme-${theme.id}`}
                      onClick={() => onVisualizerStyleChange(theme.id)}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.96 }}
                      style={{
                        position: 'relative',
                        padding: '10px 8px',
                        fontSize: '11px',
                        fontFamily: 'var(--font-mono, monospace)',
                        fontWeight: 700,
                        letterSpacing: '0.06em',
                        border: isSelected ? '1px solid var(--accent, #FF5A00)' : '1px solid rgba(255, 255, 255, 0.08)',
                        background: isSelected ? 'rgba(255, 90, 0, 0.15)' : 'rgba(15, 15, 18, 0.6)',
                        color: isSelected ? 'var(--accent, #FF5A00)' : 'var(--text-muted, #888)',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: isSelected ? '0 0 12px rgba(255, 90, 0, 0.25)' : 'none',
                      }}
                    >
                      <span>{theme.label}</span>
                    </motion.button>
                  );
                })}
              </div>
            </div>
          </MasterGlassCard>
        </div>
      </div>
    </div>
  );
}

export default AudioToVideoStudio;
