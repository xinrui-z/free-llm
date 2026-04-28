#!/usr/bin/env node
/**
 * build-providers-bundle.mjs
 *
 * Aggregates `site/src/data/providers/*.json` into a single bundle file at
 * `checker-worker/src/providers.bundle.json`, sorted by `_order.json` order
 * (with unlisted providers appended alphabetically).
 *
 * The Worker imports this bundle as a fallback when its KV catalog is empty
 * (e.g. on first deploy). The bundle is gitignored — run this script before
 * `wrangler dev` / `wrangler deploy` (wired via `checker-worker/package.json`).
 *
 * Usage:
 *   node scripts/build-providers-bundle.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC_DIR = resolve(ROOT, 'site/src/data/providers');
const OUT_PATH = resolve(ROOT, 'checker-worker/src/providers.bundle.json');

const orderRaw = JSON.parse(readFileSync(resolve(SRC_DIR, '_order.json'), 'utf8'));
const order = Array.isArray(orderRaw.order) ? orderRaw.order : [];
const orderIndex = new Map(order.map((id, i) => [id, i]));

const files = readdirSync(SRC_DIR)
  .filter(f => f.endsWith('.json') && !f.startsWith('_'))
  .sort();

const providers = files.map(f => JSON.parse(readFileSync(resolve(SRC_DIR, f), 'utf8')));

providers.sort((a, b) => {
  const ai = orderIndex.has(a.id) ? orderIndex.get(a.id) : Number.MAX_SAFE_INTEGER;
  const bi = orderIndex.has(b.id) ? orderIndex.get(b.id) : Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return a.id.localeCompare(b.id);
});

writeFileSync(OUT_PATH, JSON.stringify(providers, null, 2) + '\n');
console.log(`[build-providers-bundle] Wrote ${providers.length} providers → ${OUT_PATH.replace(ROOT + '/', '')}`);
