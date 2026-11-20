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
// In production the site Worker reads the catalog through its CHECKER service binding (site/wrangler.jsonc).
// CATALOG_API_URL / PUBLIC_STATUS_WORKER_URL are the HTTP fallback (astro dev, previews, tests); without a
// binding or a URL, every request serves the bundled snapshot.
if (dynamic && !process.env.CATALOG_API_URL && !process.env.PUBLIC_STATUS_WORKER_URL) {
  console.warn('[catalog] CATALOG_MODE=dynamic without CATALOG_API_URL or PUBLIC_STATUS_WORKER_URL at build time. ' +
    'The deployed Worker still reads the catalog through its CHECKER service binding; local previews will serve the bundled snapshot.');
}

// CATALOG_CHECKER_BINDING=off builds a dynamic site that ignores the CHECKER service binding and always reads the
// catalog over HTTP (CATALOG_API_URL), e.g. to preview a production build against a local catalog API. Without it,
// a local preview with no free-llm-checker service serves the bundled snapshot (the unbound service fails softly).
const checkerBindingSetting = process.env.CATALOG_CHECKER_BINDING || 'on';
if (!['on', 'off'].includes(checkerBindingSetting)) throw new Error(`CATALOG_CHECKER_BINDING must be "on" or "off", got "${checkerBindingSetting}"`);

/**
 * `virtual:checker-binding` exports `checkerBinding()`, which resolves to the site Worker's CHECKER service
 * binding or undefined. Only a production dynamic build reads it, from `cloudflare:workers` (imported lazily
 * because prerendering runs in Node). Static builds and `astro dev` get a stub, so a static build never
 * references `cloudflare:workers`, and `astro dev` keeps using the HTTP catalog URL.
 * @returns {import('vite').Plugin}
 */
function checkerBindingModule() {
  const id = 'virtual:checker-binding', resolved = '\0' + id;
  let command = 'build';
  return {
    name: 'free-llm:checker-binding',
    configResolved(config) { command = config.command; },
    resolveId(source) { return source === id ? resolved : undefined; },
    load(source) {
      if (source !== resolved) return undefined;
      if (!dynamic || command !== 'build' || checkerBindingSetting === 'off') return 'export async function checkerBinding() { return undefined; }';
      return [
        'let binding;',
        'export async function checkerBinding() {',
        "  binding ??= import('cloudflare:workers').then(m => m.env?.CHECKER, () => undefined);",
        '  return binding;',
        '}',
      ].join('\n');
    },
  };
}

// Test only (playwright.dynamic.config.ts): run tests/fake-checker/worker.mjs as an auxiliary Worker named
// free-llm-checker, so the e2e build reaches its fake catalog through the real CHECKER service binding.
const testCheckerUpstream = process.env.CATALOG_TEST_CHECKER_UPSTREAM || '';
const testChecker = dynamic && testCheckerUpstream ? { auxiliaryWorkers: [{ config: {
  name: 'free-llm-checker', main: './tests/fake-checker/worker.mjs', compatibility_date: '2026-11-17',
  vars: { CATALOG_UPSTREAM: testCheckerUpstream },
} }] } : {};
// Keep the test Worker's build out of dist/, which is what gets deployed (Vite would default to dist/free_llm_checker).
const testCheckerEnvironments = testChecker.auxiliaryWorkers ? { free_llm_checker: { build: { outDir: '.wrangler/test-checker' } } } : undefined;

// https://astro.build/config
export default defineConfig({
  output: dynamic ? 'server' : 'static',
  adapter: cloudflare?.({ imageService: 'passthrough', prerenderEnvironment: 'node', ...testChecker }),
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
    ...(testCheckerEnvironments ? { environments: testCheckerEnvironments } : {}),
    plugins: [tailwindcss(), checkerBindingModule()]
  }
});
