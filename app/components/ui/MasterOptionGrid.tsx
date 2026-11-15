'use client'

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface OptionItem<T extends string = string> {
  id: T;
  label: string;
  badge?: string;
  testId?: string;
}

export interface MasterOptionGridProps<T extends string = string> {
  options: OptionItem<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  layoutId?: string;
  accentColor?: string;
  testIdPrefix?: string;
}

export function MasterOptionGrid<T extends string = string>({
  options,
  value,
  onChange,
  columns = 2,
  layoutId = 'masterOptionPill',
  accentColor = 'var(--accent)',
  testIdPrefix = 'option'
}: MasterOptionGridProps<T>) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: '8px'
      }}
    >
      {options.map((opt) => {
        const isSelected = value === opt.id;
        const buttonTestId = opt.testId || `${testIdPrefix}-${opt.id.toLowerCase()}`;

        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={isSelected}
            data-testid={buttonTestId}
            onClick={() => onChange(opt.id)}
            style={{
              position: 'relative',
              minHeight: '36px',
              padding: '8px 10px',
              fontSize: '0.6875rem',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              border: 'none',
              background: isSelected ? 'rgba(255, 90, 0, 0.15)' : 'rgba(15, 15, 18, 0.6)',
              color: isSelected ? accentColor : 'var(--text-muted)',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              transition: 'color 150ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms cubic-bezier(0.23, 1, 0.32, 1)',
              boxShadow: isSelected ? '0 0 10px rgba(255, 90, 0, 0.2)' : 'none'
            }}
          >
            {isSelected && (
              <motion.span
                aria-hidden="true"
                layoutId={layoutId}
                transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', duration: 0.3, bounce: 0.15 }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(255, 90, 0, 0.15)',
                  border: `1px solid ${accentColor}`,
                  borderRadius: '4px',
                  boxShadow: '0 0 12px rgba(255, 90, 0, 0.2)'
                }}
              />
            )}
            <span style={{ position: 'relative', zIndex: 1 }}>{opt.label}</span>
            {opt.badge && (
              <span
                style={{
                  position: 'relative',
                  zIndex: 1,
                  fontSize: '0.625rem',
                  padding: '1px 4px',
                  borderRadius: '2px',
                  background: 'rgba(255, 255, 255, 0.1)',
                  color: isSelected ? accentColor : 'var(--text-muted)'
                }}
              >
                {opt.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
