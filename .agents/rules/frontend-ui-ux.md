# Frontend UI/UX & Glassmorphism Rules

## 1. Input URL Validation & State Feedback
- Always provide immediate visual and textual error feedback when an input URL fails validation (`urlError`).
- Highlight input border with `var(--error)` and render `data-testid="url-error"` with clear diagnostic text when invalid.

## 2. Batch Queue & Playlist Selection Controls
- Every playlist/batch tool MUST provide:
  - Header showing `X / Y SELECTED` track count.
  - "SELECT ALL" (`ALL`) and "DESELECT ALL" (`NONE`) batch control buttons.
- Initialize/Action buttons must be disabled when 0 tracks in a playlist batch are selected (`tracks.length > 0 && selectedTrackCount === 0`).

## 3. Keyboard & Screen Reader Accessibility (ARIA)
- Custom toggle switches: set `role="switch"`, `aria-checked={boolean}`, `tabIndex={0}`, and handle `Enter` and `Space` (`' '`) keys.
- Tile/Option selectors: set `role="button"`, `aria-selected={isSelected}`, `tabIndex={0}`, and handle `Enter` and `Space` keys.
- Interactive list items: support keyboard activation (Enter & Space with `e.preventDefault()`).

## 4. Dark Mode Glassmorphism & Framer Motion
- Apply `.glass-panel` and `.glass-panel-hover` styling for modal overlays, card headers, and playlist containers to ensure backdrop blur and subtle glowing hover states.
- When animating component heights with `AnimatePresence`, avoid static top/bottom padding on the container element to prevent layout jumping/flicker.
- Ensure scrollable input containers specify `overflowY: 'auto'` to prevent nested scroll traps and off-screen content cropping.
