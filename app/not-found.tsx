import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full p-8 text-center" style={{ minHeight: '60vh' }}>
      <span className="tiny-label mb-2">SYS.CORE // ERROR</span>
      <h2 className="tool-title mb-4" style={{ fontSize: '2.5rem' }}>404 // NOT FOUND</h2>
      <p className="mono-data mb-6">THE REQUESTED RESOURCE DOES NOT EXIST OR HAS BEEN MOVED.</p>
      <Link href="/" className="action-btn" style={{ width: 'auto', padding: '10px 24px', fontSize: '12px', textDecoration: 'none' }}>
        RETURN TO DASHBOARD
      </Link>
    </div>
  );
}
