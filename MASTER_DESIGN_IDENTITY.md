# CELESTIAL MEDIA HUB — MASTER DESIGN IDENTITY SPECIFICATION
**System Architecture & Design Identity Synthesis**  
**Document Version**: 1.0.0 // PRODUCTION MASTER  
**Target Platform**: Celestial Media Hub (`celestial-media-hub`)  
**Author**: Master Judge Subagent (`master_judge_1`)  
**Effective Date**: 2026-08-13  

---

## 1. Executive Synthesis & Architectural Vision

Celestial Media Hub is a high-performance, dark-mode web platform housing 6 core media tools: Video Muter (`/tools/muter`), HEVC Compressor (`/tools/hevc`), Universal Converter (`/tools/converter`), YouTube Downloader (`/tools/youtube`), Audio Trimmer (`/tools/trimmer`), and Spotify Converter (`/tools/spotify`).

This **Master Design Identity** establishes a single, unified design system synthesized from four specialized research domains:

```
+---------------------------------------------------------------------------------------------------+
|                                 CELESTIAL MEDIA HUB MASTER SYSTEM                                 |
+---------------------------------------------------------------------------------------------------+
|  PODIUM.GLOBAL             LENIS.DEV                 RIVE.APP                 GODLY.WEBSITE       |
|  Brutalist Micro-Typography Smooth Lerp Physics     Vector Motion Machines   Dark Glassmorphism   |
|  SYS.CORE// Aesthetic      Kinetic Inertia & Skew   WASM State Morphing      Bento Showcase Grids |
+---------------------------------------------------------------------------------------------------+
                                                  |
                                                  v
+---------------------------------------------------------------------------------------------------+
|                              UNIFIED MASTER DESIGN IDENTITY (SYS.CORE//)                          |
|  - Stark Cyberpunk Palette (#030304 Void / #FF5A00 Cyber Orange Accent / High-Viz Technical Mono)|
|  - Glassmorphic Surface Stack (Multi-layered backdrop blurs + specular edge highlights + noise)   |
|  - Lerp Smooth Scroll (Lenis 0.09 lerp factor + velocity-aware skew transform & spring inertia)   |
|  - Rive WASM Vector Machines (State machine inputs: Idle -> Hover -> Drag -> Process -> Complete) |
|  - Strict Control Standardisation (Unified glass option tiles replacing native HTML controls)     |
+---------------------------------------------------------------------------------------------------+
```

### The 4 Pillars of the Master Design Identity

1. **Brutalist Micro-Typography & Technical Aesthetic (`SYS.CORE//`)** *(from Podium)*:
   - Rigid 1px grid divider lines (`.grid-line-top`, `.grid-line-bottom`, `.grid-line-left`, `.grid-line-right`).
   - Technical metadata tags (`TARGET // 01` through `TARGET // 06`, `ENGINE: STRIP-STREAM`, `HW ACCEL: AUTO`).
   - High-density uppercase micro-caps (`0.1em` tracking) and monospace tabular data readouts.

2. **Smooth Physics & Lerp Mechanics** *(from Lenis)*:
   - Mathematical linear interpolation ($S(t+\Delta t) = S(t) + \alpha(S_{\text{target}} - S(t))$ with $\alpha = 0.09$).
   - Kinetic spring inertia (stiffness 300 / damping 25) and velocity-driven visual feedback ($v(t)$ calculation driving skew and scale).
   - Container scroll isolation via `data-lenis-prevent` to safeguard sub-panel scrolling.

3. **Vector Interactive Motion & State Machine Triggers** *(from Rive)*:
   - Lightweight (<20KB) WebGL/WASM vector graphics with resolution independence.
   - Interactive state machine inputs (`SMIBoolean`, `SMINumber`, `SMITrigger`).
   - Smooth vector path morphing (target crosshair $\rightarrow$ checkmark, waveform $\rightarrow$ mute slash, play triangle $\rightarrow$ pause bars).
   - Dynamic canvas coordinate normalization for mouse reticle tracking.

4. **State-of-the-Art Visual Presentation & Dark Glassmorphism Depth** *(from Godly)*:
   - Multi-layered translucent glass surfaces (`backdrop-filter: blur(20px)`).
   - Dynamic mouse-following radial spotlight glow (`radial-gradient` tracking `--mouse-x` / `--mouse-y`).
   - Tactile film grain noise overlay (3.5% opacity SVG turbulence filter).
   - Bento Showcase Grid layout hierarchy for system dashboard.

---

## 2. Master CSS Design Tokens (`globals.css`)

All components in Celestial Media Hub must consume the standard custom CSS properties below. Hardcoded inline hex values (e.g. legacy cyan/magenta in HEVC or unstyled native inputs in Trimmer) are strictly prohibited.

```css
/* ==========================================================================
   CELESTIAL MEDIA HUB MASTER DESIGN TOKENS (SYS.CORE// VERSION 1.0.0)
   ========================================================================== */

:root {
  /* 1. Canvas & Surface Layers (Godly Depth) */
  --bg-void: #030304;                    /* Primary deep background */
  --bg-surface-1: #09090b;               /* Main panel surface */
  --bg-surface-2: #121215;               /* Floating card surface */
  --bg-surface-3: #1a1a20;               /* Overlay & modal surface */
  
  /* Glassmorphism & Backdrop Tokens */
  --glass-surface-1: rgba(9, 9, 11, 0.70);
  --glass-surface-2: rgba(18, 18, 21, 0.80);
  --glass-surface-hover: rgba(255, 90, 0, 0.08);
  --glass-blur-sm: 8px;
  --glass-blur-md: 16px;
  --glass-blur-lg: 24px;

  /* 2. Color Palette Tokens */
  --accent-primary: #FF5A00;             /* Cyberpunk Orange */
  --accent-hover: #FF7B33;               /* Hover highlight orange */
  --accent-glow: rgba(255, 90, 0, 0.35);  /* Ambient glow shadow */
  --accent-subtle: rgba(255, 90, 0, 0.12);/* Active tile backdrop */

  --status-online: #10b981;              /* Emerald active */
  --status-processing: #FF5A00;          /* Orange busy */
  --status-warning: #f59e0b;             /* Amber caution */
  --status-error: #ef4444;               /* Crimson fault */

  /* 3. Border & Grid Line Tokens (Podium Brutalism) */
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-stark: #2a2a2e;
  --border-active: #FF5A00;
  --border-specular: rgba(255, 255, 255, 0.18);
  --grid-line-color: #1f1f22;

  /* 4. Text & Typography Tokens */
  --text-primary: #f4f4f5;               /* High contrast body text */
  --text-secondary: #a1a1aa;             /* Descriptive text */
  --text-tertiary: #52525b;              /* Dark meta & indexes */
  --text-inverse: #000000;

  --font-sans: var(--font-sans), -apple-system, BlinkMacSystemFont, "Geist", "Segoe UI", sans-serif;
  --font-mono: var(--font-mono), "Geist Mono", "JetBrains Mono", "SF Mono", monospace;

  /* Monospace & Micro-Typography Scale */
  --text-micro: 9px;
  --text-mini: 10px;
  --text-mono-sm: 11px;
  --text-mono-base: 12px;
  --text-title-sm: 16px;
  --text-title-hero: clamp(2.2rem, 4.5vw, 4.5rem);

  /* Letter Spacing (Tracking) Tokens */
  --tracking-tight: -0.04em;
  --tracking-normal: 0em;
  --tracking-mono: 0.05em;
  --tracking-microcaps: 0.1em;
  --tracking-widest: 0.15em;

  /* 5. Motion & Physics Tokens (Lenis + Framer Motion) */
  --lenis-lerp: 0.09;
  --ease-lenis: cubic-bezier(0.16, 1, 0.3, 1);
  
  --spring-stiffness-snappy: 400;
  --spring-damping-snappy: 28;
  --spring-stiffness-default: 300;
  --spring-damping-default: 25;
  --spring-stiffness-fluid: 220;
  --spring-damping-fluid: 20;

  /* 6. Layout & Spatial Grid Tokens */
  --grid-base: 8px;
  --sidebar-width: 240px;
  --options-width: 340px;
  --topbar-height: 48px;
  --bottombar-height: 80px;
}
```

---

## 3. Brutalist Micro-Typography & Technical Aesthetic Specs (`SYS.CORE//`)

### 3.1 Typographic Hierarchy Specification

| Hierarchy Tier | Target Element | Font Family | Size / Line Height | Letter Spacing | Case & Weight |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Hero Title** | Page Headline | `var(--font-sans)` | `clamp(2.2rem, 4.5vw, 4.5rem)` / `0.85` | `-0.04em` | Uppercase, Black (900) |
| **Section Title** | Card / Panel Header | `var(--font-sans)` | `1.25rem (20px)` / `1.1` | `-0.02em` | SemiBold (600) |
| **Tiny Label** | Technical Tag / Target | `var(--font-mono)` | `10px (0.625rem)` / `1.0` | `+0.1em` | Uppercase, Bold (700) |
| **Mono Data** | Telemetry / Numbers | `var(--font-mono)` | `11px - 12px` / `1.2` | `+0.05em` | Tabular-nums, Medium (500) |
| **Micro Badge** | Status / Strategy Badges | `var(--font-mono)` | `9px` / `1.0` | `+0.1em` | Uppercase, Bold (700) |

### 3.2 Standardized Header Contract (`TARGET // XX`)

Every tool page header must render using the unified format below:

```tsx
<div className="tool-header grid-line-bottom" style={{ padding: '20px 24px' }}>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
    <div>
      <span className="tiny-label" style={{ color: 'var(--text-secondary)', letterSpacing: 'var(--tracking-microcaps)' }}>
        TARGET // {targetNumber}
      </span>
      <h2 className="tool-title" style={{ marginTop: '8px' }}>
        {titleLine1}<br />{titleLine2}
      </h2>
    </div>
    {fileCount > 0 && (
      <motion.button onClick={onClear} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="clear-btn">
        CLEAR ×
      </motion.button>
    )}
  </div>
</div>
```

---

## 4. Smooth Physics & Lerp Mechanics (Lenis Integration & Production Implementation)

> [!NOTE]
> **Production Runtime Architecture Note**:
> While early design specifications drafted `@studio-freight/lenis` virtualized lerp scrolling ($\alpha = 0.09$), the production web application executes scrolling via native hardware-accelerated CSS (`scroll-behavior: smooth`, `overscroll-behavior: contain`) and Framer Motion spring physics (`stiffness: 300, damping: 25`). This avoids third-party scroll-hijacking runtimes and memory overhead while preserving responsive 60fps interaction across all workstation and mobile viewports. Container isolation attributes (`data-lenis-prevent`) remain respected for forward compatibility.

### 4.1 Physics Engine Formulae

Lenis virtualizes wheel/touch scrolling and calculates position $S(t)$ frame-by-frame inside a `requestAnimationFrame` loop:

$$\text{Lerp Position}: S(t + \Delta t) = S(t) + \alpha \cdot (S_{\text{target}} - S(t)) \quad (\alpha = 0.09)$$

$$\text{Deceleration Curve}: f(t) = \min\left(1, 1.001 - 2^{-10t}\right)$$

$$\text{Velocity Vector}: v(t) = \frac{S(t) - S(t - 1)}{\Delta t}$$

### 4.2 Velocity-Aware Skew & Inertia Transformation

Cards and list items respond dynamically to fast user scrolling by calculating scroll velocity $v(t)$ and applying subtle skew and scale compression:

```tsx
// Velocity transformation rule inside Lenis scroll callback
const skewY = useTransform(smoothVelocity, [-1000, 1000], [-3, 3]); // Max 3 deg skew
const scale = useTransform(smoothVelocity, [-1000, 0, 1000], [0.98, 1, 0.98]);
```

### 4.3 Container Protection Rules

To prevent wheel events inside options sidebars or track lists from locking the root viewport, nested scroll containers MUST include the `data-lenis-prevent` attribute:

```html
<aside class="options-panel grid-line-left options-scroll" data-lenis-prevent>
  <!-- Scrollable parameter form controls -->
</aside>
```

---

## 5. Vector Interactive Motion & State Machine Architecture

> [!NOTE]
> **Production Runtime Architecture Note**:
> While design models specified Rive WASM binaries (`RA-01` through `RA-06`), the production runtime implements all vector interactive states (dropzone crosshairs, radial loading spinners, play/pause and mute/wave path morphing, status badges, and cursor reticles) directly through Framer Motion SVG path interpolation and HTML5 Canvas (`app/components/ui/` primitives). This eliminates `@rive-app/canvas` WASM bundle overhead (~2.5MB) and WebGL context limits while executing fluid 60fps vector state transitions natively.

### 5.1 Vector State Machine & Motion Inventory

| Asset ID | Path | State Machine | Core Inputs | Morphing / Behavioral Description |
| :--- | :--- | :--- | :--- | :--- |
| `RA-01` | `/rive/dropzone_crosshair.riv` | `DropzoneMachine` | `isHovered` (Bool)<br/>`isDragging` (Bool)<br/>`onDrop` (Trigger)<br/>`onSuccess` (Trigger) | Rotating outer grid ring, corner reticles, and vector crosshair morphing into checkmark on drop. |
| `RA-02` | `/rive/processing_spinner.riv` | `LoaderState` | `Progress` (Num 0-100)<br/>`isProcessing` (Bool)<br/>`onSuccess` (Trigger)<br/>`onError` (Trigger) | Cyberpunk radial loader ring with percentage numeric counter and state pulse glow. |
| `RA-03` | `/rive/morph_play_pause.riv` | `PlayPauseState` | `isPlaying` (Bool)<br/>`onToggle` (Trigger) | Vector node path morphing between Play Triangle and Pause parallel bars. |
| `RA-04` | `/rive/morph_mute_wave.riv` | `MuteState` | `isMuted` (Bool)<br/>`onToggle` (Trigger) | Audio wave amplitude lines morphing into a diagonal mute slash path. |
| `RA-05` | `/rive/status_badge_machine.riv` | `BadgeState` | `StatusIndex` (Num 0:Pending, 1:Proc, 2:Done, 3:Err) | Vector badge icon switching between pulse dot, spinner, checkmark, and alert triangle. |
| `RA-06` | `/rive/cursor_reticle.riv` | `CursorState` | `Axis_X` (Num 0-100)<br/>`Axis_Y` (Num 0-100)<br/>`isHoveringTarget` (Bool) | WASM vector reticle tracking normalized cursor coordinates over canvas views. |

### 5.2 Canvas Mouse Coordinate Normalization Formula

$$\text{Axis}_X = \text{clamp}\left(0, 100, \frac{\text{clientX} - \text{rect.left}}{\text{rect.width}} \times 100\right)$$

$$\text{Axis}_Y = \text{clamp}\left(0, 100, \frac{\text{clientY} - \text{rect.top}}{\text{rect.height}} \times 100\right)$$

---

## 6. Visual Presentation, Dark Glassmorphism Depth & Bento Layout (Godly)

### 6.1 Multi-Layered Surface Elevation Stack

```
+-----------------------------------------------------------------------------------+
| LAYER 3: Modal Dialogs & Floating Toolbars (rgba(26, 26, 32, 0.90) + Blur 24px)   |
|   +---------------------------------------------------------------------------+   |
|   | LAYER 2: Options Panels & Active Cards (rgba(18, 18, 21, 0.80) + Blur 16px) |   |
|   |   +-------------------------------------------------------------------+   |   |
|   |   | LAYER 1: Workspace Cards (rgba(9, 9, 11, 0.70) + Blur 8px)        |   |   |
|   |   |   +-----------------------------------------------------------+   |   |   |
|   |   |   | LAYER 0: Canvas Void (#030304 Base + 3.5% Noise Texture)  |   |   |   |
```

### 6.2 Bento Showcase Grid Architecture (System Overview Dashboard)

The main landing overview (`/`) uses a 12-column Bento Grid layout to establish clear visual dominance:
- **Featured Heroic Tool Card** (spans 7 columns, 2 rows): Highlights prime tools with interactive Rive previews.
- **Secondary Highlight Cards** (span 5 columns): Audio Trimmer waveform / HEVC compressor statistics.
- **Standard Tool Cards** (span 4 columns): Universal Converter, YouTube Downloader, Spotify Converter.

---

## 7. Unified Component System Specifications

### 7.1 `MasterGlassCard.tsx`
*Combines Godly glassmorphism surface elevation, dynamic radial mouse spotlight glow, and specular top edge highlight.*

```tsx
'use client';

import React, { useRef, useState, MouseEvent } from 'react';
import { motion } from 'framer-motion';

interface MasterGlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
  spotlightColor?: string;
}

export function MasterGlassCard({
  children,
  className = '',
  onClick,
  spotlightColor = 'rgba(255, 90, 0, 0.15)',
}: MasterGlassCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  return (
    <motion.div
      ref={cardRef}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onMouseMove={handleMouseMove}
      whileHover={{ y: -2, scale: 1.01 }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: 'spring', stiffness: 300, damping: 25 }}
      className={`relative overflow-hidden rounded-sm border border-[var(--border-subtle)] bg-[var(--glass-surface-1)] backdrop-blur-md transition-colors duration-300 hover:border-[var(--border-active)] ${className}`}
      style={{
        boxShadow: isHovered
          ? '0 10px 30px -10px rgba(0, 0, 0, 0.8), 0 0 20px var(--accent-glow)'
          : '0 4px 20px rgba(0, 0, 0, 0.4)',
      }}
    >
      {/* Specular Top Edge Highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-[var(--border-specular)] to-transparent opacity-60" />

      {/* Dynamic Mouse Spotlight Radial Layer */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity: isHovered ? 1 : 0,
          background: `radial-gradient(500px circle at ${mousePos.x}px ${mousePos.y}px, ${spotlightColor}, transparent 60%)`,
        }}
      />

      {/* Content Layer */}
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
```

---

### 7.2 `MasterOptionGrid.tsx` (formerly `MasterOptionSelector.tsx`)
*Unified glass tile control primitive replacing raw HTML `<select>` elements and mismatched radio inputs.*

```tsx
'use client';

import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

export interface OptionItem<T extends string = string> {
  id: T;
  label: string;
  badge?: string;
  testId?: string;
}

export interface MasterOptionGridProps<T extends string = string> {
  options: OptionItem<T>[];
  value: T;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  layoutId?: string;
  accentColor?: string;
  testIdPrefix?: string;
}

export function MasterOptionGrid<T extends string = string>({
  options,
  value,
  onChange,
  columns = 2,
  layoutId = 'masterOptionPill',
  accentColor = 'var(--accent)',
  testIdPrefix = 'option',
}: MasterOptionGridProps<T>) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      {label && (
        <div className="flex items-center justify-between border-b border-[var(--border-stark)] pb-1.5">
          <span className="font-mono text-[10px] font-bold tracking-widest text-[var(--text-secondary)] uppercase">
            {label}
          </span>
          <span className="font-mono text-[10px] font-extrabold text-[var(--accent-primary)] uppercase">
            {value}
          </span>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: '6px',
        }}
      >
        {options.map((opt) => {
          const isSelected = value === opt.value;
          return (
            <motion.button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(opt.value)}
              whileHover={{ scale: disabled ? 1 : 1.03 }}
              whileTap={{ scale: disabled ? 1 : 0.96 }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
              className={`relative flex flex-col items-center justify-center rounded-[2px] px-3 py-2 font-mono text-[11px] font-semibold transition-all ${
                isSelected
                  ? 'border border-[var(--accent-primary)] bg-[var(--accent-subtle)] text-white shadow-[0_0_12px_var(--accent-glow)]'
                  : 'border border-[var(--border-subtle)] bg-[rgba(10,10,12,0.6)] text-[var(--text-secondary)] hover:border-[rgba(255,255,255,0.2)] hover:text-white'
              } ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              <span>{opt.label}</span>
              {opt.sublabel && (
                <span className="text-[9px] text-[var(--text-tertiary)]">{opt.sublabel}</span>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 8. Tool-by-Tool Integration & Pruning Matrix ("What Stays and What Goes")

| Tool Page | What Stays (Retained & Enhanced) | What Goes (Pruned / Refactored) | Adopted Master Component Replacement |
| :--- | :--- | :--- | :--- |
| **Video Muter** (`/tools/muter`) | Clean radio logic (`REMOVE` vs `SILENCE`), payload file item accordion. | Custom radio card inline styling, flat backdrop `#080808`. | Replace radio boxes with `MasterOptionSelector`. Wrap options panel in `MasterGlassCard`. Inject `RiveDropzone`. |
| **HEVC Compressor** (`/tools/hevc`) | Multi-category support (`VIDEO`, `AUDIO`, `PHOTO`), quality slider parameters. | **CRITICAL PRUNING**: Hardcoded cyan `#00e5ff` and magenta `#ff00e5` color variables. Inconsistent `.sidebar-options` CSS class. | Standardize class to `.options-panel.grid-line-left`. Replace hardcoded cyan/magenta with `var(--accent-primary)`. Deploy `MasterGlassCard`. |
| **Universal Converter** (`/tools/converter`) | Comprehensive format matrix, strategy badges (`REMUX`, `COPY`, `TRANSCODE`). | Unicode `▼` accordion indicators, inline box-shadows. | Replace format grid with `MasterOptionSelector`. Inject `RiveProcessingIndicator` into batch queue. |
| **YouTube Downloader** (`/tools/youtube`) | Format/quality selection grid, paste button, download history. | Flat text input underline conditional logic. | Wrap options panel in `MasterGlassCard`. Add Rive URL status validation machine. |
| **Audio Trimmer** (`/tools/trimmer`) | HTML5 Canvas waveform rendering (`WaveformCanvas.tsx`), zoom/pan controls. | **CRITICAL PRUNING**: Unstyled native HTML `<select>` dropdowns (`data-testid="mode-select"`, `format-select`). | Replace native `<select>` dropdowns with `MasterOptionSelector`. Add Rive morph Play/Pause button. |
| **Spotify Converter** (`/tools/spotify`) | Playlist track extraction list, batch select/deselect controls. | Static 9px inline text badges (`StatusBadge.tsx`). | Replace inline text badges with `MasterMicroBadge` backed by Rive state machine. Wrap tracklist in glass surface layer. |

---

## 9. Verification & Quality Protocol

To ensure 100% technical integrity and compliance across all tools:

1. **Security & Unit Test Compliance**:
   - Run `npx vitest run tests/security/` — All 123 security test cases must pass without regression.
2. **Next.js Production Build**:
   - Run `npm run build` — Compilation must succeed with zero TypeScript or ESLint errors.
3. **Layout & Motion Verification**:
   - Verify zero layout shifts or scroll overflow glitches across desktop (1440px) and mobile (375px) viewports.
   - Confirm Lenis scroll isolation (`data-lenis-prevent`) prevents nested container lockup.

---
*Published by Master Judge Subagent (`master_judge_1`). Approved for Phase 3 implementation.*
