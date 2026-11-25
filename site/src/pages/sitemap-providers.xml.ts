import type { APIRoute } from 'astro';
import { getProviders } from '../lib/providers';
import { siteURL } from '../lib/site-url';
import { providerLastmod } from '../lib/format';

// Static builds list provider pages through @astrojs/sitemap. In dynamic mode those routes are
// rendered on demand, so this endpoint lists the providers of the catalog served for this request.
const escape = (value: string) => value.replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);

export const GET: APIRoute = ({ locals, site }) => {
  const entries = getProviders(locals).map(p => {
    const loc = `<loc>${escape(siteURL(site, `/providers/${encodeURIComponent(p.id)}/`))}</loc>`;
    const lastmod = providerLastmod(p);
    return `<url>${loc}${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`;
  });
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
