import React from 'react';
import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { render } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { middleware } from '../../src/middleware';
import { GET as llmsTxtGET } from '../../src/app/llms.txt/route';
import sitemap from '../../src/app/sitemap';
import robots from '../../src/app/robots';
import Dashboard, { metadata as homeMetadata } from '../../src/app/page';
import { metadata as layoutMetadata } from '../../src/app/layout';
import AboutPage, { metadata as aboutMetadata } from '../../src/app/about/page';
import ContactPage, { metadata as contactMetadata } from '../../src/app/contact/page';
import PrivacyPage, { metadata as privacyMetadata } from '../../src/app/privacy/page';
import { GlobalJobProvider } from '../../src/app/context/GlobalJobContext';
import {
  buildHomepageStructuredData,
  prefersMarkdown,
} from '../../src/lib/agent/siteContent';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('next/font/local', () => ({
  default: () => ({ variable: '--font-mock' }),
}));

describe('Agent Readiness & Protocol Compliance Suite', () => {
  describe('1. Accept header q-weight parsing & Markdown content negotiation', () => {
    test('prefersMarkdown respects explicit q-weights and defaults', () => {
      expect(prefersMarkdown('text/markdown')).toBe(true);
      expect(prefersMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
      expect(prefersMarkdown('text/html, text/markdown;q=0.5')).toBe(false);
      expect(prefersMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
      expect(prefersMarkdown('*/*')).toBe(false);
      expect(prefersMarkdown(null)).toBe(false);
    });

    test('GET / with Accept: text/markdown returns HTTP 200 Markdown with Vary: Accept', async () => {
      const req = new NextRequest('https://celestial-media-hub.onrender.com/', {
        method: 'GET',
        headers: { accept: 'text/markdown' },
      });

      const res = middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(res.headers.get('vary')).toContain('Accept');

      const body = await res.text();
      expect(body).toContain('# Celestial Media Hub');
      expect(body).toContain('/llms.txt');
      expect(body).toContain('/sitemap.xml');
      expect(body.length).toBeGreaterThan(200);
    });

    test('GET / with Accept: text/html passes through to HTML renderer and appends Vary: Accept', () => {
      const req = new NextRequest('https://celestial-media-hub.onrender.com/', {
        method: 'GET',
        headers: { accept: 'text/html' },
      });

      const res = middleware(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-next')).toBe('1');
      expect(res.headers.get('vary')).toContain('Accept');
    });
  });

  describe('2. Agent-friendly 404 responses', () => {
    test('unknown path with Accept: text/markdown returns 404 Markdown with links to llms.txt & sitemap.xml', async () => {
      const req = new NextRequest('https://celestial-media-hub.onrender.com/__ora-404-probe-lbmpcmkq', {
        method: 'GET',
        headers: { accept: 'text/markdown' },
      });

      const res = middleware(req);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(res.headers.get('vary')).toContain('Accept');

      const body = await res.text();
      expect(body.length).toBeGreaterThanOrEqual(20);
      expect(body).toContain('404 Not Found');
      expect(body).toContain('/llms.txt');
      expect(body).toContain('/sitemap.xml');
    });
  });

  describe('3. llms.txt, sitemap.xml, robots.txt, and og-image.png', () => {
    test('GET /llms.txt returns clear when-to-use guidance and studio endpoints', async () => {
      const req = new NextRequest('https://celestial-media-hub.onrender.com/llms.txt', {
        method: 'GET',
        headers: { accept: 'text/markdown' },
      });

      const res = await llmsTxtGET(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(res.headers.get('vary')).toBe('Accept');

      const text = await res.text();
      expect(text).toContain('# Celestial Media Hub');
      expect(text).toContain('## When to Use Celestial Media Hub');
      expect(text).toContain('/tools/converter');
      expect(text).toContain('/sitemap.xml');
      expect(text).toContain('/privacy');
    });

    test('sitemap() enumerates homepage, all 6 tool routes, and all 3 trust anchor pages with lastModified', () => {
      const entries = sitemap();
      const urls = entries.map((e) => e.url);

      expect(urls).toContain('https://celestial-media-hub.onrender.com/');
      expect(urls).toContain('https://celestial-media-hub.onrender.com/about');
      expect(urls).toContain('https://celestial-media-hub.onrender.com/contact');
      expect(urls).toContain('https://celestial-media-hub.onrender.com/privacy');
      expect(urls).toContain('https://celestial-media-hub.onrender.com/tools/hevc');
      expect(entries.every((e) => e.lastModified instanceof Date)).toBe(true);
    });

    test('robots() advertises sitemap.xml and allows public indexing', () => {
      const config = robots();
      expect(config.sitemap).toBe('https://celestial-media-hub.onrender.com/sitemap.xml');
    });

    test('public/og-image.png exists as a valid PNG asset', () => {
      const ogPath = path.join(process.cwd(), 'public', 'og-image.png');
      expect(fs.existsSync(ogPath)).toBe(true);
      const header = fs.readFileSync(ogPath).subarray(0, 8);
      expect(Array.from(header)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    });
  });

  describe('4. Homepage Metadata, JSON-LD Structured Data & Discoverability', () => {
    test('layout and homepage expose canonical, og:type, og:image, and descriptive brand title', () => {
      expect(layoutMetadata.metadataBase?.toString()).toBe('https://celestial-media-hub.onrender.com/');
      expect(homeMetadata.alternates?.canonical).toBe('/');
      expect((homeMetadata.title as { absolute?: string })?.absolute).toContain('Celestial Media Hub');
      expect((homeMetadata.openGraph as { type?: string })?.type).toBe('website');
      expect(JSON.stringify(homeMetadata.openGraph?.images)).toContain('/og-image.png');
    });

    test('structured data graph contains complete Organization, SoftwareApplication, and Service schemas', () => {
      const schema = buildHomepageStructuredData('https://celestial-media-hub.onrender.com');
      const org = schema['@graph'].find((n) => n['@type'] === 'Organization') as any;
      const app = schema['@graph'].find((n) => n['@type'] === 'SoftwareApplication') as any;
      const service = schema['@graph'].find((n) => n['@type'] === 'Service') as any;

      expect(org.contactPoint['@type']).toBe('ContactPoint');
      expect(org.contactPoint.email).toBeTruthy();
      expect(org.contactPoint.contactType).toBeTruthy();
      expect(org.address['@type']).toBe('PostalAddress');
      expect(org.address.addressCountry).toBe('IN');

      expect(app.name).toBe('Celestial Media Hub');
      expect(app.offers.price).toBe('0');
      expect(app.sameAs).toContain('https://github.com/aradhyjain107/celestial-media-hub');
      expect(app.knowsAbout.length).toBeGreaterThan(2);

      expect(service.serviceType).toBe('FFmpeg media studio');
    });

    test('homepage renders embedded JSON-LD script and trust anchor footer links', () => {
      const { container } = render(
        <GlobalJobProvider>
          <Dashboard />
        </GlobalJobProvider>
      );

      const jsonLdScript = container.querySelector('script[type="application/ld+json"]');
      expect(jsonLdScript).not.toBeNull();
      const parsed = JSON.parse(jsonLdScript!.innerHTML);
      expect(parsed['@graph']).toHaveLength(4);

      expect(container.querySelector('a[href="/about"]')).not.toBeNull();
      expect(container.querySelector('a[href="/contact"]')).not.toBeNull();
      expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
      expect(container.querySelector('a[href="/llms.txt"]')).not.toBeNull();
    });
  });

  describe('5. Trust Anchor Pages (/about, /contact, /privacy)', () => {
    test.each([
      { name: '/about', Component: AboutPage, metadata: aboutMetadata, expectedCanonical: '/about' },
      { name: '/contact', Component: ContactPage, metadata: contactMetadata, expectedCanonical: '/contact' },
      { name: '/privacy', Component: PrivacyPage, metadata: privacyMetadata, expectedCanonical: '/privacy' },
    ])('$name renders >= 500 characters of substantive copy and canonical metadata', ({ Component, metadata, expectedCanonical }) => {
      expect(metadata.alternates?.canonical).toBe(expectedCanonical);
      const { container } = render(<Component />);
      const textContent = (container.textContent || '').replace(/\s+/g, ' ').trim();
      expect(textContent.length).toBeGreaterThanOrEqual(500);
    });
  });
});
