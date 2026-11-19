import type { APIRoute } from 'astro';
import { siteURL } from '../lib/site-url';

// Depends only on build-time configuration, so it is prerendered in both catalog modes.
export const prerender = true;

export const GET: APIRoute = ({ site }) => {
  const sitemaps = [siteURL(site, '/sitemap-index.xml')];
  // Dynamic mode renders provider pages per request; they are listed by an on-demand sitemap.
  if (import.meta.env.CATALOG_DYNAMIC) sitemaps.push(siteURL(site, '/sitemap-providers.xml'));
  const body = ['User-agent: *', 'Allow: /', '', ...sitemaps.map(url => `Sitemap: ${url}`), ''].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
