#!/usr/bin/env node
// Fails if anything that belongs to the private checker repository is present in this public tree:
// the checker Worker, the review console, the management CLI, monitoring budgets, onboarding reviews,
// management routes or credential headers. Runs in `npm run check`, so PR CI blocks such leaks.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN_PATHS = ['checker-worker', 'admin', 'scripts/local', 'scripts/catalog-admin.mjs', 'scripts/dev-catalog.mjs', 'catalog/monitoring.json', 'catalog/reviews'];
const FORBIDDEN_TEXT = [/\/api\/admin\b/, /X-Admin-Secret/i, /ADMIN_SECRET/, /Cf-Access-Jwt-Assertion/i, /CF_ACCESS_CLIENT/, /local-token/];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'test-dist', 'dynamic-dist', 'dynamic-test-dist', '.astro', '.wrangler', 'test-results', 'dynamic-test-results', 'playwright-report', '.catalog-local', '.catalog-reports', '.claude', '.agents', 'design-system']);
const SELF = 'scripts/check-public-tree.mjs';

export function findLeaks(root = ROOT) {
  const leaks = [];
  for (const path of FORBIDDEN_PATHS) if (existsSync(resolve(root, path))) leaks.push(`${path}: private file or directory present`);
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name), rel = relative(root, full);
      if (SKIP_DIRS.has(name) || FORBIDDEN_PATHS.includes(rel)) continue;
      const stat = statSync(full, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) { walk(full); continue; }
      if (rel === SELF || stat.size > 2_000_000 || !/\.(m?[jt]s|astro|json|jsonc|md|ya?ml|html|css|toml|sh|txt|example)$|^\.[a-z]/.test(name)) continue;
      const text = readFileSync(full, 'utf8');
      for (const pattern of FORBIDDEN_TEXT) if (pattern.test(text)) leaks.push(`${rel}: contains ${pattern}`);
    }
  };
  walk(root);
  return leaks;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const leaks = findLeaks();
  if (leaks.length) { console.error(`Private material found in the public tree:\n${leaks.join('\n')}`); process.exitCode = 1; }
  else console.log('Public tree check passed: no private checker, review console or management material.');
}
