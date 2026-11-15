'use client'

// app/global-error.tsx — Root layout error boundary
// Catches errors in the root layout itself (e.g. GlobalJobProvider crash).
// Must include <html> and <body> because the normal layout is broken.

import { useEffect } from 'react';

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error('[CELESTIAL] Global root error caught by global-error.tsx:', error);
  }, [error]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="color-scheme" content="dark" />
        <title>CELESTIAL // CRITICAL FAULT</title>
        <style>{`
          :root { color-scheme: dark; }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #08080a;
            color: #f4f4f6;
            font-family: "JetBrains Mono", "Courier New", ui-monospace, monospace;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            min-height: 100dvh;
            padding: 16px;
          }
          .panel {
            position: static;
            margin: auto;
            inline-size: min(32.5rem, 100% - 2rem);
            max-inline-size: 100%;
            border: 1px solid rgba(255, 90, 0, 0.45);
            background: rgba(14, 14, 18, 0.98);
            color: #f4f4f6;
            padding: 0;
          }
          .topbar {
            min-height: 48px;
            border-bottom: 1px solid rgba(255, 90, 0, 0.25);
            padding: 0 24px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }
          .label { font-size: 0.6875rem; letter-spacing: 0.08em; font-weight: 700; color: #9ca3af; }
          .status { font-size: 0.625rem; color: #ff5a00; letter-spacing: 0.06em; }
          .body { padding: 28px 24px; display: flex; flex-direction: column; gap: 20px; }
          .section-label { font-size: 0.625rem; letter-spacing: 0.08em; color: #9ca3af; margin-bottom: 6px; }
          .message { font-size: 0.875rem; color: #f4f4f6; line-height: 1.5; }
          .digest { font-size: 0.6875rem; color: #8c8c96; }
          .divider { border-top: 1px solid rgba(255,255,255,0.08); }
          .actions { display: flex; gap: 12px; flex-wrap: wrap; }
          .btn-primary {
            flex: 1; min-width: 120px; min-height: 44px; padding: 12px 16px;
            background: #ff5a00; color: #050505; border: none;
            font-family: inherit; font-size: 0.75rem; font-weight: 800;
            letter-spacing: 0.06em; cursor: pointer; text-transform: uppercase;
          }
          .btn-secondary {
            flex: 1; min-width: 120px; min-height: 44px; padding: 12px 16px;
            background: transparent; color: #d4d4dc;
            border: 1px solid rgba(255,255,255,0.2); font-family: inherit;
            font-size: 0.75rem; font-weight: 700; letter-spacing: 0.06em;
            cursor: pointer; text-transform: uppercase;
          }
          .btn-primary:focus-visible,
          .btn-secondary:focus-visible {
            outline: 2px solid #ff5a00;
            outline-offset: 2px;
          }
          @media (prefers-reduced-motion: no-preference) {
            .btn-primary, .btn-secondary {
              transition: opacity 150ms ease, border-color 150ms ease, color 150ms ease;
            }
          }
          @media (hover: hover) and (pointer: fine) {
            .btn-primary:hover { opacity: 0.88; }
            .btn-secondary:hover { border-color: #ff5a00; color: #ffffff; }
          }
          @media (forced-colors: active) {
            .panel, .btn-secondary { border-color: ButtonText; }
            .btn-primary { background: Highlight; color: HighlightText; forced-color-adjust: none; }
          }
        `}</style>
      </head>
      <body>
        <dialog open className="panel" role="alertdialog" aria-labelledby="global-error-title">
          <div className="topbar">
            <h1 id="global-error-title" className="label">CELESTIAL // CRITICAL FAULT</h1>
            <span className="status">ROOT LAYOUT ERROR ●</span>
          </div>
          <div className="body">
            <div>
              <p className="section-label">FAULT MESSAGE</p>
              <p className="message">
                {error.message || 'A critical error occurred in the root application layout.'}
              </p>
            </div>
            {error.digest && (
              <p className="digest">
                DIGEST: {error.digest}
              </p>
            )}
            <div className="divider" />
            <div className="actions">
              <button type="button" autoFocus className="btn-primary" onClick={reset}>
                RETRY
              </button>
              <button type="button" className="btn-secondary" onClick={() => { window.location.reload(); }}>
                RELOAD
              </button>
            </div>
          </div>
        </dialog>
      </body>
    </html>
  );
}
