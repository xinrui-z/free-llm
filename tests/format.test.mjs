import test from 'node:test';
import assert from 'node:assert/strict';
import { contextToNumber, dateRange, daysSince, formatPrice, isAutoSyncedPricing, isStale, latestDate, liveCatalogSource, LIVE_CATALOG_SOURCE_LABEL, shellQuote, yamlString } from '../site/src/lib/format.ts';

test('context window labels and numbers sort numerically; unparseable values sort last', () => {
  for (const [label, tokens] of [['128K', 128_000], ['1M', 1_000_000], ['1.5m', 1_500_000], ['131,072', 131_072], [131072, 131072], [' 32k ', 32_000]]) {
    assert.equal(contextToNumber(label), tokens, String(label));
  }
  for (const label of [undefined, null, NaN, -1, Infinity, {}, 'unknown', '']) assert.equal(contextToNumber(label), -1, String(label));
});

test('prices keep their currency and never render invalid numbers', () => {
  assert.equal(formatPrice(0, 'USD'), '$0');
  assert.equal(formatPrice(0.005, 'USD'), '$0.0050');
  assert.equal(formatPrice(0.25, 'usd'), '$0.250');
  assert.equal(formatPrice(2, 'CNY'), '¥2');
  assert.equal(formatPrice(1.5, 'EUR'), '1.50 EUR');
  assert.equal(formatPrice(NaN, 'USD'), '—');
});

test('shell and YAML quoting keep catalog values literal', () => {
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  assert.equal(shellQuote('https://x.test/v1?a=1&b=$HOME'), `'https://x.test/v1?a=1&b=$HOME'`);
  assert.equal(yamlString('a: b # c "d"'), '"a: b # c \\"d\\""');
});

test('daysSince counts whole UTC days and rejects invalid dates', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(daysSince('2026-11-20', now), 0);
  assert.equal(daysSince('2026-11-16', now), 4);
  assert.equal(daysSince('2026-10-21', now), 30);
  assert.equal(daysSince('2026-10-20', now), 31);
  assert.equal(daysSince('2026-11-22', now), -2);
  assert.equal(daysSince(new Date('2026-11-19T12:00:00Z'), now.getTime()), 1);
  for (const bad of [undefined, null, '', 'not a date', NaN, {}]) assert.equal(daysSince(bad, now), null, String(bad));
  assert.equal(daysSince('2026-11-16', 'garbage'), null);
});

test('isStale flags prices older than the threshold or with unknown dates', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  assert.equal(isStale('2026-11-16', now), false);
  assert.equal(isStale('2026-10-21', now), false, 'exactly 30 days is not stale');
  assert.equal(isStale('2026-10-20', now), true);
  assert.equal(isStale('2026-11-10', now, 7), true);
  assert.equal(isStale('2026-11-14', now, 7), false);
  assert.equal(isStale('2026-12-01', now), false, 'future dates are not stale');
  assert.equal(isStale(undefined, now), true);
  assert.equal(isStale('nope', now), true);
});

test('latestDate picks the newest valid date', () => {
  assert.equal(latestDate(['2026-11-16', '2026-11-20', undefined, 'bad', '2026-11-17']), '2026-11-20');
  assert.equal(latestDate([]), null);
  assert.equal(latestDate([undefined, 'bad']), null);
});

test('dateRange reports the oldest and newest valid dates', () => {
  assert.deepEqual(dateRange(['2026-11-17', '2026-11-20', undefined, 'bad', '2026-11-16']), { oldest: '2026-11-16', newest: '2026-11-20' });
  assert.equal(dateRange([undefined, 'bad']), null);
});

test('pricing is auto-synced by provenance, not by how recent the price dates are', () => {
  const live = { label: LIVE_CATALOG_SOURCE_LABEL, url: 'https://openrouter.ai/api/v1/models', checked_at: '2026-11-22' };
  // A sync that only added free models moves catalog_checked_at 2+ days past unchanged prices.
  const openrouter = { catalog_checked_at: '2026-11-22', sources: [{ label: 'Limits', url: 'https://x.test', checked_at: '2026-11-16' }, live] };
  assert.equal(isAutoSyncedPricing(openrouter), true);
  assert.deepEqual(liveCatalogSource(openrouter), { url: live.url, checkedAt: '2026-11-22' });
  assert.equal(isAutoSyncedPricing({ catalog_checked_at: '2026-11-22' }), true, 'a recorded catalog check alone counts');
  assert.equal(isAutoSyncedPricing({ sources: [live] }), true, 'the live source alone counts');
  assert.equal(isAutoSyncedPricing({ sources: [{ label: 'Current paid token prices', url: 'https://x.test', checked_at: '2026-11-16' }] }), false);
  assert.equal(isAutoSyncedPricing({}), false);
  assert.equal(isAutoSyncedPricing({ catalog_checked_at: 'bad' }), false);
});

test('the live source label matches the one the catalog sync job writes', async () => {
  const { readFile } = await import('node:fs/promises');
  const sync = await readFile(new URL('../scripts/catalog/sync.mjs', import.meta.url), 'utf8');
  assert.ok(sync.includes(`label: '${LIVE_CATALOG_SOURCE_LABEL}'`));
});
