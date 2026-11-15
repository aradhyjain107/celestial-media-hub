import type { Metadata } from 'next';
import Link from 'next/link';
import { MasterHeader } from '../components/ui/MasterHeader';
import { StudioFooterLinks } from '../components/ui/StudioFooterLinks';
import { getSiteIdentity } from '@/lib/agent/siteContent';

const identity = getSiteIdentity();

export const metadata: Metadata = {
  title: 'Contact & Maintainer Support',
  description:
    'Official maintainer contact details, GitHub issue tracker, bug report template, and security disclosure channel for Celestial Media Hub.',
  alternates: {
    canonical: '/contact',
  },
  openGraph: {
    type: 'website',
    url: '/contact',
    title: 'Contact Celestial Media Hub — Support & Maintainer Channels',
    description:
      'Official maintainer contact details, GitHub issue tracker, bug report template, and security disclosure channel for Celestial Media Hub.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: identity.headline }],
  },
};

export default function ContactPage() {
  return (
    <>
      <MasterHeader
        onlyUtilityBar
        toolName="CONTACT & SUPPORT"
        engineLabel="MAINTAINER"
        engineId="ACTIVE"
        hwAccelText="DIRECT CHANNELS"
      />

      <div className="workspace overflow-y-auto w-full" data-lenis-prevent>
        <div className="w-full" style={{ maxWidth: '1040px' }}>
          <MasterHeader
            onlyToolHeader
            targetId="TRUST // CONTACT"
            title={<>Contact &amp;<br />Support.</>}
            subtitle="Direct maintainer contact email, open-source issue tracker, security reporting workflow, and studio operating region for Celestial Media Hub."
          />

          <div style={{ padding: '0 24px 24px', display: 'grid', gap: '20px' }}>
            <section
              className="glass-panel"
              style={{ padding: '24px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              <span className="tiny-label" style={{ color: 'var(--accent)', display: 'block', marginBottom: '8px' }}>
                01 // MAINTAINER IDENTITY &amp; CONTACT POINT
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '16px', color: 'var(--text-primary)' }}>
                Official Project Channels
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
                <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
                  <div className="tiny-label" style={{ color: 'var(--text-muted)', marginBottom: '6px' }}>PRIMARY MAINTAINER</div>
                  <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '15px' }}>{identity.creatorName}</div>
                  <div className="mono-data" style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '4px' }}>
                    {identity.address.addressLocality}, {identity.address.addressRegion}, {identity.address.addressCountry}
                  </div>
                </div>

                <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
                  <div className="tiny-label" style={{ color: 'var(--text-muted)', marginBottom: '6px' }}>TECHNICAL SUPPORT EMAIL</div>
                  <a
                    href={`mailto:${identity.contactEmail}`}
                    className="mono-data"
                    style={{ color: 'var(--accent)', fontSize: '13px', wordBreak: 'break-all', textDecoration: 'none' }}
                  >
                    {identity.contactEmail}
                  </a>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>
                    For security disclosures, integration questions, or enterprise deployment guidance.
                  </p>
                </div>

                <div style={{ padding: '16px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}>
                  <div className="tiny-label" style={{ color: 'var(--text-muted)', marginBottom: '6px' }}>GITHUB ISSUES &amp; SOURCE</div>
                  <a
                    href={`${identity.repoUrl}/issues`}
                    className="mono-data"
                    style={{ color: 'var(--accent)', fontSize: '13px', wordBreak: 'break-all', textDecoration: 'none' }}
                  >
                    github.com/aradhyjain107/celestial-media-hub
                  </a>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '8px', marginBottom: 0 }}>
                    Public bug reports, pull requests, and codec feature requests.
                  </p>
                </div>
              </div>
            </section>

            <section
              className="glass-panel"
              style={{ padding: '24px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              <span className="tiny-label" style={{ color: 'var(--accent)', display: 'block', marginBottom: '8px' }}>
                02 // HOW TO REPORT MEDIA PIPELINE ISSUES
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
                Faster Diagnostics for FFmpeg, yt-dlp, and Self-Hosted Setups
              </h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '12px', fontSize: '14px' }}>
                When opening an issue or emailing technical support, please share your operating system (macOS, Windows, or
                Linux), target container/codec selection (for example HEVC VideoToolbox vs libx265 software fallback), the
                exact API route or Studio tool card you triggered, and sanitized terminal output from `npm test` or
                `GET /api/system/hardware`.
              </p>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '14px' }}>
                For private vulnerability reports involving JWT session handling, SSRF filtering, or temporary job storage
                isolation, please use email rather than posting exploits in a public GitHub thread so a coordinated patch can
                be tested and deployed first. Review our <Link href="/privacy" style={{ color: 'var(--accent)' }}>Privacy Policy</Link> or
                return to the <Link href="/" style={{ color: 'var(--accent)' }}>Studio Dashboard</Link> at any time.
              </p>
            </section>
          </div>

          <StudioFooterLinks />
        </div>
      </div>
    </>
  );
}
