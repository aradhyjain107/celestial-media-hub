// WaveformCanvas.tsx – React component using HTML canvas
// -----------------------------------------------------------
import React, { useRef, useEffect, useState } from 'react';

interface WaveformCanvasProps {
  /** Normalised amplitude values for left channel (0‑1) */
  left: Float32Array;
  /** Normalised amplitude values for right channel (optional) */
  right?: Float32Array;
  /** Total duration of the audio in seconds */
  duration: number;
  /** Current playback time in seconds */
  currentTime: number;
  /** Trim start time (seconds) */
  trimStart: number;
  /** Trim end time (seconds) */
  trimEnd: number;
  /** Zoom factor – number of seconds visible in the canvas width */
  zoom: number; // e.g. 10 means 10 seconds span across full width
  /** Callback when user clicks / drags to seek */
  onSeek: (time: number) => void;
  /** Callback when user updates trim selection (start, end) */
  onSelect: (start: number, end: number) => void;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  left,
  right,
  duration,
  currentTime,
  trimStart,
  trimEnd,
  zoom,
  onSeek,
  onSelect,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState<number | null>(null);

  // Cached CSS colors to avoid forced synchronous reflow in draw loop
  const colorsRef = useRef({
    accent: '#FF5A00',
    border: '#2a2a2a',
    textMuted: '#888888',
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const style = getComputedStyle(document.documentElement);
    colorsRef.current = {
      accent: style.getPropertyValue('--accent').trim() || '#FF5A00',
      border: style.getPropertyValue('--border').trim() || '#2a2a2a',
      textMuted: style.getPropertyValue('--text-muted').trim() || '#888888',
    };
  }, []);

  // Helper to calculate clamped visible start/end/duration without distortion
  const getVisibleRange = (cTime: number, dur: number, z: number) => {
    if (dur <= 0) return { visibleStart: 0, visibleEnd: 0, visibleDuration: 0.001 };
    if (dur <= z) {
      return { visibleStart: 0, visibleEnd: dur, visibleDuration: Math.max(0.001, dur) };
    }
    const visibleStart = Math.max(0, Math.min(dur - z, cTime - z / 2));
    const visibleEnd = visibleStart + z;
    return { visibleStart, visibleEnd, visibleDuration: z };
  };

  // Helper: convert a time (seconds) to canvas X coordinate based on zoom & offset
  const timeToX = (time: number, width: number) => {
    const { visibleStart, visibleDuration } = getVisibleRange(currentTime, duration, zoom);
    const ratio = (time - visibleStart) / visibleDuration;
    return Math.min(Math.max(ratio * width, 0), width);
  };

  // Helper: convert X coordinate back to time
  const xToTime = (x: number, width: number) => {
    if (width <= 0) return 0;
    const { visibleStart, visibleDuration } = getVisibleRange(currentTime, duration, zoom);
    const ratio = Math.max(0, Math.min(1, x / width));
    const calculatedTime = visibleStart + ratio * visibleDuration;
    return Math.max(0, Math.min(duration, calculatedTime));
  };

  // Resize handling – keep canvas size in sync with container
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { clientWidth, clientHeight } = containerRef.current!;
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      if (typeof window !== 'undefined') {
        const style = getComputedStyle(document.documentElement);
        colorsRef.current = {
          accent: style.getPropertyValue('--accent').trim() || '#FF5A00',
          border: style.getPropertyValue('--border').trim() || '#2a2a2a',
          textMuted: style.getPropertyValue('--text-muted').trim() || '#888888',
        };
      }
      // redraw after resize
      draw();
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drawing routine
  const draw = () => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    ctx.clearRect(0, 0, width, height);
    // Use cached colors to avoid forced layout thrashing
    const { accent, border, textMuted } = colorsRef.current;

    // Determine visible time range cleanly clamped
    const { visibleStart, visibleDuration } = getVisibleRange(currentTime, duration, zoom);

    // Draw waveform bars (mirrored) - coordinates in canvas pixels (already DPR-scaled)
    ctx.fillStyle = border;
    for (let i = 0; i < width; i++) {
      const time = visibleStart + (i / width) * visibleDuration;
      const sampleIdx = Math.min(left.length - 1, Math.max(0, Math.floor((time / Math.max(0.001, duration)) * left.length)));
      // eslint-disable-next-line security/detect-object-injection
      const amp = left[sampleIdx] ?? 0;
      const barHeight = amp * (height / 2);
      // top half
      ctx.fillRect(i, height / 2 - barHeight, 1, barHeight);
      // bottom half (mirror)
      ctx.fillRect(i, height / 2, 1, barHeight);
    }
    // If right channel exists, overlay with a slightly different shade (optional)
    if (right) {
      ctx.fillStyle = accent;
      for (let i = 0; i < width; i++) {
        const time = visibleStart + (i / width) * visibleDuration;
        const sampleIdx = Math.min(right.length - 1, Math.max(0, Math.floor((time / Math.max(0.001, duration)) * right.length)));
        // eslint-disable-next-line security/detect-object-injection
        const amp = right[sampleIdx] ?? 0;
        const barHeight = amp * (height / 2);
        ctx.fillRect(i, height / 2 - barHeight, 1, barHeight);
        ctx.fillRect(i, height / 2, 1, barHeight);
      }
    }


    // Draw selection overlay (trim region) with bounds protection
    const selStartX = Math.max(0, Math.min(width / dpr, timeToX(trimStart, width / dpr)));
    const selEndX = Math.max(0, Math.min(width / dpr, timeToX(trimEnd, width / dpr)));
    if (selEndX > selStartX) {
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(selStartX * dpr, 0, (selEndX - selStartX) * dpr, height);
      ctx.globalAlpha = 1.0;
    }

    // Draw playhead line
    const playheadX = Math.max(0, Math.min(width / dpr, timeToX(currentTime, width / dpr)));
    ctx.strokeStyle = textMuted;
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.moveTo(playheadX * dpr, 0);
    ctx.lineTo(playheadX * dpr, height);
    ctx.stroke();
  };

  // Redraw when data changes
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, right, currentTime, trimStart, trimEnd, zoom]);

  // Interaction handlers with Pointer Capture and touch support
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setIsDragging(true);
    setDragStartX(x);
    // Immediate seek on pointer down
    const time = xToTime(x, rect.width);
    onSeek(time);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const start = dragStartX ?? x;
    const end = x;
    const startTime = xToTime(Math.min(start, end), rect.width);
    const endTime = xToTime(Math.max(start, end), rect.width);
    onSelect(startTime, endTime);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (typeof e.currentTarget.releasePointerCapture === 'function' && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
    setIsDragging(false);
    setDragStartX(null);
  };

  return (
    <div ref={containerRef} className="waveform-canvas-container cel-visualizer-shell" style={{ width: '100%', flex: 1, minHeight: '120px', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        data-testid="waveform-canvas"
        aria-label="Interactive audio waveform scrubbing and trim selection"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: 'pointer',
          touchAction: 'none',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        Interactive audio waveform visualization. Use the start and end time inputs to adjust trim selection.
      </canvas>
    </div>
  );
};

export default WaveformCanvas;
