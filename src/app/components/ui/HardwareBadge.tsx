'use client';

import React, { useEffect, useState } from 'react';
import { getClientHardwareProfile, HardwareProfile } from '../../../lib/hardwareProfiler';
import { useHardwareProfile } from '../../context/GlobalJobContext';
import { motion, useReducedMotion } from 'framer-motion';
import { TooltipBottom } from './Tooltip';

export function HardwareBadge() {
  const [mounted, setMounted] = useState(false);
  const globalProfile = useHardwareProfile();
  const [localProfile, setLocalProfile] = useState<HardwareProfile | null>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    setMounted(true);
    setLocalProfile(getClientHardwareProfile());
  }, []);

  const profile = globalProfile || localProfile;
  if (!mounted || !profile) return null;

  const isUltra = profile.tier === 'TIER_1_ULTRA';
  const isPro = profile.tier === 'TIER_2_PRO';
  const isSafe = profile.tier === 'TIER_3_SAFE' || profile.tier === 'TIER_4_ENTRY';

  const badgeColor = isUltra
    ? 'var(--accent-primary, #FF5A00)'
    : (isPro ? 'var(--status-online, #22c55e)' : (isSafe ? 'var(--status-warning, #f59e0b)' : 'var(--status-online, #22c55e)'));
  const badgeBg = isUltra
    ? 'var(--accent-subtle, rgba(255, 90, 0, 0.08))'
    : (isPro ? 'rgba(34, 197, 94, 0.08)' : (isSafe ? 'rgba(245, 158, 11, 0.08)' : 'rgba(34, 197, 94, 0.08)'));
  const borderColor = isUltra
    ? 'var(--border-active, rgba(255, 90, 0, 0.25))'
    : (isPro ? 'rgba(34, 197, 94, 0.25)' : (isSafe ? 'rgba(245, 158, 11, 0.25)' : 'rgba(34, 197, 94, 0.25)'));

  const photoLimit = profile.mediaLimits?.photo ?? (profile.maxBatchFiles * 5);
  const audioLimit = profile.mediaLimits?.audio ?? (profile.maxBatchFiles * 2);
  const videoLimit = profile.mediaLimits?.videoRemux ?? Math.floor(profile.maxBatchFiles * 0.5);

  const titleText = profile.cpuModel
    ? `Precision Host Profile: ${profile.cpuModel} | ${profile.cores} Cores | ${profile.memoryGB} GB RAM | Batch Limits: ${photoLimit} Photos • ${audioLimit} Audio • ${videoLimit} Videos`
    : `Client Profile: ${profile.cores} Cores | ${profile.memoryGB} GB RAM | Max Batch: ${profile.maxBatchFiles} Files`;

  return (
    <TooltipBottom content={titleText}>
      <motion.button
        type="button"
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
        data-testid="hardware-badge"
        title={titleText}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 8px',
          minHeight: '24px',
          borderRadius: '3px',
          border: `1px solid ${borderColor}`,
          background: badgeBg,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '0.625rem',
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: badgeColor,
          lineHeight: 1,
          verticalAlign: 'middle',
          whiteSpace: 'nowrap',
          cursor: 'help',
        }}
      >
        <span aria-hidden="true" style={{ width: '6px', height: '6px', borderRadius: '50%', background: badgeColor, boxShadow: `0 0 6px ${badgeColor}` }} />
        <span>
          {isUltra
            ? `HW: ULTRA (${profile.cores}C/${profile.memoryGB}GB)`
            : (isPro
              ? `HW: PRO (${profile.cores}C/${profile.memoryGB}GB)`
              : (isSafe
                ? `HW: SAFE MODE (${profile.cores}C)`
                : `HW: BALANCED (${profile.cores}C/${profile.memoryGB}GB)`))}
        </span>
      </motion.button>
    </TooltipBottom>
  );
}

