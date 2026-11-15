'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { generateQrMatrix } from '../../../lib/utils/qrcode';

const DEFAULT_UPI_ID = '8791979936@fam';
const DEFAULT_UPI_PAYEE = 'Vaibhav Rawat';
const DEFAULT_CREATOR_NAME = 'Aradhy';
const PRESET_AMOUNTS = [null, 29, 50, 99, 249, 499] as const;

function getDonateConfig() {
  return {
    upiId: process.env.NEXT_PUBLIC_UPI_ID || DEFAULT_UPI_ID,
    payeeName: process.env.NEXT_PUBLIC_UPI_NAME || DEFAULT_UPI_PAYEE,
    creatorName: process.env.NEXT_PUBLIC_CREATOR_NAME || DEFAULT_CREATOR_NAME,
  };
}

function buildUpiUri(upiId: string, payeeName: string, amount: number | null): string {
  const params = new URLSearchParams({
    pa: upiId,
    pn: payeeName,
    cu: 'INR',
    tn: 'Support Celestial Media Hub',
  });
  if (amount && amount > 0) {
    params.set('am', String(amount));
  }
  return `upi://pay?${params.toString()}`;
}

/**
 * Builds the compact, universally scannable UPI QR URI.
 * Preserves literal `@` in `pa` so all Indian UPI scanners (GPay, PhonePe, Paytm, FamApp, BHIM)
 * immediately open the payment window with `am` pre-populated when an amount is selected.
 */
export function buildQrUpiUri(upiId: string, payeeName: string, amount: number | null): string {
  if (!amount || amount <= 0) {
    return `upi://pay?pa=${upiId}`;
  }
  const encodedName = encodeURIComponent(payeeName);
  return `upi://pay?pa=${upiId}&pn=${encodedName}&am=${amount}&cu=INR`;
}

interface DynamicUpiQrProps {
  upiId: string;
  payeeName: string;
  amount: number | null;
  size?: number;
}

function DynamicUpiQr({ upiId, payeeName, amount, size = 200 }: DynamicUpiQrProps) {
  const qrUpiUri = useMemo(() => buildQrUpiUri(upiId, payeeName, amount), [upiId, payeeName, amount]);
  const matrix = useMemo(() => generateQrMatrix(qrUpiUri, 'Q'), [qrUpiUri]);

  const n = matrix.length;
  const quiet = 3;
  const total = n + quiet * 2;
  const center = (n - 1) / 2;
  const badgeCutoffRadius = 2.85;
  const svgCenter = total / 2;

  const isFinderModule = (r: number, c: number) =>
    (r <= 6 && c <= 6) ||
    (r <= 6 && c >= n - 7) ||
    (r >= n - 7 && c <= 6);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      role="img"
      aria-label={
        amount
          ? `UPI QR Code for ${upiId} pre-loaded with ₹${amount}`
          : `UPI QR Code for ${upiId} (any amount)`
      }
      data-testid="dynamic-upi-qr"
      data-upi-uri={qrUpiUri}
      data-amount={amount ?? 'any'}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '4px',
        border: '1px solid rgba(255, 90, 0, 0.25)',
        display: 'block',
        background: '#141413',
      }}
    >
      <defs>
        <radialGradient id="upi-qr-warm-glow" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="rgba(255, 138, 30, 0.16)" />
          <stop offset="55%" stopColor="rgba(255, 100, 0, 0.05)" />
          <stop offset="100%" stopColor="rgba(20, 20, 19, 0)" />
        </radialGradient>
      </defs>

      {/* Base dark card & subtle warm ambient glow */}
      <rect x={0} y={0} width={total} height={total} fill="#141413" />
      <rect x={0} y={0} width={total} height={total} fill="url(#upi-qr-warm-glow)" />

      {/* Data & timing modules (excluding finder patterns and center emblem cutout) */}
      {matrix.map((row, r) =>
        row.map((dark, c) => {
          if (!dark || isFinderModule(r, c)) return null;
          if (Math.hypot(r - center, c - center) <= badgeCutoffRadius) return null;
          return (
            <rect
              key={`${r}-${c}`}
              x={c + quiet + 0.04}
              y={r + quiet + 0.04}
              width={0.92}
              height={0.92}
              rx={0.22}
              fill="#ede6dc"
            />
          );
        })
      )}

      {/* Crisp Finder Patterns (Top-Left, Top-Right, Bottom-Left) */}
      {[
        [0, 0],
        [0, n - 7],
        [n - 7, 0],
      ].map(([fr, fc]) => (
        <g key={`finder-${fr}-${fc}`} transform={`translate(${fc + quiet}, ${fr + quiet})`}>
          <rect
            x={0.5}
            y={0.5}
            width={6}
            height={6}
            rx={0.5}
            fill="none"
            stroke="#ede6dc"
            strokeWidth={1}
          />
          <rect x={2} y={2} width={3} height={3} rx={0.35} fill="#ede6dc" />
        </g>
      ))}

      {/* Center Emblem Badge */}
      <g transform={`translate(${svgCenter}, ${svgCenter})`}>
        <circle r={2.55} fill="#241508" stroke="#ede6dc" strokeWidth={0.34} />
        <path
          d="M -0.95 0.95 L -0.15 -0.95 L 1.15 -0.45 L 0.35 0.15 L 0.95 0.35 L -0.55 1.15 L -0.25 0.35 Z"
          fill="#ff9a2e"
        />
      </g>
    </svg>
  );
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below
  }
  try {
    if (typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    }
  } catch {
    return false;
  }
  return false;
}

export interface SupportModalProps {
  open: boolean;
  onClose: () => void;
}

export function SupportModal({ open, onClose }: SupportModalProps) {
  const shouldReduceMotion = useReducedMotion();
  const { upiId, payeeName, creatorName } = getDonateConfig();
  const [selectedAmount, setSelectedAmount] = useState<number | null>(99);
  const [customInput, setCustomInput] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(upiId);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [upiId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const upiUri = buildUpiUri(upiId, payeeName, selectedAmount);

  const handlePresetSelect = (amt: number | null) => {
    setSelectedAmount(amt);
    setCustomInput('');
  };

  const handleCustomAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    setCustomInput(raw);
    if (!raw) {
      setSelectedAmount(null);
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      setSelectedAmount(parsed);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-labelledby="support-modal-title"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? undefined : { opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(3, 3, 4, 0.84)',
            backdropFilter: 'blur(12px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
          }}
        >
          <motion.div
            initial={shouldReduceMotion ? false : { opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? undefined : { opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '420px',
              background: 'var(--glass-surface-2, rgba(20, 20, 26, 0.95))',
              border: '1px solid var(--border-active, rgba(255, 90, 0, 0.45))',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.85), 0 0 32px rgba(255, 90, 0, 0.14)',
              borderRadius: '4px',
              padding: '20px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Top specular accent bar */}
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: '2px',
                background: 'linear-gradient(90deg, transparent, var(--accent-primary, #FF5A00), transparent)',
              }}
            />

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', marginBottom: '14px' }}>
              <div>
                <span className="tiny-label" style={{ color: 'var(--accent-primary, #FF5A00)', letterSpacing: '0.12em' }}>
                  SYS.SUPPORT // 0% FEE UPI
                </span>
                <h2
                  id="support-modal-title"
                  style={{
                    margin: '6px 0 0',
                    fontSize: '18px',
                    fontWeight: 700,
                    color: 'var(--text-primary, #fff)',
                  }}
                >
                  Support {creatorName}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close support modal"
                className="tiny-label"
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.1))',
                  color: 'var(--text-secondary, #9CA3AF)',
                  borderRadius: '2px',
                  padding: '4px 8px',
                  cursor: 'pointer',
                }}
              >
                [ × ]
              </button>
            </div>

            <p style={{ fontSize: '12px', lineHeight: 1.5, color: 'var(--text-secondary, #9CA3AF)', margin: '0 0 16px' }}>
              Celestial Media Hub is built to stay 100% free with zero paywalls, ads, or tracking. Pick an amount below and scan the QR to open your UPI app with that exact amount pre-loaded.
            </p>

            {/* Dynamic QR Display */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '14px',
                background: '#09090b',
                border: '1px solid var(--border-stark, #222226)',
                borderRadius: '4px',
                marginBottom: '14px',
              }}
            >
              <DynamicUpiQr
                upiId={upiId}
                payeeName={payeeName}
                amount={selectedAmount}
                size={200}
              />
              <div
                data-testid="qr-amount-badge"
                className="mono-data"
                style={{
                  marginTop: '10px',
                  padding: '3px 9px',
                  borderRadius: '2px',
                  fontSize: '10px',
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  background: selectedAmount ? 'rgba(255, 90, 0, 0.14)' : 'rgba(255, 255, 255, 0.05)',
                  border: selectedAmount
                    ? '1px solid rgba(255, 90, 0, 0.45)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                  color: selectedAmount ? 'var(--accent-primary, #FF5A00)' : 'var(--text-secondary, #9CA3AF)',
                }}
              >
                {selectedAmount
                  ? `QR PRE-LOADED: ₹${selectedAmount} • SCAN TO PAY`
                  : 'QR MODE: ANY AMOUNT • ENTER IN UPI APP'}
              </div>
              <span className="tiny-label" style={{ marginTop: '7px', color: 'var(--text-secondary, #9CA3AF)', letterSpacing: '0.1em' }}>
                GPAY • PHONEPE • PAYTM • FAMAPP • BHIM
              </span>
            </div>

            {/* Copy UPI ID Bar */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '8px 10px',
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                borderRadius: '3px',
                marginBottom: '14px',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div className="tiny-label" style={{ color: 'var(--text-secondary, #9CA3AF)', fontSize: '9px' }}>UPI ID</div>
                <div className="mono-data" style={{ color: 'var(--text-primary, #fff)', fontSize: '12px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {upiId}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                data-testid="modal-copy-upi-btn"
                className="tiny-label"
                style={{
                  padding: '6px 10px',
                  borderRadius: '2px',
                  cursor: 'pointer',
                  fontWeight: 700,
                  border: copied ? '1px solid #22c55e' : '1px solid var(--accent-primary, #FF5A00)',
                  background: copied ? 'rgba(34, 197, 94, 0.14)' : 'rgba(255, 90, 0, 0.12)',
                  color: copied ? '#22c55e' : 'var(--accent-primary, #FF5A00)',
                  flexShrink: 0,
                }}
              >
                {copied ? 'COPIED ✓' : 'COPY ID'}
              </button>
            </div>

            {/* Preset Amount Chips + Custom Amount */}
            <div style={{ marginBottom: '14px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginBottom: '6px',
                }}
              >
                <span className="tiny-label" style={{ color: 'var(--text-secondary, #9CA3AF)' }}>
                  SELECT AMOUNT (UPDATES QR & UPI LINK)
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span className="mono-data" style={{ fontSize: '10px', color: 'var(--text-secondary, #9CA3AF)' }}>
                    ₹
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    aria-label="Custom UPI amount in rupees"
                    data-testid="custom-upi-amount-input"
                    placeholder="Custom"
                    value={customInput}
                    onChange={handleCustomAmountChange}
                    className="mono-data"
                    style={{
                      width: '66px',
                      padding: '3px 6px',
                      fontSize: '11px',
                      color: '#fff',
                      background: 'rgba(10, 10, 12, 0.85)',
                      border: customInput
                        ? '1px solid var(--accent-primary, #FF5A00)'
                        : '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                      borderRadius: '2px',
                      outline: 'none',
                    }}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' }}>
                {PRESET_AMOUNTS.map((amt) => {
                  const active = customInput === '' && selectedAmount === amt;
                  return (
                    <button
                      key={amt ?? 'any'}
                      type="button"
                      onClick={() => handlePresetSelect(amt)}
                      className="mono-data"
                      style={{
                        padding: '6px 4px',
                        fontSize: '11px',
                        fontWeight: 700,
                        borderRadius: '2px',
                        cursor: 'pointer',
                        border: active
                          ? '1px solid var(--accent-primary, #FF5A00)'
                          : '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                        background: active ? 'rgba(255, 90, 0, 0.15)' : 'rgba(10, 10, 12, 0.7)',
                        color: active ? '#fff' : 'var(--text-secondary, #9CA3AF)',
                      }}
                    >
                      {amt === null ? 'ANY' : `₹${amt}`}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Mobile Deep Link Action */}
            <a
              href={upiUri}
              data-testid="upi-deep-link"
              className="tiny-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: '100%',
                padding: '10px 14px',
                background: 'var(--accent-primary, #FF5A00)',
                color: '#000',
                fontWeight: 800,
                letterSpacing: '0.1em',
                borderRadius: '2px',
                textDecoration: 'none',
              }}
            >
              {selectedAmount ? `PAY ₹${selectedAmount} VIA UPI APP →` : 'OPEN UPI APP TO DONATE →'}
            </a>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Compact footer banner mounted at the bottom of the main Dashboard page.
 */
export function SupportDonateFooter() {
  const { upiId, payeeName, creatorName } = getDonateConfig();
  const [modalOpen, setModalOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const ok = await copyTextToClipboard(upiId);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [upiId]);

  const upiUri = buildUpiUri(upiId, payeeName, null);

  return (
    <>
      <footer
        aria-label="Support Creator"
        style={{
          margin: '8px 24px 28px',
          padding: '20px 24px',
          background: 'var(--glass-surface-1, rgba(14, 14, 18, 0.78))',
          border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.07))',
          borderRadius: '4px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(255, 90, 0, 0.45), transparent)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '20px',
          }}
        >
          {/* Left Copy */}
          <div style={{ flex: '1 1 280px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span
                className="tiny-label"
                style={{
                  color: 'var(--accent-primary, #FF5A00)',
                  background: 'rgba(255, 90, 0, 0.1)',
                  border: '1px solid rgba(255, 90, 0, 0.35)',
                  padding: '2px 7px',
                  borderRadius: '2px',
                  fontWeight: 700,
                }}
              >
                100% FREE FOREVER
              </span>
              <span className="tiny-label" style={{ color: 'var(--text-secondary, #9CA3AF)' }}>
                BUILT BY {creatorName.toUpperCase()}
              </span>
            </div>

            <h2
              style={{
                margin: '0 0 6px',
                fontSize: '16px',
                fontWeight: 700,
                color: 'var(--text-primary, #fff)',
              }}
            >
              Enjoying Celestial Media Hub? Support via UPI
            </h2>
            <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary, #9CA3AF)' }}>
              No subscriptions, no file paywalls, and no ads. If these tools saved you time, scanning the QR or tipping any amount via UPI helps keep the project alive.
            </p>
          </div>

          {/* Right QR + Controls */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' }}>
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              aria-label="Enlarge UPI QR code"
              style={{
                padding: '6px',
                background: '#09090b',
                border: '1px solid var(--border-stark, #222226)',
                borderRadius: '4px',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Image
                src="/upi-qr.png"
                alt={`Scan UPI QR (${upiId})`}
                width={84}
                height={84}
                unoptimized
                style={{ width: '84px', height: '84px', display: 'block', borderRadius: '2px' }}
              />
            </button>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '210px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  padding: '6px 10px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
                  borderRadius: '3px',
                }}
              >
                <span className="mono-data" style={{ fontSize: '12px', color: '#fff', fontWeight: 600 }}>
                  {upiId}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  data-testid="footer-copy-upi-btn"
                  className="tiny-label"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    fontWeight: 700,
                    color: copied ? '#22c55e' : 'var(--accent-primary, #FF5A00)',
                  }}
                >
                  {copied ? 'COPIED ✓' : 'COPY'}
                </button>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <a
                  href={upiUri}
                  className="tiny-label cel-btn-glow cel-btn-glow-primary"
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '7px 10px',
                    background: 'var(--accent-primary, #FF5A00)',
                    color: '#000',
                    fontWeight: 800,
                    borderRadius: '2px',
                    textDecoration: 'none',
                  }}
                >
                  DONATE UPI ↗
                </a>
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="tiny-label"
                  style={{
                    padding: '7px 10px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid var(--border-subtle, rgba(255,255,255,0.12))',
                    color: 'var(--text-primary, #fff)',
                    fontWeight: 700,
                    borderRadius: '2px',
                    cursor: 'pointer',
                  }}
                >
                  SCAN QR
                </button>
              </div>
            </div>
          </div>
        </div>
      </footer>

      <SupportModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

/**
 * Compact trigger button for the persistent navigation sidebar.
 */
export function SidebarSupportTrigger() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        data-testid="sidebar-donate-btn"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 16px',
          background: 'rgba(255, 90, 0, 0.08)',
          border: 'none',
          borderTop: '1px solid var(--border-subtle, rgba(255,255,255,0.08))',
          color: 'var(--text-primary, #fff)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span className="tiny-label" style={{ color: 'var(--accent-primary, #FF5A00)', fontWeight: 800 }}>
          ♥ SUPPORT // UPI
        </span>
        <span className="tiny-label" style={{ color: 'var(--text-secondary, #9CA3AF)' }}>
          QR ↗
        </span>
      </button>

      <SupportModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
