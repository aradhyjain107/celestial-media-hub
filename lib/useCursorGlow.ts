'use client';

import type React from 'react';
import { useCallback, useEffect, useRef } from 'react';

export const CURSOR_GLOW_SELECTOR =
  'button:not(:disabled):not(.mobile-sidebar-toggle):not([data-no-cursor-glow]), .nav-item, .drop-target-area, .cel-btn-glow';

interface CachedRectEntry {
  rect: DOMRect;
  epoch: number;
}

const cachedRects = new WeakMap<HTMLElement, CachedRectEntry>();
const pendingFrames = new WeakMap<HTMLElement, number>();
const pendingCoords = new WeakMap<HTMLElement, { x: number; y: number }>();

let rectEpoch = 0;
let listenersBound = false;

function bumpRectEpoch(): void {
  rectEpoch += 1;
}

function ensureViewportListeners(): void {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;
  // Invalidate cached bounding boxes passively on resize or any container scroll.
  window.addEventListener('resize', bumpRectEpoch, { passive: true });
  window.addEventListener('scroll', bumpRectEpoch, { passive: true, capture: true });
}

/**
 * Returns whether pointer-tracked hover glow should run for the current input and user motion preference.
 */
export function canTrackCursorGlow(pointerType?: string): boolean {
  if (typeof window === 'undefined') return false;
  if (pointerType === 'touch') return false;

  if (typeof window.matchMedia === 'function') {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return false;
    }
    const fineHover = window.matchMedia('(hover: hover) and (pointer: fine)');
    if (fineHover.media !== 'not all' && !fineHover.matches) {
      return false;
    }
  }

  return true;
}

function getElementRect(el: HTMLElement, forceRefresh: boolean): DOMRect {
  ensureViewportListeners();
  const cached = cachedRects.get(el);
  if (!forceRefresh && cached && cached.epoch === rectEpoch) {
    return cached.rect;
  }
  const rect = el.getBoundingClientRect();
  cachedRects.set(el, { rect, epoch: rectEpoch });
  return rect;
}

function writeCursorCssVars(el: HTMLElement, rect: DOMRect, clientX: number, clientY: number): void {
  const x = Math.round((clientX - rect.left) * 10) / 10;
  const y = Math.round((clientY - rect.top) * 10) / 10;
  el.style.setProperty('--mouse-x', `${x}px`);
  el.style.setProperty('--mouse-y', `${y}px`);
}

/**
 * Cancels any pending animation-frame CSS variable update queued for an element.
 */
export function cancelPendingCursorGlow(el: HTMLElement | null): void {
  if (!el) return;
  const frameId = pendingFrames.get(el);
  if (frameId !== undefined && typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(frameId);
  }
  pendingFrames.delete(el);
  pendingCoords.delete(el);
}

/**
 * Synchronously snaps glow coordinates to the pointer entry point before `:hover` transitions begin.
 */
export function syncCursorGlowEnter(
  el: HTMLElement,
  clientX: number,
  clientY: number,
  pointerType?: string
): void {
  if (!canTrackCursorGlow(pointerType)) return;
  cancelPendingCursorGlow(el);
  const rect = getElementRect(el, true);
  writeCursorCssVars(el, rect, clientX, clientY);
}

/**
 * Coalesces pointer-move updates onto one `requestAnimationFrame` write per element without layout thrashing.
 */
export function syncCursorGlowMove(
  el: HTMLElement,
  clientX: number,
  clientY: number,
  pointerType?: string
): void {
  if (!canTrackCursorGlow(pointerType)) return;

  pendingCoords.set(el, { x: clientX, y: clientY });
  if (pendingFrames.has(el)) return;

  const commit = () => {
    pendingFrames.delete(el);
    const coords = pendingCoords.get(el);
    if (!coords) return;
    pendingCoords.delete(el);
    const rect = getElementRect(el, false);
    writeCursorCssVars(el, rect, coords.x, coords.y);
  };

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    const frameId = window.requestAnimationFrame(commit);
    pendingFrames.set(el, frameId);
  } else {
    commit();
  }
}

/**
 * React pointer handlers for interactive surfaces hosting a cursor-following spotlight layer.
 */
export function useCursorGlowHandlers<T extends HTMLElement = HTMLElement>(enabled = true): {
  onPointerEnter: (e: React.PointerEvent<T>) => void;
  onPointerMove: (e: React.PointerEvent<T>) => void;
} {
  const lastTargetRef = useRef<T | null>(null);

  useEffect(() => {
    return () => {
      cancelPendingCursorGlow(lastTargetRef.current);
      lastTargetRef.current = null;
    };
  }, []);

  const onPointerEnter = useCallback(
    (e: React.PointerEvent<T>) => {
      if (!enabled) return;
      lastTargetRef.current = e.currentTarget;
      syncCursorGlowEnter(e.currentTarget, e.clientX, e.clientY, e.pointerType);
    },
    [enabled]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<T>) => {
      if (!enabled) return;
      lastTargetRef.current = e.currentTarget;
      syncCursorGlowMove(e.currentTarget, e.clientX, e.clientY, e.pointerType);
    },
    [enabled]
  );

  return { onPointerEnter, onPointerMove };
}
