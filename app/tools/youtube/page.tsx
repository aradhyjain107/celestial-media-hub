'use client'

import React, { useState, useCallback, useEffect, useRef } from 'react';

/* ── Format / Quality definitions ── */
const FORMATS = ['mp3', 'm4a', 'wav', 'mp4'] as const;
type Format = (typeof FORMATS)[number];

const AUDIO_QUALITIES = ['128', '192', '256', '320'] as const;
const VIDEO_QUALITIES = ['1080p', '720p', '480p'] as const;

interface VideoInfo {
  title: string;
  thumbnail: string;
  duration: string;
}

interface PlaylistTrack {
  index: number;
  title: string;
  duration: string;
  selected: boolean;
}

interface HistoryEntry {
  title: string;
  format: string;
  date: string;
  size: string;
}

const HISTORY_KEY = 'celestial-yt-history';

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

/* ── URL validation ── */
function isValidYouTubeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.includes('youtube.com') ||
      parsed.hostname.includes('youtu.be') ||
      parsed.hostname.includes('youtube-nocookie.com')
    );
  } catch {
    return false;
  }
}

export default function YouTubeDownloader() {
  /* ── State ── */
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<Format>('mp3');
  const [quality, setQuality] = useState('320');
  const [isPlaylist, setIsPlaylist] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>([]);
  const [status, setStatus] = useState<'IDLE' | 'FETCHING' | 'DOWNLOADING' | 'COMPLETE' | 'ERROR'>('IDLE');
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('AWAITING URL');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAudioFormat = format !== 'mp4';
  const qualities = isAudioFormat ? AUDIO_QUALITIES : VIDEO_QUALITIES;

  /* ── Load history from localStorage ── */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch {
      // ignore
    }
  }, []);

  const addToHistory = useCallback((entry: HistoryEntry) => {
    setHistory(prev => {
      const next = [entry, ...prev].slice(0, 10);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(HISTORY_KEY);
  }, []);

  /* ── Ensure quality is valid when format changes ── */
  useEffect(() => {
    if (isAudioFormat && !AUDIO_QUALITIES.includes(quality as any)) {
      setQuality('320');
    } else if (!isAudioFormat && !VIDEO_QUALITIES.includes(quality as any)) {
      setQuality('1080p');
    }
  }, [format, isAudioFormat, quality]);

  /* ── Fetch video info on valid URL ── */
  const fetchInfo = useCallback(async (inputUrl: string) => {
    if (!isValidYouTubeUrl(inputUrl)) return;
    
    setStatus('FETCHING');
    setStatusText('FETCHING VIDEO INFO...');
    setVideoInfo(null);
    setTracks([]);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const action = isPlaylist ? 'playlist-info' : 'info';
      const res = await fetch(`${apiBase}/api/youtube?action=${action}&url=${encodeURIComponent(inputUrl)}`);

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch info' }));
        throw new Error(err.error || 'Failed to fetch info');
      }

      const data = await res.json();

      if (isPlaylist && data.tracks) {
        setTracks(data.tracks.map((t: any, i: number) => ({
          index: i,
          title: t.title,
          duration: t.duration,
          selected: true,
        })));
        setVideoInfo({ title: data.title || 'Playlist', thumbnail: data.thumbnail || '', duration: `${data.tracks.length} tracks` });
      } else {
        setVideoInfo({
          title: data.title,
          thumbnail: data.thumbnail || '',
          duration: data.duration,
        });
      }

      setStatus('IDLE');
      setStatusText('READY');
    } catch (err: any) {
      setStatus('ERROR');
      setStatusText(`ERROR: ${err.message}`);
    }
  }, [isPlaylist]);

  /* ── Debounced URL input ── */
  const handleUrlChange = useCallback((value: string) => {
    setUrl(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (isValidYouTubeUrl(value)) {
        fetchInfo(value);
      }
    }, 800);
  }, [fetchInfo]);

  /* ── Paste from clipboard ── */
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
      if (isValidYouTubeUrl(text)) {
        fetchInfo(text);
      }
    } catch {
      // clipboard permission denied
    }
  }, [fetchInfo]);

  /* ── Toggle track selection ── */
  const toggleTrack = useCallback((index: number) => {
    setTracks(prev => prev.map(t =>
      t.index === index ? { ...t, selected: !t.selected } : t
    ));
  }, []);

  /* ── Initialize download ── */
  const handleInitialize = useCallback(async () => {
    if (!url || !isValidYouTubeUrl(url)) return;
    setStatus('DOWNLOADING');
    setProgress(0);
    setStatusText('INITIALIZING DOWNLOAD...');

    const selectedIndices = isPlaylist ? tracks.filter(t => t.selected).map(t => t.index) : undefined;

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const res = await fetch(`${apiBase}/api/youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          format,
          quality,
          isPlaylist,
          selectedIndices,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        throw new Error(err.error || 'Download failed');
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
                    setStatusText(`DOWNLOADING... ${Math.round(data.progress)}%`);
                  }
                  if (data.status === 'complete' && data.downloadUrl) {
                    setStatus('COMPLETE');
                    setProgress(100);
                    setStatusText('DOWNLOAD COMPLETE');
                    // Auto-download
                    const a = document.createElement('a');
                    a.href = data.downloadUrl;
                    a.download = data.filename || `download.${format}`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    // Add to history
                    addToHistory({
                      title: videoInfo?.title || data.filename || 'Unknown',
                      format: format.toUpperCase(),
                      date: new Date().toLocaleDateString(),
                      size: data.fileSize || '—',
                    });
                  }
                  if (data.status === 'error') {
                    throw new Error(data.error || 'Download failed');
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
        const downloadUrl = URL.createObjectURL(blob);
        setStatus('COMPLETE');
        setProgress(100);
        setStatusText('DOWNLOAD COMPLETE');
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `download.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        addToHistory({
          title: videoInfo?.title || 'Unknown',
          format: format.toUpperCase(),
          date: new Date().toLocaleDateString(),
          size: `${(blob.size / 1024 / 1024).toFixed(1)} MB`,
        });
      }
    } catch (err: any) {
      setStatus('ERROR');
      setStatusText(`ERROR: ${err.message}`);
    }
  }, [url, format, quality, isPlaylist, tracks, videoInfo, addToHistory]);

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
        {/* Left: URL input area (replaces dropzone) */}
        <div className="dropzone-container" style={{ overflow: 'auto' }}>
          <div className="tool-header" style={{ padding: '24px', paddingBottom: '48px' }}>
            <div className="tiny-label" style={{ marginBottom: '16px' }}>TARGET // 05</div>
            <h2 className="tool-title" style={{ fontSize: '6vw', fontWeight: 900, lineHeight: 0.85, letterSpacing: '-0.04em', marginLeft: '-4px', textTransform: 'capitalize' }}>
              YouTube<br/>Download.
            </h2>
          </div>

          {/* URL Input */}
          <div style={{ padding: '0 24px 24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1 }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <input
                type="text"
                value={url}
                onChange={e => handleUrlChange(e.target.value)}
                placeholder="PASTE YOUTUBE URL"
                data-testid="url-input"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  borderBottom: `1px solid ${isValidYouTubeUrl(url) ? 'var(--accent)' : 'var(--border)'}`,
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

            {/* Video info display */}
            {videoInfo && (
              <div style={{ display: 'flex', gap: '16px', padding: '16px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }} data-testid="video-info">
                {videoInfo.thumbnail && (
                  <img
                    src={videoInfo.thumbnail}
                    alt={videoInfo.title}
                    style={{ width: '120px', height: '68px', objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
                  />
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {videoInfo.title}
                  </span>
                  <span className="mono-data">{videoInfo.duration}</span>
                </div>
              </div>
            )}

            {/* Playlist mode toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="tiny-label">PLAYLIST MODE</span>
              <div
                onClick={() => { setIsPlaylist(!isPlaylist); if (url && isValidYouTubeUrl(url)) fetchInfo(url); }}
                data-testid="playlist-toggle"
                style={{
                  width: '36px', height: '20px',
                  borderRadius: '10px',
                  background: isPlaylist ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer',
                  position: 'relative',
                  transition: 'background 0.2s',
                }}
              >
                <div style={{
                  width: '16px', height: '16px',
                  borderRadius: '50%',
                  background: '#fff',
                  position: 'absolute',
                  top: '2px',
                  left: isPlaylist ? '18px' : '2px',
                  transition: 'left 0.2s',
                }} />
              </div>
            </div>

            {/* Playlist tracks */}
            {isPlaylist && tracks.length > 0 && (
              <div style={{ maxHeight: '200px', overflow: 'auto', border: '1px solid var(--border)' }} data-testid="track-list">
                {tracks.map(track => (
                  <div
                    key={track.index}
                    onClick={() => toggleTrack(track.index)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '12px',
                      padding: '8px 12px', cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      background: track.selected ? 'rgba(255, 90, 0, 0.04)' : 'transparent',
                    }}
                  >
                    <div style={{
                      width: '14px', height: '14px',
                      border: track.selected ? '1px solid var(--accent)' : '1px solid var(--text-muted)',
                      background: track.selected ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                    }}>
                      {track.selected && (
                        <span style={{
                          width: '3px', height: '6px',
                          border: 'solid var(--bg)', borderWidth: '0 1.5px 1.5px 0',
                          transform: 'rotate(45deg)', marginTop: '-1px',
                        }} />
                      )}
                    </div>
                    <span className="mono-data" style={{ width: '24px', flexShrink: 0 }}>
                      {String(track.index + 1).padStart(2, '0')}
                    </span>
                    <span style={{ fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {track.title}
                    </span>
                    <span className="mono-data">{track.duration}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Download History */}
            {history.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="download-history">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                  <span className="tiny-label">DOWNLOAD HISTORY</span>
                  <button
                    onClick={clearHistory}
                    data-testid="clear-history-btn"
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                      fontSize: '10px', cursor: 'pointer', textTransform: 'uppercase',
                    }}
                  >
                    CLEAR
                  </button>
                </div>
                {history.map((entry, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(42,42,42,0.5)' }}>
                    <span style={{ fontSize: '12px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '8px' }}>
                      {entry.title}
                    </span>
                    <span className="mono-data" style={{ flexShrink: 0, marginRight: '12px' }}>{entry.format}</span>
                    <span className="mono-data" style={{ flexShrink: 0, marginRight: '12px' }}>{entry.date}</span>
                    <span className="mono-data" style={{ flexShrink: 0 }}>{entry.size}</span>
                  </div>
                ))}
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
            {/* ── FORMAT ── */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">FORMAT</span>
                <span className="mono-data">{format.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }} data-testid="format-grid">
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

            {/* ── QUALITY ── */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">QUALITY</span>
                <span className="mono-data">{quality.toUpperCase()}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }} data-testid="quality-grid">
                {qualities.map(q => (
                  <div
                    key={q}
                    style={chipStyle(quality === q)}
                    onClick={() => setQuality(q)}
                    data-testid={`quality-${q}`}
                    role="button"
                    tabIndex={0}
                  >
                    {isAudioFormat ? `${q} KBPS` : q.toUpperCase()}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Progress Section */}
      <div className="progress-section grid-line-top">
        <button
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!url || !isValidYouTubeUrl(url) || status === 'DOWNLOADING'}
          data-testid="initialize-btn"
          style={{ opacity: (!url || !isValidYouTubeUrl(url) || status === 'DOWNLOADING') ? 0.5 : 1 }}
        >
          {status === 'DOWNLOADING' ? 'DOWNLOADING...' : 'INITIALIZE'}
        </button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusText}</span>
            <span className="mono-data">
              {videoInfo ? `TARGET: ${videoInfo.title.slice(0, 30)}` : 'QUEUE: 0 FILES'}
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
