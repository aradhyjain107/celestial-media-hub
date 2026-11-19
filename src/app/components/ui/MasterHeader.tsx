'use client'

import React from 'react';
import { motion } from 'framer-motion';

export interface MasterHeaderProps {
  toolName?: string;
  engineLabel?: string;
  engineId?: string;
  targetId?: string;
  title?: React.ReactNode;
  subtitle?: string;
  version?: string;
  hwAccelText?: React.ReactNode;
  rightAction?: React.ReactNode;
  onlyUtilityBar?: boolean;
  onlyToolHeader?: boolean;
  headerStyle?: React.CSSProperties;
  titleStyle?: React.CSSProperties;
  titleRowAlign?: 'flex-start' | 'center';
}

export function MasterUtilityBar({
  toolName = 'TOOL',
  engineLabel = 'ENGINE',
  engineId = 'CORE',
  version = 'V. 2.0.0',
  hwAccelText = 'PROCESSING CORE: ONLINE ●',
}: {
  toolName?: string;
  engineLabel?: string;
  engineId?: string;
  version?: string;
  hwAccelText?: React.ReactNode;
}) {
  return (
    <div className="top-utility-bar grid-line-bottom">
      <div className="left-stats">
        <span className="tiny-label">CELESTIAL // {toolName.toUpperCase()}</span>
        <span className="tiny-label" style={{ color: 'var(--accent)' }}>
          {engineLabel.toUpperCase()}: {engineId.toUpperCase()}
        </span>
        {typeof hwAccelText === 'string' ? (
          <span className="tiny-label" style={{ color: 'var(--text-muted)' }}>{hwAccelText}</span>
        ) : (
          hwAccelText
        )}
      </div>
      <div className="right-actions">
        <span className="tiny-label">{version}</span>
      </div>
    </div>
  );
}

export function MasterToolHeader({
  targetId = 'TARGET // 01',
  title = '',
  subtitle,
  rightAction,
  headerStyle,
  titleStyle,
  titleRowAlign = 'flex-start',
}: {
  targetId?: string;
  title?: React.ReactNode;
  subtitle?: string;
  rightAction?: React.ReactNode;
  headerStyle?: React.CSSProperties;
  titleStyle?: React.CSSProperties;
  titleRowAlign?: 'flex-start' | 'center';
}) {
  return (
    <div className="tool-header grid-line-bottom" style={headerStyle}>
      <div className="tiny-label">{targetId}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: titleRowAlign }}>
        <div>
          <h1 id="page-main-heading" tabIndex={-1} className="tool-title" style={titleStyle}>{title}</h1>
          {subtitle && (
            <p className="tiny-label" style={{ color: 'var(--text-muted)', marginTop: '6px' }}>
              {subtitle}
            </p>
          )}
        </div>
        {rightAction}
      </div>
    </div>
  );
}

export function MasterHeader({
  toolName = 'TOOL',
  engineLabel = 'ENGINE',
  engineId = 'CORE',
  targetId = 'TARGET // 01',
  title = '',
  subtitle,
  version = 'V. 2.0.0',
  hwAccelText = 'PROCESSING CORE: ONLINE ●',
  rightAction,
  onlyUtilityBar = false,
  onlyToolHeader = false,
  headerStyle,
  titleStyle,
  titleRowAlign = 'flex-start',
}: MasterHeaderProps) {
  if (onlyUtilityBar) {
    return (
      <MasterUtilityBar
        toolName={toolName}
        engineLabel={engineLabel}
        engineId={engineId}
        version={version}
        hwAccelText={hwAccelText}
      />
    );
  }

  if (onlyToolHeader) {
    return (
      <MasterToolHeader
        targetId={targetId}
        title={title}
        subtitle={subtitle}
        rightAction={rightAction}
        headerStyle={headerStyle}
        titleStyle={titleStyle}
        titleRowAlign={titleRowAlign}
      />
    );
  }

  return (
    <>
      <MasterUtilityBar
        toolName={toolName}
        engineLabel={engineLabel}
        engineId={engineId}
        version={version}
        hwAccelText={hwAccelText}
      />
      <MasterToolHeader
        targetId={targetId}
        title={title}
        subtitle={subtitle}
        rightAction={rightAction}
        headerStyle={headerStyle}
        titleStyle={titleStyle}
        titleRowAlign={titleRowAlign}
      />
    </>
  );
}
