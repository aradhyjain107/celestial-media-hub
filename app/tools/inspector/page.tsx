'use client'

import React, { useState } from 'react';
import { FileDropzone } from '../../components/ui/FileDropzone';

interface InspectResult {
  filename: string;
  size: number;
  format?: string;
  duration?: number;
  videoCodec?: string;
  resolution?: string;
  frameRate?: number;
  bitrate?: number;
  audioCodec?: string;
  audioChannels?: number;
  sampleRate?: number;
  createdAt?: string;
}

export default function MediaInspector() {
  const [status, setStatus] = useState<'READY' | 'ANALYZING...' | 'COMPLETE' | 'ERROR'>('READY');
  const [copyStatus, setCopyStatus] = useState<'COPY JSON' | 'COPIED!'>('COPY JSON');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [data, setData] = useState<InspectResult | null>(null);
  const [rawJson, setRawJson] = useState<string>('');
  const [compareData, setCompareData] = useState<InspectResult | null>(null);
  const [compareRawJson, setCompareRawJson] = useState<string>('');

  const formatBytes = (bytes?: number) =>
    bytes ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : '—';
  const formatSecs = (secs?: number) =>
    secs ? `${secs.toFixed(2)}s` : '—';

  const handleDrop = async (files: File[]) => {
    if (files.length === 0) return;
    setStatus('ANALYZING...');
    setErrorMsg(null);
    setData(null);
    setRawJson('');
    setCompareData(null);
    setCompareRawJson('');
    const formData = new FormData();
    formData.append('file', files[0]);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/inspect`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to inspect file');
      setData(json.metadata);
      setRawJson(JSON.stringify(json.metadata, null, 2));
      setStatus('COMPLETE');
    } catch (err: any) {
      setErrorMsg(err.message);
      setStatus('ERROR');
    }
  };

  const handleCompareDrop = async (files: File[]) => {
    if (files.length === 0) return;
    setStatus('ANALYZING...');
    setErrorMsg(null);
    const formData = new FormData();
    formData.append('file', files[0]);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? ''}/api/inspect`, {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to inspect file');
      setCompareData(json.metadata);
      setCompareRawJson(JSON.stringify(json.metadata, null, 2));
      if (status !== 'ERROR') setStatus('COMPLETE');
    } catch (err: any) {
      setErrorMsg(err.message);
      setStatus('ERROR');
    }
  };

  const handleClear = () => {
    setStatus('READY');
    setErrorMsg(null);
    setData(null);
    setRawJson('');
    setCompareData(null);
    setCompareRawJson('');
    setCopyStatus('COPY JSON');
  };

  const copyJson = () => {
    if (rawJson) {
      Promise.resolve(navigator.clipboard.writeText(rawJson)).then(() => {
        setCopyStatus('COPIED!');
        setTimeout(() => setCopyStatus('COPY JSON'), 2000);
      }).catch(() => {});
    }
  };

  const renderMetadata = (meta: InspectResult) => (
    <>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Filename</span>
        <span className="mono-data mt-1">{meta.filename || '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">File Size</span>
        <span className="mono-data mt-1">{formatBytes(meta.size)}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Format</span>
        <span className="mono-data mt-1">{meta.format || '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Duration</span>
        <span className="mono-data mt-1">{formatSecs(meta.duration)}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Video Codec</span>
        <span className="mono-data mt-1">{meta.videoCodec || '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Resolution</span>
        <span className="mono-data mt-1">{meta.resolution || '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Frame Rate</span>
        <span className="mono-data mt-1">{meta.frameRate ? `${meta.frameRate} fps` : '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Bitrate</span>
        <span className="mono-data mt-1">{meta.bitrate ? `${Math.round(meta.bitrate / 1000)} kbps` : '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Audio Codec</span>
        <span className="mono-data mt-1">{meta.audioCodec || '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Audio Channels</span>
        <span className="mono-data mt-1">{meta.audioChannels || '—'}</span>
      </div>
      <div className="flex flex-col border-b border-[#2a2a2a] py-2 w-full">
        <span className="tiny-label">Sample Rate</span>
        <span className="mono-data mt-1">{meta.sampleRate ? `${meta.sampleRate} Hz` : '—'}</span>
      </div>
      <div className="flex flex-col py-2 w-full">
        <span className="tiny-label">Created At</span>
        <span className="mono-data mt-1">{meta.createdAt || '—'}</span>
      </div>
    </>
  );

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
        <div className="dropzone-container">
          <div className="tool-header">
            <div className="tiny-label" style={{ marginBottom: '16px' }}>TARGET // 08</div>
            <h2 className="tool-title">Media<br/>Inspect.</h2>
          </div>
          <FileDropzone
            onFilesSelected={handleDrop}
            multiple={false}
            formatsListText="Drop any media file here to extract telemetry mapping."
          />
        </div>

        <aside className="options-panel grid-line-left">
          {status === 'READY' && (
            <div className="flex flex-col items-center justify-center h-full text-[#444444]">
              <span className="tiny-label">COMPARE FILE</span>
              <FileDropzone
                onFilesSelected={handleCompareDrop}
                multiple={false}
                formatsListText="Drop a second media file to compare."
                testId="compare-dropzone"
                heading="Drop compare file"
              />
            </div>
          )}
          <div className="options-header grid-line-bottom">
            <span className="tiny-label">INSPECTOR TARGET</span>
          </div>
          <div className="options-scroll">
            {status === 'READY' && (
              <div className="flex flex-col gap-4 items-center justify-center h-full text-[#444444]">
                <span className="mono-data">AWAITING PAYLOAD</span>
              </div>
            )}
            {status === 'ANALYZING...' && (
              <div className="flex flex-col gap-4 items-center justify-center h-full" style={{ color: 'var(--accent)' }}>
                <span className="mono-data">ANALYZING...</span>
              </div>
            )}
            {status === 'ERROR' && (
              <div className="flex flex-col gap-4 text-red-500">
                <span className="mono-data">ERROR:</span>
                <span className="mono-data break-all">{errorMsg}</span>
              </div>
            )}
            {status === 'COMPLETE' && data && (
              <div className="flex flex-col gap-6 w-full">
                <div className="grid grid-cols-2 gap-4">
                  {/* Primary file column */}
                  <div className="flex flex-col gap-2">
                    {renderMetadata(data)}
                    <div className="flex flex-col gap-4 mt-4 mb-16">
                      <button onClick={copyJson} className="action-btn" style={{ width: '100%', height: '40px', fontSize: '13px', background: '#2a2a2a', color: '#fff' }}>{copyStatus}</button>
                      <button onClick={handleClear} className="action-btn" style={{ width: '100%', height: '40px', fontSize: '13px', background: 'transparent', border: '1px solid #2a2a2a', color: '#888' }}>CLEAR</button>
                    </div>
                  </div>
                  {/* Compare file column */}
                  <div className="flex flex-col gap-2">
                    {compareData ? renderMetadata(compareData) : (
                      <div className="flex flex-col items-center justify-center h-full text-[#444444]">
                        <span className="mono-data">COMPARE FILE</span>
                        <FileDropzone
                          onFilesSelected={handleCompareDrop}
                          multiple={false}
                          formatsListText="Drop a second media file to compare."
                          testId="compare-dropzone"
                          heading="Drop compare file"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>

      <div className="progress-section grid-line-top">
        <button className="action-btn grid-line-right" onClick={() => { if (status === 'COMPLETE') handleClear(); else if (status === 'READY') handleDrop([]); }}>
          {status === 'COMPLETE' ? 'RESET' : 'INSPECT'}
        </button>
        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">STATUS FEED</span>
            <span className="mono-data" style={{ color: status === 'ERROR' ? '#ef4444' : 'inherit' }}>{status}</span>
          </div>
          <div className="track">
            <div className="fill" style={{ width: status === 'COMPLETE' ? '100%' : status === 'ANALYZING...' ? '50%' : '0%' }}></div>
          </div>
        </div>
      </div>
    </>
  );
}
