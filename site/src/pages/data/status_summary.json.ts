import type { APIRoute } from 'astro';
import { getProviders } from '../../lib/providers';

// Catalog counts only. Probe health lives at the checker's /api/status; this endpoint is rendered
// at build time in static mode and cannot know it, so it does not report health statuses.
// `total` (used by the README badge) counts providers listed as active in the catalog,
// `active` is the same catalog status count (not probe health) and `archived` the delisted ones.
export const GET: APIRoute = ({ locals }) => {
  const providers = getProviders(locals), catalog = locals.catalog;
  const active = providers.filter(p => p.status === 'active').length;
  const body = {
    total: active,
    active,
    archived: providers.length - active,
    ...(catalog ? { revision: catalog.revision, source: catalog.origin === 'snapshot' ? 'snapshot' : catalog.stale ? 'stale' : 'live' } : {}),
    generated_at: new Date().toISOString(),
  };
  // Rendered per request in dynamic mode, so the header is set here; public/_headers covers the static file.
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'X-Robots-Tag': 'noindex' } });
};
