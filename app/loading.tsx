// app/loading.tsx — Root Suspense fallback
// Shown during initial SSR / hydration before the page is ready.
// Matches the exact shell structure (sidebar + top bar + workspace) to prevent layout shift.

export default function RootLoading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      width: '100%',
      background: 'var(--bg, #08080a)',
    }}>
      {/* Top utility bar skeleton */}
      <div style={{
        height: '48px',
        borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: '32px',
        flexShrink: 0,
      }}>
        {[80, 120, 100].map((w, i) => (
          <div key={i} style={{ width: w, height: 8, background: 'rgba(255,255,255,0.06)', animation: 'celSkeleton 1.6s ease-in-out infinite', animationDelay: `${i * 0.12}s` }} />
        ))}
      </div>

      {/* Workspace skeleton */}
      <div style={{ display: 'flex', flexGrow: 1, overflow: 'hidden' }}>
        {/* Drop zone area */}
        <div style={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          padding: '48px',
        }}>
          {/* Crosshair */}
          <div style={{
            width: '64px', height: '64px', position: 'relative',
            animation: 'celSkeleton 1.6s ease-in-out infinite',
          }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'rgba(255,255,255,0.1)' }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.1)' }} />
          </div>
          <div style={{ width: 200, height: 10, background: 'rgba(255,255,255,0.06)', animation: 'celSkeleton 1.6s ease-in-out infinite' }} />
          <div style={{ width: 140, height: 8, background: 'rgba(255,255,255,0.04)', animation: 'celSkeleton 1.6s ease-in-out infinite', animationDelay: '0.1s' }} />
        </div>

        {/* Options panel skeleton */}
        <div style={{
          width: '380px',
          flexShrink: 0,
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{ height: '52px', borderBottom: '1px solid rgba(255,255,255,0.08)', padding: '0 24px', display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 140, height: 8, background: 'rgba(255,255,255,0.06)', animation: 'celSkeleton 1.6s ease-in-out infinite' }} />
          </div>
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {[100, 80, 120, 90, 110].map((w, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ width: 60, height: 7, background: 'rgba(255,255,255,0.04)', animation: 'celSkeleton 1.6s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
                <div style={{ width: `${w}%`, height: 32, background: 'rgba(255,255,255,0.03)', animation: 'celSkeleton 1.6s ease-in-out infinite', animationDelay: `${i * 0.1 + 0.05}s` }} />
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Progress section skeleton */}
      <div style={{ height: '80px', borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', padding: '0 24px', gap: '16px' }}>
        <div style={{ width: 240, height: 44, background: 'rgba(255,255,255,0.04)', animation: 'celSkeleton 1.6s ease-in-out infinite' }} />
        <div style={{ flexGrow: 1, height: 4, background: 'rgba(255,255,255,0.04)', animation: 'celSkeleton 1.6s ease-in-out infinite' }} />
      </div>
    </div>
  );
}
