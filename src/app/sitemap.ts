import type { MetadataRoute } from 'next';
import { PAGE_SPECS, getSiteUrl } from '@/lib/agent/siteContent';

export const dynamic = 'force-dynamic';

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();

  return PAGE_SPECS.map((spec) => ({
    url: spec.path === '/' ? `${siteUrl}/` : `${siteUrl}${spec.path}`,
    lastModified: new Date(spec.lastModified),
    changeFrequency: spec.changeFrequency,
    priority: spec.priority,
  }));
}
