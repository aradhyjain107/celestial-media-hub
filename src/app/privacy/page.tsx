import type { Metadata } from 'next';
import Link from 'next/link';
import { MasterHeader } from '../components/ui/MasterHeader';
import { StudioFooterLinks } from '../components/ui/StudioFooterLinks';
import { getSiteIdentity } from '@/lib/agent/siteContent';

const identity = getSiteIdentity();

export const metadata: Metadata = {
  title: 'Privacy & Data Handling Policy',
  description:
    'Ephemeral file handling, zero third-party ad tracking, HS256 JWT per-session job ownership isolation, and SSRF protections on Celestial Media Hub.',
  alternates: {
    canonical: '/privacy',
  },
  openGraph: {
    type: 'website',
    url: '/privacy',
    title: 'Privacy Policy — Celestial Media Hub',
    description:
      'Ephemeral file handling, zero third-party ad tracking, HS256 JWT per-session job ownership isolation, and SSRF protections on Celestial Media Hub.',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: identity.headline }],
  },
};

export default function PrivacyPage() {
  return (
    <>
      <MasterHeader
        onlyUtilityBar
        toolName="PRIVACY POLICY"
        engineLabel="SECURITY"
        engineId="HARDENED"
        hwAccelText="ZERO AD TRACKERS"
      />

      <div className="workspace overflow-y-auto w-full" data-lenis-prevent>
        <div className="w-full" style={{ maxWidth: '1040px' }}>
          <MasterHeader
            onlyToolHeader
            targetId="TRUST // PRIVACY"
            title={<>Privacy &amp;<br />Data Policy.</>}
            subtitle="Local-first execution, ephemeral job scratch isolation, zero behavioral tracking cookies, and strict session ownership enforcement."
          />

          <div style={{ padding: '0 24px 24px', display: 'grid', gap: '20px' }}>
            <section
              className="glass-panel"
              style={{ padding: '24px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              <span className="tiny-label" style={{ color: 'var(--accent)', display: 'block', marginBottom: '8px' }}>
                01 // EPHEMERAL MEDIA PROCESSING
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
                No Permanent Media Retention or Training Reuse
              </h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '12px', fontSize: '14px' }}>
                Celestial Media Hub processes audio, video, and image inputs strictly to fulfill the transformation requested
                during your active session. When you clone and run Celestial Media Hub locally on macOS, Windows, or Linux,
                media never leaves your computer at all.
              </p>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '14px' }}>
                When using the hosted web demonstration at{' '}
                <a href={identity.siteUrl} style={{ color: 'var(--accent)' }}>
                  {identity.siteUrl}
                </a>
                , uploaded source files and transpiled outputs are stored exclusively inside ephemeral temporary working
                directories scoped to your active session and are discarded on container recycle or job cleanup. We never sell,
                broker, or repurpose user media for model training or advertising.
              </p>
            </section>

            <section
              className="glass-panel"
              style={{ padding: '24px', border: '1px solid var(--border-subtle)', borderRadius: '4px' }}
            >
              <span className="tiny-label" style={{ color: 'var(--accent)', display: 'block', marginBottom: '8px' }}>
                02 // SESSION COOKIES, BOLA ISOLATION &amp; TELEMETRY
              </span>
              <h2 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '12px', color: 'var(--text-primary)' }}>
                Strictly Necessary Security Cookies Only
              </h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '12px', fontSize: '14px' }}>
                To prevent unauthorized access to active transcoding jobs, `/api/auth/session` issues a signed HS256 JWT
                session cookie used exclusively for authentication and Broken Object Level Authorization (BOLA) ownership
                verification across job progress streams and file downloads. Celestial Media Hub does not embed third-party
                marketing pixels, fingerprinting scripts, or cross-site ad trackers.
              </p>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, fontSize: '14px' }}>
                Standard infrastructure server logs (request path, HTTP status code, rate-limit bucket timing, and sanitized
                errors without filesystem paths) are used purely to maintain uptime and enforce abuse rate limits. Questions
                about data handling can be directed via our <Link href="/contact" style={{ color: 'var(--accent)' }}>Contact page</Link>.
              </p>
            </section>
          </div>

          <StudioFooterLinks />
        </div>
      </div>
    </>
  );
}
