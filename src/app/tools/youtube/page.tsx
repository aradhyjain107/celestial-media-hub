'use client'

import React, { useState, useCallback, useEffect, useRef, useId } from 'react';
import Image from 'next/image';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { ResizableOptionsPanel } from '../../components/ui/ResizableOptionsPanel';
import { TooltipRight } from '../../components/ui/Tooltip';
import { MasterHeader } from '../../components/ui/MasterHeader';
import { safeFetch } from '../../../lib/safeFetch';

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
  platform?: 'YT' | 'IG';
}

const HISTORY_KEY = 'celestial-yt-history';

import { isValidMediaUrl, detectMediaPlatform } from '../../../schemas/youtube';
import { useJob } from '../../context/GlobalJobContext';
import { ensureSessionToken, appendAuthToken, useSessionToken } from '../../../lib/clientAuth';

export default function YouTubeDownloader() {
  const { jobState, startJob, updateJob, clearJob } = useJob('youtube');
  const sessionToken = useSessionToken();
  const shouldReduceMotion = useReducedMotion();
  const urlInputId = useId();
  const urlHintId = useId();
  const urlErrorId = useId();

  /* ── State ── */
  const [url, setUrl] = useState(() => jobState?.url ?? '');
  const [batchUrls, setBatchUrls] = useState<string[]>(() => jobState?.options?.batchUrls ?? []);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>(() => jobState?.options?.format ?? 'mp3');
  const [quality, setQuality] = useState(() => jobState?.options?.quality ?? '320');
  const [isPlaylist, setIsPlaylist] = useState(() => jobState?.options?.isPlaylist ?? false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(() => jobState?.options?.videoInfo ?? null);
  const [tracks, setTracks] = useState<PlaylistTrack[]>(() => jobState?.options?.tracks ?? []);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchSeqRef = useRef(0);
  const hasManualFormatSelectionRef = useRef(false);

  const inputPlatform = detectMediaPlatform(url);
  const detectedPlatform = detectMediaPlatform(url || batchUrls[batchUrls.length - 1] || '');
  const isInstagram = detectedPlatform === 'instagram';

  // Derived state from context
  const progress = jobState?.progress ?? 0;
  const statusText = jobState?.statusText ?? 'AWAITING PAYLOAD';
  const processing = jobState?.status === 'processing';
  const status = jobState?.status === 'processing' ? 'DOWNLOADING' 
               : jobState?.status === 'complete' ? 'COMPLETE' 
               : jobState?.status === 'error' ? 'ERROR' 
               : 'IDLE';

  // Sync inputs to context so they survive navigation
  useEffect(() => {
    if (!processing) {
      updateJob({
        url,
        options: { format, quality, isPlaylist, videoInfo, tracks, batchUrls },
      });
    }
  }, [url, format, quality, isPlaylist, videoInfo, tracks, batchUrls, processing, updateJob]);


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

  // Record completed download into local history
  useEffect(() => {
    if (status === 'COMPLETE' && (videoInfo || batchUrls.length > 0)) {
      addToHistory({
        title: batchUrls.length > 1
          ? `Batch Download (${batchUrls.length} items)`
          : videoInfo?.title || (isInstagram ? 'Instagram Download' : 'YouTube Download'),
        format: format.toUpperCase(),
        date: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        size: isAudioFormat ? `${quality} kbps` : quality,
        platform: isInstagram ? 'IG' : 'YT',
      });
    }
  }, [status, videoInfo, batchUrls.length, format, quality, isAudioFormat, isInstagram, addToHistory]);

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
    if (!isValidMediaUrl(inputUrl)) {
      setUrlError('Invalid URL (must be youtube.com, youtu.be, or instagram.com)');
      return;
    }
    
    const reqSeq = ++fetchSeqRef.current;
    const platform = detectMediaPlatform(inputUrl);

    setUrlError(null);
    updateJob({ statusText: platform === 'instagram' ? 'FETCHING INSTAGRAM INFO...' : 'FETCHING VIDEO INFO...', status: 'idle' });
    setVideoInfo(null);
    setTracks([]);

    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const action = isPlaylist ? 'playlist-info' : 'info';
      const authToken = await ensureSessionToken();
      const res = await safeFetch(`${apiBase}/api/youtube?action=${action}&url=${encodeURIComponent(inputUrl)}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (reqSeq !== fetchSeqRef.current) return;

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch info' }));
        throw new Error(err.message || err.error || 'Failed to fetch info');
      }

      const data = await res.json();
      if (reqSeq !== fetchSeqRef.current) return;

      if (isPlaylist && data.tracks) {
        setTracks(data.tracks.map((t: any, i: number) => ({
          index: i,
          title: t.title,
          duration: t.duration,
          selected: true,
        })));
        setVideoInfo({
          title: data.title || (platform === 'instagram' ? 'Instagram Carousel / Batch' : 'Playlist'),
          thumbnail: data.thumbnail || '',
          duration: `${data.tracks.length} items`
        });
      } else {
        setVideoInfo({
          title: data.title || (platform === 'instagram' ? 'Instagram Media' : 'Media Item'),
          thumbnail: data.thumbnail || '',
          duration: data.duration ?? (platform === 'instagram' ? 'INSTAGRAM REEL / POST' : ''),
        });
      }

      updateJob({ statusText: 'READY', status: 'idle' });
    } catch (err: any) {
      if (reqSeq !== fetchSeqRef.current) return;
      updateJob({ statusText: `ERROR: ${err.message}`, status: 'error' });
    }
  }, [isPlaylist, updateJob]);

  /* ── Helper to extract multiple valid URLs from text ── */
  const enqueueBulkLinks = useCallback((rawText: string): number => {
    const tokens = rawText
      .split(/[\r\n,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
    const validLinks = tokens.filter(isValidMediaUrl);
    if (validLinks.length > 0) {
      if (!hasManualFormatSelectionRef.current && validLinks.some(u => detectMediaPlatform(u) === 'instagram')) {
        setFormat('mp4');
        setQuality('1080p');
      }
      setBatchUrls(prev => {
        const set = new Set([...prev, ...validLinks]);
        return Array.from(set).slice(0, 50);
      });
      setUrlError(null);
    }
    return validLinks.length;
  }, []);

  const handleAddCurrentToBatch = useCallback(() => {
    fetchSeqRef.current += 1;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const trimmed = url.trim();
    if (!trimmed) return;
    const count = enqueueBulkLinks(trimmed);
    if (count > 0) {
      setUrl('');
      setVideoInfo(null);
      updateJob({ statusText: `QUEUED ${count} LINK(S) FOR BATCH DOWNLOAD`, status: 'idle' });
    } else {
      setUrlError('Invalid URL (must be youtube.com, youtu.be, or instagram.com)');
    }
  }, [url, enqueueBulkLinks, updateJob]);

  const removeBatchUrl = useCallback((target: string) => {
    setBatchUrls(prev => prev.filter(u => u !== target));
  }, []);

  /* ── Debounced URL input ── */
  const handleUrlChange = useCallback((value: string) => {
    // If user pasted multiple newline/space-separated URLs directly into the input
    const parts = value.trim().split(/[\r\n\s]+/).filter(Boolean);
    if (parts.length > 1 && parts.every(isValidMediaUrl)) {
      enqueueBulkLinks(value);
      setUrl('');
      return;
    }

    if (!hasManualFormatSelectionRef.current && detectMediaPlatform(value) === 'instagram') {
      setFormat('mp4');
      setQuality('1080p');
    }

    setUrl(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) {
      setUrlError(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      if (isValidMediaUrl(value)) {
        setUrlError(null);
        fetchInfo(value);
      } else {
        setUrlError('Invalid URL (must be youtube.com, youtu.be, or instagram.com)');
      }
    }, 800);
  }, [fetchInfo, enqueueBulkLinks]);

  /* ── Paste from clipboard ── */
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      const parts = text.trim().split(/[\r\n\s]+/).filter(Boolean);
      if (parts.length > 1 && parts.some(isValidMediaUrl)) {
        enqueueBulkLinks(text);
        setUrl('');
        return;
      }
      if (!hasManualFormatSelectionRef.current && detectMediaPlatform(text) === 'instagram') {
        setFormat('mp4');
        setQuality('1080p');
      }
      setUrl(text);
      if (isValidMediaUrl(text)) {
        setUrlError(null);
        fetchInfo(text);
      } else if (text.trim()) {
        setUrlError('Invalid URL (must be youtube.com, youtu.be, or instagram.com)');
      }
    } catch {
      // clipboard permission denied
    }
  }, [fetchInfo, enqueueBulkLinks]);

  /* ── Toggle track selection ── */
  const toggleTrack = useCallback((index: number) => {
    setTracks(prev => prev.map(t =>
      t.index === index ? { ...t, selected: !t.selected } : t
    ));
  }, []);

  const effectiveBatchUrls = React.useMemo(() => {
    const list = [...batchUrls];
    const trimmedUrl = url.trim();
    if (trimmedUrl && isValidMediaUrl(trimmedUrl) && !list.includes(trimmedUrl)) {
      list.push(trimmedUrl);
    }
    return list;
  }, [batchUrls, url]);

  /* ── Initialize download ── */
  const handleInitialize = useCallback(async () => {
    if (effectiveBatchUrls.length === 0) return;

    if (batchUrls.length > 0 && url.trim() && isValidMediaUrl(url.trim())) {
      setBatchUrls(effectiveBatchUrls);
      setUrl('');
    }

    const primaryUrl = effectiveBatchUrls[0];
    const isMultiBatch = effectiveBatchUrls.length > 1;
    const platform = detectMediaPlatform(primaryUrl);
    const selectedIndices = !isMultiBatch && isPlaylist ? tracks.filter(t => t.selected).map(t => t.index) : undefined;

    try {
      updateJob({
        status: 'processing',
        progress: 0,
        statusText: isMultiBatch
          ? `INITIALIZING BATCH DOWNLOAD (${effectiveBatchUrls.length} LINKS)...`
          : isPlaylist
            ? 'INITIALIZING PLAYLIST / CAROUSEL DOWNLOAD...'
            : platform === 'instagram'
              ? 'INITIALIZING INSTAGRAM DOWNLOAD...'
              : 'INITIALIZING YOUTUBE DOWNLOAD...',
      });

      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
      const payload: Record<string, unknown> = {
        url: primaryUrl,
        format,
        quality,
        isPlaylist,
        selectedIndices,
      };
      if (isMultiBatch) {
        payload.urls = effectiveBatchUrls;
      }

      const authToken = await ensureSessionToken();
      const res = await safeFetch(`${apiBase}/api/youtube`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Download failed' }));
        const errorMessage = err.message || (typeof err.error === 'string' ? err.error : JSON.stringify(err.error)) || 'Download failed';
        updateJob({ status: 'error', statusText: `ERROR: ${errorMessage}` });
        return;
      }

      // Hand off to context if it's an SSE stream
      if (res.headers.get('content-type')?.includes('text/event-stream')) {
        startJob(res);
      } else {
        // Direct download fallback
        const blob = await res.blob();
        const downloadUrl = URL.createObjectURL(blob);
        updateJob({
          status: 'complete',
          progress: 100,
          statusText: 'DOWNLOAD COMPLETE',
          downloadUrl
        });
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `download.${format}`;
        a.click();
        setTimeout(() => {
          URL.revokeObjectURL(downloadUrl);
        }, 60_000);
      }
    } catch (err: any) {
      updateJob({ status: 'error', statusText: `ERROR: ${err.message}` });
    }
  }, [effectiveBatchUrls, batchUrls.length, url, format, quality, isPlaylist, tracks, startJob, updateJob]);


  const isPlaylistEmpty = effectiveBatchUrls.length === 1 && isPlaylist && tracks.length > 0 && tracks.filter(t => t.selected).length === 0;
  const isInitDisabled = effectiveBatchUrls.length === 0 || (Boolean(url.trim()) && !isValidMediaUrl(url) && batchUrls.length === 0) || status === 'DOWNLOADING' || isPlaylistEmpty;

  /* ── Render ── */
  return (
    <>
      {/* Top utility bar */}
      <MasterHeader
        onlyUtilityBar
        toolName="MEDIA DOWNLOADER"
        engineId="YT-DLP-STREAM"
        hwAccelText="STATUS: ONLINE ●"
      />

      {/* Workspace */}
      <div className="workspace">
        {/* Left: URL input area (replaces dropzone) */}
        <div className="dropzone-container" style={{ overflow: 'hidden' }}>
          <MasterHeader
            onlyToolHeader
            targetId="TARGET // 05"
            title={<>YouTube &<br/>Instagram.</>}
            rightAction={(url || batchUrls.length > 0) && (
              <button
                type="button"
                onClick={() => { setUrl(''); setBatchUrls([]); setUrlError(null); setVideoInfo(null); setTracks([]); clearJob(); }}
                className="tiny-label"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.6 }}
              >
                [ CLEAR ]
              </button>
            )}
          />

          {/* URL Input */}
          <div data-lenis-prevent style={{ padding: '20px 24px 32px', display: 'flex', flexDirection: 'column', gap: '20px', flex: 1, overflowY: 'auto' }}>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (isValidMediaUrl(url)) {
                  handleAddCurrentToBatch();
                }
              }}
              noValidate
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <label htmlFor={urlInputId} className="sr-only">
                Paste YouTube or Instagram URL
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
                  onChange={e => handleUrlChange(e.target.value)}
                  onKeyDown={e => {
                    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                    if (e.key === 'Enter' && isValidMediaUrl(url)) {
                      e.preventDefault();
                      handleAddCurrentToBatch();
                    }
                  }}
                  placeholder="PASTE YOUTUBE OR INSTAGRAM URL"
                  aria-label="Paste YouTube or Instagram URL"
                  aria-invalid={Boolean(urlError)}
                  aria-describedby={urlError ? urlErrorId : urlHintId}
                  data-testid="url-input"
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    borderBottom: `1px solid ${urlError ? 'var(--error)' : isValidMediaUrl(url) ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text-main)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.875rem',
                    padding: '12px 0',
                    transition: 'border-color 0.2s',
                  }}
                />
                {isValidMediaUrl(url) && (
                  <motion.button
                    type="button"
                    onClick={handleAddCurrentToBatch}
                    data-testid="add-batch-btn"
                    whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
                    whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                    transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
                    style={{
                      background: 'rgba(255, 90, 0, 0.1)',
                      border: '1px solid var(--accent)',
                      color: 'var(--accent)',
                      padding: '10px 12px',
                      minHeight: '40px',
                      cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      flexShrink: 0,
                    }}
                    title="Add URL to batch queue (or press Enter)"
                  >
                    + QUEUE
                  </motion.button>
                )}
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
                  title="Paste single URL or multiple newline-separated URLs from clipboard"
                >
                  PASTE
                </motion.button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span id={urlHintId} className="tiny-label" style={{ opacity: 0.75 }}>
                  {inputPlatform === 'youtube'
                    ? 'DETECTED: YOUTUBE STREAM • PRESS ENTER OR + QUEUE TO ADD MORE'
                    : inputPlatform === 'instagram'
                      ? 'DETECTED: INSTAGRAM REEL / POST • PRESS ENTER OR + QUEUE TO ADD MORE'
                      : 'SUPPORTS YOUTUBE & INSTAGRAM • PASTE ONE OR MULTIPLE LINKS'}
                </span>
              </div>
            </form>

            {urlError && (
              <div id={urlErrorId} role="alert" data-testid="url-error" style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)', fontSize: '0.75rem', marginTop: '-8px' }}>
                {urlError}
              </div>
            )}

            {/* Multi-URL Batch Queue */}
            {batchUrls.length > 0 && (
              <div
                data-testid="batch-url-queue"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px',
                  border: '1px solid var(--border)',
                  background: 'rgba(255, 255, 255, 0.02)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                  <span className="tiny-label">
                    BATCH QUEUE ({batchUrls.length} {batchUrls.length === 1 ? 'ITEM' : 'ITEMS'})
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="mono-data" style={{ fontSize: '10px', color: 'var(--accent)' }}>
                      {`YT: ${batchUrls.filter(u => detectMediaPlatform(u) === 'youtube').length}  IG: ${batchUrls.filter(u => detectMediaPlatform(u) === 'instagram').length}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setBatchUrls([])}
                      data-testid="clear-batch-btn"
                      className="mono-data"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: '10px',
                      }}
                    >
                      CLEAR
                    </button>
                  </div>
                </div>
                <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }} data-lenis-prevent>
                  {batchUrls.map((bUrl, idx) => {
                    const p = detectMediaPlatform(bUrl);
                    return (
                      <div
                        key={bUrl}
                        data-testid={`batch-url-item-${idx}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '10px',
                          padding: '6px 4px',
                          borderBottom: '1px solid rgba(42,42,42,0.5)',
                          fontSize: '12px',
                        }}
                      >
                        <span className="mono-data" style={{ width: '20px', color: 'var(--text-muted)' }}>
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                        <span
                          className="mono-data"
                          style={{
                            fontSize: '9px',
                            padding: '1px 5px',
                            border: '1px solid var(--border)',
                            color: 'var(--accent)',
                            flexShrink: 0,
                          }}
                        >
                          {p === 'instagram' ? 'IG' : 'YT'}
                        </span>
                        <span
                          className="mono-data"
                          style={{
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'var(--text-main)',
                          }}
                        >
                          {bUrl}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeBatchUrl(bUrl)}
                          data-testid={`remove-batch-item-${idx}`}
                          className="mono-data"
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: 'var(--text-muted)',
                            cursor: 'pointer',
                            fontSize: '12px',
                            padding: '0 4px',
                          }}
                          title="Remove from queue"
                        >
                          ×
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Video info display */}
            <AnimatePresence>
              {videoInfo && (
                <motion.div 
                  initial={{ opacity: 0, y: 10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: -10, height: 0 }}
                  transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                  className="glass-panel"
                  style={{ display: 'flex', gap: '16px', padding: '16px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }} 
                  data-testid="video-info"
                >
                  {videoInfo.thumbnail && (
                    <Image
                      src={videoInfo.thumbnail}
                      alt={videoInfo.title}
                      width={120}
                      height={68}
                      /* Instagram/YouTube CDN thumbnails use arbitrary dynamic regional subdomains that cannot be exhaustively listed in remotePatterns */
                      unoptimized
                      style={{ objectFit: 'cover', border: '1px solid var(--border)', flexShrink: 0 }}
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                    <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {videoInfo.title}
                    </span>
                    <span className="mono-data">{videoInfo.duration}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Playlist / Carousel mode toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span className="tiny-label">PLAYLIST MODE</span>
              <motion.button
                type="button"
                onClick={() => {
                  setIsPlaylist(!isPlaylist);
                  if (url && isValidMediaUrl(url)) fetchInfo(url);
                }}
                data-testid="playlist-toggle"
                role="switch"
                aria-checked={isPlaylist}
                aria-label="Playlist Mode"
                whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
                style={{
                  width: '40px',
                  height: '22px',
                  borderRadius: '11px',
                  border: 'none',
                  background: isPlaylist ? 'var(--accent)' : 'var(--border)',
                  cursor: 'pointer',
                  position: 'relative',
                  padding: '2px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  boxShadow: isPlaylist ? '0 0 10px rgba(255, 90, 0, 0.4)' : 'none',
                }}
              >
                <motion.span
                  aria-hidden="true"
                  layout={!shouldReduceMotion}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.2, ease: [0.23, 1, 0.32, 1] }}
                  style={{
                    display: 'block',
                    width: '18px',
                    height: '18px',
                    borderRadius: '50%',
                    background: 'var(--text-main)',
                    marginLeft: isPlaylist ? '18px' : '0px',
                  }}
                />
              </motion.button>
              <span className="tiny-label" style={{ opacity: 0.75 }}>
                (YOUTUBE PLAYLISTS & INSTAGRAM CAROUSELS)
              </span>
            </div>

            {/* Playlist tracks */}
            <AnimatePresence>
              {isPlaylist && tracks.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: shouldReduceMotion ? 0 : 0.25, ease: [0.23, 1, 0.32, 1] }}
                  style={{ display: 'flex', flexDirection: 'column', gap: '0', overflow: 'hidden' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '8px' }}>
                    <span className="tiny-label">
                      {tracks.filter(t => t.selected).length} / {tracks.length} SELECTED
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => setTracks(prev => prev.map(t => ({ ...t, selected: true })))}
                        data-testid="select-all"
                        className="mono-data"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: '0.625rem', textTransform: 'uppercase' }}
                      >
                        ALL
                      </button>
                      <button
                        type="button"
                        onClick={() => setTracks(prev => prev.map(t => ({ ...t, selected: false })))}
                        data-testid="deselect-all"
                        className="mono-data"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.625rem', textTransform: 'uppercase' }}
                      >
                        NONE
                      </button>
                    </div>
                  </div>
                  <div
                    style={{ maxHeight: '200px', overflowY: 'auto', overscrollBehavior: 'contain', border: '1px solid var(--border)' }}
                    data-testid="track-list"
                    data-lenis-prevent
                  >
                    {tracks.map(track => (
                      <label
                        key={track.index}
                        data-testid={`track-item-${track.index}`}
                        className="cel-check-row"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '12px',
                          padding: '8px 12px',
                          minHeight: '38px',
                          border: 'none',
                          borderRadius: 0,
                          borderBottom: '1px solid var(--border)',
                          background: track.selected ? 'rgba(255, 90, 0, 0.04)' : 'transparent',
                        }}
                      >
                        <input
                          type="checkbox"
                          className="cel-check-input"
                          checked={track.selected}
                          onChange={() => toggleTrack(track.index)}
                        />
                        <span className="mono-data" style={{ width: '24px', flexShrink: 0 }}>
                          {String(track.index + 1).padStart(2, '0')}
                        </span>
                        <span style={{ fontSize: '0.75rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {track.title}
                        </span>
                        <span className="mono-data">{track.duration}</span>
                      </label>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Download History */}
            {history.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} data-testid="download-history">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '6px' }}>
                  <span className="tiny-label">DOWNLOAD HISTORY</span>
                  <TooltipRight content="Remove all entries from download history">
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
                  </TooltipRight>
                </div>
                {history.map((entry, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid rgba(42,42,42,0.5)' }}>
                    {entry.platform && (
                      <span
                        className="mono-data"
                        style={{
                          flexShrink: 0,
                          marginRight: '8px',
                          fontSize: '9px',
                          padding: '1px 4px',
                          border: '1px solid var(--border)',
                          color: 'var(--accent)',
                        }}
                      >
                        {entry.platform}
                      </span>
                    )}
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

        {/* Right: Resizable options panel */}
        <ResizableOptionsPanel title="DOWNLOAD PARAMETERS">

            {/* ── FORMAT ── */}
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
                      onClick={() => {
                        hasManualFormatSelectionRef.current = true;
                        setFormat(f);
                      }}
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

            {/* ── QUALITY ── */}
            <div className="form-group">
              <div className="form-header" style={{ marginBottom: '8px' }}>
                <span className="tiny-label">{isAudioFormat ? 'AUDIO BITRATE' : 'VIDEO RESOLUTION'}</span>
                <span className="mono-data">{isAudioFormat ? `${quality} KBPS` : quality.toUpperCase()}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: '6px', padding: '4px 2px' }} data-testid="quality-grid">
                {qualities.map(q => {
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
                      {isAudioFormat ? `${q} KBPS` : q.toUpperCase()}
                    </motion.button>
                  );
                })}
              </div>
            </div>
        </ResizableOptionsPanel>
      </div>

      {/* Progress Section */}
      <div className="progress-section grid-line-top">
        <motion.button
          type="button"
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={isInitDisabled}
          data-testid="initialize-btn"
          whileHover={isInitDisabled || shouldReduceMotion ? undefined : { scale: 1.01 }}
          whileTap={isInitDisabled || shouldReduceMotion ? undefined : { scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={{ opacity: isInitDisabled ? 0.5 : 1 }}
        >
          {status === 'DOWNLOADING' ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <progress className="cel-spinner" aria-label="Downloading" />
              <span>DOWNLOADING...</span>
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
                  download={
                    jobState.downloadUrl.includes('output.zip')
                      ? `${isInstagram ? 'instagram' : 'youtube'}_downloads.zip`
                      : `${isInstagram ? 'instagram' : 'youtube'}_${videoInfo?.title ? videoInfo.title.replace(/[^a-zA-Z0-9_-]/g, '_') : 'download'}.${format}`
                  }
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
                  [ DOWNLOAD FILE ]
                </a>
              )}
              <span className="mono-data">
                {effectiveBatchUrls.length > 1
                  ? `BATCH: ${effectiveBatchUrls.length} LINKS`
                  : videoInfo
                    ? `TARGET: ${videoInfo.title.slice(0, 30)}`
                    : 'QUEUE: 0 FILES'}
              </span>
            </div>
          </div>
          <progress
            className="cel-progress"
            data-testid="progress-fill"
            max={100}
            value={Math.round(progress)}
            aria-label="Download progress"
            aria-valuetext={`${Math.round(progress)}%`}
            style={{
              ['--progress-bar-fill' as string]: progress >= 100 ? 'var(--success)' : 'var(--accent)',
            }}
          />
        </div>
      </div>
    </>
  );
}
