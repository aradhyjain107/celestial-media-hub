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

  // Helper: convert a time (seconds) to canvas X coordinate based on zoom & offset
  const timeToX = (time: number, width: number) => {
    const visibleStart = Math.max(0, currentTime - zoom / 2);
    const visibleEnd = Math.min(duration, visibleStart + zoom);
    const ratio = (time - visibleStart) / (visibleEnd - visibleStart);
    return Math.min(Math.max(ratio * width, 0), width);
  };

  // Helper: convert X coordinate back to time
  const xToTime = (x: number, width: number) => {
    const visibleStart = Math.max(0, currentTime - zoom / 2);
    const visibleEnd = Math.min(duration, visibleStart + zoom);
    const ratio = x / width;
    return visibleStart + ratio * (visibleEnd - visibleStart);
  };

  // Resize handling – keep canvas size in sync with container
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { clientWidth, clientHeight } = containerRef.current!;
      canvas.width = clientWidth * devicePixelRatio;
      canvas.height = clientHeight * devicePixelRatio;
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
    const dpr = devicePixelRatio;
    ctx.clearRect(0, 0, width, height);
    // Get CSS vars for colors
    const style = getComputedStyle(document.documentElement);
    const accent = style.getPropertyValue('--accent').trim() || '#FF5A00';
    const border = style.getPropertyValue('--border').trim() || '#2a2a2a';
    const textMuted = style.getPropertyValue('--text-muted').trim() || '#888888';

    // Determine visible time range
    const visibleStart = Math.max(0, currentTime - zoom / 2);
    const visibleEnd = Math.min(duration, visibleStart + zoom);
    const visibleDuration = visibleEnd - visibleStart;
    const samplesPerPixel = Math.max(1, Math.floor(left.length / width));

    // Draw waveform bars (mirrored)
    ctx.fillStyle = border;
    for (let i = 0; i < width; i++) {
      const sampleIdx = Math.floor(i * samplesPerPixel);
      // eslint-disable-next-line security/detect-object-injection
      const amp = left[sampleIdx] ?? 0;
      const barHeight = amp * (height / 2);
      // top half
      ctx.fillRect(i * dpr, (height / 2 - barHeight) * dpr, dpr, barHeight * dpr);
      // bottom half (mirror)
      ctx.fillRect(i * dpr, (height / 2) * dpr, dpr, barHeight * dpr);
    }
    // If right channel exists, overlay with a slightly different shade (optional)
    if (right) {
      ctx.fillStyle = accent;
      for (let i = 0; i < width; i++) {
        const sampleIdx = Math.floor(i * samplesPerPixel);
        // eslint-disable-next-line security/detect-object-injection
        const amp = right[sampleIdx] ?? 0;
        const barHeight = amp * (height / 2);
        ctx.fillRect(i * dpr, (height / 2 - barHeight) * dpr, dpr, barHeight * dpr);
        ctx.fillRect(i * dpr, (height / 2) * dpr, dpr, barHeight * dpr);
      }
    }

    // Draw selection overlay (trim region)
    const selStartX = timeToX(trimStart, width / dpr);
    const selEndX = timeToX(trimEnd, width / dpr);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.3;
    ctx.fillRect(selStartX * dpr, 0, (selEndX - selStartX) * dpr, height);
    ctx.globalAlpha = 1.0;

    // Draw playhead line
    const playheadX = timeToX(currentTime, width / dpr);
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

  // Interaction handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    setIsDragging(true);
    setDragStartX(x);
    // Immediate seek on click
    const time = xToTime(x, rect.width);
    onSeek(time);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const start = dragStartX ?? x;
    const end = x;
    const startTime = xToTime(Math.min(start, end), rect.width);
    const endTime = xToTime(Math.max(start, end), rect.width);
    onSelect(startTime, endTime);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStartX(null);
  };

  return (
    <div ref={containerRef} className="waveform-canvas-container" style={{ width: '100%', height: '120px', position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ width: '100%', height: '100%', display: 'block', cursor: 'pointer' }}
      />
    </div>
  );
};

export default WaveformCanvas;
