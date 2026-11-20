import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CHECKER_BINDING_ORIGIN, catalogResponsePolicy, catalogSource, fetchLiveCatalog, parseLiveCatalog } from '../site/src/lib/catalog.ts';
import { normalizeStatus, freshWindow } from '../site/src/lib/status.ts';
import { siteURL, canonicalPath } from '../site/src/lib/site-url.ts';

const dir = new URL('../site/src/data/providers/', import.meta.url);
const bundled = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(new URL(f, dir))));
const fallback = [{ id: 'bundled-only' }];
const reply = (body, status = 200) => new Response(status === 304 ? null : JSON.stringify(body), { status });
const quiet = () => {};

test('invalid providers are dropped individually; unusable payloads fall back', () => {
  const broken = { ...bundled[0], id: 'broken', base_url: 'http://insecure.example' };
  const { providers, dropped } = parseLiveCatalog({ revision: 'r1', providers: [...bundled, broken, bundled[0], null] });
  assert.equal(providers.length, bundled.length);
  assert.deepEqual(dropped, ['broken', bundled[0].id, '#' + (bundled.length + 2)]);
  assert.throws(() => parseLiveCatalog({ providers: bundled }));
  assert.throws(() => parseLiveCatalog({ revision: 'r1', providers: {} }));
  assert.throws(() => parseLiveCatalog({ revision: 'r1', providers: [broken] }));
});

test('live catalog is cached by revision, revalidated with ETag and kept as last-known-good', async () => {
  const cache = {}, calls = [];
  let next = () => reply({ revision: 'r1', providers: bundled });
  const fetcher = async (url, init) => { calls.push(init.headers['If-None-Match']); return next(); };
  const opts = now => ({ fetcher, cache, now, ttlMs: 60_000, warn: quiet });
  const first = await fetchLiveCatalog('https://api.test/', fallback, opts(0));
  assert.equal(first.origin, 'live');
  assert.equal(first.unavailable, false);
  await fetchLiveCatalog('https://api.test', fallback, opts(30_000));
  assert.equal(calls.length, 1, 'served from cache inside the TTL');
  next = () => reply(null, 304);
  assert.equal((await fetchLiveCatalog('https://api.test', fallback, opts(61_000))).revision, 'r1');
  assert.deepEqual(calls, [undefined, '"r1"']);
  next = () => { throw new Error('offline'); };
  const stale = await fetchLiveCatalog('https://api.test', fallback, opts(200_000));
  assert.equal(stale.origin, 'live');
  assert.equal(stale.stale, true);
  assert.equal(stale.unavailable, true);
  assert.equal(stale.providers.length, bundled.length);
  assert.equal(calls.length, 3);
  await fetchLiveCatalog('https://api.test', fallback, opts(205_000));
  assert.equal(calls.length, 3, 'failed refreshes back off briefly');
  next = () => reply({ providers: [null] });
  const invalid = await fetchLiveCatalog('https://api.test', fallback, opts(300_000));
  assert.equal(invalid.reason, 'invalid');
  assert.equal(invalid.stale, true);
  next = () => reply({ revision: 'r2', providers: bundled.slice(1) });
  const fresh = await fetchLiveCatalog('https://api.test', fallback, opts(400_000));
  assert.equal(fresh.revision, 'r2');
  assert.equal(fresh.stale, undefined);
});

test('without a previous live catalog, failures use the bundled snapshot', async () => {
  const state = await fetchLiveCatalog('https://api.test', fallback, { fetcher: async () => reply({}, 503), cache: {}, warn: quiet });
  assert.equal(state.origin, 'snapshot');
  assert.equal(state.providers, fallback);
  assert.equal(state.reason, 'unavailable');
  const zero = await fetchLiveCatalog('https://api.test', fallback, { fetcher: async () => reply({ revision: 'r', providers: [] }), cache: {}, warn: quiet });
  assert.equal(zero.reason, 'invalid');
  let warned = '';
  const partial = await fetchLiveCatalog('https://api.test', fallback, { fetcher: async () => reply({ revision: 'r', providers: [...bundled, { id: 'bad' }] }), cache: {}, warn: m => { warned = m; } });
  assert.deepEqual(partial.dropped, ['bad']);
  assert.match(warned, /bad/);
});

test('the CHECKER service binding wins over the HTTP catalog URL; HTTP is the fallback', async () => {
  const seen = [];
  const binding = { marker: 'fetcher', async fetch(input, init) { seen.push([String(input), init?.headers?.Accept, this?.marker]); return reply({ revision: 'b1', providers: bundled }); } };
  const viaBinding = catalogSource(binding, 'https://api.test');
  assert.equal(viaBinding.via, 'binding');
  assert.equal(viaBinding.url, CHECKER_BINDING_ORIGIN);
  const state = await fetchLiveCatalog(viaBinding.url, fallback, { fetcher: viaBinding.fetcher, cache: {}, warn: quiet });
  assert.equal(state.revision, 'b1');
  assert.deepEqual(seen, [[`${CHECKER_BINDING_ORIGIN}/api/catalog`, 'application/json', 'fetcher']], 'the binding is called as a method with an absolute URL');
  assert.deepEqual(catalogSource(undefined, ' https://api.test '), { url: 'https://api.test', via: 'http' });
  assert.deepEqual(catalogSource(null, 'https://api.test'), { url: 'https://api.test', via: 'http' });
  assert.deepEqual(catalogSource({}, 'https://api.test'), { url: 'https://api.test', via: 'http' }, 'a value without fetch() is not a binding');
  assert.equal(catalogSource(binding, '').via, 'binding', 'the binding needs no URL');
  assert.equal(catalogSource(undefined, ''), undefined);
  assert.equal(catalogSource(undefined, undefined), undefined);
});

test('a provider dropped by validation is never served as a cacheable 404', () => {
  const live = { providers: bundled, revision: 'r', origin: 'live', unavailable: false };
  assert.deepEqual(catalogResponsePolicy(live, '/providers/missing/', 404), { source: 'live', cacheControl: 'public, max-age=60', unavailableProvider: false });
  const partial = { ...live, dropped: ['bad id', '#3'] };
  for (const path of ['/providers/bad%20id', '/providers/bad%20id/']) {
    assert.deepEqual(catalogResponsePolicy(partial, path, 404), { source: 'live', cacheControl: 'no-store', unavailableProvider: true });
  }
  assert.equal(catalogResponsePolicy(partial, '/providers/missing', 404).unavailableProvider, false);
  assert.equal(catalogResponsePolicy(partial, '/providers/missing', 404).cacheControl, 'no-store');
  assert.equal(catalogResponsePolicy(partial, '/providers/%E0', 404).unavailableProvider, false);
  assert.equal(catalogResponsePolicy(partial, '/providers/bad%20id', 200).unavailableProvider, false);
  assert.equal(catalogResponsePolicy({ ...live, unavailable: true, stale: true }, '/', 200).source, 'stale');
  assert.equal(catalogResponsePolicy({ ...live, origin: 'snapshot', unavailable: true }, '/', 200).cacheControl, 'no-store');
});

test('per-provider fresh_ms widens or narrows the freshness window within bounds', () => {
  const now = Date.parse('2026-11-16T10:00:00Z'), hour = 3600_000;
  assert.equal(freshWindow(undefined), 2 * hour);
  assert.equal(freshWindow(60_000), 2 * hour);
  assert.equal(freshWindow(49 * hour), 2 * hour);
  assert.equal(freshWindow(Number.NaN), 2 * hour);
  assert.equal(freshWindow(6 * hour), 6 * hour);
  const at = new Date(now - 5 * hour).toISOString();
  const input = { last_checked: at, providers: [
    { id: 'slow', status: 'active', latency_ms: 10, checked_at: at, fresh_ms: 6 * hour },
    { id: 'fast', status: 'active', latency_ms: 10, checked_at: at },
  ], models: [{ provider_id: 'slow', model_id: 'm', status: 'active', latency_ms: 5, checked_at: at }] };
  const result = normalizeStatus(input, ['slow', 'fast'], now);
  assert.deepEqual(result.providers.map(p => p.status), ['active', 'unknown']);
  assert.equal(result.models[0].status, 'active');
  assert.equal(normalizeStatus(result, ['slow', 'fast'], now).providers[0].status, 'active', 'renormalizing keeps the window');
  assert.equal(normalizeStatus(input, ['slow'], now + 2 * hour).providers[0].status, 'unknown');
  const unmonitored = normalizeStatus({ ...input, models: [{ provider_id: 'slow', model_id: 'img', status: 'unknown', latency_ms: null, checked_at: null, error: 'not_monitored' },
    { provider_id: 'slow', model_id: 'old', status: 'active', latency_ms: 5, checked_at: new Date(now - 7 * hour).toISOString(), error: 'stale' }] }, ['slow'], now).models;
  assert.deepEqual(unmonitored.map(m => [m.status, m.error]), [['unknown', 'not_monitored'], ['unknown', 'not_checked_recently']]);
});

test('canonical URLs use the trailing-slash directory form', () => {
  assert.equal(canonicalPath('/providers'), '/providers/');
  assert.equal(canonicalPath('/providers/groq/?q=1'), '/providers/groq/');
  assert.equal(canonicalPath('/robots.txt'), '/robots.txt');
  assert.equal(siteURL(new URL('https://example.com'), '/pricing'), 'https://example.com/pricing/');
  assert.equal(siteURL(undefined), 'https://free-llm-apis.pages.dev/');
});
