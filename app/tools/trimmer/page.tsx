// app/tools/trimmer/page.tsx – Audio Trimmer UI (TRIM & MERGE modes)
// ---------------------------------------------------------------
'use client'

import React, { useState, useEffect, useRef } from 'react';
import { FileDropzone } from '../../components/ui/FileDropzone';
import WaveformCanvas from '../../components/waveform/WaveformCanvas';
import WaveformControls, { TrimmerMode } from '../../components/waveform/WaveformControls';
import { generateWaveform, WaveformResult } from '../../components/waveform/WaveformEngine';

// Helper to read a File as ArrayBuffer
const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('Failed to read file as ArrayBuffer'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
};

export default function AudioTrimmerPage() {
  const [mode, setMode] = useState<TrimmerMode>('TRIM');
  const [files, setFiles] = useState<File[]>([]);
  const [audioUrl, setAudioUrl] = useState<string>('');
  const [waveform, setWaveform] = useState<WaveformResult | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [zoom, setZoom] = useState(10); // seconds visible
  const [statusText, setStatusText] = useState('AWAITING PAYLOAD');
  const [progress, setProgress] = useState(0);
  const [processing, setProcessing] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);

  // Handle file drop – single file for TRIM, multiple for MERGE
  const handleFilesSelected = async (selected: File[]) => {
    if (mode === 'TRIM') {
      const file = selected[0];
      setFiles([file]);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setStatusText(`LOADED: ${file.name}`);
      const buffer = await readFileAsArrayBuffer(file);
      // Use a temporary Audio element to get duration (needed before waveform)
      const tempAudio = new Audio(url);
      tempAudio.addEventListener('loadedmetadata', async () => {
        const dur = tempAudio.duration;
        setDuration(dur);
        setTrimEnd(dur);
        // Approximate window size as canvas width (will be updated later via resize)
        const canvasWidth = 800; // fallback, actual width will be used in canvas component
        const result = await generateWaveform(buffer, canvasWidth);
        setWaveform(result);
        // Cleanup temp audio
        tempAudio.remove();
      });
    } else {
      // MERGE mode – just store files, no waveform
      setFiles(prev => [...prev, ...selected]);
      setStatusText(`${files.length + selected.length} FILES QUEUED`);
    }
  };

  // Playback controls
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const updateTime = () => setCurrentTime(audio.currentTime);
    audio.addEventListener('timeupdate', updateTime);
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    return () => {
      audio.removeEventListener('timeupdate', updateTime);
    };
  }, []);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) audio.pause();
    else audio.play();
  };

  const handleSeek = (time: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = time;
    setCurrentTime(time);
  };

  const handleSelect = (start: number, end: number) => {
    setTrimStart(Math.min(start, end));
    setTrimEnd(Math.max(start, end));
  };

  const handleZoomIn = () => setZoom(z => Math.max(1, z - 1));
  const handleZoomOut = () => setZoom(z => z + 1);

  const handleModeToggle = (newMode: TrimmerMode) => {
    setMode(newMode);
    // Reset state when switching modes
    setFiles([]);
    setAudioUrl('');
    setWaveform(null);
    setDuration(0);
    setCurrentTime(0);
    setTrimStart(0);
    setTrimEnd(0);
    setFadeIn(0);
    setFadeOut(0);
    setZoom(10);
    setStatusText('AWAITING PAYLOAD');
    setProgress(0);
  };

  const handleInitialize = async () => {
    if (files.length === 0 || processing) return;
    setProcessing(true);
    setProgress(0);
    setStatusText('PROCESSING...');
    if (mode === 'TRIM') {
      const payload = {
        fileName: files[0]?.name,
        trimStart,
        trimEnd,
        fadeIn,
        fadeOut,
        format: 'mp3',
      };
      await fetch('/api/audio-trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      const payload = {
        files: files.map(f => f.name),
        format: 'mp3',
      };
      await fetch('/api/audio-trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
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
        {/* Left: dropzone or waveform */}
        <div className="dropzone-container">
          <div className="tool-header">
            <div className="tiny-label" style={{ marginBottom: '16px' }}>TARGET // 06</div>
            <h2 className="tool-title">Audio<br/>Trim.</h2>
          </div>

          {!hasFiles ? (
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              acceptedTypes={['mp3', 'wav', 'flac', 'm4a', 'aac']}
              multiple={mode === 'MERGE'}
              formatsListText="Accepted formats: MP3, WAV, FLAC, M4A, AAC"
            />
          ) : (
            <>
              {mode === 'TRIM' && waveform && (
                <WaveformCanvas
                  left={waveform.left}
                  right={waveform.right}
                  duration={duration}
                  currentTime={currentTime}
                  trimStart={trimStart}
                  trimEnd={trimEnd}
                  zoom={zoom}
                  onSeek={handleSeek}
                  onSelect={handleSelect}
                />
              )}
              {/* Hidden audio element for playback */}
              <audio ref={audioRef} src={audioUrl} preload="metadata" />
            </>
          )}
        </div>

        {/* Right: options panel */}
        <aside className="options-panel grid-line-left">
          <div className="options-header grid-line-bottom">
            <span className="tiny-label">PROCESSING PARAMETERS</span>
          </div>
          <div className="options-scroll">
            {/* Mode toggle */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">MODE</span>
                <span className="mono-data" style={{ color: 'var(--accent)' }}>{mode}</span>
              </div>
              <select
                value={mode}
                onChange={e => handleModeToggle(e.target.value as TrimmerMode)}
                data-testid="mode-select"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-main)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '8px',
                  cursor: 'pointer',
                }}
              >
                <option value="TRIM">TRIM</option>
                <option value="MERGE">MERGE</option>
              </select>
            </div>

            {/* Output format */}
            <div className="form-group">
              <div className="form-header">
                <span className="tiny-label">OUTPUT FORMAT</span>
              </div>
              <select
                data-testid="format-select"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-main)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  padding: '8px',
                  cursor: 'pointer',
                }}
              >
                <option value="mp3">MP3</option>
                <option value="wav">WAV</option>
                <option value="flac">FLAC</option>
                <option value="m4a">M4A</option>
                <option value="aac">AAC</option>
              </select>
            </div>

            {/* Fade inputs (only in TRIM) */}
            {mode === 'TRIM' && (
              <>
                <div className="form-group">
                  <div className="form-header">
                    <span className="tiny-label">FADE IN</span>
                    <span className="mono-data" data-testid="fade-in-value">{fadeIn}s</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={fadeIn}
                    onChange={e => setFadeIn(parseFloat(e.target.value))}
                    data-testid="fade-in-slider"
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>
                <div className="form-group">
                  <div className="form-header">
                    <span className="tiny-label">FADE OUT</span>
                    <span className="mono-data" data-testid="fade-out-value">{fadeOut}s</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={fadeOut}
                    onChange={e => setFadeOut(parseFloat(e.target.value))}
                    data-testid="fade-out-slider"
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                </div>
              </>
            )}

            {mode === 'TRIM' && waveform && (
              <WaveformControls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                trimStart={trimStart}
                trimEnd={trimEnd}
                zoom={zoom}
                onPlayPause={togglePlay}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onTrimChange={(s, e) => {
                  setTrimStart(s);
                  setTrimEnd(e);
                }}
              />
            )}

            {/* Merge file list (simple) */}
            {mode === 'MERGE' && files.length > 0 && (
              <div className="form-group">
                <div className="form-header">
                  <span className="tiny-label">FILES TO MERGE</span>
                  <span className="mono-data">{files.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  {files.map((f, idx) => (
                    <div key={idx} className="mono-data" data-testid="merge-file-item" style={{ padding: '4px 0', borderBottom: '1px solid rgba(42,42,42,0.5)' }}>
                      {f.name}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Bottom progress section — INITIALIZE button lives here */}
      <div className="progress-section grid-line-top">
        <button
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!hasFiles || processing}
          data-testid="initialize-btn"
          style={{ opacity: (!hasFiles || processing) ? 0.5 : 1 }}
        >
          {processing ? 'PROCESSING...' : 'INITIALIZE'}
        </button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusText}</span>
            <span className="mono-data">
              {hasFiles ? `FILE: ${files[0].name}` : 'QUEUE: 0 FILES'}
            </span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: `${progress}%` }} data-testid="progress-fill"></div>
          </div>
        </div>
      </div>
    </>
  );
}
