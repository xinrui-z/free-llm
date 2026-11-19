import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProvider, validateChangelog, providerTimeChecks, sortProviders } from '../scripts/lib/catalog-validation.mjs';
const valid = JSON.parse(readFileSync(new URL('../site/src/data/providers/aihubmix.json', import.meta.url)));
const now = '2026-11-19T12:00:00Z';
const paidModel = { ...valid.models[0], id: 'paid-only-model' };
test('catalog rejects data that would break pages or publish invalid metadata', () => {
  for (const change of [{ models: null }, { models: [{}] }, { base_url: 'javascript:alert(1)' }, { last_verified: '2026-02-30' }, { top_models: ['missing'] }, { rpm: -1 }, { models: [{...valid.models[0], pricing: { input_per_million: 1, output_per_million: -1, currency: 'USD' } }] }]) {
    assert.ok(validateProvider({ ...valid, ...change }).length, JSON.stringify(change));
  }
  assert.deepEqual(validateProvider(valid), []);
  const pricing = { input_per_million: 1, output_per_million: 2, currency: 'USD', source_url: 'https://example.com/pricing', checked_at: '2026-11-16' };
  for (const override of [{ source_url: 'javascript:alert(1)' }, { source_url: undefined }, { checked_at: '2026-02-30' }, { valid_until: '2026-13-01' }, { valid_until: '2026-11-01' }]) {
    assert.ok(validateProvider({ ...valid, paid_models: [{ ...paidModel, pricing: { ...pricing, ...override } }] }).length, JSON.stringify(override));
  }
  assert.deepEqual(validateProvider({ ...valid, paid_models: [{ ...paidModel, pricing }] }), []);
});
test('active providers need evidence; dates must not be in the future', () => {
  assert.match(validateProvider({ ...valid, sources: undefined }).join(), /sources/);
  assert.match(validateProvider({ ...valid, sources: [] }).join(), /sources/);
  const { sources, ...archived } = { ...valid, status: 'archived' };
  assert.deepEqual(validateProvider(archived), []);
  const options = { now };
  assert.deepEqual(validateProvider(valid, options), []);
  assert.deepEqual(validateProvider(valid, valid.id, options), []);
  assert.deepEqual(validateProvider({ ...valid, last_verified: '2026-11-20' }, options), [], 'one day of timezone grace');
  for (const change of [{ last_verified: '2026-11-21' }, { catalog_checked_at: '2027-01-01' }, { sources: [{ ...valid.sources[0], checked_at: '2026-12-01' }] },
    { models: valid.models.map((m, i) => i ? m : { ...m, pricing: { input_per_million: 0, output_per_million: 0, currency: 'USD', source_url: 'https://example.com', checked_at: '2027-01-01' } }) }]) {
    assert.match(validateProvider({ ...valid, ...change }, options).join(), /future/, JSON.stringify(change));
  }
});
test('structural checks keep rendered fields well typed and model lists consistent', () => {
  for (const change of [
    { top_models: [valid.top_models[0], valid.top_models[0]] },
    { paid_models: [valid.models[0]] },
    { context_window: 128000 }, { description: ['x'] }, { quota_note: {} }, { archive_reason: 1 }, { pricing_note: false },
    { tags: 'free' }, { geo_restrictions: 'US' },
    { models: valid.models.map((m, i) => i ? m : { ...m, context_window: 131072 }) },
    { models: valid.models.map((m, i) => i ? m : { ...m, modalities: 'text' }) },
    { base_url: 'http://api.example.com/v1' }, { base_url: 'https://{region}.example.com/v1' }, { base_url: 'https://api.example.com/%7Bregion%7D' },
  ]) assert.ok(validateProvider({ ...valid, ...change }).length, JSON.stringify(change));
  assert.deepEqual(validateProvider({ ...valid, pricing_note: null, geo_restrictions: null }), []);
});
test('time checks fail expired promotional prices and warn before they or reviews go stale', () => {
  const priced = until => ({ ...valid, models: valid.models.map((m, i) => i ? m : { ...m, pricing: { input_per_million: 0, output_per_million: 0, currency: 'USD', source_url: 'https://example.com', checked_at: '2026-11-16', valid_until: until } }) });
  assert.deepEqual(providerTimeChecks(priced('2027-06-01'), { now }), { errors: [], warnings: [] });
  assert.equal(providerTimeChecks(priced('2026-12-15'), { now }).warnings.length, 1);
  assert.deepEqual(providerTimeChecks(priced('2026-11-19'), { now }).errors, [], 'still valid on its last day');
  assert.equal(providerTimeChecks(priced('2026-11-18'), { now }).errors.length, 1);
  assert.deepEqual(validateProvider(priced('2026-11-18'), { now }), [], 'expiry never makes published data unreadable');
  assert.match(providerTimeChecks({ ...valid, last_verified: '2026-08-01' }, { now }).warnings.join(), /last_verified/);
  assert.deepEqual(providerTimeChecks({ ...valid, status: 'archived', last_verified: '2026-08-01' }, { now }).warnings, []);
});
test('changelog rejects wrong shape, duplicate identifiers and unknown providers', () => {
  assert.ok(validateChangelog({}).length);
  const entry = { id: 'a', provider_id: 'aihubmix', date: '2026-11-16', type: 'model_added', title: 'Updated' };
  assert.deepEqual(validateChangelog([entry]), []);
  assert.ok(validateChangelog([entry, entry]).length);
  assert.deepEqual(validateChangelog([{ ...entry, timestamp: null }, { ...entry, id: 'b', timestamp: '2026-11-16T10:00:00.000Z' }]), []);
  assert.ok(validateChangelog([{ ...entry, timestamp: 'yesterday' }]).length);
  assert.deepEqual(validateChangelog([entry], { providerIds: ['aihubmix'] }), []);
  assert.match(validateChangelog([{ ...entry, provider_id: 'gone' }], { providerIds: ['aihubmix'] }).join(), /unknown provider/);
  assert.deepEqual(validateChangelog([{ ...entry, provider_id: 'gone' }], { providerIds: ['aihubmix'], removedProviderIds: ['gone'] }), []);
});
test('provider order follows _order.json with unlisted providers alphabetical', () => {
  assert.deepEqual(sortProviders([{ id: 'c' }, { id: 'a' }, { id: 'z' }, { id: 'b' }], ['z', 'b']).map(p => p.id), ['z', 'b', 'a', 'c']);
});
test('repository validation covers monitoring policies and sync state files', async () => {
  const { validateRepository, validateMonitoring, validateStateFile } = await import('../scripts/validate.mjs');
  const ids = new Set(['groq']);
  const policy = { enabled: true, daily_requests: 4, monthly_requests: 100, per_model_daily_requests: 2, interval_minutes: 120, max_per_run: 1 };
  assert.deepEqual(validateMonitoring({ version: 1, policies: { groq: policy } }, ids), []);
  assert.match(validateMonitoring({ version: 1, policies: { gone: policy } }, ids).join(), /unknown provider/);
  assert.ok(validateMonitoring({ version: 1, policies: { groq: { ...policy, per_model_daily_requests: 9 } } }, ids).length);
  assert.ok(validateMonitoring([], ids).length);
  const state = { version: 1, provider_id: 'groq', checked_at: '2026-11-17T02:00:00.000Z', missing: {}, candidates: [{ id: 'm' }] };
  assert.deepEqual(validateStateFile(state, 'groq', ids, Date.parse(now)), []);
  for (const change of [{ provider_id: 'other' }, { checked_at: '2027-01-01T00:00:00Z' }, { missing: [] }, { candidates: {} }, { version: 2 }]) {
    assert.ok(validateStateFile({ ...state, ...change }, 'groq', ids, Date.parse(now)).length, JSON.stringify(change));
  }
  // The real catalog is checked against the real clock (synced dates keep moving forward);
  // expired promotional prices are policy, not structure, so they must not break unit tests.
  const repo = validateRepository({ expiredAsWarnings: true });
  assert.deepEqual(repo.errors, []);
  assert.ok(repo.providers.length > 0);
});
test('expired promotional prices fail validation unless reported as warnings', async () => {
  const { validateRepository } = await import('../scripts/validate.mjs');
  const after = '2099-01-01T00:00:00Z';
  const strict = validateRepository({ now: after });
  const lenient = validateRepository({ now: after, expiredAsWarnings: true });
  const expired = strict.errors.filter(e => /pricing expired/.test(e));
  if (!expired.length) return; // no promotional prices in the catalog right now
  assert.ok(expired.every(e => lenient.warnings.includes(e)));
  assert.ok(!lenient.errors.some(e => /pricing expired/.test(e)));
});
