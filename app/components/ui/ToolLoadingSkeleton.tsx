// Shared tool loading skeleton — used by all 6 per-tool loading.tsx files
// Mirrors the exact tool page layout structure to prevent layout shift.

export function ToolLoadingSkeleton({ panelTitle = 'PARAMETERS' }: { panelTitle?: string }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: 'var(--bg, #08080a)',
      fontFamily: 'var(--font-mono, monospace)',
    }}>
      {/* Top utility bar */}
      <div style={{
        height: '48px',
        borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: '32px', alignItems: 'center' }}>
          {[100, 130, 140].map((w, i) => (
            <div key={i} style={{ width: w, height: 7, background: 'rgba(255,255,255,0.06)', animation: `celSkel 1.6s ease-in-out infinite`, animationDelay: `${i * 0.12}s` }} />
          ))}
        </div>
        <div style={{ width: 48, height: 7, background: 'rgba(255,255,255,0.04)', animation: 'celSkel 1.6s ease-in-out infinite' }} />
      </div>

      {/* Workspace */}
      <div style={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>

        {/* Left: drop zone */}
        <div style={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: '32px',
          gap: '24px',
        }}>
          {/* Tool header */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ width: 70, height: 7, background: 'rgba(255,255,255,0.05)', animation: 'celSkel 1.6s ease-in-out infinite' }} />
            <div style={{ width: 200, height: 28, background: 'rgba(255,255,255,0.05)', animation: 'celSkel 1.6s ease-in-out infinite', animationDelay: '0.08s' }} />
            <div style={{ width: 140, height: 28, background: 'rgba(255,255,255,0.04)', animation: 'celSkel 1.6s ease-in-out infinite', animationDelay: '0.12s' }} />
          </div>

          {/* Drop zone body */}
          <div style={{
            flexGrow: 1,
            border: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '16px',
            animation: 'celSkel 1.6s ease-in-out infinite',
            animationDelay: '0.2s',
          }}>
            {/* Crosshair */}
            <div style={{ width: '80px', height: '80px', position: 'relative' }}>
              <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.08)' }} />
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.08)' }} />
            </div>
            <div style={{ width: 180, height: 10, background: 'rgba(255,255,255,0.05)' }} />
            <div style={{ width: 120, height: 8, background: 'rgba(255,255,255,0.03)' }} />
          </div>
        </div>

        {/* Right: options panel */}
        <div style={{
          width: '380px',
          flexShrink: 0,
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Panel header */}
          <div style={{
            height: '52px',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
          }}>
            <span style={{ fontSize: '11px', letterSpacing: '0.08em', fontWeight: 700, color: 'rgba(255,255,255,0.15)' }}>
              {panelTitle}
            </span>
          </div>

          {/* Controls skeleton */}
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {[1, 2, 3, 4].map((_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ width: 64, height: 7, background: 'rgba(255,255,255,0.04)', animation: 'celSkel 1.6s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
                <div style={{ width: '100%', height: 36, background: 'rgba(255,255,255,0.03)', animation: 'celSkel 1.6s ease-in-out infinite', animationDelay: `${i * 0.1 + 0.05}s` }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Progress bar section */}
      <div style={{
        height: '80px',
        borderTop: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        alignItems: 'center',
        gap: '0',
        flexShrink: 0,
      }}>
        <div style={{ width: 240, height: '100%', background: 'rgba(255,255,255,0.03)', animation: 'celSkel 1.6s ease-in-out infinite' }} />
        <div style={{ flexGrow: 1, height: '100%', display: 'flex', alignItems: 'center', padding: '0 24px' }}>
          <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.04)', animation: 'celSkel 1.6s ease-in-out infinite' }} />
        </div>
      </div>
    </div>
  );
}
