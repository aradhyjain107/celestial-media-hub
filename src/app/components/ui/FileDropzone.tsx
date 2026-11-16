'use client'

import React, { useRef, useState } from 'react';

export interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  acceptedTypes?: string[];
  multiple?: boolean;
  formatsListText?: string;
  maxSizeMB?: number;
  testId?: string;
  heading?: string;
}

export function FileDropzone({ 
  onFilesSelected, 
  acceptedTypes = [], 
  multiple = true, 
  formatsListText = 'Accepted formats: .*', 
  maxSizeMB = 5000,
  testId = 'dropzone',
  heading = 'Drop media to begin'
}: FileDropzoneProps) {
  const [isActive, setIsActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsActive(false);
  };

  const processFiles = (files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files).filter(f => {
      if (acceptedTypes.length > 0) {
        const ext = f.name.split('.').pop()?.toLowerCase();
        const matches = acceptedTypes.some(t => {
          const check = t.toLowerCase();
          return check === ext || (check.startsWith('.') && check === `.${ext}`) || f.type.includes(check.replace('.', ''));
        });
        if (!matches) return false;
      }
      return f.size <= maxSizeMB * 1024 * 1024;
    });
    
    if (valid.length > 0) {
      onFilesSelected(multiple ? valid : [valid[0]]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsActive(false);
    processFiles(e.dataTransfer.files);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      fileInputRef.current?.click();
    } else if (e.key === ' ') {
      e.preventDefault();
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault();
      fileInputRef.current?.click();
    }
  };

  return (
    <>
      <input
        type="file"
        className="sr-only"
        ref={fileInputRef}
        multiple={multiple}
        accept={acceptedTypes.length > 0 ? acceptedTypes.join(',') : undefined}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          processFiles(e.target.files);
          try {
            e.currentTarget.value = '';
          } catch {}
        }}
        data-testid={testId === 'dropzone' ? 'file-input' : `${testId}-input`}
      />
      <button
        type="button"
        className={`drop-target-area ${isActive ? 'active glow-accent' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        aria-label={`${heading}. Click to browse or drag and drop files.`}
        data-testid={testId}
      >
        <span className="target-crosshair" aria-hidden="true">
          {/* Reticle corner markers */}
          <span className="reticle-corner corner-tl" />
          <span className="reticle-corner corner-tr" />
          <span className="reticle-corner corner-bl" />
          <span className="reticle-corner corner-br" />

          {/* Reticle axis lines */}
          <span className="crosshair-axis axis-h" />
          <span className="crosshair-axis axis-v" />

          {/* Center glowing Plus / Add Items Badge */}
          <span
            className="target-add-badge"
            data-testid="add-items-icon"
          >
            <svg
              aria-hidden="true"
              className="add-items-icon"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </span>
        </span>
        <span className="drop-instruction" style={{ display: 'block' }}>
          <span className="drop-heading" style={{ display: 'block' }}>
            {heading}
          </span>
          <span className="tiny-label drop-subtext" style={{ display: 'block' }}>{formatsListText}</span>
        </span>
      </button>
    </>
  );
}
