// WaveformControls.tsx – Playback, zoom, and trim controls for the Audio Trimmer
// Does NOT include fade sliders or mode toggle — those live in the options panel.
import React, { ChangeEvent } from 'react';

export type TrimmerMode = 'TRIM' | 'MERGE';

interface WaveformControlsProps {
  /** Current playback state */
  isPlaying: boolean;
  /** Current time (seconds) */
  currentTime: number;
  /** Total duration (seconds) */
  duration: number;
  /** Trim start/end (seconds) */
  trimStart: number;
  trimEnd: number;
  /** Zoom factor (seconds visible) */
  zoom: number;
  /** Callbacks */
  onPlayPause: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onTrimChange: (start: number, end: number) => void;
}

export const WaveformControls: React.FC<WaveformControlsProps> = ({
  isPlaying,
  currentTime,
  duration,
  trimStart,
  trimEnd,
  zoom,
  onPlayPause,
  onZoomIn,
  onZoomOut,
  onTrimChange,
}) => {
  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleTrimStart = (e: ChangeEvent<HTMLInputElement>) => {
    const val = Math.max(0, Math.min(parseFloat(e.target.value) || 0, trimEnd));
    onTrimChange(val, trimEnd);
  };

  const handleTrimEnd = (e: ChangeEvent<HTMLInputElement>) => {
    const val = Math.min(duration, Math.max(parseFloat(e.target.value) || 0, trimStart));
    onTrimChange(trimStart, val);
  };

  return (
    <div className="waveform-controls" style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '8px' }}>
      {/* Top row – play/pause and time display */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button onClick={onPlayPause} className="action-btn" data-testid="play-pause-btn">
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <span className="mono-data" data-testid="time-display">
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onZoomIn} className="action-btn" data-testid="zoom-in-btn">Zoom In</button>
        <button onClick={onZoomOut} className="action-btn" data-testid="zoom-out-btn">Zoom Out</button>
        <span className="tiny-label">Zoom: {zoom.toFixed(1)}s</span>
      </div>

      {/* Trim inputs */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label className="tiny-label" htmlFor="trim-start">Start (s)</label>
        <input
          id="trim-start"
          type="number"
          min={0}
          max={trimEnd}
          step="0.01"
          value={trimStart}
          onChange={handleTrimStart}
          data-testid="trim-start-input"
          className="mono-data"
        />
        <label className="tiny-label" htmlFor="trim-end">End (s)</label>
        <input
          id="trim-end"
          type="number"
          min={trimStart}
          max={duration}
          step="0.01"
          value={trimEnd}
          onChange={handleTrimEnd}
          data-testid="trim-end-input"
          className="mono-data"
        />
      </div>
    </div>
  );
};

export default WaveformControls;
