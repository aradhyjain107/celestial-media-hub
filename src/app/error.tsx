'use client'

// app/error.tsx — Route-level React error boundary (catches errors in any route segment)
// Next.js calls this automatically when a component in the route tree throws.

import { useEffect, useId } from 'react';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const titleId = useId();

  useEffect(() => {
    // Log to console in dev; swap for a real error reporter (Sentry, etc.) in prod
    console.error('[CELESTIAL] Route error caught by error.tsx:', error);
  }, [error]);

  const isDev = process.env.NODE_ENV === 'development';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      minHeight: '400px',
      padding: '32px 16px',
      fontFamily: 'var(--font-mono, monospace)',
    }}>
      {/* Header */}
      <div
        role="alertdialog"
        aria-labelledby={titleId}
        style={{
          width: 'min(35rem, 100%)',
          border: '1px solid rgba(255, 90, 0, 0.35)',
          background: 'rgba(14, 14, 18, 0.9)',
        }}
      >
        {/* Top bar */}
        <div style={{
          minHeight: '48px',
          borderBottom: '1px solid rgba(255, 90, 0, 0.2)',
          padding: '0 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}>
          <h1 id={titleId} tabIndex={-1} style={{ fontSize: '0.6875rem', letterSpacing: '0.08em', fontWeight: 700, color: 'var(--text-muted)', margin: 0 }}>
            CELESTIAL // COMPONENT FAULT
          </h1>
          <span style={{ fontSize: '0.625rem', color: 'var(--accent)', letterSpacing: '0.06em' }}>
            RENDER ERROR ●
          </span>
        </div>

        {/* Body */}
        <div style={{ padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <span style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
              FAULT MESSAGE
            </span>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-main)', margin: 0, lineHeight: 1.5 }}>
              {error.message || 'An unexpected error occurred in this route.'}
            </p>
          </div>

          {/* Stack trace — dev only */}
          {isDev && error.stack && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '0.625rem', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                STACK TRACE
              </span>
              <pre style={{
                fontSize: '0.6875rem',
                color: 'var(--text-muted)',
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '12px',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                margin: 0,
                maxHeight: '180px',
              }}>
                {error.stack}
              </pre>
            </div>
          )}

          {error.digest && (
            <p style={{ fontSize: '0.6875rem', color: 'var(--text-dark)', margin: 0 }}>
              DIGEST: {error.digest}
            </p>
          )}

          {/* Divider */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }} />

          {/* Actions */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={reset}
              data-testid="error-retry-btn"
              className="cel-btn-primary"
            >
              RETRY
            </button>
            <button
              type="button"
              onClick={() => { window.location.href = '/'; }}
              className="cel-btn-secondary"
            >
              DASHBOARD
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
