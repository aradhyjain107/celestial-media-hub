import type { Metadata } from 'next';
import Link from 'next/link';
import { MasterHeader } from '../components/ui/MasterHeader';
import { StudioFooterLinks } from '../components/ui/StudioFooterLinks';
import { STUDIO_TOOLS, getSiteIdentity } from '@/lib/agent/siteContent';

const identity = getSiteIdentity();

export const metadata: Metadata = {
  title: 'About Celestial Media Hub',
  description:
    'Architecture, native FFmpeg and yt-dlp processing pipelines, cross-platform hardware acceleration, and security model behind Celestial Media Hub.',
  alternates: {
    canonical: '/about',
  },
  openGraph: {
    type: 'website',
    url: '/about',
    title: 'About Celestial Media Hub — Local & Cloud FFmpeg Media Studio',
    description:
      'Architecture, native FFmpeg and yt-dlp processing pipelines, cross-platform hardware acceleration, and security model behind Celestial Media Hub.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: identity.headline }],
  },
};

export default function AboutPage() {
  return (
    <>
      <MasterHeader
        onlyUtilityBar
        toolName="ABOUT STUDIO"
        engineLabel="DOCS"
        engineId="VERIFIED"
        hwAccelText="OPEN-SOURCE MIT"
      />

      <div className="workspace overflow-y-auto w-full" data-lenis-prevent>
        <div className="w-full" style={{ maxWidth: '1040px' }}>
          <MasterHeader
            onlyToolHeader
            targetId="TRUST // ABOUT"
            title={<>About Celestial<br />Media Hub.</>}
            subtitle="Open-source Next.js 14 and FFmpeg media studio built for fast, lossless stream processing, hardware-accelerated compression, precision audio editing, and clean extraction."
          />

          <div style={{ padding: '0 24px 24px', display: 'grid', gap: '20px' }}>
            <section
              className="glass-panel"
              style={{ padding: '24px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              <span className="tiny-label" style={{ color: 'var(--accent)', display: 'block', marginBottom: '8px' }}>
                01 // ARCHITECTURE &amp; PHILOSOPHY
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
                Local-First Power Without Browser Sandbox Ceilings
              </h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '12px', fontSize: '14px' }}>
                Celestial Media Hub is an open-source media engineering workbench created by {identity.creatorName}. Unlike
                bloated consumer converters that gate basic bitrates behind monthly subscriptions or push large files through
                in-browser WebAssembly memory limits, Celestial Media Hub dispatches directly to native `ffmpeg`, `ffprobe`,
                `yt-dlp`, and `cwebp` binaries through isolated Next.js API workers and Server-Sent Events progress telemetry.
              </p>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '14px' }}>
                Every workflow runs cross-platform on macOS (Apple Silicon &amp; VideoToolbox), Windows (NVIDIA NVENC &amp;
                Intel QSV), and Linux containers with automatic software encoding fallbacks when GPU hardware acceleration
                is unavailable. You can use the hosted cloud web workbench or clone the repository locally to remove upload
                latency altogether.
              </p>
            </section>

            <section
              className="glass-panel"
              style={{ padding: '24px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              <span className="tiny-label" style={{ color: 'var(--accent)', display: 'block', marginBottom: '8px' }}>
                02 // CORE MEDIA STUDIO MODULES
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                Six Specialized Workflows Under One Obsidian Workspace
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
                {STUDIO_TOOLS.map((tool) => (
                  <Link
                    key={tool.path}
                    href={tool.path}
                    style={{
                      display: 'block',
                      padding: '16px',
                      background: 'rgba(255, 255, 255, 0.02)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '4px',
                      textDecoration: 'none',
                    }}
                  >
                    <div className="tiny-label" style={{ color: 'var(--accent)', marginBottom: '6px' }}>
                      {`${tool.num} // ${tool.name.toUpperCase()}`}
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>
                      {tool.summary}
                    </p>
                  </Link>
                ))}
              </div>
            </section>

            <section
              className="glass-panel"
              style={{ padding: '24px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              <span className="tiny-label" style={{ color: 'var(--accent)', display: 'block', marginBottom: '8px' }}>
                03 // SECURITY &amp; OPEN-SOURCE GOVERNANCE
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
                Hardened Against Argument Injection, BOLA, and SSRF
              </h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '14px' }}>
                Processing untrusted filenames and media URLs requires strict systems hygiene. Celestial Media Hub uses
                argument-vector process execution (never shell interpolation), path traversal confinement inside scoped job
                directories, HS256 JWT per-session ownership enforcement (BOLA protection), Fetch Metadata cross-site
                isolation, and public IP resolution validation on external extractors. Full source code and automated
                security suites are publicly auditable at{' '}
                <a href={identity.repoUrl} style={{ color: 'var(--accent)' }}>
                  {identity.repoUrl}
                </a>
                .
              </p>
            </section>
          </div>

          <StudioFooterLinks />
        </div>
      </div>
    </>
  );
}
