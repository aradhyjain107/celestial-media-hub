import React from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { JobStatus, StatusBadge } from './ui/StatusBadge';

export interface QueueItem {
  id: string;
  filename: string;
  sizeBytes: number;
  status: JobStatus;
  progress: number;
}

export function BatchQueue({ items }: { items: QueueItem[] }) {
  const shouldReduceMotion = useReducedMotion();

  const formatSize = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
    // eslint-disable-next-line security/detect-object-injection
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const splitFilename = (name: string) => {
    const extIndex = name.lastIndexOf('.');
    const hasExt = extIndex > 0 && extIndex > name.length - 8;
    return {
      stem: hasExt ? name.slice(0, extIndex) : name,
      ext: hasExt ? name.slice(extIndex) : '',
    };
  };

  if (items.length === 0) {
    return (
      <div className="options-scroll" data-testid="batch-queue-empty">
        <div className="tiny-label" style={{ textAlign: 'center', marginTop: '40px' }}>QUEUE EMPTY</div>
      </div>
    );
  }

  return (
    <div className="options-scroll" style={{ gap: '12px' }} data-testid="batch-queue">
      <AnimatePresence mode="popLayout">
        {items.map((item, index) => {
          const clampedProgress = Number.isFinite(item.progress) ? Math.min(100, Math.max(0, Math.round(item.progress))) : 0;
          return (
            <motion.div 
              key={item.id} 
              layout={!shouldReduceMotion}
              initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 16 }}
              animate={{ 
                opacity: 1, 
                x: 0,
                transition: { duration: 0.2, delay: shouldReduceMotion ? 0 : index * 0.04, ease: [0.23, 1, 0.32, 1] }
              }}
              exit={{ 
                opacity: 0, 
                x: shouldReduceMotion ? 0 : -12,
                transition: { duration: 0.15, ease: [0.23, 1, 0.32, 1] }
              }}
              className="form-group glass-panel" 
              style={{ padding: '12px', borderRadius: '4px', borderBottom: '1px solid var(--border)' }}
            >
              <div className="form-header" style={{ borderBottom: 'none', paddingBottom: 0, gap: '8px', minWidth: 0 }}>
                {(() => {
                  const { stem, ext } = splitFilename(item.filename);
                  return (
                    <span
                      title={item.filename}
                      dir="auto"
                      className="filename-truncate"
                      style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', flex: 1, minWidth: 0 }}
                    >
                      <span className="filename-stem">{stem}</span>
                      {ext && <span className="filename-ext">{ext}</span>}
                    </span>
                  );
                })()}
                <StatusBadge status={item.status} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                <span className="mono-data" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatSize(item.sizeBytes)}</span>
                <span className="mono-data" style={{ fontVariantNumeric: 'tabular-nums' }}>{clampedProgress}%</span>
              </div>

              <progress
                className="cel-progress"
                max={100}
                value={item.status === 'processing' && clampedProgress === 0 ? undefined : clampedProgress}
                aria-label={`${item.filename} progress`}
                aria-valuetext={item.status === 'processing' && clampedProgress === 0 ? 'Processing' : `${clampedProgress}%`}
                style={{
                  marginBlockStart: '8px',
                  ['--progress-bar-fill' as string]: clampedProgress >= 100 ? 'var(--success)' : 'var(--accent)',
                }}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

