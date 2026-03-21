import React from 'react';

export type JobStatus = 'pending' | 'processing' | 'done' | 'error';

export function StatusBadge({ status }: { status: JobStatus }) {
  const config = {
    pending: { label: 'PENDING', color: 'var(--text-muted)' },
    processing: { label: 'PROCESSING', color: 'var(--accent)' },
    done: { label: 'DONE', color: '#10b981' }, 
    error: { label: 'ERROR', color: '#ef4444' } 
  };

  // eslint-disable-next-line security/detect-object-injection
  const { label, color } = config[status];

  return (
    <span 
      data-testid={`badge-${status}`}
      style={{
        display: 'inline-block',
        padding: '2px 6px',
        border: `1px solid ${color}`,
        color: color,
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        borderRadius: '2px',
        letterSpacing: '0.05em'
      }}
    >
      {label}
    </span>
  );
}
