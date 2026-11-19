import test from 'node:test';
import assert from 'node:assert/strict';
import { contextToNumber, formatPrice, shellQuote, yamlString } from '../site/src/lib/format.ts';

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
