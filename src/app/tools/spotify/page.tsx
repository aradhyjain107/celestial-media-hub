'use client'

import React, { useState, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { StatusBadge, JobStatus } from '../../components/ui/StatusBadge';
import { ResizableOptionsPanel } from '../../components/ui/ResizableOptionsPanel';
import { TooltipTop, TooltipRight } from '../../components/ui/Tooltip';
import { MasterHeader } from '../../components/ui/MasterHeader';

interface Track {
  id: string;
  name: string;
  status: JobStatus;
}

const FORMATS = ['mp3', 'm4a', 'wav'] as const;
const QUALITIES = ['128', '192', '256', '320'] as const;

import { useJob } from '../../context/GlobalJobContext';
import { safeFetch } from '../../../lib/safeFetch';
import { ensureSessionToken, appendAuthToken, useSessionToken } from '../../../lib/clientAuth';

export default function SpotifyConverter() {
  const { jobState, startJob, updateJob, clearJob } = useJob('spotify');
  const sessionToken = useSessionToken();
  const shouldReduceMotion = useReducedMotion();
  const urlInputId = useId();
  const urlErrorId = useId();

  const [url, setUrl] = useState(() => jobState?.url ?? '');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [playlistName, setPlaylistName] = useState(() => jobState?.options?.playlistName ?? '');
  const [tracks, setTracks] = useState<Track[]>(() => jobState?.options?.tracks ?? []);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(() => new Set(jobState?.options?.selectedTrackIds ?? []));
  const [format, setFormat] = useState<string>(() => jobState?.options?.format ?? 'mp3');
  const [quality, setQuality] = useState<string>(() => jobState?.options?.quality ?? '128');

  // Derived state from context
  const status = jobState?.status === 'processing' ? 'PROCESSING' : jobState?.status === 'complete' ? 'COMPLETE' : jobState?.status === 'error' ? 'ERROR' : 'IDLE';
  const statusText = jobState?.statusText ?? 'AWAITING PAYLOAD';
  const progress = jobState?.progress ?? 0;
  const processing = jobState?.status === 'processing';

  // Extract tracks into separate local state for UI responsiveness, then sync to context
  useEffect(() => {
    if (!processing) {
      updateJob({
        url,
        options: { playlistName, tracks, selectedTrackIds: Array.from(selectedTrackIds), format, quality },
      });
    }
  }, [url, playlistName, tracks, selectedTrackIds, format, quality, processing, updateJob]);

  // Sync tracks back from context (for status updates)
  useEffect(() => {
    if (jobState?.options?.tracks) {
      setTracks(jobState.options.tracks);
    }
  }, [jobState?.options?.tracks]);


  const validateUrl = (input: string) => {
    const regex = /https?:\/\/(open\.)?spotify\.com\/(playlist|album|track)\/[a-zA-Z0-9]+/;
    return regex.test(input.trim());
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setUrl(text);
    } catch {}
  };

  const handleExtract = async () => {
    if (!validateUrl(url)) {
      setUrlError('Invalid Spotify URL (playlist, album, or track)');
      return;
    }

    setUrlError(null);
    updateJob({ statusText: 'EXTRACTING PLAYLIST...', status: 'processing' });
    try {
      const authToken = await ensureSessionToken();
      const res = await safeFetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert?action=extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({ url }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to extract');
      const { name, tracks: fetchedTracks } = json.playlist;
      setPlaylistName(name);
      const initialTracks: Track[] = fetchedTracks.map((t: any) => ({ id: t.id, name: t.name, status: 'pending' as JobStatus }));
      setTracks(initialTracks);
      setSelectedTrackIds(new Set(initialTracks.map(t => t.id)));
      updateJob({ status: 'idle', statusText: `${initialTracks.length} TRACKS FOUND`, options: { playlistName: name, tracks: initialTracks, selectedTrackIds: initialTracks.map(t => t.id) } });
    } catch (err: any) {
      setUrlError(err.message);
      updateJob({ status: 'error', statusText: 'EXTRACTION FAILED' });
    }
  };

  const toggleSelectAll = (select: boolean) => {
    const nextSet = select ? new Set(tracks.map(t => t.id)) : new Set<string>();
    setSelectedTrackIds(nextSet);
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
    if (selectedTrackIds.size === 0 || processing) return;
    
    const payload = {
      trackIds: Array.from(selectedTrackIds),
      format,
      quality,
    };
    try {
      updateJob({
        status: 'processing',
        progress: 0,
        statusText: `INITIALIZING SPOTIFY EXTRACTION (${selectedTrackIds.size} TRACKS)...`,
      });

      const authToken = await ensureSessionToken();
      const res = await safeFetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        const errorMessage = typeof json.error === 'string' ? json.error : JSON.stringify(json.error) || 'Failed to start conversion';
        updateJob({ status: 'error', statusText: `ERROR: ${errorMessage}` });
        return;
      }
      const { jobId } = json;
      const es = new EventSource(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert?jobId=${jobId}&token=${encodeURIComponent(authToken)}`);
      startJob(es);
    } catch (err: any) {
      updateJob({ status: 'error', statusText: `ERROR: ${err.message || 'Conversion failed'}` });
    }
  };

  const handleRetry = async (trackId: string) => {
    try {
      const hasJwt = sessionToken.split('.').length === 3;
      const authToken =
        hasJwt || (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test')
          ? sessionToken
          : await ensureSessionToken();
      await safeFetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/spotify-convert/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
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
    clearJob();
  };


  const completedCount = tracks.filter(t => t.status === 'done').length;
  const totalSelected = selectedTrackIds.size;
  const progressPct = totalSelected > 0 ? Math.round((completedCount / totalSelected) * 100) : 0;
  const activeProgress = (typeof jobState?.progress === 'number' && jobState.progress > 0) ? jobState.progress : progressPct;

  return (
    <>
      {/* Top utility bar */}
      <MasterHeader
        onlyUtilityBar
        toolName="SPOTIFY CONVERTER"
        engineId="SPOTIFY-FETCH"
        hwAccelText="STATUS: ONLINE ●"
      />

      {/* Workspace */}
      <div className="workspace">
        {/* Left: URL input area (replaces dropzone) */}
        <div className="dropzone-container">
          <MasterHeader
            onlyToolHeader
            targetId="TARGET // 07"
            title={<>Spotify<br/>Converter.</>}
            rightAction={url && (
              <TooltipTop content="Clear URL and reset">
                <button
                  type="button"
                  onClick={handleClear}
                  className="tiny-label"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6 }}
                >
                  [ CLEAR ]
                </button>
              </TooltipTop>
            )}
          />

          {/* URL Input */}
          <div data-lenis-prevent style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: '24px', flex: 1, overflowY: 'auto' }}>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (url && statusText !== 'EXTRACTING PLAYLIST...' && !processing) {
                  handleExtract();
                }
              }}
              noValidate
              style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
            >
              <label htmlFor={urlInputId} className="sr-only">
                Spotify Playlist URL
              </label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <input
                  id={urlInputId}
                  type="url"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) {
                      e.preventDefault();
                    }
                  }}
                  placeholder="PASTE SPOTIFY PLAYLIST URL"
                  aria-label="Paste Spotify Playlist URL"
                  aria-invalid={Boolean(urlError)}
                  aria-describedby={urlError ? urlErrorId : undefined}
                  data-testid="url-input"
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `1px solid ${urlError ? 'var(--error)' : validateUrl(url) ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text-main)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.875rem',
                    padding: '12px 0',
                    transition: 'border-color 0.2s',
                  }}
                />
                <motion.button
                  type="button"
                  onClick={handlePaste}
                  data-testid="paste-btn"
                  whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                  transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--border)',
                    color: 'var(--text-muted)',
                    padding: '10px 12px',
                    minHeight: '40px',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.875rem',
                    flexShrink: 0,
                  }}
                  title="Paste from clipboard"
                >
                  PASTE
                </motion.button>
              </div>

              {urlError && (
                <div id={urlErrorId} role="alert" data-testid="url-error" style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                  {urlError}
                </div>
              )}

              <motion.button
                type="submit"
                disabled={!url || statusText === 'EXTRACTING PLAYLIST...' || processing}
                data-testid="extract-btn"
                whileHover={(!url || statusText === 'EXTRACTING PLAYLIST...' || processing || shouldReduceMotion) ? undefined : { scale: 1.01 }}
                whileTap={(!url || statusText === 'EXTRACTING PLAYLIST...' || processing || shouldReduceMotion) ? undefined : { scale: 0.97 }}
                transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--accent)',
                  color: 'var(--accent)',
                  padding: '10px 16px',
                  minHeight: '40px',
                  cursor: (!url || statusText === 'EXTRACTING PLAYLIST...' || processing) ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  alignSelf: 'flex-start',
                  opacity: (!url || !validateUrl(url) || statusText === 'EXTRACTING PLAYLIST...' || processing) ? 0.5 : 1,
                }}
              >
                {statusText === 'EXTRACTING PLAYLIST...' ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <progress className="cel-spinner" aria-label="Extracting playlist" />
                    <span>EXTRACTING...</span>
                  </span>
                ) : (
                  'EXTRACT PLAYLIST'
                )}
              </motion.button>
            </form>

            {/* Playlist info */}
            <AnimatePresence>
              {playlistName && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  data-testid="playlist-info" 
                  className="glass-panel"
                  style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}
                >
                  <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>{playlistName}</span>
                  <span className="mono-data" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Track list */}
            <AnimatePresence>
              {tracks.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  data-testid="track-list" 
                  style={{ display: 'flex', flexDirection: 'column', gap: '0', overflow: 'hidden' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '8px' }}>
                    <span className="tiny-label" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {selectedTrackIds.size} / {tracks.length} SELECTED
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <TooltipRight content="Select all tracks for download">
                        <button
                          type="button"
                          onClick={() => toggleSelectAll(true)}
                          data-testid="select-all"
                          className="mono-data"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.625rem', textTransform: 'uppercase' }}
                        >
                          ALL
                        </button>
                      </TooltipRight>
                      <TooltipRight content="Deselect all tracks">
                        <button
                          type="button"
                          onClick={() => toggleSelectAll(false)}
                          data-testid="deselect-all"
                          className="mono-data"
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.625rem', textTransform: 'uppercase' }}
                        >
                          NONE
                        </button>
                      </TooltipRight>
                    </div>
                  </div>
                  <div data-lenis-prevent style={{ maxHeight: '300px', overflowY: 'auto', overscrollBehavior: 'contain' }}>
                    {tracks.map(track => {
                      const isSelected = selectedTrackIds.has(track.id);
                      return (
                        <div
                          key={track.id}
                          data-testid={`track-item-${track.id}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            padding: '6px 4px',
                            borderBottom: '1px solid rgba(42,42,42,0.5)',
                            background: isSelected ? 'rgba(255, 90, 0, 0.04)' : 'transparent',
                          }}
                        >
                          <label
                            className="cel-check-row"
                            style={{
                              flex: 1,
                              minWidth: 0,
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '2px 0',
                              minHeight: '30px',
                              border: 'none',
                              background: 'transparent',
                            }}
                          >
                            <input
                              type="checkbox"
                              className="cel-check-input"
                              checked={isSelected}
                              onChange={() => toggleTrackSelection(track.id)}
                            />
                            <span style={{ fontSize: '0.75rem', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={track.name}>
                              {track.name}
                            </span>
                          </label>
                          <StatusBadge status={track.status} />
                          {track.status === 'error' && (
                            <button
                              type="button"
                              onClick={() => handleRetry(track.id)}
                              data-testid={`retry-${track.id}`}
                              className="mono-data"
                              style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 8px', fontSize: '0.625rem', flexShrink: 0, whiteSpace: 'nowrap' }}
                            >
                              RETRY
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right: Resizable options panel */}
        <ResizableOptionsPanel title="SPOTIFY PARAMETERS">

            {/* FORMAT */}
            <div className="form-group">
              <div className="form-header" style={{ marginBottom: '8px' }}>
                <span className="tiny-label">FORMAT</span>
                <span className="mono-data">{format.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '6px', padding: '4px 2px' }} data-testid="format-grid">
                {FORMATS.map(f => {
                  const isSelected = format === f;
                  return (
                    <motion.button
                      key={f}
                      type="button"
                      whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                      transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
                      onClick={() => setFormat(f)}
                      data-testid={`format-${f}`}
                      aria-pressed={isSelected}
                      style={{
                        position: 'relative',
                        minHeight: '36px',
                        padding: '8px 4px',
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        border: isSelected ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                        background: isSelected ? 'rgba(255, 90, 0, 0.18)' : 'rgba(15, 15, 18, 0.65)',
                        color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                        boxShadow: isSelected ? '0 0 14px rgba(255, 90, 0, 0.28)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        transition: 'border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease'
                      }}
                    >
                      {f.toUpperCase()}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* QUALITY */}
            <div className="form-group">
              <div className="form-header" style={{ marginBottom: '8px' }}>
                <span className="tiny-label">AUDIO BITRATE</span>
                <span className="mono-data">{quality} KBPS</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '6px', padding: '4px 2px' }} data-testid="quality-grid">
                {QUALITIES.map(q => {
                  const isSelected = quality === q;
                  return (
                    <motion.button
                      key={q}
                      type="button"
                      whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                      whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                      transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
                      onClick={() => setQuality(q)}
                      data-testid={`quality-${q}`}
                      aria-pressed={isSelected}
                      style={{
                        position: 'relative',
                        minHeight: '36px',
                        padding: '8px 4px',
                        textAlign: 'center',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.6875rem',
                        fontWeight: 700,
                        letterSpacing: '0.04em',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        border: isSelected ? '1px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
                        background: isSelected ? 'rgba(255, 90, 0, 0.18)' : 'rgba(15, 15, 18, 0.65)',
                        color: isSelected ? 'var(--accent)' : 'var(--text-muted)',
                        boxShadow: isSelected ? '0 0 14px rgba(255, 90, 0, 0.28)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        transition: 'border-color 0.15s ease, background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease'
                      }}
                    >
                      {q} KBPS
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Payload summary */}
            <AnimatePresence>
              {tracks.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="form-group"
                  style={{ overflow: 'hidden' }}
                >
                  <div className="form-header">
                    <span className="tiny-label">PAYLOAD SUMMARY</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingTop: '4px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tiny-label">SELECTED</span>
                      <span className="mono-data" style={{ fontVariantNumeric: 'tabular-nums' }}>
                        {selectedTrackIds.size} {selectedTrackIds.size === 1 ? 'track' : 'tracks'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tiny-label">FORMAT</span>
                      <span className="mono-data" style={{ color: 'var(--accent)' }}>{format.toUpperCase()}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="tiny-label">QUALITY</span>
                      <span className="mono-data">{quality} KBPS</span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Clear button */}
            {tracks.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                className="mono-data"
                data-testid="clear-btn"
                style={{ background: 'none', border: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-muted)', padding: '8px', minHeight: '36px', width: '100%', textAlign: 'center', fontSize: '0.6875rem', textTransform: 'uppercase' }}
              >
                CLEAR
              </button>
            )}
        </ResizableOptionsPanel>
      </div>

      {/* Bottom progress section */}
      <div className="progress-section grid-line-top">
        <motion.button
          type="button"
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={selectedTrackIds.size === 0 || status === 'PROCESSING'}
          data-testid="initialize-btn"
          whileHover={(selectedTrackIds.size === 0 || status === 'PROCESSING' || shouldReduceMotion) ? undefined : { scale: 1.01 }}
          whileTap={(selectedTrackIds.size === 0 || status === 'PROCESSING' || shouldReduceMotion) ? undefined : { scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={{ opacity: (selectedTrackIds.size === 0 || status === 'PROCESSING') ? 0.5 : 1 }}
        >
          {status === 'PROCESSING' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <progress className="cel-spinner" aria-label="Processing" />
              <span>PROCESSING...</span>
            </span>
          ) : (
            'INITIALIZE'
          )}
        </motion.button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusText}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {status === 'COMPLETE' && jobState?.downloadUrl && (
                <a
                  href={appendAuthToken(jobState.downloadUrl, sessionToken)}
                  download="spotify_converted_tracks.zip"
                  data-testid="download-btn"
                  className="mono-data"
                  style={{
                    color: 'var(--accent)',
                    border: '1px solid var(--accent)',
                    background: 'rgba(255, 90, 0, 0.1)',
                    borderRadius: '3px',
                    padding: '2px 8px',
                    textDecoration: 'none',
                    fontWeight: 600
                  }}
                >
                  [ DOWNLOAD BATCH (.ZIP) ]
                </a>
              )}
              <span className="mono-data" data-testid="progress-count" style={{ fontVariantNumeric: 'tabular-nums' }}>
                {totalSelected > 0 ? `TARGET: ${totalSelected} ${totalSelected === 1 ? 'TRACK' : 'TRACKS'}` : 'QUEUE: 0 FILES'}
              </span>
            </div>
          </div>
          <progress
            className="cel-progress"
            data-testid="progress-fill"
            max={100}
            value={Math.round(activeProgress)}
            aria-label="Spotify conversion progress"
            aria-valuetext={`${Math.round(activeProgress)}%`}
            style={{
              ['--progress-bar-fill' as string]: activeProgress >= 100 ? 'var(--success)' : 'var(--accent)',
            }}
          />
        </div>
      </div>
    </>
  );
}
