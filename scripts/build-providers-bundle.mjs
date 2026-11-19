#!/usr/bin/env node
/**
 * build-providers-bundle.mjs
 *
 * Aggregates `site/src/data/providers/*.json` into one bundle sorted by `_order.json` (unlisted
 * providers appended alphabetically). Fails without writing when the catalog has structural errors
 * (expired promotional prices only warn). The checker Worker uses the bundle as its seed catalog, and
 * the deployment workflow uploads it to the checker in static mode.
 *
 * Usage:
 *   node scripts/build-providers-bundle.mjs [--out FILE]   (default: dist/providers.bundle.json)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateRepository } from './validate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const OUT_PATH = values.out ? resolve(values.out) : resolve(ROOT, 'dist/providers.bundle.json');

// Never hand the Worker a structurally invalid catalog. Expired promotional prices only warn here
// so local dev, Worker builds and tests keep working; `npm run validate` still fails on them.
const { errors, warnings, providers } = validateRepository({ root: ROOT, expiredAsWarnings: true });
for (const warning of warnings) console.warn(`[build-providers-bundle] warning: ${warning}`);
if (errors.length) {
  console.error(`[build-providers-bundle] Catalog is invalid; bundle not written:\n${errors.join('\n')}`);
  process.exit(1);
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(providers, null, 2) + '\n');
console.log(`[build-providers-bundle] Wrote ${providers.length} providers → ${OUT_PATH.startsWith(ROOT + '/') ? OUT_PATH.slice(ROOT.length + 1) : OUT_PATH}`);
