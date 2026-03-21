import Link from 'next/link';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Dashboard',
};

export default function Dashboard() {
  const tools = [
    { num: '01', name: 'Dashboard', desc: 'System overview and telemetry routing.', path: '/' },
    { num: '02', name: 'Video Muter', desc: 'Remove or replace audio streams in video files.', path: '/tools/muter' },
    { num: '03', name: 'HEVC Compressor', desc: 'Hardware-accelerated H.265 compression.', path: '/tools/hevc' },
    { num: '04', name: 'Universal Converter', desc: 'Convert media between standard formats.', path: '/tools/converter' },
    { num: '05', name: 'YouTube Downloader', desc: 'Extract streams natively to filesystem.', path: '/tools/youtube' },
    { num: '06', name: 'Audio Trimmer', desc: 'Merge and split audio with crossfade.', path: '/tools/trimmer' },
    { num: '07', name: 'Spotify Converter', desc: 'Scrape and extract audio from embeds.', path: '/tools/spotify' },
    { num: '08', name: 'Media Inspector', desc: 'Extract deep FFprobe metadata layers.', path: '/tools/inspector' }
  ];

  return (
    <>
      <div className="top-utility-bar grid-line-bottom w-full">
        <div className="left-stats">
          <span className="tiny-label">CELESTIAL //</span>
        </div>
        <div className="right-actions">
          <span className="tiny-label">V. 2.0.0</span>
        </div>
      </div>

      <div className="workspace p-8 overflow-y-auto w-full">
        <div className="w-full max-w-7xl mx-auto">
          <div className="tool-header px-0 pb-12">
            <div className="tiny-label" style={{ marginBottom: '16px' }}>SYSTEM // 01</div>
            <h2 className="tool-title" style={{ marginLeft: '-4px' }}>Dashboard<br/>Overview.</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 w-full">
            {tools.map(t => (
              <Link key={t.path} href={t.path} className="group flex flex-col justify-between border border-[var(--border)] bg-[var(--bg)] p-6 h-48 hover:bg-[#111] transition-all relative overflow-hidden cursor-pointer" style={{ textDecoration: 'none' }}>
                 <div className="absolute top-0 left-0 w-1 h-full bg-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity" />
                 <div>
                   <span className="nav-index transition-colors group-hover:text-[var(--accent)]">{t.num}{' //'}</span>
                   <h3 className="nav-name mt-2" style={{ color: 'var(--text-main)', fontSize: '16px' }}>{t.name}</h3>
                   <p className="mt-2" style={{ color: 'var(--text-muted)', lineHeight: '1.4', fontSize: '13px' }}>{t.desc}</p>
                 </div>
                 <div className="flex justify-end">
                   <span className="tiny-label group-hover:text-[var(--accent)] transition-colors">INITIALIZE &rarr;</span>
                 </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
