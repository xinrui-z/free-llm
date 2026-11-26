import type { APIRoute } from 'astro';
import { getProviders } from '../lib/providers';
import { siteURL } from '../lib/site-url';
import { latestDate, providerLastmod } from '../lib/format';
import { familyPages, familyPath } from '../lib/families';

// Static builds list provider and model family pages through @astrojs/sitemap. In dynamic mode those routes are
// rendered on demand, so this endpoint lists the provider and family pages of the catalog served for this request.
const escape = (value: string) => value.replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);
const url = (loc: string, lastmod: string | null) => `<url><loc>${escape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;

export const GET: APIRoute = ({ locals, site }) => {
  const providers = getProviders(locals);
  const entries = [
    ...providers.map(p => url(siteURL(site, `/providers/${encodeURIComponent(p.id)}/`), providerLastmod(p))),
    ...familyPages(providers).map(f => url(siteURL(site, familyPath(f.family.id)), latestDate(f.entries.map(e => providerLastmod(e.provider))))),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
