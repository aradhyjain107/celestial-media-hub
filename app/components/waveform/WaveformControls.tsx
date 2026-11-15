// WaveformControls.tsx – Playback, zoom, and trim controls for the Audio Trimmer
// Does NOT include fade sliders or mode toggle — those live in the options panel.
import React, { ChangeEvent, useId } from 'react';

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
  const trimStartId = useId();
  const trimEndId = useId();
  const formatTime = (sec: number) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const totalSec = Math.floor(sec);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = (totalSec % 60).toString().padStart(2, '0');
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s}`;
    }
    return `${m}:${s}`;
  };

  const handleTrimStart = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    const val = Number.isFinite(raw) ? Math.max(0, Math.min(raw, trimEnd)) : 0;
    onTrimChange(val, trimEnd);
  };

  const handleTrimEnd = (e: ChangeEvent<HTMLInputElement>) => {
    const raw = parseFloat(e.target.value);
    const val = Number.isFinite(raw) ? Math.min(duration, Math.max(raw, trimStart)) : duration;
    onTrimChange(trimStart, val);
  };

  return (
    <div className="waveform-controls glass-panel" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '12px 16px', border: '1px solid var(--border)', background: 'rgba(8, 8, 8, 0.7)', flexShrink: 0 }}>
      {/* Playback & time display */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <button 
          type="button"
          onClick={onPlayPause} 
          className="action-btn" 
          data-testid="play-pause-btn"
          aria-label={isPlaying ? 'Pause audio playback' : 'Play audio'}
          style={{ width: 'auto', minHeight: '36px', padding: '6px 16px', height: 'auto', fontSize: '0.75rem', transition: 'background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), transform 100ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <span className="mono-data" data-testid="time-display" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>

      {/* Zoom controls */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button 
          type="button"
          onClick={onZoomIn} 
          className="action-btn" 
          data-testid="zoom-in-btn"
          aria-label="Zoom in waveform"
          style={{ width: 'auto', minHeight: '36px', padding: '6px 12px', height: 'auto', fontSize: '0.75rem', transition: 'background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), transform 100ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        >
          Zoom In
        </button>
        <button 
          type="button"
          onClick={onZoomOut} 
          className="action-btn" 
          data-testid="zoom-out-btn"
          aria-label="Zoom out waveform"
          style={{ width: 'auto', minHeight: '36px', padding: '6px 12px', height: 'auto', fontSize: '0.75rem', transition: 'background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), transform 100ms cubic-bezier(0.23, 1, 0.32, 1)' }}
        >
          Zoom Out
        </button>
        <span className="tiny-label">Zoom: {zoom.toFixed(1)}s</span>
      </div>

      {/* Trim inputs */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <label className="tiny-label" htmlFor={trimStartId}>Start (s)</label>
        <input
          id={trimStartId}
          type="number"
          min={0}
          max={trimEnd}
          step="0.01"
          value={trimStart}
          onChange={handleTrimStart}
          aria-label="Trim Start Time (seconds)"
          data-testid="trim-start-input"
          className="mono-data"
          style={{ width: '72px', minHeight: '36px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-main)', padding: '6px 8px' }}
        />
        <label className="tiny-label" htmlFor={trimEndId}>End (s)</label>
        <input
          id={trimEndId}
          type="number"
          min={trimStart}
          max={duration}
          step="0.01"
          value={trimEnd}
          onChange={handleTrimEnd}
          aria-label="Trim End Time (seconds)"
          data-testid="trim-end-input"
          className="mono-data"
          style={{ width: '72px', minHeight: '36px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-main)', padding: '6px 8px' }}
        />
      </div>
    </div>
  );
};

export default WaveformControls;
