import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center" style={{ minHeight: '60vh' }}>
      <span className="tiny-label mb-2">SYS.CORE // ERROR</span>
      <h2 className="tool-title mb-4" style={{ fontSize: '2.5rem' }}>404 // NOT FOUND</h2>
      <p className="mono-data mb-6">THE REQUESTED RESOURCE DOES NOT EXIST OR HAS BEEN MOVED.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center', marginBottom: '20px' }}>
        <Link href="/" className="action-btn" style={{ width: 'auto', padding: '10px 24px', fontSize: '12px', textDecoration: 'none' }}>
          RETURN TO DASHBOARD
        </Link>
        <Link href="/about" className="tiny-label" style={{ padding: '10px 16px', border: '1px solid var(--border-subtle)', borderRadius: '2px', textDecoration: 'none', color: 'var(--text-primary)' }}>
          ABOUT STUDIO
        </Link>
      </div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <a href="/llms.txt" className="tiny-label" style={{ color: 'var(--accent)', textDecoration: 'none' }}>
          llms.txt
        </a>
        <a href="/sitemap.xml" className="tiny-label" style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}>
          sitemap.xml
        </a>
      </div>
    </div>
  );
}
