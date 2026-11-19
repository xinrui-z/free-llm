// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import tailwindcss from '@tailwindcss/vite';

const mode = process.env.CATALOG_MODE || 'static';
if (!['static', 'dynamic'].includes(mode)) throw new Error(`CATALOG_MODE must be "static" or "dynamic", got "${mode}"`);
const dynamic = mode === 'dynamic';
const cloudflare = dynamic ? (await import('@astrojs/cloudflare')).default : undefined;
const cacheTtl = process.env.CATALOG_CACHE_TTL_MS || '';
if (cacheTtl && !(cacheTtl.trim() && Number.isFinite(Number(cacheTtl)) && Number(cacheTtl) >= 0)) throw new Error(`CATALOG_CACHE_TTL_MS must be a nonnegative number of milliseconds, got "${cacheTtl}"`);
// The site Worker may receive CATALOG_API_URL as a runtime variable (set it with `wrangler secret put CATALOG_API_URL`),
// so a missing build-time URL is not fatal. Without either, every request serves the bundled snapshot.
if (dynamic && !process.env.CATALOG_API_URL && !process.env.PUBLIC_STATUS_WORKER_URL) {
  console.warn('[catalog] CATALOG_MODE=dynamic without CATALOG_API_URL or PUBLIC_STATUS_WORKER_URL at build time. ' +
    'Set CATALOG_API_URL as a runtime variable on the free-llm-site Worker, or the site will only serve its bundled snapshot.');
}

// https://astro.build/config
export default defineConfig({
  output: dynamic ? 'server' : 'static',
  adapter: cloudflare?.({ imageService: 'passthrough', prerenderEnvironment: 'node' }),
  session: false,
  site: process.env.PUBLIC_SITE_URL || 'https://free-llm-apis.pages.dev',
  // Both '/providers' and '/providers/' are served. Canonical URLs, JSON-LD and sitemaps use the
  // trailing-slash form produced by build.format 'directory' (see src/lib/site-url.ts).
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  vite: {
    define: {
      'import.meta.env.CATALOG_DYNAMIC': JSON.stringify(dynamic),
      'import.meta.env.CATALOG_API_URL': JSON.stringify(process.env.CATALOG_API_URL || ''),
      'import.meta.env.CATALOG_CACHE_TTL_MS': JSON.stringify(cacheTtl),
      ...(process.env.PUBLIC_STATUS_WORKER_URL ? { 'import.meta.env.PUBLIC_STATUS_WORKER_URL': JSON.stringify(process.env.PUBLIC_STATUS_WORKER_URL) } : {}),
    },
    plugins: [tailwindcss()]
  }
});
