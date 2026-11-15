# Frontend UI/UX & State Sync Rules

## 1. Global Context State Sync vs Local Duplicate State
- **Pattern**: When a global store (e.g. `GlobalJobContext`) tracks queue items or job progress via external stores / SSE streams, tool components should derive arrays (like `queueItems`) directly from context state (`jobState?.queueItems ?? []`) rather than keeping duplicate local `useState` copies and synchronizing via `useEffect`.
- **Rationale**: Dual state synchronization creates infinite re-render loops and reference inequality triggers.

## 2. Framer Motion layoutId & Auto-Height Animations
- **Pattern**: Avoid `layoutId` on child indicator elements nested inside parent containers that have active `whileHover` scale or translation transforms. Use explicit scale/opacity transitions instead.
- **Pattern**: When animating expandable cards with `AnimatePresence` (`height: 'auto'`), use ease transitions (`transition={{ duration: 0.2, ease: 'easeInOut' }}`) rather than spring physics to prevent exit collapse glitches.

## 3. Directional Parameter Calculations
- **Pattern**: Double check formulas where lower numerical values represent higher quality (e.g., CRF value in HEVC/H.265 compression).
- **Formula**: In CRF compression estimation, lower CRF numbers (CRF 18) mean higher quality/larger file sizes, while higher CRF numbers (CRF 35) mean smaller file sizes. Calculating delta as `(28 - crf)` ensures correct directional scaling.

## 4. Accessibility (WCAG 2.1 Focus & ARIA)
- **Focus Rings**: All custom interactive controls (`role="radio"`, `role="checkbox"`, buttons, range sliders) must have visible focus indicators via `:focus-visible` in CSS (`outline: 2px solid var(--accent)`).
- **Keyboard Navigation**: Custom radiogroups must support directional arrow key navigation (`ArrowUp`/`ArrowDown`/`ArrowLeft`/`ArrowRight`) in addition to Enter and Space keys.
- **ARIA Attributes**: Form controls and progress bars must have explicit `aria-label`, `role="progressbar"`, `aria-valuenow`, `aria-valuemin`, and `aria-valuemax` attributes.
