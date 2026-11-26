import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { modelCapabilities, hasCapability, inputModalities } from '../site/src/lib/capabilities.ts';
import { limitRows } from '../site/src/lib/limits.ts';
import { exploreRows, LONG_CONTEXT_TOKENS } from '../site/src/lib/explore.ts';
import { validateProvider } from '../scripts/lib/catalog-validation.mjs';

const dir = new URL('../site/src/data/providers/', import.meta.url);
const bundled = readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_')).map(f => JSON.parse(readFileSync(new URL(f, dir))));
const keys = m => modelCapabilities(m).map(c => `${c.key}:${c.basis}`);

test('capabilities: catalog evidence beats name hints, and families never imply capabilities', () => {
  assert.deepEqual(keys({ id: 'gemini-3.1-flash-lite', modalities: ['text', 'vision'] }), ['vision:catalog']);
  assert.deepEqual(keys({ id: 'glm-z1-flash', modalities: ['text'] }), ['reasoning:name']);
  assert.deepEqual(keys({ id: 'glm-z1-flash', modalities: ['text'], capabilities: { reasoning: true } }), ['reasoning:catalog']);
  assert.deepEqual(keys({ id: 'poolside/laguna-xs-2.1', modalities: ['text', 'code'] }), ['coding:catalog']);
  assert.deepEqual(keys({ id: 'cohere/north-mini-code:free', name: 'Cohere: North Mini Code (free)' }), ['coding:name']);
  assert.deepEqual(keys({ id: 'command-a-reasoning-08-2025' }), ['reasoning:name']);
  // Vendor names and stray substrings are not capabilities.
  assert.deepEqual(keys({ id: 'thinkingmachines/inkling-2-small:free', name: 'Thinking Machines: Inkling 2 Small (free)' }), []);
  assert.deepEqual(keys({ id: 'acme/model-r100' }), []);
  assert.deepEqual(keys({ id: 'x', capabilities: { tool_calling: true, structured_output: false } }), ['tools:catalog']);
  assert.deepEqual(keys({ id: 'glm-z1-flash', capabilities: { reasoning: false } }), [], 'a documented false beats the name hint');
  assert.deepEqual(keys({ id: 'x-ai/grok-4-fast-non-reasoning' }), []);
  assert.deepEqual(keys({ id: 'deepseek-v3.2', name: 'DeepSeek V3.2 (Non-thinking Mode)' }), []);
  assert.deepEqual(keys({ id: 'mistral/devstral-small-2' }), ['coding:name']);
  assert.equal(hasCapability({ id: 'gpt-4o', modalities: ['text'] }, 'vision'), false, 'no family-level vision');
});

test('input modalities are never assumed', () => {
  assert.equal(inputModalities({}), null);
  assert.equal(inputModalities({ modalities: [] }), null);
  assert.equal(inputModalities({ modalities: ['code'] }), null);
  assert.deepEqual(inputModalities({ modalities: ['text', 'vision', 'code'] }), ['text', 'image']);
});

test('limit rows: structured limits keep their scope; unknown metrics are not disclosed, never derived', () => {
  const groq = bundled.find(p => p.id === 'groq');
  const rows = limitRows(groq);
  assert.deepEqual(rows.map(r => [r.metric, r.value, r.scope]), [['rpm', 30, 'model'], ['tpm', 8000, 'model'], ['rpd', 1000, 'model'], ['tpd', 200000, 'model']]);
  const plain = limitRows({ rpm: 20, tpm: null });
  // Without structured limits only RPM/TPM are shown: daily caps are not claimed undisclosed.
  assert.deepEqual(plain.map(r => [r.metric, r.value, r.scope]), [['rpm', 20, null], ['tpm', null, null]]);
  assert.deepEqual(limitRows({}).map(r => r.value), [null, null]);
  const cohere = limitRows(bundled.find(p => p.id === 'cohere'));
  assert.deepEqual(cohere.find(r => r.metric === 'requests_per_month')?.value, 1000);
  assert.equal(cohere.find(r => r.metric === 'tpm')?.value, null);
});

test('limits validation rejects unknown values, scopes and unsourced numbers', () => {
  const base = bundled.find(p => p.id === 'groq');
  const withLimits = limits => validateProvider({ ...base, limits });
  assert.deepEqual(withLimits(base.limits), []);
  assert.ok(withLimits([{ ...base.limits[0], value: null }]).some(e => /published nonnegative number/.test(e)));
  assert.ok(withLimits([{ ...base.limits[0], scope: 'global' }]).some(e => /scope/.test(e)));
  assert.ok(withLimits([{ ...base.limits[0], source_url: undefined }]).some(e => /source_url/.test(e)));
  assert.ok(withLimits([base.limits[0], base.limits[0]]).some(e => /duplicate/.test(e)));
  assert.ok(withLimits([{ ...base.limits[0], models: [] }]).some(e => /nonempty array of model IDs/.test(e)));
  assert.deepEqual(withLimits([{ ...base.limits[0], models: ['no-longer-listed'] }]), [], 'a stale model ID never blocks catalog sync');
  assert.ok(validateProvider({ ...base, models: [{ ...base.models[0], capabilities: { reasoning: 'yes' } }, ...base.models.slice(1)] }).some(e => /true or false/.test(e)));
  assert.ok(validateProvider({ ...base, models: [{ ...base.models[0], capabilities: { vision: true } }, ...base.models.slice(1)] }).some(e => /unknown capability/.test(e)));
});

test('explore rows are rule-based, exclude archived providers and rank only disclosed numbers', () => {
  const rows = exploreRows(bundled);
  const byKey = Object.fromEntries(rows.map(r => [r.key, r]));
  const archived = new Set(bundled.filter(p => p.status === 'archived').map(p => `/providers/${p.id}/`));
  for (const r of rows) {
    assert.ok(r.rule.length > 20, `${r.key} states its rule`);
    assert.doesNotMatch(`${r.label} ${r.rule}`, /\b(best|fastest|most reliable)\b/i);
    for (const l of r.leaders) assert.ok(!archived.has(l.href), `${r.key} never ranks archived providers`);
  }
  assert.equal(byKey['rate-limits'].leaders[0].label, 'Groq');
  const unpublished = bundled.filter(p => p.status === 'active' && p.rpm == null && p.tpm == null).map(p => p.name);
  for (const l of byKey['rate-limits'].leaders) assert.ok(!unpublished.includes(l.label));
  for (const l of byKey['long-context'].leaders) assert.match(l.value, /^\d+(\.\d+)?[KM]$/);
  assert.equal(byKey.availability.count, null, 'availability is filled only from live monitoring');
  assert.equal(LONG_CONTEXT_TOKENS, 256000);
});
