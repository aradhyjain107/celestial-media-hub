# BUG NOTES: Webpack Module Resolution & TypeScript Types

## Bug: `Cannot read properties of undefined (reading 'call')`
- **Root Cause**: Next.js 14 Webpack cache corruption. When adding new client dependencies (`framer-motion`) or having unresolved type errors in some routes (e.g. mismatched `executeFfmpeg` parameters or implicitly typed arrow functions), Fast Refresh can serve a stale/corrupt client module chunk, causing a client-side runtime crash when trying to call a module function.
- **Resolution**:
  1. Delete the `.next` directory to clear the Webpack cache completely: `rm -rf .next`
  2. Fix any TypeScript compilation errors in all routes and files to let `next build` succeed without errors.
  3. Re-run `npm run dev` to generate fresh, uncorrupted chunks.

## Related Typescript Bug: Implicitly Typed Function Arguments
- **Symptoms**: `Type error: Parameter 'v' implicitly has an 'any' type` or `Type error: Parameter 'z' implicitly has an 'any' type`.
- **Resolution**: Provide explicit types to updater arrow functions inside `useState` or `useCallback` when strict type-checking is enabled:
  ```tsx
  setHardwareAccel((v: boolean) => !v)
  setZoom((z: number) => z + 1)
  ```

## Bug: `Cannot find module 'autoprefixer'` in `next/font`
- **Symptoms**: Dev server crashes with 500 error on initial load. Error log explicitly mentions `autoprefixer` missing in `next/font` stack trace.
- **Root Cause**: `next/font` (Next.js 14) can fail to resolve PostCSS plugins like `autoprefixer` even if they are installed in `node_modules`. This often happens after dependency drift or cache corruption.
- **Resolution**:
  1. Comment out `autoprefixer: {}` in `postcss.config.mjs` temporarily.
  2. Reinstall as a dev dependency: `npm install -D autoprefixer`.
  3. Delete `.next` and restart `npm run dev`.

## Bug: `GlobalJobContext` Type Mismatch (EventSource)
- **Symptoms**: TypeScript build error in tools using `EventSource` (e.g. Spotify). `useJob` hook `startJob` function rejects valid stream sources.
- **Root Cause**: `useJob` hook was incorrectly typed to only accept `Response` objects, but the internal `GlobalJobContext` was designed for both `Response` and `EventSource`.
- **Resolution**: Update the `startJob` signature in the `useJob` hook within `GlobalJobContext.tsx` to accept `Response | EventSource`.

## Bug: "Black Screen" / Empty Main Content
- **Symptoms**: Sidebar renders correctly, but the `main` content area is completely black or empty.
- **Root Cause**: Two-fold: (1) A server-side 500 crash prevents `children` from rendering, and (2) `PageTransition` (using `framer-motion`) can get stuck in an `exit` state (opacity 0) if the page crashes during a transition.
- **Resolution**:
  1. Fix the underlying server crash (see `autoprefixer` bug above).
  2. Temporarily bypass `PageTransition` in `layout.tsx` to force rendering.
  3. Ensure all paths in `ROUTES_ORDER` in `PageTransition.tsx` are accurate.

