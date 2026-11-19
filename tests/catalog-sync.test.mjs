import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { completeModelList, price } from '../scripts/catalog/adapters.mjs';
import { planSync, validateSources } from '../scripts/catalog/sync.mjs';
import { retryAfterMs } from '../scripts/catalog/fetch.mjs';
import { discoverProviders, discoverProvidersReport } from '../scripts/catalog/provider-discovery.mjs';
import { syncCatalog, fetchCatalog, main } from '../scripts/sync-catalog.mjs';

const source = {
  provider_id: 'openrouter', adapter: 'openrouter', enabled: true,
  removal_confirmations: 2, removal_interval_hours: 6, max_removal_fraction: 0.25, max_additions: 25,
};
const discovery = {
  provider_id: 'aihubmix', adapter: 'openai-discovery', enabled: true,
  url: 'https://aihubmix.com/v1/models', candidate_suffix: '-free', policy_url: 'https://docs.aihubmix.com/cn/blogs/free-ai-models',
};
const now = '2026-11-17T00:00:00.000Z';
const rawModel = (id, pricing = { prompt: '0', completion: '0' }) => ({
  id, name: id, context_length: 131072, pricing,
  architecture: { input_modalities: ['text'], output_modalities: ['text'] },
});
function fixture() {
  const models = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id: `test/${id}:free`, name: id, status: 'active', rpm: null, rpd: null }));
  const provider = {
    id: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', status: 'active', auth: 'required',
    models, top_models: [models[2].id, models[0].id], last_verified: '2026-11-01',
    quota_note: 'An independently reviewed account policy',
    sources: [{ url: 'https://openrouter.ai/docs/api/reference/limits', label: 'Limits', checked_at: '2026-11-01' }],
  };
  return { provider, raw: { data: models.map(m => rawModel(m.id)) }, source, observedAt: now };
}

test('sync preserves policy dates, curated ranks, limits and explicit deprecations', () => {
  const f = fixture();
  f.provider.models[0].rpm = 5;
  f.provider.models[0].editor_note = 'Keep this';
  f.provider.models[4].status = 'deprecated';
  f.raw.data.reverse();
  f.raw.data.push(rawModel('test/new:free'));
  const result = planSync(f);
  assert.equal(result.provider.last_verified, f.provider.last_verified);
  assert.equal(result.provider.quota_note, f.provider.quota_note);
  assert.deepEqual(result.provider.sources[0], f.provider.sources[0]);
  assert.deepEqual(result.provider.top_models, f.provider.top_models);
  assert.equal(result.provider.models[0].rpm, 5);
  assert.equal(result.provider.models[0].editor_note, 'Keep this');
  assert.equal(result.provider.models[4].status, 'deprecated');
  assert.equal(result.provider.models.at(-1).rpm, null);
  assert.equal(result.provider.catalog_checked_at, '2026-11-17');
  assert.deepEqual(result.report.models.added, ['test/new:free']);
  assert.equal(f.provider.models.length, 5);
  assert.equal(planSync({ ...f, provider: result.provider, state: result.state }).report.catalog_changed, false);
});

test('unknown prices never become zero and malformed candidate prices block publication', () => {
  for (const value of [null, undefined, '', ' ', false, true, [], {}, 'NaN', Infinity, -1, '-1', '0x0', '1e-9999']) {
    assert.throws(() => price(value));
    const f = fixture();
    f.raw.data[0].pricing.prompt = value;
    assert.throws(() => planSync(f), /price/i);
  }
  for (const value of ['0', '0.000', 0, '0e-8']) assert.equal(price(value), 0);
});

test('one disappearance is retained; same-time retries and early reruns cannot confirm removal', () => {
  const f = fixture();
  f.raw.data = f.raw.data.filter(m => m.id !== 'test/a:free');
  const first = planSync(f);
  assert.equal(first.provider.models.length, 5);
  assert.deepEqual(first.report.pending_removals, ['models/test/a:free']);
  const retry = planSync({ ...f, provider: first.provider, state: first.state });
  assert.equal(retry.state.missing['models/test/a:free'].count, 1);
  const early = planSync({ ...f, provider: retry.provider, state: retry.state, observedAt: '2026-11-17T05:59:59.000Z' });
  assert.equal(early.provider.models.length, 5);
  const later = planSync({ ...f, provider: early.provider, state: early.state, observedAt: '2026-11-17T06:00:00.000Z' });
  assert.equal(later.provider.models.length, 4);
  assert.deepEqual(later.report.models.removed, ['test/a:free']);
  assert.deepEqual(later.provider.top_models, ['test/c:free', 'test/b:free']);
});

test('reappearing models reset pending removal evidence', () => {
  const f = fixture();
  const missing = { data: f.raw.data.slice(1) };
  const first = planSync({ ...f, raw: missing });
  const restored = planSync({ ...f, provider: first.provider, state: first.state, observedAt: '2026-11-17T06:00:00.000Z' });
  assert.deepEqual(restored.state.missing, {});
  const again = planSync({ ...f, raw: missing, provider: restored.provider, state: restored.state, observedAt: '2026-11-17T12:00:00.000Z' });
  assert.equal(again.provider.models.length, 5);
  assert.equal(again.state.missing['models/test/a:free'].count, 1);
});

test('changed source policy cannot reuse old removal confirmations', () => {
  const f = fixture();
  f.raw.data = f.raw.data.slice(1);
  const first = planSync(f);
  const next = planSync({ ...f, provider: first.provider, state: first.state,
    source: { ...source, max_additions: 20 }, observedAt: '2026-11-17T06:00:00.000Z' });
  assert.equal(next.provider.models.length, 5);
  assert.equal(next.state.missing['models/test/a:free'].count, 1);
});

test('explicit nonzero prices and extra billing revoke free eligibility immediately', () => {
  for (const pricing of [{ prompt: '0.000001', completion: '0' }, { prompt: '0', completion: '0', request: '0.01' }]) {
    const f = fixture();
    f.raw.data[0].pricing = pricing;
    const result = planSync(f);
    assert.equal(result.provider.models.length, 4);
    assert.deepEqual(result.report.revoked_free_eligibility, ['test/a:free']);
    assert.deepEqual(result.report.pending_removals, []);
  }
});

test('catalog rejects empty, duplicate, truncated, paginated and malformed snapshots', () => {
  const f = fixture();
  const responses = [
    {}, { data: [] }, { data: [null] }, { data: [f.raw.data[0], f.raw.data[0]] },
    { ...f.raw, total_count: 6 }, { ...f.raw, links: { next: '/page/2' } }, { ...f.raw, has_more: true },
    { data: f.raw.data.slice(0, 2) },
    { data: f.raw.data.map(m => ({ ...m, context_length: '128K' })) },
    { data: f.raw.data.map(m => ({ ...m, architecture: { input_modalities: ['text'], output_modalities: [null] } })) },
  ];
  for (const raw of responses) assert.throws(() => planSync({ ...f, raw }));
  assert.doesNotThrow(() => completeModelList({ data: [rawModel('~vendor/latest'), rawModel('legacy-model(33)')] }));
});

test('large additions, archived providers and future or malformed state block sync', () => {
  const f = fixture();
  assert.throws(() => planSync({ ...f, raw: { data: [...f.raw.data, ...Array.from({ length: 26 }, (_, i) => rawModel(`new/${i}:free`))] } }), /addition/);
  assert.throws(() => planSync({ ...f, provider: { ...f.provider, status: 'archived' } }), /Archived/);
  const first = planSync(f);
  assert.throws(() => planSync({ ...f, state: { ...first.state, checked_at: '2027-01-01' } }), /state/);
  assert.throws(() => planSync({ ...f, state: { ...first.state, missing: { x: { count: 999 } } } }), /observation/);
});

test('tracked paid prices update with evidence; untracked paid models are not imported', () => {
  const f = fixture();
  f.provider.paid_models = [{ id: 'paid/a', name: 'Paid', status: 'active' }];
  f.raw.data.push(rawModel('paid/a', { prompt: '0.0000006', completion: '0.0000015' }), rawModel('paid/b'));
  const result = planSync(f);
  assert.equal(result.provider.paid_models.length, 1);
  assert.equal(result.provider.paid_models[0].pricing.input_per_million, 0.6);
  assert.equal(result.provider.paid_models[0].pricing.output_per_million, 1.5);
  assert.equal(result.provider.paid_models[0].pricing.checked_at, '2026-11-17');
});

test('OpenAI-style discovery reports candidates without claiming free eligibility or rewriting provider', () => {
  const f = fixture();
  const provider = { ...f.provider, id: 'aihubmix', models: [{ id: 'known-free', name: 'Known', status: 'active' }], top_models: ['known-free'] };
  const raw = { data: [{ id: 'known-free' }, { id: 'trial-free' }, { id: 'paid' }] };
  const first = planSync({ provider, raw, source: discovery, observedAt: now });
  assert.equal(first.provider, provider);
  assert.equal(first.report.catalog_changed, false);
  assert.deepEqual(first.state.candidates.map(c => c.id), ['trial-free']);
  const next = planSync({ provider, raw, source: discovery, state: first.state, observedAt: '2026-11-18T00:00:00.000Z' });
  assert.equal(next.state.candidates[0].first_seen_at, now);
});

test('source manifest rejects duplicate providers, unsafe URLs and unknown adapters', () => {
  assert.deepEqual(validateSources({ version: 1, sources: [source, discovery] }), [source, discovery]);
  for (const sources of [[source, source], [{ ...source, adapter: 'unknown' }], [{ ...source, removal_confirmations: 1 }], [{ ...discovery, url: 'http://example.com' }]]) {
    assert.throws(() => validateSources({ version: 1, sources }));
  }
});

function workspace(t, sources = [source]) {
  const root = mkdtempSync(resolve(tmpdir(), 'free-llm-sync-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(resolve(root, 'catalog'), { recursive: true });
  mkdirSync(resolve(root, 'site/src/data/providers'), { recursive: true });
  writeFileSync(resolve(root, 'catalog/sources.json'), JSON.stringify({ version: 1, sources }));
  const f = fixture();
  for (const s of sources) writeFileSync(resolve(root, `site/src/data/providers/${s.provider_id}.json`), JSON.stringify({ ...f.provider, id: s.provider_id }));
  return { root, ...f };
}

const serve = body => async () => new Response(JSON.stringify(body));
async function capture(fn) {
  const lines = [], { log, warn, error } = console;
  console.log = console.warn = console.error = (...args) => lines.push(args.join(' '));
  try { return { result: await fn(), lines }; } finally { Object.assign(console, { log, warn, error }); }
}

test('CLI preview and offline replay are read-only; explicit apply persists evidence; repeated apply is idempotent', async t => {
  const { root, raw } = workspace(t);
  const file = resolve(root, 'input.json');
  writeFileSync(file, JSON.stringify(raw));
  const path = resolve(root, 'site/src/data/providers/openrouter.json');
  const statePath = resolve(root, 'catalog/state/openrouter.json');
  const before = readFileSync(path, 'utf8');
  assert.equal((await capture(() => main(['--provider', 'openrouter', '--from', file, '--date', '2026-11-17'], { root }))).result, 0);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(existsSync(statePath), false);
  await assert.rejects(main(['--provider', 'openrouter', '--from', file, '--write'], { root }), /preview-only/);
  const first = await syncCatalog({ root, write: true, observedAt: now, fetchImpl: serve(raw) });
  assert.deepEqual(first.written, ['site/src/data/providers/openrouter.json', 'catalog/state/openrouter.json']);
  const after = readFileSync(path, 'utf8'), state = readFileSync(statePath, 'utf8');
  const again = await syncCatalog({ root, write: true, observedAt: '2026-11-17T06:00:00.000Z', fetchImpl: serve(raw) });
  assert.deepEqual(again.written, []);
  assert.equal(again.observed_at, '2026-11-17T06:00:00.000Z');
  assert.equal(readFileSync(path, 'utf8'), after);
  assert.equal(readFileSync(statePath, 'utf8'), state);
  await assert.rejects(main(['--date', '2026-02-30'], { root }), /date/);
  await assert.rejects(main(['--provider', 'missing'], { root }), /No enabled/);
});

test('--date is replay-only and never in the future; replay ignores newer saved state', async t => {
  const { root, raw } = workspace(t);
  const file = resolve(root, 'input.json');
  writeFileSync(file, JSON.stringify({ data: raw.data.slice(1) }));
  await assert.rejects(main(['--date', '2026-11-01'], { root }), /--from/);
  const tomorrow = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  await assert.rejects(main(['--from', file, '--date', tomorrow], { root }), /future/);
  // Live state recorded after the replay date must neither block the replay nor be rewound by it.
  await syncCatalog({ root, write: true, observedAt: '2026-11-18T00:00:00.000Z', fetchImpl: serve({ data: raw.data.slice(1) }) });
  const statePath = resolve(root, 'catalog/state/openrouter.json'), state = readFileSync(statePath, 'utf8');
  const { result: code } = await capture(() => main(['--from', file, '--date', '2026-11-17'], { root }));
  assert.equal(code, 0);
  const report = JSON.parse(readFileSync(resolve(root, '.catalog-reports/report.json'), 'utf8'));
  assert.equal(report.providers[0].replay, true);
  assert.equal(report.providers[0].state_ignored, true);
  assert.deepEqual(report.providers[0].pending_removals, ['models/test/a:free']);
  assert.equal(readFileSync(statePath, 'utf8'), state);
});

test('a concurrent edit aborts the write after saving report.json', async t => {
  const { root, raw } = workspace(t);
  const path = resolve(root, 'site/src/data/providers/openrouter.json');
  const edited = readFileSync(path, 'utf8').replace('"OpenRouter"', '"OpenRouter (edited)"');
  await assert.rejects(syncCatalog({ root, write: true, observedAt: now, fetchImpl: async () => {
    writeFileSync(path, edited);
    return new Response(JSON.stringify(raw));
  } }), /changed during sync/);
  assert.equal(readFileSync(path, 'utf8'), edited);
  assert.equal(existsSync(resolve(root, 'catalog/state/openrouter.json')), false);
  const report = JSON.parse(readFileSync(resolve(root, '.catalog-reports/report.json'), 'utf8'));
  assert.equal(report.applied, false);
  assert.match(report.conflict, /openrouter/);
});

test('observation-only runs change neither provider nor state; paid checked_at follows the price', () => {
  const f = fixture();
  f.provider.paid_models = [{ id: 'paid/a', name: 'Paid', status: 'active' }];
  f.raw.data.push(rawModel('paid/a', { prompt: '0.0000006', completion: '0.0000015' }));
  f.raw.data = f.raw.data.filter(m => m.id !== 'test/a:free');
  const first = planSync(f);
  assert.equal(first.report.state_changed, true);
  const quiet = planSync({ ...f, provider: first.provider, state: first.state, observedAt: '2026-11-18T01:00:00.000Z', raw: { data: f.raw.data } });
  // The second observation counts toward removal, so only a material state change is reported.
  assert.equal(quiet.report.catalog_changed, true);
  const settled = planSync({ ...f, provider: quiet.provider, state: quiet.state, observedAt: '2026-11-18T02:00:00.000Z' });
  assert.equal(settled.report.catalog_changed, false);
  assert.equal(settled.report.state_changed, false);
  assert.equal(settled.state, quiet.state);
  assert.deepEqual(settled.provider, quiet.provider);
  assert.equal(settled.report.observed_at, '2026-11-18T02:00:00.000Z');
  assert.equal(settled.provider.paid_models[0].pricing.checked_at, '2026-11-17');
  const raised = { data: f.raw.data.map(m => m.id === 'paid/a' ? rawModel('paid/a', { prompt: '0.0000007', completion: '0.0000015' }) : m) };
  const repriced = planSync({ ...f, raw: raised, provider: settled.provider, state: settled.state, observedAt: '2026-11-19T00:00:00.000Z' });
  assert.equal(repriced.provider.paid_models[0].pricing.checked_at, '2026-11-19');
  assert.equal(repriced.provider.catalog_checked_at, '2026-11-19');
});

test('discovery reports catalogued models missing upstream and the CLI raises a warning annotation', async t => {
  const { root } = workspace(t, [discovery]);
  const raw = { data: [{ id: 'test/b:free' }, { id: 'test/c:free' }, { id: 'test/d:free' }, { id: 'test/e:free' }, { id: 'new-free' }] };
  const file = resolve(root, 'input.json');
  writeFileSync(file, JSON.stringify(raw));
  const previous = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true';
  t.after(() => { if (previous === undefined) delete process.env.GITHUB_ACTIONS; else process.env.GITHUB_ACTIONS = previous; });
  const { result: code, lines } = await capture(() => main(['--from', file], { root }));
  assert.equal(code, 0);
  assert.ok(lines.some(line => line.startsWith('::warning title=Catalog sync (aihubmix)::1 catalogued model(s) missing upstream') && line.includes('test/a:free')), lines.join('\n'));
  assert.ok(lines.some(line => /^Attention: 1 catalogued model/.test(line)));
  const report = JSON.parse(readFileSync(resolve(root, '.catalog-reports/report.json'), 'utf8'));
  assert.deepEqual(report.missing_upstream, [{ provider_id: 'aihubmix', models: ['test/a:free'] }]);
  assert.deepEqual(report.providers[0].missing_upstream, ['test/a:free']);
});

test('a malformed new :free entry is quarantined; malformed tracked entries still block', () => {
  const f = fixture();
  f.raw.data.push({ ...rawModel('test/new:free'), pricing: { prompt: null, completion: '0' } }, { ...rawModel('test/odd:free'), context_length: '128K' });
  const result = planSync(f);
  assert.deepEqual(result.report.quarantined.map(q => q.id), ['test/new:free', 'test/odd:free']);
  assert.match(result.report.quarantined[0].reason, /price/i);
  assert.equal(result.provider.models.length, 5);
  assert.equal(result.report.catalog_changed, true);
  f.raw.data[0].pricing = { prompt: null, completion: '0' };
  assert.throws(() => planSync(f), /price/i);
});

test('provider discovery matches API origins only and surfaces archived providers as reactivation candidates', () => {
  const existing = [
    { id: 'alpha', base_url: 'https://api.alpha.com/v1', website_url: 'https://cloud.example.com', status: 'active' },
    { id: 'old', base_url: 'https://api.old.com/v1', status: 'archived' },
  ];
  const entry = (api, doc = 'https://cloud.example.com/docs') => ({ name: 'X', api, doc, models: { m: { cost: { input: 0, output: 0 } } } });
  const { candidates, filtered } = discoverProvidersReport({
    sibling: entry('https://api.sibling.com/v1'), mirror: entry('https://api.alpha.com/v2'),
    revived: entry('https://api.old.com/openai'), paid: { ...entry('https://api.paid.com'), models: { m: { cost: { input: 1, output: 1 } } } },
  }, existing);
  assert.deepEqual(candidates.map(c => c.provider_id), ['revived', 'sibling']);
  assert.equal(candidates[0].kind, 'reactivation');
  assert.equal(candidates[0].existing_provider_id, 'old');
  assert.deepEqual(filtered, [
    { provider_id: 'mirror', reason: 'already in catalog', existing_provider_id: 'alpha' },
    { provider_id: 'paid', reason: 'no zero-price models' },
  ]);
  assert.deepEqual(discoverProviders({ sibling: entry('https://api.sibling.com/v1') }, existing).map(c => c.provider_id), ['sibling']);
});

test('provider discovery ignores a www. prefix and prefers active providers on a shared API origin', () => {
  const entry = api => ({ name: 'X', api, models: { m: { cost: { input: 0, output: 0 } } } });
  const existing = [
    { id: 'current', base_url: 'https://example.com/v1', status: 'active' },
    { id: 'retired', base_url: 'https://example.com/v1', status: 'archived' },
    { id: 'gone', base_url: 'https://www.gone.com/v1', status: 'archived' },
  ];
  const { candidates, filtered } = discoverProvidersReport({
    mirror: entry('https://www.example.com/v1'), same: entry('https://example.com/openai'), back: entry('https://gone.com/v1'),
    sub: entry('https://api.example.com/v1'),
  }, existing);
  assert.deepEqual(filtered, [
    { provider_id: 'mirror', reason: 'already in catalog', existing_provider_id: 'current' },
    { provider_id: 'same', reason: 'already in catalog', existing_provider_id: 'current' },
  ]);
  assert.deepEqual(candidates.map(c => [c.provider_id, c.kind ?? null, c.existing_provider_id ?? null]), [['back', 'reactivation', 'gone'], ['sub', null, null]]);
});

test('manual pricing fields survive unchanged prices; valid_until is dropped when the price changes', () => {
  const f = fixture();
  f.provider.paid_models = [{ id: 'paid/a', name: 'Paid', status: 'active' }];
  f.raw.data.push(rawModel('paid/a', { prompt: '0.0000006', completion: '0.0000015' }));
  const first = planSync(f);
  first.provider.paid_models[0].pricing.valid_until = '2026-12-31';
  const quiet = planSync({ ...f, provider: first.provider, state: first.state, observedAt: '2026-11-18T00:00:00.000Z' });
  assert.equal(quiet.report.catalog_changed, false);
  assert.deepEqual(quiet.report.paid_models.updated, []);
  assert.deepEqual(quiet.provider, first.provider);
  assert.equal(quiet.provider.paid_models[0].pricing.valid_until, '2026-12-31');
  const raised = { data: f.raw.data.map(m => m.id === 'paid/a' ? rawModel('paid/a', { prompt: '0.0000007', completion: '0.0000015' }) : m) };
  const repriced = planSync({ ...f, raw: raised, provider: quiet.provider, state: quiet.state, observedAt: '2026-11-19T00:00:00.000Z' });
  const pricing = repriced.provider.paid_models[0].pricing;
  assert.equal(pricing.input_per_million, 0.7);
  assert.equal(pricing.checked_at, '2026-11-19');
  assert.equal(Object.hasOwn(pricing, 'valid_until'), false);
  assert.equal(repriced.report.catalog_changed, true);
});

test('failure of one selected source leaves every catalog and observation state untouched', async t => {
  const { root, raw } = workspace(t, [source, discovery]);
  const path = resolve(root, 'site/src/data/providers/openrouter.json');
  const before = readFileSync(path, 'utf8');
  const report = await syncCatalog({ root, write: true, observedAt: now,
    fetchImpl: async url => new Response(JSON.stringify(url.includes('openrouter') ? raw : { data: [] })),
  });
  assert.equal(report.blocked, true);
  assert.equal(report.applied, false);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(existsSync(resolve(root, 'catalog/state')), false);
});

test('fetch uses no credentials, rejects non-JSON and does not retry authentication errors', async () => {
  let calls = 0;
  await assert.rejects(fetchCatalog('https://example.com', async (_url, options) => {
    calls++;
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.redirect, 'manual');
    return new Response('{}', { status: 401 });
  }), /HTTP 401/);
  assert.equal(calls, 1);
  await assert.rejects(fetchCatalog('https://example.com', async () => new Response('<html>maintenance</html>')), /valid JSON/);
});

test('fetch honors bounded Retry-After and treats empty bodies as permanent', async () => {
  const delays = [];
  let calls = 0;
  const flaky = async () => ++calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '7' } }) : new Response('{"data":[]}');
  assert.deepEqual(await fetchCatalog('https://example.com', flaky, undefined, { sleep: async ms => delays.push(ms) }), { data: [] });
  assert.deepEqual(delays, [7000]);
  calls = 0;
  await assert.rejects(fetchCatalog('https://example.com', async () => { calls++; return new Response('', { status: 503, headers: { 'Retry-After': '3600' } }); },
    undefined, { sleep: async () => assert.fail('must not wait') }), /Retry-After/);
  assert.equal(calls, 1);
  for (const body of ['', '  \n', null]) {
    calls = 0;
    await assert.rejects(fetchCatalog('https://example.com', async () => { calls++; return new Response(body); }, undefined, { sleep: async () => {} }), /empty body/);
    assert.equal(calls, 1);
  }
  assert.equal(retryAfterMs('Wed, 18 Nov 2026 00:00:30 GMT', Date.parse('2026-11-18T00:00:00Z')), 30_000);
  assert.equal(retryAfterMs('soon'), null);
});
