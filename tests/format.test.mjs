import test from 'node:test';
import assert from 'node:assert/strict';
import { contextToNumber, dateRange, daysSince, formatCount, formatLatency, formatPrice, formatRate, formatTokens, isAutoSyncedPricing, isStale, latestDate, providerLastmod, clampText, providerMetaDescription, liveCatalogSource, LIVE_CATALOG_SOURCE_LABEL, modelDisplayName, nameFromId, shellQuote, yamlString } from '../site/src/lib/format.ts';

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

test('display numbers round before picking a unit and never abbreviate counts', () => {
  // Context windows: round first so 999,500 reads "1M", never "1000K".
  assert.equal(formatTokens(999_500).text, '1M');
  assert.equal(formatTokens(999_999).text, '1M');
  assert.equal(formatTokens(999_499).text, '999K');
  assert.equal(formatTokens(131_072).text, '128K');
  assert.equal(formatTokens(1_048_576).text, '1M');
  assert.equal(formatTokens(1_024_000).text, '1.02M');
  assert.equal(formatTokens(131_072).title, '131,072 tokens');
  assert.equal(formatTokens('128k').text, '128K');
  for (const bad of [null, undefined, '', 'n/a', 0, -5]) assert.equal(formatTokens(bad), null, String(bad));
  // Latency: 999.6 ms rounds to a full second and reads "1.0 s", not "1000 ms".
  assert.equal(formatLatency(999.6), '1.0 s');
  assert.equal(formatLatency(999.4), '999 ms');
  assert.equal(formatLatency(1234), '1.2 s');
  assert.equal(formatLatency(-1), null);
  // Request counts stay exact: 1,000 not 1K.
  assert.equal(formatCount(1000), '1,000');
  assert.equal(formatCount(14_400), '14,400');
  assert.equal(formatCount(null), null);
});

test('per-million rates keep the digits that distinguish them', () => {
  for (const [n, text] of [[0.0375, '$0.0375'], [0.075, '$0.075'], [0.8, '$0.800'], [0.0005, '$0.0005'], [0, '$0.000'], [2.5, '$2.50'], [15, '$15.00']]) {
    assert.equal(formatRate(n), text, String(n));
  }
  for (const bad of [null, undefined, -1, NaN]) assert.equal(formatRate(bad), null, String(bad));
});

test('model names fall back to a readable form of the ID when the catalog name is just the ID', () => {
  for (const [id, name] of [
    ['coding-glm-5.4-free', 'Coding GLM 5.4 Free'],
    ['coding-minimax-m2.7-free', 'Coding MiniMax M2.7 Free'],
    ['k2.6-code-preview-free', 'K2.6 Code Preview Free'],
    ['kimi-for-coding-free', 'Kimi for Coding Free'],
    ['lfm-2.5-2.6b-free', 'LFM 2.5 2.6B Free'],
    ['gemma-4-26b-a4b-it-free', 'Gemma 4 26B A4B IT Free'],
    ['DeepSeek-V3.1', 'DeepSeek V3.1'],
    ['acme/foo-1:free', 'Foo 1 Free'],
  ]) assert.equal(nameFromId(id), name, id);
  assert.equal(modelDisplayName({ id: 'agents-a1-free', name: 'agents-a1-free' }), 'Agents A1 Free');
  assert.equal(modelDisplayName({ id: 'intern-s2-free' }), 'Intern S2 Free');
  assert.equal(modelDisplayName({ id: 'coding-glm-5.1-free', name: 'Coding GLM 5.1 Free' }), 'Coding GLM 5.1 Free');
});

test('price-page providers on the site match the daily Price sync parsers', async () => {
  const { pricePages } = await import('../scripts/catalog/price-pages.mjs');
  const { PRICE_PAGE_PROVIDERS, isPricePageSynced } = await import('../site/src/lib/format.ts');
  assert.deepEqual([...PRICE_PAGE_PROVIDERS].sort(), Object.keys(pricePages).sort());
  assert.equal(isPricePageSynced({ id: 'groq' }), true);
  assert.equal(isPricePageSynced({ id: 'openrouter' }), false);
  assert.equal(isPricePageSynced({}), false);
});

test('providerLastmod picks the newest content date and ignores missing or invalid ones', () => {
  assert.equal(providerLastmod({
    last_verified: '2026-11-16',
    catalog_checked_at: '2026-11-17',
    sources: [{ checked_at: '2026-11-10' }, {}],
    models: [{ pricing: { checked_at: '2026-11-20' } }, { pricing: null }, {}],
  }), '2026-11-20');
  assert.equal(providerLastmod({ last_verified: '2026-04-28', catalog_checked_at: 'not a date' }), '2026-04-28');
  assert.equal(providerLastmod({}), null);
});

test('clampText cuts at a word boundary with an ellipsis and leaves short text alone', () => {
  assert.equal(clampText('short text'), 'short text');
  const out = clampText('word '.repeat(60), 50);
  assert.ok(out.length <= 50 && out.endsWith('…') && !out.includes('wor…'), out);
});

test('providerMetaDescription leads with published limits, names the provider and stays short', () => {
  assert.equal(
    providerMetaDescription({ name: 'Groq', status: 'active', rpm: 30, tpm: 8000, description: 'Groq-hosted GPT-OSS and Qwen models with a recurring free developer tier.' }),
    'Groq free tier: 30 RPM, 8,000 TPM. Groq-hosted GPT-OSS and Qwen models with a recurring free developer tier.',
  );
  // No published limits and a blurb without the name: lead with "<Name> free API".
  assert.match(providerMetaDescription({ name: 'OpenRouter', status: 'active', description: 'Aggregates multiple LLM providers.' }), /^OpenRouter free API: Aggregates/);
  // No blurb: built from facts instead of a one-size template.
  assert.equal(providerMetaDescription({ name: 'Kilo', status: 'active' }, { modelCount: 4 }), 'Kilo free API: 4 free models, base URL and an OpenAI-compatible quick start.');
  // Archived: a short notice with the alternatives count; archive_reason stays in the page body.
  assert.equal(
    providerMetaDescription({ name: 'Cerebras', status: 'archived', description: 'x'.repeat(300) }, { alternatives: 3 }),
    'Cerebras no longer offers a recurring free API tier. Compare 3 active free LLM API alternatives.',
  );
  assert.ok(providerMetaDescription({ name: 'X', status: 'active', description: 'free X '.repeat(80) }).length <= 158);
});
