import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { applyPriceResult, mergePricing, candidateEntry } from '../scripts/catalog/price-apply.mjs';
import { pricePages } from '../scripts/catalog/price-pages.mjs';
import { main } from '../scripts/check-prices.mjs';
import { validateProvider } from '../scripts/lib/catalog-validation.mjs';

const page = pricePages['ollama-cloud'];
const pricing = (input, output, extra = {}) => ({ input_per_million: input, output_per_million: output, currency: 'USD', source_url: page.page_url, checked_at: '2026-11-16', ...extra });
const provider = () => ({
  id: 'ollama-cloud', name: 'Ollama Cloud', base_url: 'https://ollama.com/v1', status: 'archived', archive_reason: 'Paid only.', auth: 'required',
  last_verified: '2026-11-16', top_models: ['beam'], description: 'kept', quota_note: 'kept',
  sources: [{ label: 'Pricing', url: page.page_url, checked_at: '2026-11-16' }],
  models: [
    { id: 'beam', name: 'beam', status: 'active', modalities: ['text'], rpm: null, tpm: null, pricing: pricing(0.125, 0.4) },
    { id: 'gemma4', name: 'gemma4', status: 'active', modalities: ['text'], rpm: null, tpm: null, pricing: pricing(0.14, 0.4, { valid_until: '2026-12-31' }) },
    { id: 'old', name: 'old', status: 'active', modalities: ['text'], rpm: null, tpm: null, pricing: { ...pricing(1, 2), source_url: 'https://ollama.com/old' } },
  ],
});

test('applyPriceResult changes prices, promotion dates and moved pages, and adds candidates as paid models', () => {
  const result = {
    status: 'drift',
    changed: [
      { id: 'beam', fields: { input_per_million: { catalog: 0.125, page: 0.2 } } },
      { id: 'gemma4', fields: { valid_until: { catalog: '2026-12-31', page: null } } },
    ],
    source_url: [{ id: 'old', catalog: 'https://ollama.com/old', expected: page.page_url }],
    unpriced: [{ id: 'x', reason: 'n/a' }], missing: ['gone'],
    candidates: [{ id: 'hy4', input_per_million: 0.834, output_per_million: 2.501 }],
  };
  const { provider: next, applied } = applyPriceResult(provider(), result, page, '2026-11-25');
  const by = Object.fromEntries([...next.models, ...next.paid_models].map(m => [m.id, m]));
  assert.deepEqual(by.beam.pricing, pricing(0.2, 0.4, { checked_at: '2026-11-25' }));
  assert.equal(by.gemma4.pricing.valid_until, undefined, 'a promotion that ended is removed');
  assert.equal(by.gemma4.pricing.checked_at, '2026-11-25');
  assert.equal(by.old.pricing.source_url, page.page_url);
  assert.equal(by.old.pricing.checked_at, '2026-11-16', 'a moved page is not a new price');
  assert.deepEqual(next.paid_models, [candidateEntry({ id: 'hy4', input_per_million: 0.834, output_per_million: 2.501 }, page, '2026-11-25')]);
  assert.deepEqual(next.models.map(m => m.id), ['beam', 'gemma4', 'old'], 'free models are never added or removed');
  assert.equal(next.description, 'kept');
  assert.deepEqual(applied.map(a => `${a.kind}:${a.model_id}`), ['price:beam', 'price:gemma4', 'source_url:old', 'paid_model_added:hy4']);
  assert.deepEqual(validateProvider(next), []);
});

test('applyPriceResult never acts on a blocked page or an empty result', () => {
  assert.equal(applyPriceResult(provider(), { status: 'blocked', error: 'x' }, page, '2026-11-25'), null);
  assert.equal(applyPriceResult(provider(), { status: 'ok', changed: [], source_url: [], candidates: [] }, page, '2026-11-25'), null);
});

test('mergePricing copies only pricing data and keeps every live edit', () => {
  const live = provider();
  live.description = 'live edit';
  live.models[0].rpm = 7;
  const repo = provider();
  repo.description = 'repository text';
  repo.models[0].pricing = pricing(0.3, 0.5, { checked_at: '2026-11-25' });
  repo.models.push({ id: 'repo-free', name: 'x', status: 'active', modalities: ['text'], pricing: pricing(1, 1) });
  repo.paid_models = [{ id: 'paid', name: 'paid', status: 'active', modalities: ['text'], rpm: null, tpm: null, pricing: { ...pricing(2, 4), source_url: 'https://ollama.com/other' } }];
  repo.sources.push({ label: 'Other page', url: 'https://ollama.com/other', checked_at: '2026-11-25' });
  repo.pricing_note = 'note';
  const { provider: next, changes } = mergePricing(live, repo);
  assert.equal(next.description, 'live edit');
  assert.equal(next.models[0].rpm, 7);
  assert.deepEqual(next.models[0].pricing, repo.models[0].pricing);
  assert.deepEqual(next.models.map(m => m.id), ['beam', 'gemma4', 'old'], 'free models stay a live decision');
  assert.deepEqual(next.paid_models, repo.paid_models);
  assert.equal(next.pricing_note, 'note');
  assert.deepEqual(next.sources.map(s => s.url), [page.page_url, 'https://ollama.com/other']);
  assert.deepEqual(changes.map(c => c.kind), ['pricing', 'paid_model_added', 'pricing_note', 'source_added']);
  assert.equal(mergePricing(next, repo), null, 'merging again changes nothing');
  assert.equal(mergePricing(live, { ...repo, id: 'other' }), null);
});

function tempRoot() {
  const root = mkdtempSync(resolve(tmpdir(), 'price-write-'));
  mkdirSync(resolve(root, 'site/src/data/providers'), { recursive: true });
  mkdirSync(resolve(root, 'catalog'), { recursive: true });
  const p = provider();
  p.models = p.models.slice(0, 1);
  writeFileSync(resolve(root, 'site/src/data/providers/ollama-cloud.json'), JSON.stringify(p, null, 2) + '\n');
  return root;
}
const html = rows => `<h2>Model pricing</h2><p>Pay as you go. Prices are per million tokens.</p><table><thead><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr></thead><tbody>${
  rows.map(([n, i, o]) => `<tr><td><a href="/library/${n}">${n}</a></td><td>${i}</td><td>-</td><td>${o}</td></tr>`).join('')}</tbody></table>`;
const PAGE = html([['beam', '$0.15', '$0.40'], ['a', '$1', '$1'], ['b', '$1', '$1'], ['c', '$1', '$1'], ['d', '$1', '$1']]);
const pageFetch = body => async url => url === 'https://ollama.com/pricing' ? new Response(body, { headers: { 'Content-Type': 'text/html' } }) : new Response('', { status: 404 });

test('check-prices --write applies prices and new paid models to the repository JSON', async () => {
  const root = tempRoot(), logs = [];
  writeFileSync(resolve(root, 'catalog/price-candidates-ignore.json'), JSON.stringify({ version: 1, providers: { 'ollama-cloud': { d: 'Reviewed and left out' } } }));
  assert.equal(await main(['--provider', 'ollama-cloud', '--write'], { root, fetchImpl: pageFetch(PAGE), log: m => logs.push(m) }), 1);
  const saved = JSON.parse(readFileSync(resolve(root, 'site/src/data/providers/ollama-cloud.json'), 'utf8'));
  assert.equal(saved.models[0].pricing.input_per_million, 0.15);
  assert.deepEqual(saved.paid_models.map(m => m.id), ['a', 'b', 'c'], 'ignored models are not added');
  const report = JSON.parse(readFileSync(resolve(root, '.catalog-reports/prices/report.json'), 'utf8'));
  assert.equal(report.written.applied.length, 4);
  assert.match(logs.join(''), /## Applied to the repository[\s\S]*beam\*\*: \$0\.125 \/ \$0\.4 → \$0\.15 \/ \$0\.4/);
  // The next run finds nothing to do.
  assert.equal(await main(['--provider', 'ollama-cloud', '--write'], { root, fetchImpl: pageFetch(PAGE), log() {} }), 0);
});

test('check-prices --write leaves the JSON untouched when a page is blocked, and refuses replays and live catalogs', async () => {
  const root = tempRoot(), before = readFileSync(resolve(root, 'site/src/data/providers/ollama-cloud.json'), 'utf8'), quiet = { log() {}, error() {} };
  assert.equal(await main(['--provider', 'ollama-cloud', '--write'], { root, fetchImpl: pageFetch('<html>maintenance</html>'), ...quiet }), 1);
  assert.equal(readFileSync(resolve(root, 'site/src/data/providers/ollama-cloud.json'), 'utf8'), before);
  writeFileSync(resolve(root, 'page.html'), PAGE);
  assert.equal(await main(['--provider', 'ollama-cloud', '--from', resolve(root, 'page.html'), '--write'], { root, ...quiet }), 2);
  assert.equal(await main(['--write', '--catalog-url', 'https://checker.example'], { root, ...quiet }), 2);
  assert.equal(readFileSync(resolve(root, 'site/src/data/providers/ollama-cloud.json'), 'utf8'), before);
});
