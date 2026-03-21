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

  const audioRef = useRef<HTMLAudioElement>(null);

  // Handle file drop – single file for TRIM, multiple for MERGE
  const handleFilesSelected = async (selected: File[]) => {
    if (mode === 'TRIM') {
      const file = selected[0];
      setFiles([file]);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
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
  };

  const handleInitialize = async () => {
    if (mode === 'TRIM') {
      const payload = {
        fileName: files[0]?.name,
        trimStart,
        trimEnd,
        fadeIn,
        fadeOut,
        format: 'mp3', // placeholder – UI will later allow selection
      };
      await fetch('/api/audio-trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      const payload = {
        files: files.map(f => f.name), // In real app we would upload FormData
        format: 'mp3',
      };
      await fetch('/api/audio-trim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
  };

  return (
    <div className="dropzone-container" style={{ display: 'flex', flexDirection: 'row', height: '100%' }}>
      {/* Left side – either Dropzone or Waveform */}
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {files.length === 0 ? (
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

      {/* Right side – options panel */}
      <div className="options-panel">
        <div className="options-header">
          <h2 className="mono-data" style={{ color: 'var(--accent)' }}>{mode === 'TRIM' ? 'Trim Mode' : 'Merge Mode'}</h2>
        </div>
        <div className="options-scroll">
          {/* Mode toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label className="tiny-label" htmlFor="mode-select">Mode</label>
            <select
              id="mode-select"
              value={mode}
              onChange={e => handleModeToggle(e.target.value as TrimmerMode)}
              className="action-btn"
              data-testid="mode-select"
            >
              <option value="TRIM">TRIM</option>
              <option value="MERGE">MERGE</option>
            </select>
          </div>

          {/* Output format selector (placeholder) */}
          <div style={{ marginBottom: '16px' }}>
            <label className="tiny-label" htmlFor="format-select">Output format</label>
            <select id="format-select" className="action-btn" data-testid="format-select">
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
              <div style={{ marginBottom: '16px' }}>
                <label className="tiny-label" htmlFor="fade-in">Fade In (s)</label>
                <input
                  id="fade-in"
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={fadeIn}
                  onChange={e => setFadeIn(parseFloat(e.target.value))}
                  data-testid="fade-in-slider"
                />
                <span className="mono-data" data-testid="fade-in-value">{fadeIn}s</span>
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label className="tiny-label" htmlFor="fade-out">Fade Out (s)</label>
                <input
                  id="fade-out"
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={fadeOut}
                  onChange={e => setFadeOut(parseFloat(e.target.value))}
                  data-testid="fade-out-slider"
                />
                <span className="mono-data" data-testid="fade-out-value">{fadeOut}s</span>
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
            <div style={{ marginBottom: '16px' }}>
              <h3 className="tiny-label">Files to merge</h3>
              <ul>
                {files.map((f, idx) => (
                  <li key={idx} className="mono-data" data-testid="merge-file-item">
                    {f.name}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Initialize button */}
          <button className="action-btn" onClick={handleInitialize} data-testid="initialize-btn">
            Initialize
          </button>
        </div>
      </div>
    </div>
  );
}
