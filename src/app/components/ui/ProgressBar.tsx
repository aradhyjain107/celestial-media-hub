'use client'
import { useEffect, useState } from 'react';

export interface ProgressBarProps {
  sseUrl?: string;
  queueCount?: number;
  manualProgress?: number; 
}

export function ProgressBar({ sseUrl, queueCount = 0, manualProgress = 0 }: ProgressBarProps) {
  const [progress, setProgress] = useState(manualProgress);

  useEffect(() => {
    if (manualProgress !== undefined && !sseUrl) {
      setProgress(manualProgress);
    }
  }, [manualProgress, sseUrl]);

  useEffect(() => {
    if (!sseUrl) return;

    const eventSource = new EventSource(sseUrl);
    
    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (typeof data.progress === 'number') {
          setProgress(data.progress);
        }
        if (data.status === 'done' || data.error) {
          eventSource.close();
        }
      } catch (err) {}
    };

    return () => {
      eventSource.close();
    };
  }, [sseUrl]);

  return (
    <div className="progress-section" data-testid="progress-bar">
      <div className="progress-track-area">
        <div className="progress-meta">
          <span className="tiny-label" data-testid="queue-status">QUEUE: {queueCount} FILES</span>
          <span className="tiny-label" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <span data-testid="progress-text">{progress}</span>%
          </span>
        </div>
        <progress
          className="cel-progress"
          data-testid="progress-fill"
          max={100}
          value={progress}
          aria-label="Job progress"
          aria-valuetext={`${progress}%`}
          style={{
            marginBlockStart: 0,
            ['--progress-bar-fill' as string]: progress >= 100 ? 'var(--success)' : 'var(--accent)',
          }}
        />
      </div>
    </div>
  );
}
