import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus, summarizeHistory, compareQuota, formatQuota } from '../site/src/lib/status.ts';
const now = Date.parse('2026-11-16T10:00:00Z');
const snapshot = { last_checked: new Date(now).toISOString(), providers: [{ id: 'groq', status: 'dead', latency_ms: 45, history_90d: ['active'] }] };
test('only recent observed provider statuses count toward health', () => {
  assert.equal(normalizeStatus(snapshot, ['groq', 'aihubmix'], now).unknown, 1);
  assert.equal(normalizeStatus(snapshot, ['groq'], now).dead, 1);
  assert.equal(normalizeStatus(snapshot, ['groq'], now + 3 * 3600_000).unknown, 1);
  assert.equal(normalizeStatus(null, ['groq'], now).active, 0);
  assert.equal(normalizeStatus({...snapshot, providers:[{id:'groq',status:'<img onerror=alert(1)>',latency_ms:-10}]}, ['groq'], now).providers[0].status, 'unknown');
  assert.equal(normalizeStatus({...snapshot, providers:[{...snapshot.providers[0],checked_at:'2026-01-01'}]},['groq'],now).unknown,1);
});
test('unobserved days do not count as outages', () => {
  assert.deepEqual(summarizeHistory([...Array(83).fill('unknown'), ...Array(7).fill('active')]), { observed: 7, healthy: 7, percent: 100 });
  assert.equal(summarizeHistory(Array(90).fill('unknown')).percent, null);
  assert.equal(summarizeHistory(['active', 'dead']).percent, 50);
});
test('unpublished quotas rank last and are never formatted as unlimited', () => {
  assert.deepEqual([null, 20, 1000].sort(compareQuota), [1000, 20, null]);
  assert.equal(formatQuota(null), 'Not published');
  assert.equal(formatQuota(0), '0/d');
});
test('per-provider fresh_ms widens the freshness window only within 15 min to 48 h', () => {
  const at = offset => ({ last_checked: new Date(now - offset).toISOString(), providers: [{ id: 'groq', status: 'active', latency_ms: 45, checked_at: new Date(now - offset).toISOString(), fresh_ms: 6 * 3600_000 }] });
  assert.equal(normalizeStatus(at(5 * 3600_000), ['groq'], now).active, 1);
  assert.equal(normalizeStatus(at(7 * 3600_000), ['groq'], now).unknown, 1);
  for (const fresh_ms of [60_000, 72 * 3600_000, '21600000', Number.NaN]) {
    const snapshot = at(3 * 3600_000); snapshot.providers[0].fresh_ms = fresh_ms;
    assert.equal(normalizeStatus(snapshot, ['groq'], now).unknown, 1, `invalid fresh_ms ${fresh_ms} falls back to 2h`);
  }
});
