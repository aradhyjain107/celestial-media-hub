'use client'

import React, { useState, useEffect, useRef } from 'react';
import { StatusBadge, JobStatus } from '../../components/ui/StatusBadge';

interface Track {
  id: string;
  name: string;
  status: JobStatus;
}

export default function SpotifyConverter() {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState<string>('');
  const [trackCount, setTrackCount] = useState<number>(0);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<string>('mp3');
  const [quality, setQuality] = useState<string>('128');
  const [jobId, setJobId] = useState<string>('');
  const eventSourceRef = useRef<EventSource | null>(null);

  const reset = () => {
    setUrl('');
    setUrlError(null);
    setPlaylistName('');
    setTrackCount(0);
    setTracks([]);
    setSelectedTrackIds(new Set());
    setJobId('');
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  };

  const validateUrl = (input: string) => {
    const regex = /https?:\/\/open\.spotify\.com\/playlist\/[a-zA-Z0-9]+/;
    return regex.test(input.trim());
  };

  const handleExtract = async () => {
    if (!validateUrl(url)) {
      setUrlError('Invalid Spotify playlist URL');
      return;
    }
    setUrlError(null);
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
      setTrackCount(fetchedTracks.length);
      const initialTracks: Track[] = fetchedTracks.map((t: any) => ({ id: t.id, name: t.name, status: 'pending' }));
      setTracks(initialTracks);
      setSelectedTrackIds(new Set(initialTracks.map(t => t.id)));
    } catch (err: any) {
      setUrlError(err.message);
    }
  };

  const toggleSelectAll = (select: boolean) => {
    if (select) {
      setSelectedTrackIds(new Set(tracks.map(t => t.id)));
    } else {
      setSelectedTrackIds(new Set());
    }
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
      setJobId(jobId);
      // Open SSE stream
      const es = new EventSource(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert?jobId=${jobId}`);
      eventSourceRef.current = es;
      const handleMessage = (e: MessageEvent) => {
        const data = JSON.parse(e.data);
        const { trackId, status } = data; // status: 'processing' | 'done' | 'error'
        setTracks(prev =>
          prev.map(t => (t.id === trackId ? { ...t, status } : t))
        );
      };
      // Support both onmessage property and addEventListener for compatibility with mocks
      es.onmessage = handleMessage;
      if (typeof es.addEventListener === 'function') {
        es.addEventListener('message', handleMessage);
      }
    } catch (err: any) {
      // handle error
    }
  };

  const handleRetry = async (trackId: string) => {
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackId }),
      });
      // After retry, status will be updated via SSE
    } catch {}
  };

  const completedCount = tracks.filter(t => t.status === 'done').length;
  const totalSelected = selectedTrackIds.size;

  const allDone = totalSelected > 0 && completedCount === totalSelected;

  return (
    <>
      <div className="top-utility-bar grid-line-bottom">
        <div className="left-stats">
          <span className="tiny-label">CELESTIAL //</span>
        </div>
        <div className="right-actions">
          <span className="tiny-label">V. 2.0.0</span>
        </div>
      </div>

      <div className="workspace">
        {/* URL Input Section */}
        <div className="url-section">
          <input
            type="text"
            placeholder="Spotify playlist URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
            data-testid="url-input"
            className="action-input"
          />
          <button
            onClick={async () => {
              const text = await navigator.clipboard.readText();
              setUrl(text);
            }}
            data-testid="paste-btn"
            className="action-btn"
          >
            Paste from Clipboard
          </button>
          <button onClick={handleExtract} data-testid="extract-btn" className="action-btn">
            Extract
          </button>
          {urlError && <div className="error-msg" data-testid="url-error">{urlError}</div>}
        </div>

        {/* Playlist Info */}
        {playlistName && (
          <div className="playlist-info" data-testid="playlist-info">
            <h2>{playlistName}</h2>
            <p>{trackCount} tracks</p>
          </div>
        )}

        {/* Options Panel — always visible */}
        <aside className="options-panel grid-line-left">
          <div className="options-header grid-line-bottom">
            <span className="tiny-label">OPTIONS</span>
          </div>
          <div className="options-section">
            <div className="format-tiles">
              {['mp3', 'm4a', 'wav'].map(f => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  data-testid={`format-${f}`}
                  className={`format-tile ${format === f ? 'selected' : ''}`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="quality-chips">
              {['128', '192', '256', '320'].map(q => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  data-testid={`quality-${q}`}
                  className={`quality-chip ${quality === q ? 'selected' : ''}`}
                >
                  {q} kbps
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Track List */}
        {tracks.length > 0 && (
          <div className="track-list" data-testid="track-list">
            <div className="selection-controls">
              <button onClick={() => toggleSelectAll(true)} data-testid="select-all" className="action-btn">
                SELECT ALL
              </button>
              <button onClick={() => toggleSelectAll(false)} data-testid="deselect-all" className="action-btn">
                DESELECT ALL
              </button>
            </div>
            {tracks.map(track => (
              <div key={track.id} className="track-item" data-testid={`track-item-${track.id}`}>
                <input
                  type="checkbox"
                  checked={selectedTrackIds.has(track.id)}
                  onChange={() => toggleTrackSelection(track.id)}
                  data-testid={`track-checkbox-${track.id}`}
                />
                <span className="track-name">{track.name}</span>
                <StatusBadge status={track.status as JobStatus} />
                {track.status === 'error' && (
                  <button onClick={() => handleRetry(track.id)} data-testid={`retry-${track.id}`} className="action-btn">
                    RETRY
                  </button>
                )}
              </div>
            ))}
            <button onClick={handleInitialize} data-testid="initialize-btn" className="action-btn">
              Initialize Conversion
            </button>
          </div>
        )}

        {/* Progress Bar */}
        {totalSelected > 0 && (
          <div className="progress-section grid-line-top" data-testid="progress-section">
            <div className="progress-meta">
              <span className="tiny-label">PROGRESS</span>
              <span className="mono-data" data-testid="progress-count">
                {completedCount} / {totalSelected}
              </span>
            </div>
            <div className="track">
              <div
                className="fill"
                style={{ width: `${(completedCount / totalSelected) * 100}%` }}
                data-testid="progress-fill"
              />
            </div>
          </div>
        )}

        {/* Download All */}
        {allDone && (
          <button onClick={() => {/* trigger download logic */}} data-testid="download-all" className="action-btn">
            DOWNLOAD ALL
          </button>
        )}
      </div>
    </>
  );
}
