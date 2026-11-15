'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react';

export interface ResizableOptionsPanelProps {
  title: string;
  children: React.ReactNode;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
  testId?: string;
}

const STORAGE_KEY = 'celestial_toolbox_width';

export function ResizableOptionsPanel({
  title,
  children,
  defaultWidth = 380,
  minWidth = 260,
  maxWidth = 600,
  className = '',
  testId = 'resizable-options-panel'
}: ResizableOptionsPanelProps) {
  const [width, setWidth] = useState<number>(defaultWidth);
  const [isResizing, setIsResizing] = useState(false);
  const startXRef = useRef<number>(0);
  const startWidthRef = useRef<number>(defaultWidth);
  const currentWidthRef = useRef<number>(defaultWidth);

  // Keep ref in sync with state
  currentWidthRef.current = width;

  // Load saved width from localStorage on mount
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          setWidth(parsed);
          currentWidthRef.current = parsed;
        }
      }
    } catch {
      // Fallback to defaultWidth if localStorage is unavailable
    }
  }, [minWidth, maxWidth]);

  // Apple Fluid Interface exponential rubber band resistance
  const rubberBand = (overshoot: number, dimension = 200) => {
    const c = 0.55;
    return (overshoot * dimension * c) / (dimension + c * Math.abs(overshoot));
  };

  const calculateResizedWidth = useCallback((rawTargetWidth: number) => {
    if (rawTargetWidth > maxWidth) {
      const overshoot = rawTargetWidth - maxWidth;
      return maxWidth + rubberBand(overshoot);
    }
    if (rawTargetWidth < minWidth) {
      const undershoot = minWidth - rawTargetWidth;
      return minWidth - rubberBand(undershoot);
    }
    return rawTargetWidth;
  }, [minWidth, maxWidth]);

  const handleEnd = useCallback(() => {
    setIsResizing(false);
    const settled = Math.min(Math.max(currentWidthRef.current, minWidth), maxWidth);
    setWidth(settled);
    try {
      localStorage.setItem(STORAGE_KEY, settled.toString());
    } catch {
      // Ignore storage errors
    }
  }, [minWidth, maxWidth]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (typeof e.currentTarget.setPointerCapture === 'function') {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    }
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidthRef.current;
    setIsResizing(true);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    const delta = startXRef.current - e.clientX;
    const newWidth = calculateResizedWidth(startWidthRef.current + delta);
    setWidth(newWidth);
    currentWidthRef.current = newWidth;
  }, [isResizing, calculateResizedWidth]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (typeof e.currentTarget.releasePointerCapture === 'function' && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
    }
    handleEnd();
  }, [handleEnd]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    startXRef.current = e.clientX;
    startWidthRef.current = currentWidthRef.current;
    setIsResizing(true);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    startXRef.current = e.touches[0].clientX;
    startWidthRef.current = currentWidthRef.current;
    setIsResizing(true);
  }, []);

  // WAI-ARIA keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 20 : 10;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setWidth(prev => {
        const next = Math.min(maxWidth, prev + step);
        currentWidthRef.current = next;
        try { localStorage.setItem(STORAGE_KEY, next.toString()); } catch {}
        return next;
      });
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setWidth(prev => {
        const next = Math.max(minWidth, prev - step);
        currentWidthRef.current = next;
        try { localStorage.setItem(STORAGE_KEY, next.toString()); } catch {}
        return next;
      });
    } else if (e.key === 'Home') {
      e.preventDefault();
      setWidth(minWidth);
      currentWidthRef.current = minWidth;
      try { localStorage.setItem(STORAGE_KEY, minWidth.toString()); } catch {}
    } else if (e.key === 'End') {
      e.preventDefault();
      setWidth(maxWidth);
      currentWidthRef.current = maxWidth;
      try { localStorage.setItem(STORAGE_KEY, maxWidth.toString()); } catch {}
    }
  }, [minWidth, maxWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleWindowMouseMove = (e: MouseEvent) => {
      const delta = startXRef.current - e.clientX;
      const newWidth = calculateResizedWidth(startWidthRef.current + delta);
      setWidth(newWidth);
      currentWidthRef.current = newWidth;
    };

    const handleWindowTouchMove = (e: TouchEvent) => {
      const delta = startXRef.current - e.touches[0].clientX;
      const newWidth = calculateResizedWidth(startWidthRef.current + delta);
      setWidth(newWidth);
      currentWidthRef.current = newWidth;
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleEnd);
    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false });
    window.addEventListener('touchend', handleEnd);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleWindowTouchMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [isResizing, calculateResizedWidth, handleEnd]);

  return (
    <>
      <aside
        data-testid={testId}
        data-lenis-prevent
        className={`options-panel ${className}`}
        style={{
          width: `${width}px`,
          flexShrink: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          userSelect: isResizing ? 'none' : undefined,
        }}
      >
        {/* 
          Drag handle: modernized with Pointer Capture, 44px hit area (Apple touch target minimum),
          and WAI-ARIA keyboard navigation (ArrowLeft / ArrowRight).
        */}
        <div
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label="Resize toolbox panel — drag or use arrow keys to resize"
          aria-valuenow={Math.round(width)}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          data-testid="toolbox-resize-handle"
          className="cel-resize-handle"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onKeyDown={handleKeyDown}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: '44px',
            transform: 'translateX(-22px)',
            cursor: 'col-resize',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            touchAction: 'none',
          }}
        >
          {/* Visual pill indicator */}
          <div
            style={{
              width: isResizing ? '3px' : '2px',
              height: '40px',
              borderRadius: '3px',
              background: isResizing
                ? 'var(--accent)'
                : 'rgba(255, 255, 255, 0.18)',
              boxShadow: isResizing
                ? '0 0 10px var(--accent), 0 0 20px rgba(255, 90, 0, 0.3)'
                : 'none',
              transition: 'background 0.15s ease, box-shadow 0.15s ease, width 0.1s ease',
              pointerEvents: 'none'
            }}
          />
        </div>

        {/* Panel Header */}
        <div
          className="options-header grid-line-bottom"
          style={{ height: '52px', padding: '0 24px', flexShrink: 0 }}
        >
          <span
            className="tiny-label"
            style={{ fontSize: '0.6875rem', letterSpacing: '0.08em', fontWeight: 700 }}
          >
            {title}
          </span>
          {/* Live width readout during resize */}
          {isResizing && (
            <span
              style={{
                marginLeft: 'auto',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.625rem',
                color: 'var(--accent)',
                letterSpacing: '0.05em',
                opacity: 0.9,
                transition: 'opacity 0.1s'
              }}
              aria-live="polite"
            >
              {Math.round(width)}px
            </span>
          )}
        </div>

        {/* Scrollable Content Body */}
        <div
          style={{
            padding: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '24px',
            flexGrow: 1,
            overflowY: 'auto',
            overscrollBehavior: 'contain'
          }}
        >
          {children}
        </div>
      </aside>
    </>
  );
}
