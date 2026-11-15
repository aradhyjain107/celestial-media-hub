'use client'

import React from 'react';
import { motion } from 'framer-motion';
import { useCursorGlowHandlers } from '../../../lib/useCursorGlow';

export interface MasterGlassCardProps {
  children: React.ReactNode;
  variant?: 'surface1' | 'surface2' | 'surface3';
  className?: string;
  style?: React.CSSProperties;
  enableSpotlight?: boolean;
  enableSpecularBorder?: boolean;
  testId?: string;
}

export function MasterGlassCard({
  children,
  variant = 'surface1',
  className = '',
  style = {},
  enableSpotlight = true,
  enableSpecularBorder = true,
  testId
}: MasterGlassCardProps) {
  const glowHandlers = useCursorGlowHandlers<HTMLDivElement>(enableSpotlight);

  const bgStyle = variant === 'surface3' 
    ? 'rgba(26, 26, 32, 0.85)' 
    : variant === 'surface2' 
      ? 'rgba(18, 18, 21, 0.75)' 
      : 'rgba(9, 9, 11, 0.65)';

  const blurStyle = variant === 'surface3' ? '24px' : variant === 'surface2' ? '16px' : '8px';

  return (
    <motion.div
      data-testid={testId}
      className={`master-glass-card ${enableSpotlight ? 'cel-glow-host' : ''} ${className}`.trim()}
      {...(enableSpotlight ? glowHandlers : {})}
      style={{
        position: 'relative',
        background: bgStyle,
        backdropFilter: `blur(${blurStyle})`,
        WebkitBackdropFilter: `blur(${blurStyle})`,
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: '6px',
        overflow: 'hidden',
        ...style
      }}
    >
      {/* Specular Top Edge Line */}
      {enableSpecularBorder && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '1px',
            background: 'linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.18) 50%, transparent 100%)',
            pointerEvents: 'none',
            zIndex: 2
          }}
        />
      )}

      {/* Dynamic Cursor Spotlight Glow via CSS custom properties */}
      {enableSpotlight && (
        <div
          aria-hidden="true"
          className="cel-glow-layer"
          style={{
            '--cel-glow-size': '400px',
            '--cel-glow-alpha': '0.12',
          } as React.CSSProperties}
        />
      )}

      {/* Card Content */}
      <div style={{ position: 'relative', zIndex: 3 }}>
        {children}
      </div>
    </motion.div>
  );
}
