import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus, summarizeHistory, compareQuota, formatQuota, probeDetail, providerProbeError } from '../site/src/lib/status.ts';
const now = Date.parse('2026-11-16T10:00:00Z');
const snapshot = { last_checked: new Date(now).toISOString(), providers: [{ id: 'groq', status: 'dead', latency_ms: 45, history_90d: ['active'] }] };
test('probe details never turn quota, auth or model errors into outages', () => {
  assert.equal(probeDetail({ status: 'unknown', error: 'HTTP 429 Too Many Requests' }), 'rate_limited');
  assert.equal(probeDetail({ status: 'dead', error: 'rate_limit_exceeded' }), 'rate_limited');
  assert.equal(probeDetail({ status: 'unknown', error: 'HTTP 401' }), 'auth_failed');
  assert.equal(probeDetail({ status: 'unknown', error: 'HTTP 403 Forbidden' }), 'auth_failed');
  assert.equal(probeDetail({ status: 'unknown', error: 'HTTP 404: model not found' }), 'model_unavailable');
  assert.equal(probeDetail({ status: 'dead', error: 'HTTP 503' }), 'service_unavailable');
  assert.equal(probeDetail({ status: 'dead', error: 'timeout' }), 'service_unavailable');
  assert.equal(probeDetail({ status: 'active' }), 'operational');
  assert.equal(probeDetail({ status: 'degraded' }), 'degraded');
  assert.equal(probeDetail({ status: 'unknown' }), 'unknown');
  assert.equal(probeDetail({ status: 'unknown', error: 'not_monitored' }), 'not_monitored');
  assert.equal(probeDetail(undefined), 'not_monitored');
  // The checker's own short codes (live payload, 2026-11-26).
  assert.equal(probeDetail({ status: 'unknown', error: 'quota' }), 'rate_limited');
  assert.equal(probeDetail({ status: 'unknown', error: 'auth' }), 'auth_failed');
  assert.equal(probeDetail({ status: 'unknown', error: 'invalid_response' }), 'unknown');
  assert.equal(probeDetail({ status: 'unknown', error: 'stale' }), 'unknown');
});
test('an unknown provider is explained by its newest fresh model error, never by housekeeping codes', () => {
  const at = offset => new Date(now - offset).toISOString();
  const raw = { last_checked: at(0), providers: [{ id: 'sambanova', status: 'unknown', latency_ms: null, checked_at: at(60_000) }, { id: 'groq', status: 'active', latency_ms: 200, checked_at: at(0) }],
    models: [
      { provider_id: 'sambanova', model_id: 'a', status: 'unknown', error: 'stale', checked_at: at(30 * 60_000) },
      { provider_id: 'sambanova', model_id: 'b', status: 'unknown', error: 'quota', checked_at: at(60_000) },
      { provider_id: 'sambanova', model_id: 'c', status: 'unknown', error: 'auth', checked_at: at(5 * 3600_000) },
      { provider_id: 'groq', model_id: 'x', status: 'unknown', error: 'quota', checked_at: at(0) },
    ] };
  const s = normalizeStatus(raw, ['sambanova', 'groq'], now);
  const samba = s.providers.find(p => p.id === 'sambanova');
  assert.equal(providerProbeError(samba, s.models), 'quota', 'old (5 h) auth error is outside the window');
  assert.equal(probeDetail({ ...samba, error: providerProbeError(samba, s.models) }), 'rate_limited');
  // A provider with a healthy status is not relabelled by one model's error.
  assert.equal(providerProbeError(s.providers.find(p => p.id === 'groq'), s.models), undefined);
});
test('providers missing from a fresh snapshot are not monitored; stale errors are dropped', () => {
  const s = normalizeStatus(snapshot, ['groq', 'aihubmix'], now);
  assert.equal(s.providers.find(p => p.id === 'aihubmix').monitored, false);
  assert.equal(s.providers.find(p => p.id === 'groq').monitored, true);
  // Re-normalising a normalised snapshot (failed poll) keeps "not monitored".
  assert.equal(normalizeStatus(s, ['groq', 'aihubmix'], now).providers.find(p => p.id === 'aihubmix').monitored, false);
  // A "dead" provider whose error is a quota/auth problem is never counted as down.
  const quota = normalizeStatus({ ...snapshot, providers: [{ id: 'groq', status: 'dead', error: 'HTTP 429', latency_ms: null }] }, ['groq'], now);
  assert.equal(quota.dead, 0);
  assert.equal(quota.providers[0].status, 'unknown');
  assert.equal(probeDetail(quota.providers[0]), 'rate_limited');
  assert.equal(normalizeStatus({ ...snapshot, providers: [{ id: 'groq', status: 'dead', error: 'HTTP 503' }] }, ['groq'], now).dead, 1);
  const stale = normalizeStatus({ ...snapshot, providers: [{ id: 'groq', status: 'unknown', error: 'HTTP 429', checked_at: '2026-01-01T00:00:00Z' }] }, ['groq'], now);
  assert.equal(stale.providers[0].error, undefined);
  assert.equal(probeDetail(stale.providers[0]), 'unknown');
});
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
  assert.equal(formatQuota(null), 'Not disclosed');
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
