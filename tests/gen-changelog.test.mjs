import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { diffProviders, isDuplicateEntry } from '../scripts/gen-changelog.mjs';
import { validateChangelog } from '../scripts/lib/catalog-validation.mjs';

const now = '2026-11-19T08:00:00.000Z';
const model = (id, extra = {}) => ({ id, name: id.toUpperCase(), status: 'active', rpm: 10, tpm: 100, ...extra });
const provider = (id, extra = {}) => ({ id, name: `P ${id}`, status: 'active', rpm: 30, tpm: 1000, models: [model('a'), model('b')], ...extra });
const diff = (before, after, options = {}) => diffProviders(before, after, { now, revision: 'abc', ...options });

test('provider additions respect catalog status and every entry is a valid changelog entry', () => {
  const entries = diff([], [provider('live', { description: 'Fast.' }), provider('old', { status: 'archived', archive_reason: 'Free tier ended.' })]);
  assert.deepEqual(entries.map(e => e.type), ['provider_added', 'provider_added']);
  assert.equal(entries[0].title, 'Added P live provider');
  assert.match(entries[1].title, /archived/);
  assert.doesNotMatch(entries[1].description, /added to the free API list/);
  assert.deepEqual(validateChangelog(entries), []);
  assert.deepEqual(entries.map(e => e.id), ['cl-auto-abc-0', 'cl-auto-abc-1']);
  assert.equal(entries[0].date, '2026-11-19');
  assert.equal(entries[0].timestamp, now);
});

test('status changes emit status_change with the old and new status', () => {
  const [archived] = diff([provider('x')], [provider('x', { status: 'archived', archive_reason: 'No longer free.' })]);
  assert.equal(archived.type, 'status_change');
  assert.equal(archived.old_status, 'active');
  assert.equal(archived.new_status, 'archived');
  assert.equal(archived.description, 'No longer free.');
  const [restored] = diff([provider('x', { status: 'archived' })], [provider('x')]);
  assert.equal(restored.type, 'status_change');
  assert.match(restored.title, /restored/);
});

test('model and rate limit changes are reported once per provider', () => {
  const before = provider('x');
  const after = provider('x', { tpm: null, models: [model('a', { rpm: 20 }), model('c')] });
  const entries = diff([before], [after]);
  assert.deepEqual(entries.map(e => e.type), ['model_added', 'model_removed', 'rate_limit_change']);
  assert.deepEqual(entries[0].model_ids, ['c']);
  assert.deepEqual(entries[1].model_ids, ['b']);
  assert.deepEqual(entries[2].model_ids, ['a']);
  assert.match(entries[2].description, /TPM 1000 → unpublished/);
  assert.match(entries[2].description, /A: RPM 10 → 20/);
  assert.deepEqual(validateChangelog(entries), []);
  assert.deepEqual(diff([before], [structuredClone(before)]), []);
});

test('archived providers do not produce model or rate limit noise', () => {
  const before = provider('x', { status: 'archived' });
  assert.deepEqual(diff([before], [{ ...before, rpm: 1, models: [model('z')] }]), []);
});

test('entries already in the curated changelog are skipped', () => {
  const after = provider('x', { models: [model('a'), model('b'), model('c')] });
  const curated = { provider_id: 'x', type: 'model_added', date: '2026-11-19' };
  assert.deepEqual(diff([provider('x')], [after], { existing: [curated] }), []);
  assert.equal(diff([provider('x')], [after], { existing: [{ ...curated, date: '2026-11-18' }] }).length, 1);
  assert.equal(diff([provider('x')], [after], { existing: [{ ...curated, model_ids: ['other'] }] }).length, 1);
  assert.ok(isDuplicateEntry({ ...curated, model_ids: ['b', 'a'] }, [{ ...curated, model_ids: ['a', 'b'] }]));
});

test('an all-zero base skips generation instead of announcing every provider', () => {
  const script = fileURLToPath(new URL('../scripts/gen-changelog.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--base', '0'.repeat(40), '--dry-run'], { encoding: 'utf8', env: { ...process.env, WORKER_URL: '', REFRESH_SECRET: '' } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /skipping/);
  assert.doesNotMatch(result.stdout, /provider_added/);
});
