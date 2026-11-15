import Link from 'next/link';
import React from 'react';

const FOOTER_LINKS = [
  { href: '/', label: 'Studio Dashboard' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
  { href: '/privacy', label: 'Privacy Policy' },
] as const;

export function StudioFooterLinks() {
  return (
    <nav
      aria-label="Studio documentation and policy links"
      style={{
        margin: '0 24px 32px',
        padding: '14px 20px',
        background: 'rgba(10, 10, 14, 0.65)',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.07))',
        borderRadius: '4px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px 24px',
      }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px' }}>
        {FOOTER_LINKS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="tiny-label"
            style={{
              color: 'var(--text-secondary, #9CA3AF)',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            {item.label}
          </Link>
        ))}
        <a
          href="/llms.txt"
          className="tiny-label"
          style={{
            color: 'var(--accent-primary, #FF5A00)',
            textDecoration: 'none',
            fontWeight: 700,
          }}
        >
          llms.txt
        </a>
        <a
          href="/sitemap.xml"
          className="tiny-label"
          style={{
            color: 'var(--text-secondary, #9CA3AF)',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          sitemap.xml
        </a>
      </div>

      <span className="tiny-label" style={{ color: 'var(--text-muted, #6B7280)' }}>
        CELESTIAL MEDIA HUB // OPEN-SOURCE FFMPEG MEDIA STUDIO
      </span>
    </nav>
  );
}
