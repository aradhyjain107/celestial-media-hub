'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { FileDropzone } from '../../components/ui/FileDropzone';
import { BatchQueue, QueueItem } from '../../components/BatchQueue';
import { useJob, useHardwareProfile } from '../../context/GlobalJobContext';
import { getMediaBatchLimit } from '../../../lib/hardwareProfiler';
import { ResizableOptionsPanel } from '../../components/ui/ResizableOptionsPanel';
import { TooltipTop, TooltipBottom } from '../../components/ui/Tooltip';
import { StatusBadge, JobStatus } from '../../components/ui/StatusBadge';
import { MasterHeader } from '../../components/ui/MasterHeader';
import { safeFetch } from '../../../lib/safeFetch';
import { ensureSessionToken, appendAuthToken, useSessionToken } from '../../../lib/clientAuth';


type MuteMode = 'remove' | 'silence';

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  // eslint-disable-next-line security/detect-object-injection
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function splitFilename(name: string): { stem: string; ext: string } {
  const extIndex = name.lastIndexOf('.');
  const hasExt = extIndex > 0 && extIndex > name.length - 10;
  return {
    stem: hasExt ? name.slice(0, extIndex) : name,
    ext: hasExt ? name.slice(extIndex) : '',
  };
}

export default function VideoMuter() {
  const shouldReduceMotion = useReducedMotion();
  const sessionToken = useSessionToken();
  const { jobState, startJob, updateJob, clearJob } = useJob('muter');
  const hardwareProfile = useHardwareProfile();
  const videoRemuxLimit = getMediaBatchLimit(hardwareProfile, 'VIDEO', true);
  const [files, setFiles] = useState<File[]>(() => jobState?.files ?? []);
  const [mode, setMode] = useState<MuteMode>(() => jobState?.options?.mode ?? 'remove');

  // Derived state from context
  const progress = jobState?.progress ?? 0;
  const statusLabel = jobState?.statusText ?? 'AWAITING PAYLOAD';
  const processing = jobState?.status === 'processing';
  const queueItems = jobState?.queueItems ?? [];

  // Sync inputs to context when idle
  useEffect(() => {
    if (!jobState?.status || jobState?.status === 'idle') {
      updateJob({
        files,
        options: { mode },
      });
    }
  }, [files, mode, jobState?.status, updateJob]);

  const handleFilesSelected = (selectedFiles: File[]) => {
    setFiles(prev => {
      const combined = [...prev, ...selectedFiles].slice(0, videoRemuxLimit);
      const initialItems: QueueItem[] = combined.map((f, i) => ({
        id: `${f.name}-${f.size}-${i}`,
        filename: f.name,
        sizeBytes: f.size,
        status: 'pending',
        progress: 0,
      }));
      updateJob({ 
        statusText: 'AWAITING PAYLOAD', 
        progress: 0, 
        queueItems: initialItems, 
        files: combined,
        options: { mode }
      });
      return combined;
    });
  };

  const handleInitialize = async () => {
    if (files.length === 0 || processing) return;

    const formData = new FormData();
    formData.append('mode', mode);
    files.forEach(f => formData.append('files', f));

    try {
      updateJob({
        status: 'processing',
        progress: 0,
        statusText: files[0]?.size > 50 * 1024 * 1024 ? 'UPLOADING MEDIA PAYLOAD...' : 'INITIALIZING VIDEO MUTER...',
      });

      const authToken = await ensureSessionToken();
      const res = await safeFetch((process.env.NEXT_PUBLIC_API_BASE_URL ?? '') + '/api/mute', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Mute request failed' }));
        const errorMessage = typeof err.error === 'string' ? err.error : JSON.stringify(err.error) || 'Mute request failed';
        updateJob({ status: 'error', statusText: `ERROR: ${errorMessage}` });
        return;
      }

      startJob(res);
    } catch (err: any) {
      updateJob({ status: 'error', statusText: `ERROR: ${err.message || 'Mute request failed'}` });
    }
  };

  const handleClear = () => {
    setFiles([]);
    clearJob();
  };

  const hasFiles = files.length > 0;

  return (
    <>
      {/* Top utility bar */}
      <MasterHeader
        onlyUtilityBar
        toolName="VIDEO MUTER"
        engineId={mode === 'remove' ? 'STRIP-STREAM' : 'SILENCE-STITCH'}
      />

      {/* Workspace */}
      <div className="workspace">
        {/* Left: dropzone or batch queue */}
        <div className="dropzone-container">
          <MasterHeader
            onlyToolHeader
            targetId="TARGET // 02"
            title={<>Video<br/>Muter.</>}
            rightAction={hasFiles && (
              <TooltipTop content="Remove all files from queue">
                <motion.button
                  type="button"
                  onClick={handleClear}
                  className="tiny-label"
                  data-testid="clear-btn"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  style={{
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    padding: '4px 10px',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    color: 'var(--text-muted)'
                  }}
                >
                  [ CLEAR ALL ]
                </motion.button>
              </TooltipTop>
            )}
          />

          {!hasFiles ? (
            <FileDropzone
              onFilesSelected={handleFilesSelected}
              multiple={true}
              acceptedTypes={['.mov', '.mp4', '.mkv', '.webm']}
              formatsListText="Drop video files to mute. Supports .MOV, .MP4, .MKV, .WebM — up to 20 files."
            />
          ) : (
            <div data-lenis-prevent style={{ display: 'flex', flexDirection: 'column', flex: 1, padding: '20px 24px 24px', gap: '16px', overflowY: 'auto' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="tiny-label">BATCH QUEUE ({files.length} ITEMS)</span>
                <span className="mono-data" style={{ color: 'var(--accent)' }}>V: {files.length}</span>
              </div>

              {/* Queue List with 21st.dev staggered motion */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {files.map((file, idx) => {
                  const badgeColor = 'var(--accent)';
                  
                  return (
                    <motion.div
                      key={`${file.name}-${file.size}-${idx}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.15, delay: Math.min(idx * 0.03, 0.3) }}
                      data-testid="batch-file-item"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: 'rgba(15, 15, 18, 0.65)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '4px',
                        gap: '12px'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '2px',
                            border: `1px solid ${badgeColor}`,
                            color: badgeColor,
                            background: 'rgba(255, 90, 0, 0.1)',
                            letterSpacing: '0.06em'
                          }}
                        >
                          VIDEO
                        </span>
                        {(() => {
                          const { stem, ext } = splitFilename(file.name);
                          return (
                            <span
                              className="mono-data filename-truncate"
                              title={file.name}
                              dir="auto"
                              style={{ flex: 1, minWidth: 0 }}
                            >
                              <span className="filename-stem">{stem}</span>
                              {ext && <span className="filename-ext">{ext}</span>}
                            </span>
                          );
                        })()}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
                        {jobState?.status && jobState.status !== 'idle' && (
                          <StatusBadge status={jobState.status as JobStatus} />
                        )}
                        <span className="tiny-label" style={{ color: 'var(--text-muted)' }}>
                          {formatSize(file.size)}
                        </span>
                        {jobState?.downloadUrl && jobState?.status === 'complete' && (() => {
                          const jobId = jobState.downloadUrl.split('jobId=')[1]?.split('&')[0];
                          const ext = file.name.substring(file.name.lastIndexOf('.')) || '.mp4';
                          const baseName = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                          const targetFile = `muted_${baseName}${ext}`;
                          const rawHref = `/api/download?jobId=${jobId}&file=${encodeURIComponent(targetFile)}`;
                          const downloadHref = appendAuthToken(rawHref, sessionToken);
                          return (
                            <TooltipBottom content="Download muted file">
                              <motion.a
                                href={downloadHref}
                                download={targetFile}
                                className="tiny-label"
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                transition={{ duration: 0.12, ease: [0.23, 1, 0.32, 1] }}
                                style={{
                                  color: 'var(--accent)',
                                  border: '1px solid var(--accent)',
                                  background: 'rgba(255, 90, 0, 0.1)',
                                  borderRadius: '3px',
                                  padding: '3px 10px',
                                  textDecoration: 'none',
                                  fontWeight: 600
                                }}
                              >
                                [ DOWNLOAD ]
                              </motion.a>
                            </TooltipBottom>
                          );
                        })()}
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Add more files dropzone strip */}
              <div style={{ marginTop: '8px' }}>
                <FileDropzone
                  onFilesSelected={handleFilesSelected}
                  multiple={true}
                  acceptedTypes={['.mov', '.mp4', '.mkv', '.webm']}
                  formatsListText="+ Add more video files to mute batch"
                />
              </div>
            </div>
          )}
        </div>

        {/* Right: resizable options panel */}
        <ResizableOptionsPanel title="PROCESSING PARAMETERS">
          {/* Mode selector */}
          <fieldset className="form-group" style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend
              className="tiny-label"
              style={{
                width: '100%',
                borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                paddingBottom: '6px',
                marginBottom: '10px',
                fontSize: '0.625rem',
                letterSpacing: '0.08em',
                color: 'var(--text-muted)',
              }}
            >
              AUDIO MODE
            </legend>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* REMOVE AUDIO option row */}
              <label
                data-testid="mode-remove"
                data-selected={mode === 'remove'}
                className="cel-radio-row"
                style={{
                  cursor: processing ? 'not-allowed' : 'pointer',
                  opacity: processing ? 0.65 : 1,
                }}
              >
                <input
                  type="radio"
                  name="audioMode"
                  value="remove"
                  checked={mode === 'remove'}
                  disabled={processing}
                  onChange={() => !processing && setMode('remove')}
                  className="cel-radio-input"
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span className="mono-data" style={{ fontSize: '0.6875rem', letterSpacing: '0.06em', color: mode === 'remove' ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 700 }}>
                    REMOVE AUDIO STREAM
                  </span>
                  <span className="tiny-label" style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                    Drops audio tracks completely (-an) for instantaneous lossless video stream copy.
                  </span>
                </span>
              </label>

              {/* REPLACE WITH SILENCE option row */}
              <label
                data-testid="mode-silence"
                data-selected={mode === 'silence'}
                className="cel-radio-row"
                style={{
                  cursor: processing ? 'not-allowed' : 'pointer',
                  opacity: processing ? 0.65 : 1,
                }}
              >
                <input
                  type="radio"
                  name="audioMode"
                  value="silence"
                  checked={mode === 'silence'}
                  disabled={processing}
                  onChange={() => !processing && setMode('silence')}
                  className="cel-radio-input"
                />
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span className="mono-data" style={{ fontSize: '0.6875rem', letterSpacing: '0.06em', color: mode === 'silence' ? 'var(--accent)' : 'var(--text-muted)', fontWeight: 700 }}>
                    REPLACE WITH SILENCE
                  </span>
                  <span className="tiny-label" style={{ fontSize: '0.625rem', color: 'var(--text-muted)' }}>
                    Injects a silent audio track to guarantee compatibility with web players &amp; social apps.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          {/* File size summary */}
          <AnimatePresence>
            {hasFiles && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: [0.77, 0, 0.175, 1] }}
                className="form-group"
                style={{ overflow: 'hidden' }}
              >
                <div className="form-header" style={{ marginBottom: '10px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)', paddingBottom: '6px' }}>
                  <span className="tiny-label" style={{ fontSize: '10px', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>PAYLOAD SUMMARY</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '4px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">FILES</span>
                    <span className="mono-data">{files.length}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">TOTAL SIZE</span>
                    <span className="mono-data">{formatSize(files.reduce((acc, f) => acc + f.size, 0))}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span className="tiny-label">MODE</span>
                    <span className="mono-data" style={{ color: 'var(--accent)', fontWeight: 700 }}>{mode === 'remove' ? 'REMOVE' : 'SILENCE'}</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </ResizableOptionsPanel>
      </div>

      {/* Bottom progress section */}
      <div className="progress-section grid-line-top">
        <motion.button
          type="button"
          className="action-btn grid-line-right"
          onClick={handleInitialize}
          disabled={!hasFiles || processing}
          data-testid="initialize-btn"
          whileHover={!hasFiles || processing || shouldReduceMotion ? undefined : { scale: 1.01 }}
          whileTap={!hasFiles || processing || shouldReduceMotion ? undefined : { scale: 0.97 }}
          transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
          style={{
            opacity: (!hasFiles || processing) ? 0.5 : 1,
            cursor: (!hasFiles || processing) ? 'not-allowed' : 'pointer'
          }}
        >
          {processing ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <progress className="cel-spinner" aria-label="Processing" />
              PROCESSING...
            </span>
          ) : (
            'INITIALIZE'
          )}
        </motion.button>

        <div className="progress-track-area">
          <div className="progress-meta">
            <span className="tiny-label">{statusLabel}</span>
            <span className="mono-data" data-testid="queue-count">
              {files.length > 0 ? `QUEUE: ${files.length.toLocaleString('en-US')} FILE${files.length !== 1 ? 'S' : ''}` : 'QUEUE: 0 FILES'}
            </span>
          </div>
          <progress
            className="cel-progress"
            data-testid="progress-fill"
            max={100}
            value={Math.round(progress)}
            aria-label="Processing progress"
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
