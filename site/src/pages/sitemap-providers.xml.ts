import type { APIRoute } from 'astro';
import { getProviders } from '../lib/providers';
import { siteURL } from '../lib/site-url';

// Static builds list provider pages through @astrojs/sitemap. In dynamic mode those routes are
// rendered on demand, so this endpoint lists the providers of the catalog served for this request.
const escape = (value: string) => value.replace(/[<>&'"]/g, c => `&#${c.charCodeAt(0)};`);

export const GET: APIRoute = ({ locals, site }) => {
  const urls = getProviders(locals).map(p => siteURL(site, `/providers/${encodeURIComponent(p.id)}/`));
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `<url><loc>${escape(url)}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
