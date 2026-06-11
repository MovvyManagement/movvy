// Dynamic sitemap — Next.js renders this as /sitemap.xml. Update as new
// routes ship so search engines pick them up faster.

import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://movvy.ca';
  const now = new Date();
  return [
    { url: `${base}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/partners`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/legal`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, lastModified: now, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/safety`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/training`, lastModified: now, changeFrequency: 'monthly', priority: 0.4 },
  ];
}
