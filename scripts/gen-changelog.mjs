#!/usr/bin/env node
/**
 * gen-changelog.mjs
 *
 * Compares two versions of the per-provider JSON files under
 * `site/src/data/providers/`, generates changelog entries for new/removed
 * providers and models, then POSTs them to the Worker KV.
 *
 * Usage:
 *   # Compare with previous git commit and push to Worker:
 *   node scripts/gen-changelog.mjs --worker-url <URL> --secret <SECRET>
 *
 *   # Compare against an explicit directory of provider JSON files:
 *   node scripts/gen-changelog.mjs --old /tmp/old-providers --worker-url <URL> --secret <SECRET>
 *
 *   # Dry run (print entries, don't write anywhere):
 *   node scripts/gen-changelog.mjs --dry-run
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROVIDERS_DIR_REL = 'site/src/data/providers';
const PROVIDERS_DIR_ABS = resolve(ROOT, PROVIDERS_DIR_REL);
// Path to the legacy single-file format. Used as a fallback when comparing
// against a git revision predating the directory split.
const LEGACY_FILE_REL = 'site/src/data/providers.json';

// ── Parse CLI args ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : null;
};
const dryRun    = args.includes('--dry-run');
const oldDir    = flag('--old');
const workerUrl = flag('--worker-url') ?? process.env.WORKER_URL ?? '';
const secret    = flag('--secret')     ?? process.env.REFRESH_SECRET ?? '';

// ── Load providers ────────────────────────────────────────────────────────
function loadProvidersFromDir(absDir) {
  const files = readdirSync(absDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'));
  return files.map(f => JSON.parse(readFileSync(resolve(absDir, f), 'utf8')));
}

function loadProvidersFromGitRev(rev) {
  // Prefer the new directory layout if it exists at this rev.
  let listing = '';
  try {
    listing = execSync(`git ls-tree -r --name-only ${rev} -- ${PROVIDERS_DIR_REL}`, {
      cwd: ROOT, encoding: 'utf8',
    });
  } catch {
    listing = '';
  }
  const dirFiles = listing
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.endsWith('.json') && !basename(s).startsWith('_'));

  if (dirFiles.length > 0) {
    return dirFiles.map(path => {
      const raw = execSync(`git show ${rev}:${path}`, { cwd: ROOT, encoding: 'utf8' });
      return JSON.parse(raw);
    });
  }

  // Fallback: rev predates the split — read the legacy single file.
  try {
    const raw = execSync(`git show ${rev}:${LEGACY_FILE_REL}`, { cwd: ROOT, encoding: 'utf8' });
    return JSON.parse(raw);
  } catch {
    console.warn(`[gen-changelog] No provider data found at ${rev}, treating all providers as new.`);
    return [];
  }
}

const oldProviders = oldDir
  ? loadProvidersFromDir(resolve(oldDir))
  : loadProvidersFromGitRev('HEAD~1');
const newProviders = loadProvidersFromDir(PROVIDERS_DIR_ABS);

// ── Diff logic ────────────────────────────────────────────────────────────
const oldMap = Object.fromEntries(oldProviders.map(p => [p.id, p]));
const newMap = Object.fromEntries(newProviders.map(p => [p.id, p]));

const now = new Date();
const today = now.toISOString().split('T')[0];
const timestamp = now.toISOString();
let counter = Date.now();
const uid = () => `cl-auto-${counter++}`;

const entries = [];

for (const p of newProviders) {
  if (!oldMap[p.id]) {
    entries.push({
      id: uid(), timestamp, date: today,
      provider_id: p.id, provider_name: p.name,
      type: 'provider_added',
      title: `Added ${p.name} provider`,
      description: p.description
        ? `Added ${p.name}. ${p.description}`
        : `Added ${p.name} to the free API list.`,
    });
  }
}

for (const p of oldProviders) {
  if (!newMap[p.id]) {
    entries.push({
      id: uid(), timestamp, date: today,
      provider_id: p.id, provider_name: p.name,
      type: 'provider_removed',
      title: `Removed ${p.name} provider`,
      description: `${p.name} has been removed from the free API list.`,
    });
  }
}

for (const newP of newProviders) {
  const oldP = oldMap[newP.id];
  if (!oldP) continue;

  const oldModels = Object.fromEntries((oldP.models ?? []).map(m => [m.id, m]));
  const newModels = Object.fromEntries((newP.models ?? []).map(m => [m.id, m]));

  const addedModels = (newP.models ?? []).filter(m => !oldModels[m.id]);
  const removedModels = (oldP.models ?? []).filter(m => !newModels[m.id]);

  if (addedModels.length === 1) {
    const m = addedModels[0];
    entries.push({
      id: uid(), timestamp, date: today,
      provider_id: newP.id, provider_name: newP.name,
      type: 'model_added',
      title: `${newP.name} added model ${m.name ?? m.id}`,
      description: [
        `${newP.name} added free model ${m.name ?? m.id}`,
        m.context_window ? ` (${m.context_window})` : '',
        m.rpm ? `, ${m.rpm} RPM` : '',
        m.rpd ? `, ${m.rpd} RPD` : '',
        '.',
      ].join(''),
    });
  } else if (addedModels.length > 1) {
    const modelList = addedModels.map(m => {
      const parts = [m.name ?? m.id];
      if (m.context_window) parts.push(`(${m.context_window})`);
      if (m.rpm) parts.push(`${m.rpm} RPM`);
      if (m.rpd) parts.push(`${m.rpd} RPD`);
      return parts.join(' ');
    }).join(', ');
    entries.push({
      id: uid(), timestamp, date: today,
      provider_id: newP.id, provider_name: newP.name,
      type: 'model_added',
      title: `${newP.name} added ${addedModels.length} free models`,
      description: `${newP.name} added ${addedModels.length} free models: ${modelList}.`,
    });
  }

  if (removedModels.length === 1) {
    const m = removedModels[0];
    entries.push({
      id: uid(), timestamp, date: today,
      provider_id: newP.id, provider_name: newP.name,
      type: 'model_removed',
      title: `${newP.name} removed model ${m.name ?? m.id}`,
      description: `${newP.name} removed free model ${m.name ?? m.id}.`,
    });
  } else if (removedModels.length > 1) {
    const modelList = removedModels.map(m => m.name ?? m.id).join(', ');
    entries.push({
      id: uid(), timestamp, date: today,
      provider_id: newP.id, provider_name: newP.name,
      type: 'model_removed',
      title: `${newP.name} removed ${removedModels.length} models`,
      description: `${newP.name} removed ${removedModels.length} free models: ${modelList}.`,
    });
  }
}

// ── Output ────────────────────────────────────────────────────────────────
if (entries.length === 0) {
  console.log('[gen-changelog] No changes detected.');
  process.exit(0);
}

console.log(`[gen-changelog] Detected ${entries.length} change(s):`);
for (const e of entries) {
  console.log(`  [${e.type}] ${e.title}`);
}

if (dryRun) {
  console.log('\n[gen-changelog] Dry run — nothing written.');
  console.log(JSON.stringify(entries, null, 2));
  process.exit(0);
}

if (!workerUrl) {
  console.error('[gen-changelog] --worker-url is required (or set WORKER_URL env var). Use --dry-run to preview.');
  process.exit(1);
}

// POST entries to Worker
const headers = { 'Content-Type': 'application/json' };
if (secret) headers['X-Refresh-Secret'] = secret;

const resp = await fetch(`${workerUrl}/api/changelog`, {
  method: 'POST',
  headers,
  body: JSON.stringify(entries),
});

if (!resp.ok) {
  const text = await resp.text();
  console.error(`[gen-changelog] Worker returned ${resp.status}: ${text}`);
  process.exit(1);
}

const result = await resp.json();
console.log(`[gen-changelog] Pushed ${result.appended} entries to Worker KV.`);
