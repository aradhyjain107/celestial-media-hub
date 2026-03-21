'use client'

import React, { useState, useRef } from 'react';
import { StatusBadge, JobStatus } from '../../components/ui/StatusBadge';

interface Track {
  id: string;
  name: string;
  status: JobStatus;
}

const FORMATS = ['mp3', 'm4a', 'wav'] as const;
const QUALITIES = ['128', '192', '256', '320'] as const;

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

export default function SpotifyConverter() {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState('');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<string>('mp3');
  const [quality, setQuality] = useState<string>('128');
  const [status, setStatus] = useState<'IDLE' | 'EXTRACTING' | 'PROCESSING' | 'COMPLETE' | 'ERROR'>('IDLE');
  const [statusText, setStatusText] = useState('AWAITING URL');
  const [progress, setProgress] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  const validateUrl = (input: string) => {
    const regex = /https?:\/\/open\.spotify\.com\/playlist\/[a-zA-Z0-9]+/;
    return regex.test(input.trim());
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {
      // clipboard permission denied
    }
  };

  const handleExtract = async () => {
    if (!validateUrl(url)) {
      setUrlError('Invalid Spotify playlist URL');
      return;
    }
    setUrlError(null);
    setStatus('EXTRACTING');
    setStatusText('EXTRACTING PLAYLIST...');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert?action=extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to extract');
      const { name, tracks: fetchedTracks } = json.playlist;
      setPlaylistName(name);
      const initialTracks: Track[] = fetchedTracks.map((t: any) => ({ id: t.id, name: t.name, status: 'pending' as JobStatus }));
      setTracks(initialTracks);
      setSelectedTrackIds(new Set(initialTracks.map(t => t.id)));
      setStatus('IDLE');
      setStatusText(`${initialTracks.length} TRACKS FOUND`);
    } catch (err: any) {
      setUrlError(err.message);
      setStatus('ERROR');
      setStatusText('EXTRACTION FAILED');
    }
  };

  const toggleSelectAll = (select: boolean) => {
    if (select) setSelectedTrackIds(new Set(tracks.map(t => t.id)));
    else setSelectedTrackIds(new Set());
  };

  const toggleTrackSelection = (id: string) => {
    setSelectedTrackIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) newSet.delete(id);
      else newSet.add(id);
      return newSet;
    });
  };

  const handleInitialize = async () => {
    if (selectedTrackIds.size === 0) return;
    setStatus('PROCESSING');
    setStatusText('CONVERTING...');
    setProgress(0);
    const payload = {
      trackIds: Array.from(selectedTrackIds),
      format,
      quality,
    };
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to start conversion');
      const { jobId } = json;
      const es = new EventSource(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert?jobId=${jobId}`);
      eventSourceRef.current = es;
      const handleMessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        const { trackId, status: trackStatus } = data;
        setTracks(prev =>
          prev.map(t => (t.id === trackId ? { ...t, status: trackStatus } : t))
        );
      };
      es.onmessage = handleMessage;
      if (typeof es.addEventListener === 'function') {
        es.addEventListener('message', handleMessage);
      }
    } catch (err: any) {
      setStatus('ERROR');
      setStatusText(`ERROR: ${err.message}`);
    }
  };

  const handleRetry = async (trackId: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId }),
      });
    } catch {}
  };

  const handleClear = () => {
    setUrl('');
    setUrlError(null);
    setPlaylistName('');
    setTracks([]);
    setSelectedTrackIds(new Set());
    setStatus('IDLE');
    setStatusText('AWAITING URL');
    setProgress(0);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const completedCount = tracks.filter(t => t.status === 'done').length;
  const totalSelected = selectedTrackIds.size;
  const progressPct = totalSelected > 0 ? Math.round((completedCount / totalSelected) * 100) : 0;

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
        {/* Left: URL input area (replaces dropzone) */}
        <div className="dropzone-container" style={{ overflow: 'auto' }}>
          <div className="tool-header">
            <div className="tiny-label" style={{ marginBottom: '16px' }}>TARGET // 07</div>
            <h2 className="tool-title">Spotify<br/>Convert.</h2>
          </div>

          {/* URL Input */}
          <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="PASTE SPOTIFY PLAYLIST URL"
                data-testid="url-input"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${validateUrl(url) ? 'var(--accent)' : 'var(--border)'}`,
                  color: 'var(--text-main)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  padding: '12px 0',
                  outline: 'none',
                  transition: 'border-color 0.2s',
                }}
              />
              <button
                onClick={handlePaste}
                data-testid="paste-btn"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  flexShrink: 0,
                  transition: 'border-color 0.2s',
                }}
                title="Paste from clipboard"
              >
                📋
              </button>
            </div>

            {urlError && (
              <div data-testid="url-error" style={{ color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: '12px' }}>
                {urlError}
              </div>
            )}

            <button
              onClick={handleExtract}
              data-testid="extract-btn"
              style={{
                background: 'transparent',
                border: '1px solid var(--accent)',
                color: 'var(--accent)',
                padding: '10px 16px',
                cursor: 'pointer',
                fontFamily: 'var(--font-mono)',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                transition: 'all 0.2s',
                alignSelf: 'flex-start',
              }}
            >
              EXTRACT PLAYLIST
            </button>

            {/* Playlist info */}
            {playlistName && (
              <div data-testid="playlist-info" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
                <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>{playlistName}</span>
                <span className="mono-data">{tracks.length} tracks</span>
              </div>
            )}

            {/* Track list */}
            {tracks.length > 0 && (
              <div data-testid="track-list" style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '8px' }}>
                  <span className="tiny-label">{selectedTrackIds.size} / {tracks.length} SELECTED</span>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => toggleSelectAll(true)}
                      data-testid="select-all"
                      className="mono-data"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '10px', textTransform: 'uppercase' }}
                    >
                      ALL
                    </button>
                    <button
                      onClick={() => toggleSelectAll(false)}
                      data-testid="deselect-all"
                      className="mono-data"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '10px', textTransform: 'uppercase' }}
                    >
                      NONE
                    </button>
                  </div>
                </div>
                <div style={{ maxHeight: '300px', overflow: 'auto' }}>
                  {tracks.map(track => (
                    <div
                      key={track.id}
                      data-testid={`track-item-${track.id}`}
                      onClick={() => toggleTrackSelection(track.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '8px 0', cursor: 'pointer',
                        borderBottom: '1px solid rgba(42,42,42,0.5)',
                        background: selectedTrackIds.has(track.id) ? 'rgba(255, 90, 0, 0.04)' : 'transparent',
                      }}
                    >
                      <div style={{
                        width: '14px', height: '14px',
                        border: selectedTrackIds.has(track.id) ? '1px solid var(--accent)' : '1px solid var(--text-muted)',
                        background: selectedTrackIds.has(track.id) ? 'var(--accent)' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                      }}>
                        {selectedTrackIds.has(track.id) && (
                          <span style={{
                            width: '3px', height: '6px',
                            border: 'solid var(--bg)', borderWidth: '0 1.5px 1.5px 0',
                            transform: 'rotate(45deg)', marginTop: '-1px',
                          }} />
                        )}
                      </div>
                      <span style={{ fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {track.name}
                      </span>
                      <StatusBadge status={track.status} />
                      {track.status === 'error' && (
                        <button
                          onClick={e => { e.stopPropagation(); handleRetry(track.id); }}
                          data-testid={`retry-${track.id}`}
                          className="mono-data"
                          style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 8px', fontSize: '10px' }}
                        >
                          RETRY
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right: Options panel */}
        <aside className="options-panel grid-line-left">
          <div className="options-header grid-line-bottom">
            <span className="tiny-label">PROCESSING PARAMETERS</span>
          </div>

          <div className="options-scroll">
            {/* FORMAT */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">FORMAT</span>
                <span className="mono-data">{format.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }} data-testid="format-grid">
                {FORMATS.map(f => (
                  <div
                    key={f}
                    style={tileStyle(format === f)}
                    onClick={() => setFormat(f)}
                    data-testid={`format-${f}`}
                    role="button"
                    tabIndex={0}
                  >
                    {f.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>

            {/* QUALITY */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">QUALITY</span>
                <span className="mono-data">{quality} KBPS</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }} data-testid="quality-grid">
                {QUALITIES.map(q => (
                  <div
                    key={q}
                    style={chipStyle(quality === q)}
                    onClick={() => setQuality(q)}
                    data-testid={`quality-${q}`}
                    role="button"
                    tabIndex={0}
                  >
                    {q} KBPS
                  </div>
                ))}
              </div>
            </div>

            {/* Payload summary */}
            {tracks.length > 0 && (
              <div className="form-group">
                <div className="form-header">
                  <span className="tiny-label">PAYLOAD SUMMARY</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Selected</span>
                    <span className="mono-data">{selectedTrackIds.size} tracks</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Format</span>
                    <span className="mono-data" style={{ color: 'var(--accent)' }}>{format.toUpperCase()}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">Quality</span>
                    <span className="mono-data">{quality} KBPS</span>
                  </div>
                </div>
              </div>
            )}

            {/* Clear button */}
            {tracks.length > 0 && (
              <button
                onClick={handleClear}
                className="mono-data"
                data-testid="clear-btn"
                style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px', width: '100%', textAlign: 'center', fontSize: '11px', textTransform: 'uppercase' }}
              >
                CLEAR
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom progress section */}
      <div className="progress-section grid-line-top">
        <button
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={selectedTrackIds.size === 0 || status === 'PROCESSING'}
          data-testid="initialize-btn"
          style={{ opacity: (selectedTrackIds.size === 0 || status === 'PROCESSING') ? 0.5 : 1 }}
        >
          {status === 'PROCESSING' ? 'CONVERTING...' : 'INITIALIZE'}
        </button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusText}</span>
            <span className="mono-data" data-testid="progress-count">
              {totalSelected > 0 ? `${completedCount} / ${totalSelected}` : 'QUEUE: 0 TRACKS'}
            </span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${progressPct}%` }} data-testid="progress-fill"></div>
          </div>
        </div>
      </div>
    </>
  );
}
