'use client'

import { useEffect, useRef, useState, useCallback, useId } from 'react';

import { safeFetch } from '../../../lib/security/safeFetch';

const HEALTH_ENDPOINT = '/api/health';
const PING_INTERVAL_MS = 10_000;   // check every 10s
const FAILURE_THRESHOLD = 5;       // require 5 consecutive failures before displaying offline modal
const RETRY_COUNTDOWN_S = 10;      // auto-retry countdown shown in overlay

interface HealthState {
  online: boolean;
  lastSeen: Date | null;
  failCount: number;
  uptime?: number;
  memoryMB?: number;
}

const safeFetchHealth = async (url: string, timeoutMs = 8000): Promise<Response | null> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const fetchPromise = safeFetch(url, { cache: 'no-store' }).catch(() => null);
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    return await Promise.race([fetchPromise, timeoutPromise]);
  } catch {
    return null;
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
};

export function ServerGuard() {
  const [state, setState] = useState<HealthState>({
    online: true,
    lastSeen: new Date(),
    failCount: 0,
  });
  const [retryIn, setRetryIn] = useState(RETRY_COUNTDOWN_S);
  const pingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMounted = useRef(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  const handleDismiss = useCallback(() => {
    setState({
      online: true,
      lastSeen: new Date(),
      failCount: 0,
    });
  }, []);

  const ping = useCallback(async () => {
    try {
      const res = await safeFetchHealth(HEALTH_ENDPOINT, 8000);

      if (!isMounted.current) return;

      if (res?.ok) {
        const data = await res.json().catch(() => ({}));
        setState({
          online: true,
          lastSeen: new Date(),
          failCount: 0,
          uptime: data.uptime,
          memoryMB: data.memoryMB,
        });
        setRetryIn(RETRY_COUNTDOWN_S);
      } else {
        setState(prev => ({
          ...prev,
          failCount: prev.failCount + 1,
          online: prev.failCount + 1 < FAILURE_THRESHOLD ? prev.online : false,
        }));
      }
    } catch {
      if (!isMounted.current) return;
      setState(prev => ({
        ...prev,
        failCount: prev.failCount + 1,
        online: prev.failCount + 1 < FAILURE_THRESHOLD ? prev.online : false,
      }));
    }
  }, []);

  // Start ping loop on mount
  useEffect(() => {
    isMounted.current = true;
    ping(); // immediate first ping
    pingRef.current = setInterval(ping, PING_INTERVAL_MS);
    return () => {
      isMounted.current = false;
      if (pingRef.current) clearInterval(pingRef.current);
    };
  }, [ping]);

  // Countdown timer when offline
  useEffect(() => {
    const isOffline = state.failCount >= FAILURE_THRESHOLD;
    if (isOffline) {
      setRetryIn(RETRY_COUNTDOWN_S);
      countdownRef.current = setInterval(() => {
        setRetryIn(prev => {
          if (prev <= 1) {
            ping();
            return RETRY_COUNTDOWN_S;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [state.failCount >= FAILURE_THRESHOLD, ping]); // eslint-disable-line react-hooks/exhaustive-deps

  const isOffline = state.failCount >= FAILURE_THRESHOLD;

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;

    if (isOffline) {
      if (typeof dlg.showModal === 'function') {
        try {
          if (!dlg.open) dlg.showModal();
        } catch {
          dlg.setAttribute('open', '');
        }
      } else {
        dlg.setAttribute('open', '');
      }
    } else if (typeof dlg.close === 'function' && dlg.open) {
      try {
        dlg.close();
      } catch {
        dlg.removeAttribute('open');
      }
    } else {
      dlg.removeAttribute('open');
    }
  }, [isOffline]);

  if (!isOffline) return null;

  const secondsAgo = state.lastSeen
    ? Math.round((Date.now() - state.lastSeen.getTime()) / 1000)
    : null;

  return (
    <dialog
      ref={dialogRef}
      role="alertdialog"
      aria-labelledby={titleId}
      className="cel-dialog"
      onCancel={(e) => {
        e.preventDefault();
        handleDismiss();
      }}
    >
      {/* Scanline effect */}
      <div style={{
        position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden',
      }} aria-hidden="true">
        <div
          className="cel-guard-scanline"
          style={{
            position: 'absolute', left: 0, right: 0, height: '2px',
            background: 'linear-gradient(to bottom, transparent, rgba(255,90,0,0.15), transparent)',
          }}
        />
      </div>

      {/* Header bar */}
      <div style={{
        minHeight: '48px',
        borderBottom: '1px solid rgba(255, 90, 0, 0.25)',
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      }}>
        <h2 id={titleId} style={{ margin: 0, fontSize: '0.6875rem', letterSpacing: '0.08em', fontWeight: 700, color: 'var(--text-muted)' }}>
          CELESTIAL // SYSTEM DIAGNOSTIC
        </h2>
        <span
          className="cel-guard-pulse"
          style={{
            fontSize: '0.625rem',
            letterSpacing: '0.06em',
            color: 'var(--accent)',
          }}
        >
          SERVER OFFLINE ●
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: '20px', position: 'relative' }}>
        {/* Status row */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            FAULT REPORT
          </span>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-main)', lineHeight: 1.6, margin: 0 }}>
            The Celestial dev server is not responding to health checks.
            {secondsAgo !== null && (
              <span style={{ color: 'var(--text-muted)' }}> Last seen {secondsAgo}s ago.</span>
            )}
          </p>
        </div>

        {/* Recovery commands */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <span style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            RECOVERY COMMANDS
          </span>
          <div style={{
            background: 'rgba(0,0,0,0.5)',
            border: '1px solid rgba(255,255,255,0.08)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            {[
              { label: 'Supervised (auto-restart)', cmd: 'npm run dev:supervised' },
              { label: 'Quick restart', cmd: 'npm run dev:restart' },
              { label: 'Fresh start', cmd: 'npm run dev' },
            ].map(({ label, cmd }) => (
              <div key={cmd} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '0.625rem', color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                  {label.toUpperCase()}
                </span>
                <code style={{ fontSize: '0.75rem', color: 'var(--accent)', letterSpacing: '0.04em' }}>
                  $ {cmd}
                </code>
              </div>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <button
            type="button"
            autoFocus
            onClick={async () => {
              await ping();
            }}
            data-testid="server-guard-retry-now"
            className="cel-btn-primary"
          >
            RETRY NOW
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            data-testid="server-guard-dismiss"
            className="cel-btn-secondary"
          >
            DISMISS (CONTINUE)
          </button>
        </div>

        <div
          aria-live="polite"
          style={{
            minHeight: '32px',
            border: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.6875rem',
            color: 'var(--text-muted)',
            letterSpacing: '0.06em',
            gap: '6px',
          }}
        >
          <span className="cel-guard-pulse" style={{ color: 'var(--accent)' }} aria-hidden="true">●</span>
          AUTO-RETRY IN {retryIn}s
        </div>

        {/* Health URL hint */}
        <p style={{ fontSize: '0.6875rem', color: 'var(--text-dark)', margin: 0, letterSpacing: '0.04em' }}>
          HEALTH ENDPOINT: <span style={{ color: 'var(--text-muted)' }}>http://localhost:3000/api/health</span>
        </p>
      </div>
    </dialog>
  );
}
