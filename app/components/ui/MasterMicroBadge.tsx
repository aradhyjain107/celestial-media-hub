'use client'

import React from 'react';

export interface MasterMicroBadgeProps {
  label: string;
  variant?: 'accent' | 'emerald' | 'amber' | 'crimson' | 'muted';
  style?: React.CSSProperties;
  testId?: string;
}

export function MasterMicroBadge({
  label,
  variant = 'accent',
  style = {},
  testId
}: MasterMicroBadgeProps) {
  const colorMap = {
    accent: {
      color: 'var(--accent)',
      border: 'rgba(255, 90, 0, 0.4)',
      bg: 'rgba(255, 90, 0, 0.1)'
    },
    emerald: {
      color: '#10b981',
      border: 'rgba(16, 185, 129, 0.4)',
      bg: 'rgba(16, 185, 129, 0.1)'
    },
    amber: {
      color: '#f59e0b',
      border: 'rgba(245, 158, 11, 0.4)',
      bg: 'rgba(245, 158, 11, 0.1)'
    },
    crimson: {
      color: '#ef4444',
      border: 'rgba(239, 68, 68, 0.4)',
      bg: 'rgba(239, 68, 68, 0.1)'
    },
    muted: {
      color: 'var(--text-muted)',
      border: 'rgba(255, 255, 255, 0.1)',
      bg: 'rgba(255, 255, 255, 0.04)'
    }
  };

  // eslint-disable-next-line security/detect-object-injection
  const scheme = colorMap[variant];

  return (
    <span
      data-testid={testId}
      style={{
        fontSize: '9px',
        fontWeight: 700,
        fontFamily: 'var(--font-mono)',
        padding: '2px 7px',
        borderRadius: '2px',
        border: `1px solid ${scheme.border}`,
        color: scheme.color,
        background: scheme.bg,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        ...style
      }}
    >
      {label}
    </span>
  );
}
