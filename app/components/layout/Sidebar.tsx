'use client'

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard' },
  { path: '/tools/muter', label: 'Video Muter' },
  { path: '/tools/hevc', label: 'HEVC Compressor' },
  { path: '/tools/converter', label: 'Universal Converter' },
  { path: '/tools/youtube', label: 'YouTube Downloader' },
  { path: '/tools/trimmer', label: 'Audio Trimmer' },
  { path: '/tools/spotify', label: 'Spotify Converter' },
  { path: '/tools/inspector', label: 'Media Inspector' }
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>SYS.CORE//</h1>
      </div>
      
      <div className="nav-list">
        {NAV_ITEMS.map((item, i) => {
          const isActive = pathname === item.path || (item.path !== '/' && pathname.startsWith(item.path));
          const num = String(i + 1).padStart(2, '0');
          
          return (
            <Link key={item.path} href={item.path} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div className={`nav-item ${isActive ? 'active' : ''}`}>
                <div className="nav-index">{num} {`//`}</div>
                <div className="nav-name">{item.label}</div>
              </div>
            </Link>
          );
        })}
      </div>
      
      <div className="sidebar-footer">
        <span className="tiny-label">SYS.STATUS</span>
        <span className="status-dot" />
      </div>
    </aside>
  );
}
