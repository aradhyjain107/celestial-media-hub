import React from 'react';
import { JobStatus, StatusBadge } from './ui/StatusBadge';

export interface QueueItem {
  id: string;
  filename: string;
  sizeBytes: number;
  status: JobStatus;
  progress: number;
}

export function BatchQueue({ items }: { items: QueueItem[] }) {
  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    // eslint-disable-next-line security/detect-object-injection
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  if (items.length === 0) {
    return (
      <div className="options-scroll" data-testid="batch-queue-empty">
        <div className="tiny-label" style={{ textAlign: 'center', marginTop: '40px' }}>QUEUE EMPTY</div>
      </div>
    );
  }

  return (
    <div className="options-scroll" data-testid="batch-queue">
      {items.map(item => (
        <div key={item.id} className="form-group" style={{ paddingBottom: '16px', borderBottom: '1px solid var(--border)' }}>
          <div className="form-header" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '180px' }}>
              {item.filename}
            </span>
            <StatusBadge status={item.status} />
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="mono-data">{formatSize(item.sizeBytes)}</span>
            <span className="mono-data">{item.progress}%</span>
          </div>
          
          <div className="track" style={{ marginTop: '8px' }}>
            <div className="fill" style={{ width: `${item.progress}%` }}></div>
          </div>
        </div>
      ))}
    </div>
  );
}
