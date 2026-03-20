'use client'

import React, { useRef, useState } from 'react';

export interface FileDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  acceptedTypes?: string[];
  multiple?: boolean;
  formatsListText?: string;
  maxSizeMB?: number;
}

export function FileDropzone({ 
  onFilesSelected, 
  acceptedTypes = [], 
  multiple = true, 
  formatsListText = 'Accepted formats: .*', 
  maxSizeMB = 5000 
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

  return (
    <div 
      className={`drop-target-area ${isActive ? 'active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => fileInputRef.current?.click()}
      data-testid="dropzone"
    >
      <input 
        type="file" 
        hidden 
        ref={fileInputRef} 
        multiple={multiple}
        accept={acceptedTypes.length > 0 ? acceptedTypes.join(',') : undefined}
        onChange={(e) => processFiles(e.target.files)}
        data-testid="file-input"
      />
      <div className="target-crosshair"></div>
      <div className="drop-instruction">
        <h3>Drop media to begin</h3>
        <p>{formatsListText}</p>
      </div>
    </div>
  );
}
