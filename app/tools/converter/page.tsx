'use client'

import React, { useState, useCallback } from 'react';
import { FileDropzone } from '../../components/ui/FileDropzone';

/* ── Format definitions ── */
const VIDEO_FORMATS = ['mp4', 'mkv', 'mov', 'webm', 'gif'] as const;
const AUDIO_FORMATS = ['mp3', 'wav', 'm4a', 'ogg', 'flac'] as const;
const ALL_FORMATS = [...VIDEO_FORMATS, ...AUDIO_FORMATS] as const;
type OutputFormat = (typeof ALL_FORMATS)[number];

/* ── Preset definitions ── */
const PRESETS = ['whatsapp', 'discord', 'email', 'twitter', 'high'] as const;
type Preset = (typeof PRESETS)[number] | 'custom';

const PRESET_CONFIG: Record<Exclude<Preset, 'custom'>, { resolution: string; quality: string }> = {
  whatsapp: { resolution: '480p', quality: 'fast' },
  discord:  { resolution: '720p', quality: 'medium' },
  email:    { resolution: '480p', quality: 'fast' },
  twitter:  { resolution: '720p', quality: 'medium' },
  high:     { resolution: '1080p', quality: 'slow' },
};

/* ── Speed / Resolution options ── */
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.5, 2, 4] as const;
const RESOLUTION_OPTIONS = ['original', '1080p', '720p', '480p', '360p'] as const;
const GIF_FPS_OPTIONS = [10, 15, 24] as const;

/* ── Styles ── */
const tileStyle = (selected: boolean): React.CSSProperties => ({
  padding: '8px 0',
  textAlign: 'center',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  cursor: 'pointer',
  border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
  background: selected ? 'rgba(255, 90, 0, 0.08)' : 'transparent',
  color: selected ? 'var(--accent)' : 'var(--text-muted)',
  transition: 'all 0.15s ease',
});

const chipStyle = (selected: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 500,
  cursor: 'pointer',
  border: selected ? '1px solid var(--accent)' : '1px solid var(--border)',
  background: selected ? 'rgba(255, 90, 0, 0.08)' : 'transparent',
  color: selected ? 'var(--accent)' : 'var(--text-muted)',
  transition: 'all 0.15s ease',
  whiteSpace: 'nowrap' as const,
});

const checkboxStyle = (checked: boolean): React.CSSProperties => ({
  width: '16px',
  height: '16px',
  border: checked ? '1px solid var(--accent)' : '1px solid var(--text-muted)',
  background: checked ? 'var(--accent)' : 'transparent',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  flexShrink: 0,
  position: 'relative' as const,
});

export default function UniversalConverter() {
  /* ── State ── */
  const [file, setFile] = useState<File | null>(null);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('mp4');
  const [preset, setPreset] = useState<Preset>('high');
  const [speed, setSpeed] = useState(1);
  const [resolution, setResolution] = useState('original');
  const [stripAudio, setStripAudio] = useState(false);
  const [stripMetadata, setStripMetadata] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [gifFps, setGifFps] = useState(15);
  const [gifPalette, setGifPalette] = useState(true);
  const [status, setStatus] = useState<'IDLE' | 'PROCESSING' | 'COMPLETE' | 'ERROR'>('IDLE');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('AWAITING PAYLOAD');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const isAudioFormat = AUDIO_FORMATS.includes(outputFormat as any);
  const isGif = outputFormat === 'gif';

  /* ── Handlers ── */
  const handleFileDrop = useCallback((files: File[]) => {
    if (files.length > 0) {
      setFile(files[0]);
      setStatusText(`LOADED: ${files[0].name}`);
    }
  }, []);

  const handleFormatSelect = useCallback((fmt: OutputFormat) => {
    setOutputFormat(fmt);
    // Reset video-specific options when switching to audio
    if (AUDIO_FORMATS.includes(fmt as any)) {
      setStripAudio(false);
      setResolution('original');
    }
  }, []);

  const handlePresetSelect = useCallback((p: Exclude<Preset, 'custom'>) => {
    setPreset(p);
    const config = PRESET_CONFIG[p];
    setResolution(config.resolution);
  }, []);

  const handleCustomOverride = useCallback((setter: () => void) => {
    setter();
    setPreset('custom');
  }, []);

  const handleInitialize = useCallback(async () => {
    if (!file) return;
    setStatus('PROCESSING');
    setProgress(0);
    setStatusText('INITIALIZING...');
    setDownloadUrl(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('outputFormat', outputFormat);
    formData.append('preset', preset);
    formData.append('speed', String(speed));
    formData.append('resolution', resolution);
    formData.append('stripAudio', String(stripAudio));
    formData.append('stripMetadata', String(stripMetadata));
    if (isGif) {
      formData.append('gifFps', String(gifFps));
      formData.append('gifPalette', String(gifPalette));
    }

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const res = await fetch(`${apiBase}/api/convert`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Conversion failed' }));
        throw new Error(err.error || 'Conversion failed');
      }

      // SSE progress stream
      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.progress !== undefined) {
                    setProgress(data.progress);
                    setStatusText(`CONVERTING... ${Math.round(data.progress)}%`);
                  }
                  if (data.status === 'complete' && data.downloadUrl) {
                    setDownloadUrl(data.downloadUrl);
                    setStatus('COMPLETE');
                    setProgress(100);
                    setStatusText('CONVERSION COMPLETE');
                    // Auto-download
                    const a = document.createElement('a');
                    a.href = data.downloadUrl;
                    a.download = data.filename || `output.${outputFormat}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                  }
                  if (data.status === 'error') {
                    throw new Error(data.error || 'Conversion failed');
                  }
                } catch (parseErr) {
                  // skip non-JSON SSE lines
                }
              }
            }
          }
        }
      } else {
        // Direct download response
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        setDownloadUrl(url);
        setStatus('COMPLETE');
        setProgress(100);
        setStatusText('CONVERSION COMPLETE');
        const a = document.createElement('a');
        a.href = url;
        a.download = `output.${outputFormat}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (err: any) {
      setStatus('ERROR');
      setStatusText(`ERROR: ${err.message}`);
    }
  }, [file, outputFormat, preset, speed, resolution, stripAudio, stripMetadata, isGif, gifFps, gifPalette]);

  /* ── Render ── */
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
        {/* Left: Dropzone */}
        <div className="dropzone-container">
          <div className="tool-header" style={{ padding: '24px', paddingBottom: '48px' }}>
            <div className="tiny-label" style={{ marginBottom: '16px' }}>TARGET // 04</div>
            <h2 className="tool-title" style={{ fontSize: '6vw', fontWeight: 900, lineHeight: 0.85, letterSpacing: '-0.04em', marginLeft: '-4px', textTransform: 'capitalize' }}>
              Universal<br/>Convert.
            </h2>
          </div>

          {file ? (
            <div className="drop-target-area" style={{ flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '80px', height: '80px', border: '1px solid var(--accent)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700,
                }}>
                  {file.name.split('.').pop()?.toUpperCase()}
                </div>
                <span className="mono-data" style={{ color: 'var(--text-main)', fontSize: '13px' }}>{file.name}</span>
                <span className="mono-data">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </div>
              <button
                onClick={() => { setFile(null); setStatusText('AWAITING PAYLOAD'); setStatus('IDLE'); setProgress(0); }}
                style={{
                  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                  padding: '6px 16px', fontFamily: 'var(--font-mono)', fontSize: '11px', cursor: 'pointer',
                }}
                data-testid="clear-file"
              >
                CLEAR
              </button>
            </div>
          ) : (
            <FileDropzone
              onFilesSelected={handleFileDrop}
              multiple={false}
              formatsListText="Drop any video or audio file to convert. Supports MP4, MKV, MOV, WebM, MP3, WAV, FLAC, and more."
            />
          )}
        </div>

        {/* Right: Options panel */}
        <aside className="options-panel grid-line-left">
          <div className="options-header grid-line-bottom">
            <span className="tiny-label">PROCESSING PARAMETERS</span>
          </div>

          <div className="options-scroll">
            {/* ── 1. OUTPUT FORMAT ── */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">OUTPUT FORMAT</span>
                <span className="mono-data">{outputFormat.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }} data-testid="format-grid">
                {ALL_FORMATS.map(fmt => (
                  <div
                    key={fmt}
                    style={tileStyle(outputFormat === fmt)}
                    onClick={() => handleFormatSelect(fmt)}
                    data-testid={`format-${fmt}`}
                    role="button"
                    tabIndex={0}
                  >
                    {fmt.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>

            {/* ── 2. PLATFORM PRESET ── */}
            {!isAudioFormat && (
              <div className="form-group">
                <div className="form-header">
                  <span className="tiny-label">PLATFORM PRESET</span>
                  <span className="mono-data">{preset.toUpperCase()}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }} data-testid="preset-grid">
                  {PRESETS.map(p => (
                    <div
                      key={p}
                      style={tileStyle(preset === p)}
                      onClick={() => handlePresetSelect(p)}
                      data-testid={`preset-${p}`}
                      role="button"
                      tabIndex={0}
                    >
                      {p.toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 3. ADVANCED OPTIONS ── */}
            <div className="form-group">
              <div
                className="form-header"
                style={{ cursor: 'pointer' }}
                onClick={() => setAdvancedOpen(!advancedOpen)}
                data-testid="advanced-toggle"
              >
                <span className="tiny-label">ADVANCED OPTIONS</span>
                <span className="mono-data" style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  ▼
                </span>
              </div>

              {advancedOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} data-testid="advanced-section">
                  {/* Speed */}
                  <div>
                    <span className="tiny-label" style={{ marginBottom: '8px', display: 'block' }}>SPEED</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                      {SPEED_OPTIONS.map(s => (
                        <div
                          key={s}
                          style={chipStyle(speed === s)}
                          onClick={() => handleCustomOverride(() => setSpeed(s))}
                          data-testid={`speed-${s}`}
                          role="button"
                          tabIndex={0}
                        >
                          {s}×
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Resolution — hidden for audio formats */}
                  {!isAudioFormat && (
                    <div>
                      <span className="tiny-label" style={{ marginBottom: '8px', display: 'block' }}>RESOLUTION</span>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {RESOLUTION_OPTIONS.map(r => (
                          <div
                            key={r}
                            style={chipStyle(resolution === r)}
                            onClick={() => handleCustomOverride(() => setResolution(r))}
                            data-testid={`resolution-${r}`}
                            role="button"
                            tabIndex={0}
                          >
                            {r.toUpperCase()}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Strip Audio — hidden for audio formats */}
                  {!isAudioFormat && (
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                      onClick={() => handleCustomOverride(() => setStripAudio(!stripAudio))}
                      data-testid="strip-audio-toggle"
                    >
                      <div style={checkboxStyle(stripAudio)}>
                        {stripAudio && (
                          <span style={{
                            width: '4px', height: '8px',
                            border: 'solid var(--bg)', borderWidth: '0 2px 2px 0',
                            transform: 'rotate(45deg)', marginTop: '-2px',
                          }} />
                        )}
                      </div>
                      <span style={{ fontSize: '13px', fontWeight: 500 }}>Strip Audio</span>
                    </div>
                  )}

                  {/* Strip Metadata */}
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                    onClick={() => handleCustomOverride(() => setStripMetadata(!stripMetadata))}
                    data-testid="strip-metadata-toggle"
                  >
                    <div style={checkboxStyle(stripMetadata)}>
                      {stripMetadata && (
                        <span style={{
                          width: '4px', height: '8px',
                          border: 'solid var(--bg)', borderWidth: '0 2px 2px 0',
                          transform: 'rotate(45deg)', marginTop: '-2px',
                        }} />
                      )}
                    </div>
                    <span style={{ fontSize: '13px', fontWeight: 500 }}>Strip Metadata</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── 4. GIF OPTIONS ── */}
            {isGif && (
              <div className="form-group" data-testid="gif-options">
                <div className="form-header">
                  <span className="tiny-label">GIF OPTIONS</span>
                </div>

                {/* Frame Rate */}
                <div>
                  <span className="tiny-label" style={{ marginBottom: '8px', display: 'block' }}>FRAME RATE</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {GIF_FPS_OPTIONS.map(fps => (
                      <div
                        key={fps}
                        style={chipStyle(gifFps === fps)}
                        onClick={() => setGifFps(fps)}
                        data-testid={`gif-fps-${fps}`}
                        role="button"
                        tabIndex={0}
                      >
                        {fps} FPS
                      </div>
                    ))}
                  </div>
                </div>

                {/* Palette Optimization */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
                  onClick={() => setGifPalette(!gifPalette)}
                  data-testid="gif-palette-toggle"
                >
                  <div style={checkboxStyle(gifPalette)}>
                    {gifPalette && (
                      <span style={{
                        width: '4px', height: '8px',
                        border: 'solid var(--bg)', borderWidth: '0 2px 2px 0',
                        transform: 'rotate(45deg)', marginTop: '-2px',
                      }} />
                    )}
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 500 }}>Palette Optimization</span>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Progress Section */}
      <div className="progress-section grid-line-top">
        <button
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!file || status === 'PROCESSING'}
          data-testid="initialize-btn"
          style={{ opacity: (!file || status === 'PROCESSING') ? 0.5 : 1 }}
        >
          {status === 'PROCESSING' ? 'CONVERTING...' : 'INITIALIZE'}
        </button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusText}</span>
            <span className="mono-data">
              {file ? `FILE: ${file.name}` : 'QUEUE: 0 FILES'}
            </span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${progress}%` }}></div>
          </div>
        </div>
      </div>
    </>
  );
}
