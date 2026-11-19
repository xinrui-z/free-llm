import { defineMiddleware } from 'astro:middleware';
import { getSecret } from 'astro:env/server';
import fallback from './data/providers';
import { CATALOG_TTL_MS, catalogResponsePolicy, fetchLiveCatalog, snapshotState } from './lib/catalog';

let reportedMisconfiguration = false;
const ttl = (value: unknown) => {
  const n = typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export const onRequest = defineMiddleware(async (context, next) => {
  // Prerendered routes (robots.txt) never depend on the live catalog.
  if (import.meta.env.CATALOG_DYNAMIC && !context.isPrerendered) {
    const url = getSecret('CATALOG_API_URL') || import.meta.env.CATALOG_API_URL || import.meta.env.PUBLIC_STATUS_WORKER_URL;
    if (url) {
      context.locals.catalog = await fetchLiveCatalog(url, fallback, {
        // `astro dev` defaults to no reuse so catalog changes show up on the next request.
        ttlMs: ttl(getSecret('CATALOG_CACHE_TTL_MS')) ?? ttl(import.meta.env.CATALOG_CACHE_TTL_MS) ?? (import.meta.env.DEV ? 0 : CATALOG_TTL_MS),
      });
    } else {
      if (!reportedMisconfiguration) {
        reportedMisconfiguration = true;
        console.error('[catalog] CATALOG_MODE=dynamic but no CATALOG_API_URL (runtime variable or build-time) or PUBLIC_STATUS_WORKER_URL is configured; serving the bundled snapshot.');
      }
      context.locals.catalog = snapshotState(fallback, 'misconfigured');
    }
  }
  let response = await next();
  const catalog = context.locals.catalog;
  if (catalog) {
    const policy = catalogResponsePolicy(catalog, context.url.pathname, response.status);
    if (policy.unavailableProvider) {
      // The live catalog lists this provider but its entry failed validation here: not a confirmed 404.
      response = new Response('Live catalog unavailable. Please try again shortly.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    response.headers.set('X-Catalog-Revision', catalog.revision);
    response.headers.set('X-Catalog-Source', policy.source);
    if (policy.unavailableProvider || !response.headers.has('Cache-Control')) response.headers.set('Cache-Control', policy.cacheControl);
  }
  return response;
});
