'use client'

/**
 * Celestial Tooltip System
 *
 * Provider + three tooltip variants matched to the Celestial Obsidian design language:
 *   - TooltipProvider  : wraps the app
 *   - TooltipTop       : Variation 1 — icon button, tip appears above
 *   - TooltipBottom    : Variation 2 — text+icon button, tip appears below
 *   - TooltipRight     : Variation 3 — longer contextual text, tip appears to the right
 *
 * Implements WCAG 1.4.13 (Dismissible via Escape, Hoverable content, Persistent until
 * trigger/content hover & focus end), unique per-instance IDs via React useId(),
 * CSS-only styles via .cel-tooltip in globals.css, viewport clamping/flipping, and
 * native Popover API top-layer promotion with graceful fallback when unsupported.
 */

import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
  type ReactNode,
  type CSSProperties,
} from 'react';

interface TooltipContextValue {
  delayMs: number;
  skipDelayMs: number;
}

const TooltipContext = createContext<TooltipContextValue>({
  delayMs: 600,
  skipDelayMs: 100,
});

interface TooltipProviderProps {
  children: ReactNode;
  delayMs?: number;
  skipDelayMs?: number;
}

export function TooltipProvider({
  children,
  delayMs = 600,
  skipDelayMs = 100,
}: TooltipProviderProps) {
  return (
    <TooltipContext.Provider value={{ delayMs, skipDelayMs }}>
      {children}
    </TooltipContext.Provider>
  );
}

type Placement = 'top' | 'bottom' | 'right';

// Global "skip delay" and single-active-hint coordination (also covers browsers where popover="hint" falls back to manual)
let lastCloseTime = 0;
let dismissActiveTooltip: (() => void) | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

function useTooltip(placement: Placement) {
  const { delayMs, skipDelayMs } = useContext(TooltipContext);
  const tooltipId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [isInstant, setIsInstant] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const computePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    if (!triggerEl || typeof window === 'undefined') return { top: 0, left: 0 };

    const rect = triggerEl.getBoundingClientRect();
    const tipEl = tooltipRef.current;
    const tipWidth = tipEl?.offsetWidth || 160;
    const tipHeight = tipEl?.offsetHeight || 28;
    const GAP = 8;
    const VIEWPORT_PAD = 8;
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;

    let top = 0;
    let left = 0;

    if (placement === 'top') {
      const fitsAbove = rect.top - GAP - tipHeight >= VIEWPORT_PAD;
      top = fitsAbove ? rect.top - GAP - tipHeight : rect.bottom + GAP;
      left = rect.left + rect.width / 2 - tipWidth / 2;
    } else if (placement === 'bottom') {
      const fitsBelow = rect.bottom + GAP + tipHeight <= vh - VIEWPORT_PAD;
      top = fitsBelow ? rect.bottom + GAP : rect.top - GAP - tipHeight;
      left = rect.left + rect.width / 2 - tipWidth / 2;
    } else {
      const fitsRight = rect.right + GAP + tipWidth <= vw - VIEWPORT_PAD;
      left = fitsRight ? rect.right + GAP : rect.left - GAP - tipWidth;
      top = rect.top + rect.height / 2 - tipHeight / 2;
    }

    return {
      top: clamp(top, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vh - tipHeight - VIEWPORT_PAD)),
      left: clamp(left, VIEWPORT_PAD, Math.max(VIEWPORT_PAD, vw - tipWidth - VIEWPORT_PAD)),
    };
  }, [placement]);

  const closeImmediately = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsOpen(false);
    lastCloseTime = Date.now();
  }, []);

  const scheduleClose = useCallback(() => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    // Short grace period lets pointer cross the 8px gap onto the tooltip itself (WCAG 1.4.13 Hoverable)
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
      lastCloseTime = Date.now();
      closeTimerRef.current = null;
    }, 90);
  }, []);

  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    cancelScheduledClose();
    if (openTimerRef.current) clearTimeout(openTimerRef.current);

    if (dismissActiveTooltip && dismissActiveTooltip !== closeImmediately) {
      dismissActiveTooltip();
    }
    dismissActiveTooltip = closeImmediately;

    const sinceClose = Date.now() - lastCloseTime;
    const isRapid = sinceClose < 300;
    const delay = isRapid ? skipDelayMs : delayMs;
    setIsInstant(isRapid);

    const activate = () => {
      setPosition(computePosition());
      setIsOpen(true);
    };

    if (delay <= 0) {
      activate();
    } else {
      openTimerRef.current = setTimeout(activate, delay);
    }
  }, [cancelScheduledClose, closeImmediately, computePosition, delayMs, skipDelayMs]);

  useEffect(() => {
    return () => {
      if (dismissActiveTooltip === closeImmediately) {
        dismissActiveTooltip = null;
      }
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [closeImmediately]);

  // Progressive enhancement with native Popover API + Escape key dismissal + viewport tracking
  useEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;

    const supportsPopover = typeof el.showPopover === 'function' && typeof el.hidePopover === 'function';
    if (isOpen) {
      if (supportsPopover) {
        try {
          if (!el.matches(':popover-open')) el.showPopover();
        } catch {
          // Graceful fallback to fixed positioning
        }
      }
      // Refine position after popover measures its actual rendered size
      const frame = window.requestAnimationFrame(() => {
        setPosition(computePosition());
      });

      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeImmediately();
      };
      const update = () => setPosition(computePosition());

      document.addEventListener('keydown', handleEscape);
      window.addEventListener('scroll', update, { passive: true, capture: true });
      window.addEventListener('resize', update, { passive: true });
      return () => {
        window.cancelAnimationFrame(frame);
        document.removeEventListener('keydown', handleEscape);
        window.removeEventListener('scroll', update, { capture: true });
        window.removeEventListener('resize', update);
      };
    } else if (supportsPopover) {
      try {
        if (el.matches(':popover-open')) el.hidePopover();
      } catch {
        // Already closed
      }
    }
  }, [isOpen, computePosition, closeImmediately]);

  useEffect(() => {
    const el = tooltipRef.current;
    if (!el) return;
    const handleToggle = (e: Event) => {
      const toggleEvent = e as Event & { newState?: string };
      if (toggleEvent.newState === 'closed') {
        setIsOpen(false);
      }
    };
    el.addEventListener('toggle', handleToggle);
    return () => el.removeEventListener('toggle', handleToggle);
  }, []);

  return {
    tooltipId,
    isOpen,
    isInstant,
    position,
    triggerRef,
    tooltipRef,
    open,
    scheduleClose,
    cancelScheduledClose,
    closeImmediately,
  };
}

function TooltipBase({
  placement,
  content,
  children,
}: {
  placement: Placement;
  content: ReactNode;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}) {
  const {
    tooltipId,
    isOpen,
    isInstant,
    position,
    triggerRef,
    tooltipRef,
    open,
    scheduleClose,
    cancelScheduledClose,
    closeImmediately,
  } = useTooltip(placement);

  const existingProps = children.props;

  const child = React.cloneElement(children, {
    ref: triggerRef,
    'aria-describedby': existingProps['aria-describedby'] ?? (isOpen ? tooltipId : undefined),
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      existingProps.onMouseEnter?.(e);
      open();
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      existingProps.onMouseLeave?.(e);
      scheduleClose();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      existingProps.onFocus?.(e);
      open();
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      existingProps.onBlur?.(e);
      scheduleClose();
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      existingProps.onKeyDown?.(e);
      if (e.key === 'Escape' && isOpen) {
        closeImmediately();
      }
    },
  } as React.HTMLAttributes<HTMLElement> & { ref: React.Ref<HTMLElement> });

  const popoverStyle: CSSProperties = {
    top: position.top,
    left: position.left,
  };

  return (
    <>
      {child}
      <div
        ref={tooltipRef}
        id={tooltipId}
        role="tooltip"
        {...({ popover: 'hint' } as React.HTMLAttributes<HTMLDivElement>)}
        className="cel-tooltip"
        data-placement={placement}
        data-state={isOpen ? 'open' : 'closed'}
        data-instant={isInstant ? 'true' : 'false'}
        aria-hidden={!isOpen}
        onMouseEnter={cancelScheduledClose}
        onMouseLeave={scheduleClose}
        style={popoverStyle}
      >
        {content}
      </div>
    </>
  );
}

interface TooltipVariantProps {
  content: ReactNode;
  children: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
}

export function TooltipTop({ content, children }: TooltipVariantProps) {
  return <TooltipBase placement="top" content={content}>{children}</TooltipBase>;
}

export function TooltipBottom({ content, children }: TooltipVariantProps) {
  return <TooltipBase placement="bottom" content={content}>{children}</TooltipBase>;
}

export function TooltipRight({ content, children }: TooltipVariantProps) {
  return <TooltipBase placement="right" content={content}>{children}</TooltipBase>;
}
