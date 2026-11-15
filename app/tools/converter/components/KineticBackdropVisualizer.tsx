'use client'
/* eslint-disable security/detect-object-injection */

import React, { useRef, useEffect } from 'react';

export interface KineticBackdropVisualizerProps {
  /** The loaded audio file */
  audioFile: File;
  /** Selected visualizer theme */
  style: 'obsidian_pulse' | 'cyber_bars' | 'nebula_spectrum' | 'minimal_wave';
  /** Active playback status */
  isPlaying: boolean;
  /** Current playback time in seconds */
  currentTime?: number;
  /** Primary accent color (default #FF5A00) */
  accentColor?: string;
  /** Background canvas color (default #0A0A0C) */
  bgColor?: string;
  /** Optional master audio element for real-time FFT spectrum analysis */
  audioElement?: HTMLAudioElement | null;
  /** Optional play/pause toggle callback when clicking the canvas */
  onTogglePlay?: () => void;
}

const audioNodeCache = typeof WeakMap !== 'undefined'
  ? new WeakMap<HTMLAudioElement, { ctx: AudioContext; analyser: AnalyserNode; source: MediaElementAudioSourceNode }>()
  : null;

export function KineticBackdropVisualizer({
  audioFile,
  style = 'obsidian_pulse',
  isPlaying,
  currentTime = 0,
  accentColor = '#FF5A00',
  bgColor = '#0A0A0C',
  audioElement,
  onTogglePlay,
}: KineticBackdropVisualizerProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 640, height: 360 });
  const freqDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(new ArrayBuffer(64)));
  const timeDataRef = useRef<Uint8Array<ArrayBuffer>>(new Uint8Array(new ArrayBuffer(64)));
  const isSkippedRef = useRef<boolean>(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const peakValuesRef = useRef<number[]>(new Array(64).fill(0));
  const particlesRef = useRef<Array<{ x: number; y: number; angle: number; radius: number; speed: number; size: number }>>([]);
  const currentTimeRef = useRef<number>(currentTime);
  currentTimeRef.current = currentTime;
  const startTimeRef = useRef<number | null>(null);

  // Lazily bind Web Audio API AnalyserNode to the master HTMLAudioElement when playing
  useEffect(() => {
    if (!audioElement || !isPlaying || typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx || typeof AudioCtx.prototype?.createMediaElementSource !== 'function') return;

      let cached = audioNodeCache?.get(audioElement);
      if (!cached) {
        const ctx = new AudioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.8;
        const source = ctx.createMediaElementSource(audioElement);
        source.connect(analyser);
        analyser.connect(ctx.destination);
        cached = { ctx, analyser, source };
        audioNodeCache?.set(audioElement, cached);
      }
      if (cached.ctx.state === 'suspended') {
        cached.ctx.resume().catch(() => {});
      }
      audioContextRef.current = cached.ctx;
      analyserRef.current = cached.analyser;
      sourceRef.current = cached.source;
    } catch {
      // Fallback to synthetic frequency generator
    }
  }, [audioElement, isPlaying]);

  // Initialize particle field for nebula theme
  useEffect(() => {
    const count = 120;
    const particles = [];
    for (let i = 0; i < count; i++) {
      particles.push({
        x: 0,
        y: 0,
        angle: Math.random() * Math.PI * 2,
        radius: 30 + Math.random() * 140,
        speed: (Math.random() * 0.02 + 0.005) * (Math.random() > 0.5 ? 1 : -1),
        size: Math.random() * 2.5 + 1,
      });
    }
    particlesRef.current = particles;
  }, [audioFile]);

  // Cache canvas pixel geometry outside the animation loop via ResizeObserver
  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;

    const updateSize = () => {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const width = Math.max(1, Math.round((canvas.clientWidth || shell.clientWidth || 640) * dpr));
      const height = Math.max(1, Math.round((canvas.clientHeight || shell.clientHeight || 360) * dpr));
      sizeRef.current = { width, height };
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    };

    updateSize();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(updateSize);
      ro.observe(shell);
    }
    return () => {
      ro?.disconnect();
    };
  }, []);

  // Animation and rendering loop with content-visibility, IntersectionObserver, and tab visibility pausing
  useEffect(() => {
    const canvas = canvasRef.current;
    const shell = shellRef.current;
    if (!canvas || !shell) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (startTimeRef.current === null) {
      startTimeRef.current = performance.now();
    }

    const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    let prefersReducedMotion = Boolean(motionQuery?.matches);

    const drawFrame = () => {
      const now = performance.now();
      const elapsed = prefersReducedMotion ? currentTimeRef.current : (now - (startTimeRef.current || now)) / 1000;
      const sampleTime = elapsed + currentTimeRef.current * 0.35;

      const { width, height } = sizeRef.current;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      ctx.save();
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      const freqData = freqDataRef.current;
      const timeData = timeDataRef.current;
      const binCount = freqData.length;

      if (analyserRef.current && isPlaying) {
        try {
          analyserRef.current.getByteFrequencyData(freqData);
          analyserRef.current.getByteTimeDomainData(timeData);
          let nonZero = 0;
          for (let i = 0; i < binCount; i++) {
            nonZero += freqData[i] || 0;
          }
          if (nonZero === 0) {
            simulateAudioData(sampleTime, isPlaying, freqData, timeData);
          }
        } catch {
          // Fallback simulation
          simulateAudioData(sampleTime, isPlaying, freqData, timeData);
        }
      } else {
        simulateAudioData(sampleTime, isPlaying, freqData, timeData);
      }

      // Calculate bass energy
      let bassSum = 0;
      for (let i = 0; i < 16; i++) {
        bassSum += freqData[i] || 0;
      }
      const bassEnergy = bassSum / (16 * 255);

      const centerX = width / 2;
      const centerY = height / 2;

      // ── Render selected theme ──
      if (style === 'obsidian_pulse') {
        renderObsidianPulse(ctx, width, height, centerX, centerY, freqData, bassEnergy, sampleTime, accentColor);
      } else if (style === 'cyber_bars') {
        renderCyberBars(ctx, width, height, centerX, centerY, freqData, peakValuesRef.current, accentColor);
      } else if (style === 'nebula_spectrum') {
        renderNebulaSpectrum(ctx, width, height, centerX, centerY, freqData, particlesRef.current, bassEnergy, sampleTime, accentColor);
      } else {
        // minimal_wave
        renderMinimalWave(ctx, width, height, centerX, centerY, timeData, bassEnergy, sampleTime, accentColor);
      }

      ctx.restore();
    };

    const stopLoop = () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };

    const canAnimate = () => {
      const tabVisible = typeof document === 'undefined' ? true : !document.hidden;
      return isPlaying && !prefersReducedMotion && !isSkippedRef.current && tabVisible;
    };

    const renderTick = () => {
      animFrameRef.current = null;
      if (isSkippedRef.current) return;
      drawFrame();
      if (canAnimate()) {
        animFrameRef.current = requestAnimationFrame(renderTick);
      }
    };

    const scheduleIfActive = () => {
      if (animFrameRef.current === null && canAnimate()) {
        animFrameRef.current = requestAnimationFrame(renderTick);
      }
    };

    // Always draw one initial crisp frame on mount or prop update; animate continuously only when active & visible
    drawFrame();
    scheduleIfActive();

    const handleMotionChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion = e.matches;
      if (prefersReducedMotion) {
        stopLoop();
        drawFrame();
      } else {
        scheduleIfActive();
      }
    };
    motionQuery?.addEventListener?.('change', handleMotionChange);

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        stopLoop();
      } else {
        scheduleIfActive();
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    const supportsContentVisibility =
      typeof document !== 'undefined' && 'contentVisibility' in document.documentElement.style;
    const handleAutoStateChange = (event: Event) => {
      const skipped = Boolean((event as Event & { skipped?: boolean }).skipped);
      isSkippedRef.current = skipped;
      if (skipped) {
        stopLoop();
      } else {
        drawFrame();
        scheduleIfActive();
      }
    };

    let io: IntersectionObserver | null = null;
    if (supportsContentVisibility) {
      shell.addEventListener('contentvisibilityautostatechange', handleAutoStateChange);
    } else if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        entries => {
          const entry = entries[0];
          if (!entry) return;
          isSkippedRef.current = !entry.isIntersecting;
          if (!entry.isIntersecting) {
            stopLoop();
          } else {
            drawFrame();
            scheduleIfActive();
          }
        },
        { rootMargin: '200px' }
      );
      io.observe(shell);
    }

    return () => {
      stopLoop();
      motionQuery?.removeEventListener?.('change', handleMotionChange);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      shell.removeEventListener('contentvisibilityautostatechange', handleAutoStateChange);
      io?.disconnect();
    };
  }, [style, isPlaying, accentColor, bgColor]);

  return (
    <div
      ref={shellRef}
      className="cel-visualizer-shell"
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        background: bgColor,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="kinetic-visualizer-canvas"
        aria-label={`Audio frequency visualizer (${style.replace('_', ' ')} theme)`}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      >
        Audio frequency visualizer preview ({style.replace('_', ' ')}).
      </canvas>
      {onTogglePlay && (
        <button
          type="button"
          onClick={onTogglePlay}
          data-testid="visualizer-play-toggle"
          data-no-cursor-glow="true"
          aria-label={isPlaying ? 'Pause audio visualizer preview' : 'Play audio visualizer preview'}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            zIndex: 2,
          }}
        />
      )}
      {/* Reticle HUD overlay */}
      <div
        style={{
          position: 'absolute',
          top: '12px',
          left: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          pointerEvents: 'none',
          zIndex: 3,
        }}
      >
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
            color: 'rgba(255, 255, 255, 0.7)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {isPlaying ? 'LIVE VISUALIZER // 60 FPS' : 'STANDBY // PAUSED'}
        </span>
      </div>

      <div
        style={{
          position: 'absolute',
          bottom: '12px',
          right: '14px',
          pointerEvents: 'none',
          zIndex: 3,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.5625rem',
          color: 'rgba(255, 255, 255, 0.45)',
          letterSpacing: '0.06em',
        }}
      >
        THEME: {style.toUpperCase()}
      </div>
    </div>
  );
}

// ── Synthetic frequency generator for deterministic animations & test environments ──
function simulateAudioData(time: number, isPlaying: boolean, freqOut: Uint8Array, timeOut: Uint8Array) {
  const speed = isPlaying ? 3.0 : 0.6;
  const count = freqOut.length;
  for (let i = 0; i < count; i++) {
    const bass = Math.sin(time * 4 * speed + i * 0.12) * 0.5 + 0.5;
    const mid = Math.cos(time * 2.5 * speed + i * 0.25) * 0.5 + 0.5;
    const noise = (Math.sin(time * 10 + i * 1.5) + 1) * 0.15;
    const amp = Math.floor((bass * 0.6 + mid * 0.3 + noise * 0.1) * (isPlaying ? 230 : 60)) + 25;
    freqOut[i] = Math.min(255, Math.max(10, amp));
    timeOut[i] = Math.floor(128 + Math.sin(time * 5 * speed + i * 0.2) * (isPlaying ? 70 : 20));
  }
}

// ── Theme 1: obsidian_pulse ──
function renderObsidianPulse(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cx: number,
  cy: number,
  freq: Uint8Array,
  bassEnergy: number,
  elapsed: number,
  accentColor: string
) {
  const minDim = Math.min(width, height);
  const baseRadius = minDim * 0.22 * (1 + bassEnergy * 0.35);

  // Concentric pulsating rings
  for (let k = 1; k <= 5; k++) {
    const r = baseRadius + k * 20 * (1 + bassEnergy * 0.5);
    const alpha = (1 - k / 6) * (0.3 + bassEnergy * 0.4);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 90, 0, ${alpha.toFixed(3)})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // Radial frequency spikes
  const numSpikes = 48;
  const angleStep = (Math.PI * 2) / numSpikes;
  for (let i = 0; i < numSpikes; i++) {
    const fVal = freq[i % freq.length] || 20;
    const spikeLen = (fVal / 255) * (minDim * 0.18);
    const angle = i * angleStep + elapsed * 0.2;
    const x1 = cx + Math.cos(angle) * (baseRadius * 0.85);
    const y1 = cy + Math.sin(angle) * (baseRadius * 0.85);
    const x2 = cx + Math.cos(angle) * (baseRadius + spikeLen);
    const y2 = cy + Math.sin(angle) * (baseRadius + spikeLen);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Core glow
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, baseRadius);
  grad.addColorStop(0, '#FF8A00');
  grad.addColorStop(0.5, 'rgba(255, 90, 0, 0.3)');
  grad.addColorStop(1, 'rgba(10, 10, 12, 0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
  ctx.fill();
}

// ── Theme 2: cyber_bars ──
function renderCyberBars(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cx: number,
  cy: number,
  freq: Uint8Array,
  peaks: number[],
  accentColor: string
) {
  const numBars = 48;
  const barWidth = Math.max(2, (width * 0.85) / numBars - 3);
  const startX = (width - numBars * (barWidth + 3)) / 2;
  const maxBarHeight = height * 0.42;

  for (let i = 0; i < numBars; i++) {
    const fVal = freq[i % freq.length] || 10;
    const h = (fVal / 255) * maxBarHeight;
    const x = startX + i * (barWidth + 3);

    // Peak decay tracking
    if (h > (peaks[i] || 0)) {
      peaks[i] = h;
    } else {
      peaks[i] = Math.max(0, (peaks[i] || 0) - 1.8);
    }

    // Mirrored vertical bar
    const grad = ctx.createLinearGradient(0, cy - h, 0, cy + h);
    grad.addColorStop(0, 'rgba(255, 90, 0, 0.15)');
    grad.addColorStop(0.5, '#FFFFFF');
    grad.addColorStop(1, 'rgba(255, 90, 0, 0.15)');

    ctx.fillStyle = grad;
    ctx.fillRect(x, cy - h, barWidth, h * 2);

    // Peak cap markers
    const peakY = peaks[i] || 0;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(x, cy - peakY - 2, barWidth, 2);
    ctx.fillRect(x, cy + peakY, barWidth, 2);
  }

  // Center horizon line
  ctx.beginPath();
  ctx.moveTo(startX, cy);
  ctx.lineTo(startX + numBars * (barWidth + 3), cy);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ── Theme 3: nebula_spectrum ──
function renderNebulaSpectrum(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cx: number,
  cy: number,
  freq: Uint8Array,
  particles: Array<{ x: number; y: number; angle: number; radius: number; speed: number; size: number }>,
  bassEnergy: number,
  elapsed: number,
  accentColor: string
) {
  // Center orbital galaxy
  particles.forEach((p, idx) => {
    const fVal = freq[idx % freq.length] || 20;
    const dynRadius = p.radius * (1 + (fVal / 255) * 0.4 + bassEnergy * 0.2);
    p.angle += p.speed * (1 + bassEnergy * 1.5);

    const x = cx + Math.cos(p.angle) * dynRadius;
    const y = cy + Math.sin(p.angle) * dynRadius * 0.55; // 3D tilt
    p.x = x;
    p.y = y;

    ctx.beginPath();
    ctx.arc(x, y, p.size * (1 + bassEnergy * 0.8), 0, Math.PI * 2);
    ctx.fillStyle = idx % 2 === 0 ? accentColor : 'rgba(255, 255, 255, 0.8)';
    ctx.shadowBlur = 8;
    ctx.shadowColor = accentColor;
    ctx.fill();
    ctx.shadowBlur = 0;
  });

  // Connecting constellation threads
  ctx.lineWidth = 0.5;
  for (let i = 0; i < particles.length; i += 3) {
    for (let j = i + 1; j < particles.length; j += 4) {
      const p1 = particles[i];
      const p2 = particles[j];
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (dist < 55) {
        const alpha = (1 - dist / 55) * 0.25;
        ctx.strokeStyle = `rgba(255, 120, 40, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    }
  }
}

// ── Theme 4: minimal_wave ──
function renderMinimalWave(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cx: number,
  cy: number,
  timeData: Uint8Array,
  bassEnergy: number,
  elapsed: number,
  accentColor: string
) {
  // Grid lines
  const gridStep = 30;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y < height; y += gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Waveform oscilloscope path
  const count = timeData.length;
  const sliceWidth = width / count;

  // Pass 1: Glow trace
  ctx.beginPath();
  let x = 0;
  for (let i = 0; i < count; i++) {
    const v = (timeData[i] - 128) / 128;
    const y = cy + v * (height * 0.35) * (1 + bassEnergy * 0.3);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
    x += sliceWidth;
  }
  ctx.strokeStyle = 'rgba(255, 90, 0, 0.3)';
  ctx.lineWidth = 6;
  ctx.stroke();

  // Pass 2: Sharp core
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Pass 3: White center beam
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;
  ctx.stroke();
}
