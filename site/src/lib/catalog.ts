import type { Provider } from '../data/providers';
import { validateProvider } from '../../../scripts/lib/catalog-validation.mjs';

export interface CatalogState {
  providers: Provider[];
  revision: string;
  // 'live': fetched from the catalog API (possibly a stale last-known-good copy).
  // 'snapshot': the directory bundled at build time.
  origin: 'live' | 'snapshot';
  // True whenever the current request could not confirm the live catalog.
  unavailable: boolean;
  // True when serving a previously validated live catalog after a failed refresh.
  stale?: boolean;
  // Why the live catalog was not confirmed for this request.
  reason?: 'misconfigured' | 'unavailable' | 'invalid';
  // Provider IDs dropped from the live payload because they failed validation.
  dropped?: string[];
}

export class InvalidCatalog extends Error {}

/** Validates each provider and drops the invalid ones. Throws only when the payload as a whole is unusable. */
export function parseLiveCatalog(data: unknown): { providers: Provider[]; revision: string; dropped: string[] } {
  const body = data as { revision?: unknown; providers?: unknown } | null;
  if (!body || typeof body !== 'object' || typeof body.revision !== 'string' || !body.revision || !Array.isArray(body.providers)) {
    throw new InvalidCatalog('Catalog payload must contain a revision and a providers array');
  }
  const providers: Provider[] = [], dropped: string[] = [], seen = new Set<string>();
  for (const [index, p] of body.providers.entries()) {
    const id = typeof p?.id === 'string' && p.id ? p.id : `#${index}`;
    let errors: string[];
    try { errors = validateProvider(p); } catch { errors = ['validation failed']; }
    if (errors.length || seen.has(id)) { dropped.push(id); continue; }
    seen.add(id);
    providers.push(p as Provider);
  }
  if (!providers.length) throw new InvalidCatalog('Catalog contains no valid providers');
  return { providers, revision: body.revision, dropped };
}

/**
 * Response metadata for a page rendered from `catalog`. A provider route that 404s only because its
 * live entry failed validation is answered with 503: the catalog still lists that provider, so the
 * page must not be reported (or cached) as missing. Any degraded catalog (unavailable, stale or with
 * dropped providers) is served with no-store so a bounded public cache never pins the degraded view.
 */
export function catalogResponsePolicy(catalog: CatalogState, pathname: string, status: number):
  { source: 'live' | 'stale' | 'snapshot'; cacheControl: string; unavailableProvider: boolean } {
  const source = catalog.origin === 'snapshot' ? 'snapshot' : catalog.stale ? 'stale' : 'live';
  let unavailableProvider = false;
  const match = status === 404 && catalog.dropped?.length ? /^\/providers\/([^/]+)\/?$/.exec(pathname) : null;
  if (match) {
    try { unavailableProvider = catalog.dropped!.includes(decodeURIComponent(match[1])); } catch { /* malformed escape: not a provider id */ }
  }
  const degraded = catalog.unavailable || !!catalog.dropped?.length;
  return { source, cacheControl: degraded ? 'no-store' : 'public, max-age=60', unavailableProvider };
}

export const snapshotState = (fallback: Provider[], reason: CatalogState['reason']): CatalogState =>
  ({ providers: fallback, revision: 'bundled', origin: 'snapshot', unavailable: true, reason });

/** The subset of a Cloudflare service binding (Fetcher) the site uses. */
export interface CatalogBinding {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

// A service binding ignores the hostname, but fetch() still needs an absolute URL.
export const CHECKER_BINDING_ORIGIN = 'https://checker.internal';

export interface CatalogSource { url: string; via: 'binding' | 'http'; fetcher?: typeof fetch }

/**
 * Chooses how the site reaches the checker's public catalog. The CHECKER service binding wins when
 * the Worker has one: on workers.dev a Worker cannot fetch another workers.dev Worker on the same
 * account (error 1042). Without a binding (`astro dev`, tests, local previews) the HTTP URL is used.
 * Returns undefined when neither is configured.
 */
export function catalogSource(binding: CatalogBinding | null | undefined, httpUrl: string | null | undefined): CatalogSource | undefined {
  if (binding && typeof binding.fetch === 'function') {
    // Call as a method: a Fetcher must keep its `this`.
    return { url: CHECKER_BINDING_ORIGIN, via: 'binding', fetcher: ((input, init) => binding.fetch(input, init)) as typeof fetch };
  }
  const url = typeof httpUrl === 'string' ? httpUrl.trim() : '';
  return url ? { url, via: 'http' } : undefined;
}

interface CacheEntry { url: string; state: CatalogState; checkedAt: number }

export interface CatalogCache { entry?: CacheEntry; failedAt?: number }

export interface FetchCatalogOptions {
  fetcher?: typeof fetch;
  now?: number;
  // How long a confirmed live catalog is reused without contacting the API. 0 disables reuse.
  ttlMs?: number;
  // Per-isolate cache. Only plain data is stored, never Response objects or promises.
  cache?: CatalogCache;
  warn?: (message: string) => void;
}

export const CATALOG_TTL_MS = 60_000;
// After a failed refresh, wait this long before retrying so an outage does not add a timeout to every request.
const RETRY_MS = 10_000;
const isolateCache: CatalogCache = {};

export async function fetchLiveCatalog(url: string, fallback: Provider[], options: FetchCatalogOptions | typeof fetch = {}): Promise<CatalogState> {
  const { fetcher = fetch, now = Date.now(), ttlMs = CATALOG_TTL_MS, cache = isolateCache, warn = console.warn } =
    typeof options === 'function' ? { fetcher: options } : options;
  const base = url.replace(/\/$/, '');
  if (cache.entry && cache.entry.url !== base) { cache.entry = undefined; cache.failedAt = undefined; }
  const entry = cache.entry;
  // Prefer the last validated live catalog over the build-time snapshot.
  const fail = (reason: 'unavailable' | 'invalid'): CatalogState => {
    cache.failedAt = now;
    return entry ? { ...entry.state, unavailable: true, stale: true, reason } : snapshotState(fallback, reason);
  };
  if (cache.failedAt !== undefined && now - cache.failedAt < Math.min(ttlMs, RETRY_MS)) {
    return entry ? { ...entry.state, unavailable: true, stale: true, reason: 'unavailable' } : snapshotState(fallback, 'unavailable');
  }
  if (entry && cache.failedAt === undefined && now - entry.checkedAt < ttlMs) return entry.state;

  let response: Response;
  try {
    response = await fetcher(`${base}/api/catalog`, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: 'application/json', ...(entry ? { 'If-None-Match': `"${entry.state.revision}"` } : {}) },
    });
  } catch {
    return fail('unavailable');
  }
  if (response.status === 304 && entry) {
    cache.entry = { ...entry, checkedAt: now };
    cache.failedAt = undefined;
    return entry.state;
  }
  let data: unknown;
  try {
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return fail('unavailable');
    }
    data = await response.json();
  } catch {
    return fail('invalid');
  }
  try {
    const { providers, revision, dropped } = parseLiveCatalog(data);
    if (dropped.length) warn(`[catalog] revision ${revision}: dropped invalid providers: ${dropped.join(', ')}`);
    const state: CatalogState = { providers, revision, origin: 'live', unavailable: false, ...(dropped.length ? { dropped } : {}) };
    cache.entry = { url: base, state, checkedAt: now };
    cache.failedAt = undefined;
    return state;
  } catch {
    return fail('invalid');
  }
}
