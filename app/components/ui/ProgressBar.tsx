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
          <span className="tiny-label"><span data-testid="progress-text">{progress}</span>%</span>
        </div>
        <div className="track">
          <div className="fill" style={{ width: `${progress}%` }} data-testid="progress-fill"></div>
        </div>
      </div>
    </div>
  );
}
