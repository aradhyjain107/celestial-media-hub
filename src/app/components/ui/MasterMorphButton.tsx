'use client'

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface MasterMorphButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  isProcessing?: boolean;
  processingLabel?: string;
  variant?: 'primary' | 'secondary' | 'accentOutline';
  testId?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function MasterMorphButton({
  children,
  onClick,
  disabled = false,
  isProcessing = false,
  processingLabel = 'PROCESSING...',
  variant = 'primary',
  testId = 'action-btn',
  className = '',
  style = {}
}: MasterMorphButtonProps) {
  const isInactive = disabled || isProcessing;
  const shouldReduceMotion = useReducedMotion();
  const canAnimate = !isInactive && !shouldReduceMotion;

  const bgStyle = variant === 'primary'
    ? 'var(--accent)'
    : variant === 'secondary'
      ? 'rgba(255, 255, 255, 0.06)'
      : 'rgba(255, 90, 0, 0.1)';

  const textStyle = variant === 'primary' ? '#000000' : 'var(--text-main)';
  const borderStyle = variant === 'accentOutline' ? '1px solid var(--accent)' : '1px solid transparent';

  return (
    <motion.button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={isInactive}
      whileHover={canAnimate ? { scale: 1.01 } : undefined}
      whileTap={canAnimate ? { scale: 0.97 } : undefined}
      transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
      className={`action-btn ${className}`}
      style={{
        background: bgStyle,
        color: textStyle,
        border: borderStyle,
        cursor: isInactive ? 'not-allowed' : 'pointer',
        opacity: isInactive ? 0.5 : 1,
        boxShadow: !isInactive && variant === 'primary' ? '0 0 16px rgba(255, 90, 0, 0.35)' : 'none',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        transition: 'background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), opacity 150ms cubic-bezier(0.23, 1, 0.32, 1)',
        ...style
      }}
    >
      {isProcessing && (
        <progress className="cel-spinner" aria-label={processingLabel} />
      )}
      <span>{isProcessing ? processingLabel : children}</span>
    </motion.button>
  );
}
