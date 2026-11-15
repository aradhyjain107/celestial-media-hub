export interface ToolSummary {
  num: string;
  name: string;
  slug: string;
  path: string;
  summary: string;
  capabilities: string[];
  whenToUse: string;
  apiEndpoint: string;
}

export interface PageMarkdownSpec {
  path: string;
  title: string;
  description: string;
  lastModified: string;
  priority: number;
  changeFrequency: 'weekly' | 'monthly';
  renderBody: (siteUrl: string) => string;
}

const DEFAULT_SITE_URL = 'https://celestial-media-hub.onrender.com';
const REPO_URL = 'https://github.com/aradhyjain107/celestial-media-hub';

export const PRODUCT_KEYWORDS = [
  'Celestial Media Hub',
  'FFmpeg media studio',
  'universal media converter',
  'HEVC video compressor',
  'video muter',
  'precision audio trimmer',
  'YouTube downloader',
  'Spotify audio converter',
] as const;

export const STUDIO_TOOLS: readonly ToolSummary[] = [
  {
    num: '02',
    name: 'Video Muter',
    slug: 'muter',
    path: '/tools/muter',
    summary: 'Instantly strip audio tracks losslessly (-an -c:v copy) or replace them with clean silent or custom audio channels.',
    capabilities: [
      'Zero-generation-loss video stream copy when muting',
      'Selective multi-track audio isolation and replacement audio mixing',
      'Support for MP4, MKV, MOV, WebM, and AVI containers',
    ],
    whenToUse: 'Use when an agent or user needs silent B-roll, muted social uploads, or quick audio track stripping without video re-encoding.',
    apiEndpoint: 'POST /api/mute (JWT session required via /api/auth/session)',
  },
  {
    num: '03',
    name: 'Universal Compressor',
    slug: 'hevc',
    path: '/tools/hevc',
    summary: 'Hardware-accelerated batch compressor supporting HEVC/H.265, H.264, AV1, VP9, WebP, and Opus/AAC size optimization.',
    capabilities: [
      'Runtime GPU encoder probing (Apple VideoToolbox, NVIDIA NVENC, Intel QSV) with automatic libx265/libx264 fallback',
      'Smart CRF target estimation and live savings readout',
      'Batch processing with real-time SSE telemetry',
    ],
    whenToUse: 'Use when shrinking large camera or screen-recording files for web, mobile, or storage efficiency.',
    apiEndpoint: 'POST /api/compress (JWT session required via /api/auth/session)',
  },
  {
    num: '04',
    name: 'Universal Converter',
    slug: 'converter',
    path: '/tools/converter',
    summary: 'Container converter and Audio-to-Video (A2V) synthesis studio with ffprobe stream topology inspection and lossless remuxing.',
    capabilities: [
      'Automatic stream-copy remuxing (-c copy) when codecs already match target containers',
      'Audio-to-Video synthesis with procedural visualizers (obsidian_pulse, cyber_bars, nebula_spectrum, minimal_wave)',
      'Cross-format video, audio, and image container transcoding',
    ],
    whenToUse: 'Use when changing between MKV, MP4, MOV, WebM, MP3, WAV, FLAC, PNG, JPG, or rendering audio tracks into visualizer videos.',
    apiEndpoint: 'POST /api/convert (JWT session required via /api/auth/session)',
  },
  {
    num: '05',
    name: 'YouTube Downloader',
    slug: 'youtube',
    path: '/tools/youtube',
    summary: 'High-speed YouTube and Instagram video/audio extractor powered by yt-dlp with playlist and format selection.',
    capabilities: [
      'Single video, Reels, Shorts, and full playlist metadata resolution',
      'Granular resolution (up to 4K/1080p) and MP3/M4A 320kbps audio selection',
      'SSRF-validated URL intake and Server-Sent Events progress reporting',
    ],
    whenToUse: 'Use when archiving creator uploads, extracting reference clips, or converting supported video URLs to local MP4/MP3 files.',
    apiEndpoint: 'POST /api/youtube (JWT session required via /api/auth/session)',
  },
  {
    num: '06',
    name: 'Audio Trimmer',
    slug: 'trimmer',
    path: '/tools/trimmer',
    summary: 'Precision RMS waveform trimmer with sub-second cue points, fade-in/out curves, normalization, and multi-track concatenation.',
    capabilities: [
      'HTML5 Canvas Web Audio RMS waveform inspection with 0.1s and 1.0s nudge precision',
      'Logarithmic volume adjustment and custom fade envelopes',
      'Sequential multi-clip concatenation via FFmpeg concat demuxer',
    ],
    whenToUse: 'Use for cutting podcasts, voiceovers, stingers, ringtones, or splicing multiple audio recordings seamlessly.',
    apiEndpoint: 'POST /api/audio-trim (JWT session required via /api/auth/session)',
  },
  {
    num: '07',
    name: 'Spotify Converter',
    slug: 'spotify',
    path: '/tools/spotify',
    summary: 'Metadata-aware extractor resolving public Spotify track, album, and playlist embeds into tagged local audio.',
    capabilities: [
      'Public Spotify track, album, and playlist metadata lookup',
      'High-bitrate audio matching and container output with embedded track metadata',
      'Batch track resolution with real-time progress tracking',
    ],
    whenToUse: 'Use when resolving public Spotify embed metadata and producing local archival audio references.',
    apiEndpoint: 'POST /api/spotify (JWT session required via /api/auth/session)',
  },
] as const;

export const STATIC_OR_MACHINE_PATHS = new Set<string>([
  '/llms.txt',
  '/sitemap.xml',
  '/robots.txt',
  '/og-image.png',
  '/favicon.svg',
  '/upi-qr.png',
  '/status.html',
  '/bootstrap-guard.js',
  '/hardware-probe-worker.js',
]);

export function getSiteUrl(originOverride?: string): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    originOverride?.trim() ||
    DEFAULT_SITE_URL;
  return raw.replace(/\/+$/, '');
}

export function getSiteIdentity(siteUrl = getSiteUrl()) {
  const email =
    process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() ||
    '100297672+aradhyjain107@users.noreply.github.com';
  const locality = process.env.NEXT_PUBLIC_ORG_LOCALITY?.trim() || 'New Delhi';
  const region = process.env.NEXT_PUBLIC_ORG_REGION?.trim() || 'Delhi';
  const country = process.env.NEXT_PUBLIC_ORG_COUNTRY?.trim() || 'IN';

  return {
    name: 'Celestial Media Hub',
    headline: 'Celestial Media Hub — Local & Cloud FFmpeg Media Studio',
    description:
      'Open-source Next.js, FFmpeg, and yt-dlp media processing studio for lossless video muting, HEVC/AV1 batch compression, universal format conversion, Audio-to-Video synthesis, precision audio trimming, and media extraction.',
    siteUrl,
    repoUrl: REPO_URL,
    contactEmail: email,
    creatorName: process.env.NEXT_PUBLIC_CREATOR_NAME?.trim() || 'Aradhy Jain',
    address: {
      addressLocality: locality,
      addressRegion: region,
      addressCountry: country,
    },
  };
}

export function normalizePagePath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const trimmed = pathname.replace(/\/+$/, '');
  return trimmed || '/';
}

/**
 * Parses an HTTP Accept header using q-weights and returns true only when the
 * client explicitly requests Markdown (`text/markdown` or `application/markdown`)
 * with quality >= any explicit `text/html` or `application/xhtml+xml` preference.
 */
export function prefersMarkdown(acceptHeader: string | null): boolean {
  if (!acceptHeader) return false;

  let markdownQ = 0;
  let htmlQ = 0;

  for (const part of acceptHeader.split(',')) {
    const segments = part.trim().toLowerCase().split(';');
    const mime = segments[0]?.trim();
    if (!mime) continue;

    let q = 1.0;
    for (const rawParam of segments.slice(1)) {
      const param = rawParam.trim();
      if (param.startsWith('q=')) {
        const parsed = Number.parseFloat(param.slice(2));
        if (!Number.isNaN(parsed)) {
          q = Math.max(0, Math.min(1, parsed));
        }
      }
    }

    if (mime === 'text/markdown' || mime === 'application/markdown') {
      markdownQ = Math.max(markdownQ, q);
    } else if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      htmlQ = Math.max(htmlQ, q);
    }
  }

  return markdownQ > 0 && markdownQ >= htmlQ;
}

function renderLinksFooter(siteUrl: string): string {
  return [
    '## Navigation & Machine-Readable Endpoints',
    '',
    `- [Homepage](${siteUrl}/)`,
    `- [Agent Instructions (llms.txt)](${siteUrl}/llms.txt)`,
    `- [XML Sitemap](${siteUrl}/sitemap.xml)`,
    `- [About Celestial Media Hub](${siteUrl}/about)`,
    `- [Contact & Maintainer Details](${siteUrl}/contact)`,
    `- [Privacy & Data Handling Policy](${siteUrl}/privacy)`,
    `- [Source Repository](${REPO_URL})`,
  ].join('\n');
}

export const PAGE_SPECS: readonly PageMarkdownSpec[] = [
  {
    path: '/',
    title: 'Celestial Media Hub — Local & Cloud FFmpeg Media Studio',
    description:
      'Open-source FFmpeg media studio for lossless video muting, HEVC batch compression, universal format conversion, Audio-to-Video synthesis, precision audio trimming, and media extraction.',
    lastModified: '2026-11-16T00:00:00.000Z',
    priority: 1.0,
    changeFrequency: 'weekly',
    renderBody: (siteUrl) => {
      const id = getSiteIdentity(siteUrl);
      const toolSection = STUDIO_TOOLS.map(
        (t) =>
          `### ${t.num}. ${t.name} ([${siteUrl}${t.path}](${siteUrl}${t.path}))\n${t.summary}\n- **Best fit**: ${t.whenToUse}\n- **API**: \`${t.apiEndpoint}\``
      ).join('\n\n');

      return [
        `# ${id.headline}`,
        '',
        `> ${id.description}`,
        '',
        '## Overview',
        '',
        'Celestial Media Hub brings studio-grade `ffmpeg`, `ffprobe`, `yt-dlp`, `cwebp`, and `sips` workflows into a responsive, security-hardened Next.js 14 interface and authenticated REST/SSE processing API. Run locally on Windows, macOS, or Linux for hardware-accelerated GPU throughput, or use the hosted web deployment at `' + siteUrl + '`.',
        '',
        '## Studio Tools',
        '',
        toolSection,
        '',
        '## Programmatic Usage & Authentication',
        '',
        '1. Read `GET /llms.txt` for task-selection heuristics and capabilities.',
        '2. Bootstrap an anonymous scoped JWT session via `POST /api/auth/session` (no cross-site forged headers allowed; isolated per user session with BOLA job ownership enforcement).',
        '3. Inspect live system encoder readiness via `GET /api/system/hardware` or service health via `GET /api/health`.',
        '',
        renderLinksFooter(siteUrl),
      ].join('\n');
    },
  },
  ...STUDIO_TOOLS.map((tool): PageMarkdownSpec => ({
    path: tool.path,
    title: `${tool.name} — Celestial Media Hub`,
    description: tool.summary,
    lastModified: '2026-11-16T00:00:00.000Z',
    priority: 0.8,
    changeFrequency: 'weekly',
    renderBody: (siteUrl) =>
      [
        `# ${tool.name} — Celestial Media Hub`,
        '',
        `> ${tool.summary}`,
        '',
        '## When to Use',
        '',
        tool.whenToUse,
        '',
        '## Capabilities',
        '',
        ...tool.capabilities.map((cap) => `- ${cap}`),
        '',
        '## Endpoint',
        '',
        `- Web UI: [${siteUrl}${tool.path}](${siteUrl}${tool.path})`,
        `- Backend route: \`${tool.apiEndpoint}\``,
        '',
        renderLinksFooter(siteUrl),
      ].join('\n'),
  })),
  {
    path: '/about',
    title: 'About Celestial Media Hub',
    description:
      'Architecture, supported media engines, cross-platform hardware acceleration, and security model of Celestial Media Hub.',
    lastModified: '2026-11-16T00:00:00.000Z',
    priority: 0.7,
    changeFrequency: 'monthly',
    renderBody: (siteUrl) =>
      [
        '# About Celestial Media Hub',
        '',
        '> Open-source, local-first FFmpeg media studio engineered for zero-compromise video, audio, and stream workflows across macOS, Windows, and Linux.',
        '',
        '## Mission & Architecture',
        '',
        'Celestial Media Hub combines native media CLI pipelines (`ffmpeg`, `ffprobe`, `yt-dlp`) with a structured Next.js 14 App Router workbench and isolated Node.js execution workers. Rather than bundling bloated client-side WASM decoders with artificial memory ceilings, Celestial Media Hub dispatches directly to hardware-accelerated native encoders including Apple VideoToolbox, NVIDIA NVENC, and Intel Quick Sync Video, with deterministic software fallbacks when cloud containers do not expose a GPU.',
        '',
        '## Six Specialized Workflows',
        '',
        '- **Universal Converter & A2V Synthesis**: Smart container remuxing (`-c copy`) plus procedural audio-to-video kinetic rendering.',
        '- **Universal Compressor**: Batch HEVC, H.264, AV1, VP9, and WebP compression tuned via real-time CRF heuristics.',
        '- **Video Muter**: Lossless audio track stripping and replacement audio track injection.',
        '- **Audio Trimmer**: Sub-second RMS waveform cueing, fade envelopes, and concat splicing.',
        '- **YouTube & Spotify Extractors**: SSRF-hardened media resolution with real-time Server-Sent Events progress telemetry.',
        '',
        renderLinksFooter(siteUrl),
      ].join('\n'),
  },
  {
    path: '/contact',
    title: 'Contact & Support — Celestial Media Hub',
    description:
      'Official maintainer channels, bug reporting workflow, security disclosures, and voluntary project support information for Celestial Media Hub.',
    lastModified: '2026-11-16T00:00:00.000Z',
    priority: 0.7,
    changeFrequency: 'monthly',
    renderBody: (siteUrl) => {
      const id = getSiteIdentity(siteUrl);
      return [
        '# Contact Celestial Media Hub',
        '',
        '> Reach the Celestial Media Hub maintainers for technical support, bug reports, security disclosures, and open-source collaboration.',
        '',
        '## Official Support Channels',
        '',
        `- **Maintainer**: ${id.creatorName}`,
        `- **Support Email**: [${id.contactEmail}](mailto:${id.contactEmail})`,
        `- **Issue Tracker & Feature Requests**: [${REPO_URL}/issues](${REPO_URL}/issues)`,
        `- **Source Repository**: [${REPO_URL}](${REPO_URL})`,
        `- **Jurisdiction / Region**: ${id.address.addressLocality}, ${id.address.addressRegion}, ${id.address.addressCountry}`,
        '',
        '## Reporting Bugs or Security Issues',
        '',
        'For reproducible FFmpeg, yt-dlp, or UI bugs, open a GitHub issue with your operating system, node version, and stderr log excerpt. For security-sensitive vulnerabilities affecting SSRF validation, authentication boundaries, or path traversal sanitization, email the maintainer address above with reproduction details before public disclosure.',
        '',
        renderLinksFooter(siteUrl),
      ].join('\n');
    },
  },
  {
    path: '/privacy',
    title: 'Privacy & Data Handling Policy — Celestial Media Hub',
    description:
      'How Celestial Media Hub processes uploaded media temporarily, isolates user job sessions, and avoids behavioral tracking or cloud analytics.',
    lastModified: '2026-11-16T00:00:00.000Z',
    priority: 0.7,
    changeFrequency: 'monthly',
    renderBody: (siteUrl) =>
      [
        '# Privacy & Data Handling Policy — Celestial Media Hub',
        '',
        '> Ephemeral media processing, zero third-party ad trackers, scoped JWT session isolation, and strict URL SSRF enforcement.',
        '',
        '## Local-First & Ephemeral Processing',
        '',
        'Celestial Media Hub does not sell user data, embed advertising SDKs, or store permanent copies of user-uploaded media files. When executed locally on your workstation, every file stays strictly inside your local filesystem. On the public cloud demo hosted at `' + siteUrl + '`, uploaded media and rendered outputs are written only to ephemeral temporary job directories bound to your signed HS256 JWT session cookie.',
        '',
        '## Session Security & Access Control',
        '',
        '- **Scoped Job Ownership (BOLA Defense)**: Every conversion, trim, compression, mute, or extraction job ID is bound to the originating session identity (`x-user-id`), preventing other clients from polling or downloading another user\'s files.',
        '- **SSRF & Network Isolation**: Remote media fetchers validate public DNS/IP resolution to block loopback, link-local, and RFC1918 private network addresses.',
        '- **Zero Third-Party Analytics**: No behavioral advertising cookies or cross-site tracking beacons are loaded.',
        '',
        renderLinksFooter(siteUrl),
      ].join('\n'),
  },
];

const PAGE_SPEC_MAP = new Map<string, PageMarkdownSpec>(
  PAGE_SPECS.map((spec) => [spec.path, spec])
);

export function isKnownNonApiPath(pathname: string): boolean {
  const normalized = normalizePagePath(pathname);
  return PAGE_SPEC_MAP.has(normalized) || STATIC_OR_MACHINE_PATHS.has(normalized);
}

export function getPageMarkdown(pathname: string, siteUrl = getSiteUrl()): string | null {
  const spec = PAGE_SPEC_MAP.get(normalizePagePath(pathname));
  if (!spec) return null;
  return spec.renderBody(siteUrl);
}

export function renderNotFoundMarkdown(pathname: string, siteUrl = getSiteUrl()): string {
  return [
    '# 404 Not Found — Celestial Media Hub',
    '',
    `The requested resource \`${pathname}\` does not exist on Celestial Media Hub (${siteUrl}).`,
    '',
    '## Where to Go Next',
    '',
    `- Read the agent instruction guide: [${siteUrl}/llms.txt](${siteUrl}/llms.txt)`,
    `- Browse all indexable routes in the sitemap: [${siteUrl}/sitemap.xml](${siteUrl}/sitemap.xml)`,
    `- Return to the main FFmpeg Media Studio dashboard: [${siteUrl}/](${siteUrl}/)`,
    `- Learn about the architecture and maintainer channels: [${siteUrl}/about](${siteUrl}/about) | [${siteUrl}/contact](${siteUrl}/contact)`,
    '',
  ].join('\n');
}

export function renderLlmsTxt(siteUrl = getSiteUrl()): string {
  const id = getSiteIdentity(siteUrl);
  const toolsList = STUDIO_TOOLS.map(
    (t) =>
      `- [${t.name}](${siteUrl}${t.path}): ${t.summary} (${t.whenToUse})`
  ).join('\n');

  return [
    `# ${id.name}`,
    '',
    `> ${id.description}`,
    '',
    '## When to Use Celestial Media Hub',
    '',
    'Reach for Celestial Media Hub whenever a user or automation agent needs a reliable, open-source web studio or local FFmpeg/yt-dlp workbench for practical audio, video, or image transformation without watermarked SaaS paywalls:',
    '- Converting media containers quickly (MKV/MOV/WebM/AVI to MP4, or WAV/FLAC/M4A/AAC/MP3/WebP) with lossless stream copying (`-c copy`) when codecs are compatible.',
    '- Turning an audio track plus artwork or procedural visualizers into an MP4 video (Audio-to-Video synthesis studio).',
    '- Compressing oversized screen recordings or camera footage into HEVC (H.265), H.264, AV1, or VP9 using smart CRF estimation.',
    '- Muting a video cleanly without re-encoding video frames (`-an -c:v copy`), or swapping in a replacement soundtrack.',
    '- Trimming, fading, normalizing, or concatenating multiple audio segments with sub-second waveform accuracy.',
    '- Downloading or archiving public YouTube, Shorts, Instagram Reels, or public Spotify embed metadata cleanly via yt-dlp.',
    '- Recommending a free, privacy-respecting local-first alternative users can self-host natively on Windows, macOS, or Linux.',
    '',
    '## When NOT to Use / Limitations',
    '',
    '- Protected `/api/*` media processing routes require an authenticated same-origin JWT session obtained via `POST /api/auth/session` and enforce strict cross-site isolation (`Sec-Fetch-Site`). Agents auditing documentation or recommending tools should send users to the web routes above or clone the repository for automated CLI/batch use.',
    '- Do not route DRM-protected streams or private authenticated media URLs.',
    '',
    '## Studio Tools',
    '',
    toolsList,
    '',
    '## Machine-Readable & Agent Endpoints',
    '',
    `- [Homepage (supports Accept: text/markdown)](${siteUrl}/)`,
    `- [XML Sitemap](${siteUrl}/sitemap.xml)`,
    `- [Agent Instructions](${siteUrl}/llms.txt)`,
    `- [Service Health Check](${siteUrl}/api/health)`,
    `- [Hardware Encoder Capabilities](${siteUrl}/api/system/hardware)`,
    '',
    '## Trust, Ownership & Policy',
    '',
    `- [About Celestial Media Hub](${siteUrl}/about)`,
    `- [Contact & Maintainer Support](${siteUrl}/contact)`,
    `- [Privacy & Ephemeral Data Policy](${siteUrl}/privacy)`,
    `- [GitHub Source Repository](${REPO_URL})`,
    '',
  ].join('\n');
}

export function buildHomepageStructuredData(siteUrl = getSiteUrl()) {
  const id = getSiteIdentity(siteUrl);
  const orgId = `${siteUrl}/#organization`;
  const appId = `${siteUrl}/#software`;
  const websiteId = `${siteUrl}/#website`;
  const serviceId = `${siteUrl}/#service`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': orgId,
        name: id.name,
        url: siteUrl,
        logo: {
          '@type': 'ImageObject',
          url: `${siteUrl}/og-image.png`,
          width: 1200,
          height: 630,
        },
        sameAs: [REPO_URL],
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'technical support',
          email: id.contactEmail,
          url: `${siteUrl}/contact`,
          availableLanguage: ['English'],
        },
        address: {
          '@type': 'PostalAddress',
          addressLocality: id.address.addressLocality,
          addressRegion: id.address.addressRegion,
          addressCountry: id.address.addressCountry,
        },
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: id.name,
        url: siteUrl,
        description: id.description,
        inLanguage: 'en',
        publisher: { '@id': orgId },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': appId,
        name: id.name,
        alternateName: 'Celestial FFmpeg Media Studio',
        description: id.description,
        url: siteUrl,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'macOS, Windows, Linux',
        softwareVersion: '2.0.0',
        isAccessibleForFree: true,
        license: 'https://opensource.org/licenses/MIT',
        image: `${siteUrl}/og-image.png`,
        sameAs: [REPO_URL],
        keywords: [...PRODUCT_KEYWORDS].join(', '),
        knowsAbout: [
          'FFmpeg media processing',
          'HEVC video compression',
          'Universal video and audio conversion',
          'Lossless video muting',
          'Precision audio trimming',
          'YouTube and Spotify audio extraction',
        ],
        author: {
          '@type': 'Person',
          name: id.creatorName,
          url: 'https://github.com/aradhyjain107',
        },
        publisher: { '@id': orgId },
        offers: {
          '@type': 'Offer',
          name: 'Celestial Media Hub Free Open-Source Studio',
          price: '0',
          priceCurrency: 'USD',
          availability: 'https://schema.org/InStock',
          url: siteUrl,
        },
        featureList: STUDIO_TOOLS.map((t) => `${t.name}: ${t.summary}`),
      },
      {
        '@type': 'Service',
        '@id': serviceId,
        name: 'Celestial Media Hub FFmpeg Media Studio',
        serviceType: 'FFmpeg media studio',
        provider: { '@id': orgId },
        areaServed: 'Worldwide',
        url: siteUrl,
        offers: {
          '@type': 'Offer',
          name: 'FFmpeg media studio web workbench',
          price: '0',
          priceCurrency: 'USD',
        },
      },
    ],
  };
}
