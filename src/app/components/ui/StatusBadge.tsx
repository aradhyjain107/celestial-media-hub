import React from 'react';

export type JobStatus = 'pending' | 'processing' | 'done' | 'complete' | 'error';

export function StatusBadge({ status }: { status: JobStatus | string }) {
  const config: Record<string, { label: string; color: string }> = {
    pending: { label: 'PENDING', color: 'var(--text-muted)' },
    processing: { label: 'PROCESSING', color: 'var(--accent)' },
    done: { label: 'DONE', color: '#10b981' }, 
    complete: { label: 'DONE', color: '#10b981' },
    error: { label: 'ERROR', color: '#ef4444' } 
  };

  // eslint-disable-next-line security/detect-object-injection
  const current = config[status] || { label: String(status).toUpperCase(), color: 'var(--text-muted)' };
  const { label, color } = current;

  return (
    <span 
      data-testid={`badge-${status}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2px 6px',
        border: `1px solid ${color}`,
        color: color,
        fontSize: '9px',
        fontFamily: 'var(--font-mono)',
        borderRadius: '2px',
        letterSpacing: '0.05em',
        flexShrink: 0,
        whiteSpace: 'nowrap',
        userSelect: 'none',
        transition: 'color 150ms cubic-bezier(0.23, 1, 0.32, 1), border-color 150ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms cubic-bezier(0.23, 1, 0.32, 1)'
      }}
    >
      {status === 'processing' && (
        <span 
          className="status-dot-pulse" 
          style={{ width: '4px', height: '4px', borderRadius: '50%', background: color, marginRight: '4px', display: 'inline-block' }} 
        />
      )}
      {label}
    </span>
  );
}
