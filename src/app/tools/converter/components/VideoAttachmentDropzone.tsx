'use client'

import React, { useRef, useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { splitFilename } from '../../../../lib/utils/filename';
import { MasterGlassCard } from '../../../components/ui/MasterGlassCard';
import { MasterMicroBadge } from '../../../components/ui/MasterMicroBadge';

export interface VideoAttachmentDropzoneProps {
  /** Currently attached video file, or null */
  attachedVideo: File | null;
  /** Callback when video is attached, replaced, or cleared */
  onAttachVideo: (file: File | null) => void;
  /** Flag whether procedural visualizer mode is enabled */
  useVisualizer: boolean;
  /** Callback to toggle procedural visualizer mode */
  onToggleVisualizer: (enabled: boolean) => void;
}

export function VideoAttachmentDropzone({
  attachedVideo,
  onAttachVideo,
  useVisualizer,
  onToggleVisualizer,
}: VideoAttachmentDropzoneProps) {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const [isDragOver, setIsDragOver] = useState(false);
  const [metadata, setMetadata] = useState<{ duration: number; width: number; height: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!attachedVideo) {
      setMetadata(null);
      return;
    }
    const url = URL.createObjectURL(attachedVideo);
    const video = document.createElement('video');
    video.src = url;
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      setMetadata({
        duration: video.duration || 30,
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
      });
      URL.revokeObjectURL(url);
    };
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [attachedVideo]);

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (file.type.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(file.name)) {
      onAttachVideo(file);
      onToggleVisualizer(false);
    }
  };

  return (
    <MasterGlassCard variant="surface2" style={{ padding: '16px' }}>
      <input
        type="file"
        ref={fileInputRef}
        hidden
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
        onChange={(e) => handleFiles(e.target.files)}
        data-testid="video-file-input"
      />

      <div className="form-header" style={{ marginBottom: '12px' }}>
        <span className="tiny-label">COMPANION VIDEO ATTACHMENT</span>
        <MasterMicroBadge 
          label={attachedVideo ? 'ATTACHED' : 'NONE'} 
          variant={attachedVideo ? 'emerald' : 'muted'} 
        />
      </div>

      {!attachedVideo ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); handleFiles(e.dataTransfer.files); }}
          data-testid="video-dropzone-empty"
          style={{
            border: isDragOver ? '1px dashed var(--accent, #FF5A00)' : '1px dashed rgba(255, 255, 255, 0.15)',
            background: isDragOver ? 'rgba(255, 90, 0, 0.08)' : 'rgba(10, 10, 12, 0.5)',
            padding: '20px 16px',
            borderRadius: '6px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <motion.button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            data-testid="browse-video-btn"
            whileHover={shouldReduceMotion ? undefined : { scale: 1.01 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.98 }}
            transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 28 }}
            style={{
              width: '100%',
              background: 'transparent',
              border: 'none',
              padding: '4px',
              color: 'inherit',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <span aria-hidden="true" style={{ width: '40px', height: '40px', borderRadius: '50%', border: '1px solid rgba(255, 255, 255, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ color: 'var(--accent, #FF5A00)', fontSize: '1.125rem' }}>+</span>
            </span>
            <span>
              <span className="mono-data" style={{ fontWeight: 700, color: 'var(--text-main, #fff)', display: 'block' }}>
                DROP VIDEO CLIP (MP4, MOV, WEBM, MKV)
              </span>
              <span className="tiny-label" style={{ color: 'var(--text-muted, #888)' }}>
                Or click to browse from device
              </span>
            </span>
          </motion.button>
          <button
            type="button"
            data-testid="visualizer-toggle"
            onClick={() => onToggleVisualizer(true)}
            style={{
              minHeight: '36px',
              padding: '6px 14px',
              fontSize: '0.625rem',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              background: 'rgba(255, 90, 0, 0.1)',
              border: '1px solid var(--accent, #FF5A00)',
              color: 'var(--accent, #FF5A00)',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            [ USE PROCEDURAL VISUALIZER ]
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="video-dropzone-attached">
          {/* Metadata Breakdown */}
          <div style={{ padding: '12px', background: 'rgba(10, 10, 12, 0.7)', borderRadius: '4px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <span className="tiny-label" style={{ flexShrink: 0 }}>FILE</span>
              {(() => {
                const { stem, ext } = splitFilename(attachedVideo.name);
                return (
                  <span
                    className="mono-data filename-truncate"
                    title={attachedVideo.name}
                    dir="auto"
                    style={{ fontWeight: 700, color: 'var(--text-main, #fff)' }}
                  >
                    <span className="filename-stem">{stem}</span>
                    {ext && <span className="filename-ext">{ext}</span>}
                  </span>
                );
              })()}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span className="tiny-label">SIZE</span>
              <span className="mono-data">{(attachedVideo.size / (1024 * 1024)).toFixed(2)} MB</span>
            </div>
            {metadata && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span className="tiny-label">DURATION</span>
                  <span className="mono-data">{metadata.duration.toFixed(2)}s</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span className="tiny-label">RESOLUTION</span>
                  <span className="mono-data">{metadata.width} × {metadata.height}</span>
                </div>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <motion.button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              data-testid="replace-video-btn"
              whileHover={shouldReduceMotion ? undefined : { scale: 1.03 }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
              style={{
                minHeight: '36px',
                padding: '8px 12px',
                fontSize: '0.625rem',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 700,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '4px',
                color: 'var(--text-main, #fff)',
                cursor: 'pointer',
              }}
            >
              [ REPLACE VIDEO ]
            </motion.button>
            <motion.button
              type="button"
              onClick={() => {
                onAttachVideo(null);
                onToggleVisualizer(true);
              }}
              data-testid="remove-video-btn"
              whileHover={shouldReduceMotion ? undefined : { scale: 1.03, backgroundColor: 'rgba(239, 68, 68, 0.15)' }}
              whileTap={shouldReduceMotion ? undefined : { scale: 0.95 }}
              style={{
                minHeight: '36px',
                padding: '8px 12px',
                fontSize: '0.625rem',
                fontFamily: 'var(--font-mono, monospace)',
                fontWeight: 700,
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '4px',
                color: '#ef4444',
                cursor: 'pointer',
              }}
            >
              [ REMOVE VIDEO ]
            </motion.button>
          </div>
          
          <motion.button
            type="button"
            onClick={() => onToggleVisualizer(!useVisualizer)}
            data-testid="visualizer-toggle"
            whileHover={shouldReduceMotion ? undefined : { scale: 1.02 }}
            whileTap={shouldReduceMotion ? undefined : { scale: 0.96 }}
            style={{
              width: '100%',
              minHeight: '36px',
              padding: '8px 12px',
              fontSize: '0.625rem',
              fontFamily: 'var(--font-mono, monospace)',
              fontWeight: 700,
              background: useVisualizer ? 'var(--accent, #FF5A00)' : 'rgba(255, 90, 0, 0.1)',
              color: useVisualizer ? '#000000' : 'var(--accent, #FF5A00)',
              border: '1px solid var(--accent, #FF5A00)',
              borderRadius: '4px',
              cursor: 'pointer',
              boxShadow: useVisualizer ? '0 0 12px rgba(255, 90, 0, 0.3)' : 'none',
            }}
          >
            {useVisualizer ? '[ RETURN TO VIDEO PREVIEW ]' : '[ SWITCH TO VISUALIZER ]'}
          </motion.button>
        </div>
      )}
    </MasterGlassCard>
  );
}
