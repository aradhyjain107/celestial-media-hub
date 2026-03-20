'use client'

import { useState, useRef } from 'react';
import { FileDropzone } from '../../components/ui/FileDropzone';
import { BatchQueue, QueueItem } from '../../components/BatchQueue';

type MuteMode = 'remove' | 'silence';

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function VideoMuter() {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<MuteMode>('remove');
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState('AWAITING PAYLOAD');
  const [processing, setProcessing] = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const handleFilesSelected = (selectedFiles: File[]) => {
    const limited = selectedFiles.slice(0, 20);
    setFiles(limited);
    setQueueItems(
      limited.map(f => ({
        id: f.name + f.size,
        filename: f.name,
        sizeBytes: f.size,
        status: 'pending',
        progress: 0,
      }))
    );
    setProgress(0);
    setStatusLabel('AWAITING PAYLOAD');
  };

  const updateItemStatus = (id: string, status: QueueItem['status'], prog?: number) => {
    setQueueItems(prev =>
      prev.map(item =>
        item.id === id ? { ...item, status, progress: prog ?? item.progress } : item
      )
    );
  };

  const handleInitialize = async () => {
    if (files.length === 0 || processing) return;

    setProcessing(true);
    setProgress(0);
    setStatusLabel('PROCESSING...');
    setQueueItems(prev => prev.map(item => ({ ...item, status: 'processing', progress: 0 })));

    const formData = new FormData();
    formData.append('mode', mode);
    files.forEach(f => formData.append('files', f));

    try {
      const res = await fetch((process.env.NEXT_PUBLIC_API_BASE_URL ?? '') + '/api/mute', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue;
          let payload: any = null;
          try {
            payload = JSON.parse(part.slice(6));
          } catch (_) {
            continue;
          }

          if (typeof payload.progress === 'number') {
            setProgress(payload.progress);
            // Distribute progress proportionally across all items
            setQueueItems(prev =>
              prev.map(item => ({
                ...item,
                progress: payload.progress,
              }))
            );
          }

          if (payload.zipBase64) {
            // All done — mark all items as done
            setQueueItems(prev => prev.map(item => ({ ...item, status: 'done', progress: 100 })));
            setProgress(100);
            setStatusLabel('COMPLETE');

            // Trigger download
            const byteArr = Uint8Array.from(atob(payload.zipBase64), c => c.charCodeAt(0));
            const blob = new Blob([byteArr], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'muted_videos.zip';
            a.click();
            URL.revokeObjectURL(url);
          }

          if (payload.error) {
            throw new Error(payload.error);
          }
        }
      }
    } catch (err: any) {
      setQueueItems(prev => prev.map(item => ({ ...item, status: 'error' })));
      setStatusLabel('ERROR');
    } finally {
      setProcessing(false);
    }
  };

  const handleClear = () => {
    setFiles([]);
    setQueueItems([]);
    setProgress(0);
    setStatusLabel('AWAITING PAYLOAD');
    setProcessing(false);
  };

  const hasFiles = files.length > 0;

  return (
    <>
      {/* Top utility bar */}
      <div className="top-utility-bar grid-line-bottom">
        <div className="left-stats">
          <span className="tiny-label">CELESTIAL //</span>
        </div>
        <div className="right-actions">
          <span className="tiny-label">V. 2.0.0</span>
        </div>
      </div>

      {/* Workspace */}
      <div className="workspace">
        {/* Left: dropzone or batch queue */}
        <div className="dropzone-container">
          <div className="tool-header">
            <div className="tiny-label" style={{ marginBottom: '16px' }}>TARGET // 02</div>
            <h2 className="tool-title">Video<br/>Muter.</h2>
          </div>

          {!hasFiles ? (
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              multiple={true}
              acceptedTypes={['.mov', '.mp4', '.mkv', '.webm']}
              formatsListText="Drop video files to mute. Supports .MOV, .MP4, .MKV, .WebM — up to 20 files."
            />
          ) : (
            <div style={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* File list header */}
              <div
                className="grid-line-bottom"
                style={{ padding: '0 24px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}
              >
                <span className="tiny-label">{files.length} FILE{files.length !== 1 ? 'S' : ''} QUEUED</span>
                <button
                  onClick={handleClear}
                  className="mono-data"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                  disabled={processing}
                  data-testid="clear-btn"
                >
                  CLEAR ×
                </button>
              </div>
              <BatchQueue items={queueItems} />
            </div>
          )}
        </div>

        {/* Right: options panel */}
        <aside className="options-panel grid-line-left">
          <div className="options-header grid-line-bottom">
            <span className="tiny-label">PROCESSING PARAMETERS</span>
          </div>

          <div className="options-scroll">
            {/* Mode selector */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">AUDIO MODE</span>
              </div>

              {/* REMOVE AUDIO option row */}
              <div
                onClick={() => !processing && setMode('remove')}
                data-testid="mode-remove"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 0',
                  cursor: processing ? 'not-allowed' : 'pointer',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    border: `2px solid ${mode === 'remove' ? 'var(--accent)' : 'var(--text-muted)'}`,
                    background: mode === 'remove' ? 'var(--accent)' : 'transparent',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                />
                <span className="mono-data" style={{ fontSize: '12px', color: mode === 'remove' ? 'var(--text-main)' : 'var(--text-muted)' }}>
                  REMOVE AUDIO
                </span>
              </div>

              {/* REPLACE WITH SILENCE option row */}
              <div
                onClick={() => !processing && setMode('silence')}
                data-testid="mode-silence"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 0',
                  cursor: processing ? 'not-allowed' : 'pointer',
                }}
              >
                <div
                  style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    border: `2px solid ${mode === 'silence' ? 'var(--accent)' : 'var(--text-muted)'}`,
                    background: mode === 'silence' ? 'var(--accent)' : 'transparent',
                    flexShrink: 0,
                    transition: 'all 0.15s',
                  }}
                />
                <span className="mono-data" style={{ fontSize: '12px', color: mode === 'silence' ? 'var(--text-main)' : 'var(--text-muted)' }}>
                  REPLACE WITH SILENCE
                </span>
              </div>
            </div>

            {/* File size summary */}
            {hasFiles && (
              <div className="form-group">
                <div className="form-header">
                  <span className="tiny-label">PAYLOAD SUMMARY</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Files</span>
                    <span className="mono-data">{files.length}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Total Size</span>
                    <span className="mono-data">{formatSize(files.reduce((acc, f) => acc + f.size, 0))}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Mode</span>
                    <span className="mono-data" style={{ color: 'var(--accent)' }}>{mode === 'remove' ? 'REMOVE' : 'SILENCE'}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom progress section */}
      <div className="progress-section grid-line-top">
        <button
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!hasFiles || processing}
          data-testid="initialize-btn"
          style={{ opacity: !hasFiles || processing ? 0.5 : 1 }}
        >
          {processing ? 'PROCESSING...' : 'INITIALIZE'}
        </button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusLabel}</span>
            <span className="mono-data" data-testid="queue-count">QUEUE: {files.length} FILE{files.length !== 1 ? 'S' : ''}</span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${progress}%` }} data-testid="progress-fill"></div>
          </div>
        </div>
      </div>
    </>
  );
}
