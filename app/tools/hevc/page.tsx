'use client'

import { useState } from 'react';
import { FileDropzone } from '../../components/ui/FileDropzone';
import { BatchQueue, QueueItem } from '../../components/BatchQueue';

const PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'] as const;
type Preset = typeof PRESETS[number];

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  // eslint-disable-next-line security/detect-object-injection
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** Estimate compressed size: CRF 28 baseline = 50% reduction, each +1 CRF ≈ 6% smaller, each -1 ≈ 6% larger */
function estimateSize(originalBytes: number, crf: number): number {
  const baseRatio = 0.50; // at CRF 28
  const delta = (crf - 28) * 0.036;
  const ratio = Math.max(0.05, Math.min(0.95, baseRatio + delta));
  return Math.round(originalBytes * ratio);
}

export default function HEVCCompressor() {
  const [files, setFiles] = useState<File[]>([]);
  const [crf, setCrf] = useState(28);
  const [preset, setPreset] = useState<Preset>('fast');
  const [hardwareAccel, setHardwareAccel] = useState(true);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [progress, setProgress] = useState(0);
  const [statusLabel, setStatusLabel] = useState('AWAITING PAYLOAD');
  const [processing, setProcessing] = useState(false);

  const totalOriginal = files.reduce((acc, f) => acc + f.size, 0);
  const totalEstimated = files.reduce((acc, f) => acc + estimateSize(f.size, crf), 0);

  const handleFilesSelected = (selectedFiles: File[]) => {
    const limited = selectedFiles.slice(0, 10);
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

  const handleInitialize = async () => {
    if (files.length === 0 || processing) return;

    setProcessing(true);
    setProgress(0);
    setStatusLabel('PROCESSING...');
    setQueueItems(prev => prev.map(item => ({ ...item, status: 'processing', progress: 0 })));

    const formData = new FormData();
    formData.append('crf', String(crf));
    formData.append('preset', preset);
    formData.append('hardwareAccel', String(hardwareAccel));
    files.forEach(f => formData.append('files', f));

    try {
      const res = await fetch((process.env.NEXT_PUBLIC_API_BASE_URL ?? '') + '/api/hevc', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok || !res.body) throw new Error('Request failed');

      const reader = res.body.getReader();
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
            setQueueItems(prev =>
              prev.map(item => ({ ...item, progress: payload.progress }))
            );
          }

          if (payload.zipBase64) {
            setQueueItems(prev => prev.map(item => ({ ...item, status: 'done', progress: 100 })));
            setProgress(100);
            setStatusLabel('COMPLETE');

            const byteArr = Uint8Array.from(atob(payload.zipBase64), c => c.charCodeAt(0));
            const blob = new Blob([byteArr], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'hevc_compressed.zip';
            a.click();
            URL.revokeObjectURL(url);
          }

          if (payload.error) throw new Error(payload.error);
        }
      }
    } catch {
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
            <div className="tiny-label" style={{ marginBottom: '16px' }}>TARGET // 03</div>
            <h2 className="tool-title">HEVC<br/>Compress.</h2>
          </div>

          {!hasFiles ? (
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              multiple={true}
              acceptedTypes={['.mov', '.mp4', '.mkv']}
              formatsListText="Drop video files for HEVC compression. Supports .MOV, .MP4, .MKV — up to 10 files."
            />
          ) : (
            <div style={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
            {/* CRF slider */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">CRF VALUE</span>
                <span className="mono-data" data-testid="crf-value">{crf}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
                <input
                  type="range"
                  min={18}
                  max={35}
                  value={crf}
                  onChange={e => setCrf(Number(e.target.value))}
                  disabled={processing}
                  data-testid="crf-slider"
                  style={{
                    width: '100%',
                    accentColor: 'var(--accent)',
                    cursor: processing ? 'not-allowed' : 'pointer',
                  }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="mono-data">18 (quality)</span>
                  <span className="mono-data">35 (smallest)</span>
                </div>
              </div>
            </div>

            {/* Preset selector */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">ENCODING PRESET</span>
              </div>
              <select
                className="custom-select"
                value={preset}
                onChange={e => setPreset(e.target.value as Preset)}
                disabled={processing}
                data-testid="preset-select"
              >
                {PRESETS.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>

            {/* Hardware accel checkbox */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">ACCELERATION</span>
              </div>
              <div
                className="checkbox-group"
                onClick={() => !processing && setHardwareAccel(v => !v)}
                data-testid="hw-accel-toggle"
                style={{ cursor: processing ? 'not-allowed' : 'pointer', paddingTop: '4px' }}
              >
                <div className={`checkbox${hardwareAccel ? ' checked' : ''}`} />
                <span className="checkbox-label">Use VideoToolbox (macOS)</span>
              </div>
            </div>

            {/* Size estimate — only shown after file drop */}
            {hasFiles && (
              <div className="form-group">
                <div className="form-header">
                  <span className="tiny-label">SIZE ESTIMATE</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Original</span>
                    <span className="mono-data">{formatSize(totalOriginal)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Estimated output</span>
                    <span className="mono-data" style={{ color: 'var(--accent)' }} data-testid="estimated-size">
                      {formatSize(totalEstimated)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Reduction</span>
                    <span className="mono-data">
                      {totalOriginal > 0 ? `~${Math.round((1 - totalEstimated / totalOriginal) * 100)}%` : '—'}
                    </span>
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
