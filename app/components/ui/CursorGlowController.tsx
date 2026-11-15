'use client';

import { useEffect, useRef } from 'react';
import {
  CURSOR_GLOW_SELECTOR,
  cancelPendingCursorGlow,
  canTrackCursorGlow,
  syncCursorGlowEnter,
  syncCursorGlowMove,
} from '../../../lib/useCursorGlow';

/**
 * Delegated fine-pointer spotlight tracker that updates `--mouse-x`/`--mouse-y`
 * on interactive buttons and navigation surfaces without per-button listeners.
 */
export function CursorGlowController() {
  const activeTargetRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const resolveTarget = (rawTarget: EventTarget | null): HTMLElement | null => {
      if (!(rawTarget instanceof Element)) return null;
      return rawTarget.closest<HTMLElement>(CURSOR_GLOW_SELECTOR);
    };

    const handlePointer = (e: PointerEvent) => {
      if (!canTrackCursorGlow(e.pointerType)) {
        activeTargetRef.current = null;
        return;
      }

      const nextTarget = resolveTarget(e.target);
      if (!nextTarget) {
        activeTargetRef.current = null;
        return;
      }

      if (nextTarget !== activeTargetRef.current) {
        activeTargetRef.current = nextTarget;
        syncCursorGlowEnter(nextTarget, e.clientX, e.clientY, e.pointerType);
      } else {
        syncCursorGlowMove(nextTarget, e.clientX, e.clientY, e.pointerType);
      }
    };

    const handlePointerOut = (e: PointerEvent) => {
      if (e.relatedTarget && resolveTarget(e.relatedTarget) === activeTargetRef.current) {
        return;
      }
      if (!e.relatedTarget) {
        activeTargetRef.current = null;
      }
    };

    document.addEventListener('pointerover', handlePointer, { passive: true });
    document.addEventListener('pointermove', handlePointer, { passive: true });
    document.addEventListener('pointerout', handlePointerOut, { passive: true });

    return () => {
      document.removeEventListener('pointerover', handlePointer);
      document.removeEventListener('pointermove', handlePointer);
      document.removeEventListener('pointerout', handlePointerOut);
      cancelPendingCursorGlow(activeTargetRef.current);
      activeTargetRef.current = null;
    };
  }, []);

  return null;
}
