import { defineMiddleware } from 'astro:middleware';
import { getSecret } from 'astro:env/server';
import fallback from './data/providers';
import { checkerBinding } from 'virtual:checker-binding';
import { CATALOG_TTL_MS, catalogResponsePolicy, catalogSource, fetchLiveCatalog, snapshotState } from './lib/catalog';
import { canonicalPath } from './lib/site-url';

let reportedMisconfiguration = false;
const ttl = (value: unknown) => {
  const n = typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export const onRequest = defineMiddleware(async (context, next) => {
  // '/x' and '/x/' both render (trailingSlash: 'ignore'); on-demand pages 301 to the canonical '/x/' form,
  // query string kept, before any catalog work. Paths with a file extension are left alone (canonicalPath).
  if (import.meta.env.CATALOG_DYNAMIC && !context.isPrerendered
      && (context.request.method === 'GET' || context.request.method === 'HEAD')) {
    const { pathname, search } = context.url;
    // '/providers' itself only redirects to '/' (pages/providers/index.astro): go there in one hop.
    const canonical = pathname === '/providers' ? '/' : canonicalPath(pathname);
    if (canonical !== pathname) return context.redirect(canonical + search, 301);
  }
  // Prerendered routes (robots.txt) never depend on the live catalog.
  if (import.meta.env.CATALOG_DYNAMIC && !context.isPrerendered) {
    // The CHECKER service binding (production Worker) wins; otherwise the catalog is read over HTTP.
    const source = catalogSource(await checkerBinding(),
      getSecret('CATALOG_API_URL') || import.meta.env.CATALOG_API_URL || import.meta.env.PUBLIC_STATUS_WORKER_URL);
    if (source) {
      context.locals.catalog = await fetchLiveCatalog(source.url, fallback, {
        ...(source.fetcher ? { fetcher: source.fetcher } : {}),
        // `astro dev` defaults to no reuse so catalog changes show up on the next request.
        ttlMs: ttl(getSecret('CATALOG_CACHE_TTL_MS')) ?? ttl(import.meta.env.CATALOG_CACHE_TTL_MS) ?? (import.meta.env.DEV ? 0 : CATALOG_TTL_MS),
      });
    } else {
      if (!reportedMisconfiguration) {
        reportedMisconfiguration = true;
        console.error('[catalog] CATALOG_MODE=dynamic but there is no CHECKER service binding, CATALOG_API_URL (runtime variable or build-time) or PUBLIC_STATUS_WORKER_URL; serving the bundled snapshot.');
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
