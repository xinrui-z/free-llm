#!/usr/bin/env node
/**
 * gen-changelog.mjs
 *
 * Compares two versions of the per-provider JSON files under
 * `site/src/data/providers/`, generates changelog entries for provider
 * additions/removals/status changes, model additions/removals and rate-limit
 * changes, then POSTs them to the Worker KV. Entries already recorded in the
 * curated `site/src/data/changelog.json` (same provider, type, date and models)
 * are skipped.
 *
 * Usage:
 *   # Compare with a git revision and push to the Worker (secret from the environment):
 *   WORKER_URL=<URL> REFRESH_SECRET=<SECRET> node scripts/gen-changelog.mjs --base <SHA>
 *
 *   # Compare against an explicit directory of provider JSON files:
 *   node scripts/gen-changelog.mjs --old /tmp/old-providers --dry-run
 *
 *   # Dry run (print entries, don't write anywhere):
 *   node scripts/gen-changelog.mjs --dry-run
 *
 * An all-zero base (the first push of a branch) or a base without provider
 * data is skipped instead of reporting every provider as new.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateChangelog } from './lib/catalog-validation.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PROVIDERS_DIR_REL = 'site/src/data/providers';
const PROVIDERS_DIR_ABS = resolve(ROOT, PROVIDERS_DIR_REL);
const CHANGELOG_ABS = resolve(ROOT, 'site/src/data/changelog.json');
// Path to the legacy single-file format. Used as a fallback when comparing
// against a git revision predating the directory split.
const LEGACY_FILE_REL = 'site/src/data/providers.json';

// ── Diff logic (pure) ─────────────────────────────────────────────────────
const limitText = value => value == null ? 'unpublished' : String(value);
const modelSummary = m => [m.name ?? m.id, m.context_window ? `(${m.context_window})` : '', m.rpm ? `${m.rpm} RPM` : '', m.rpd ? `${m.rpd} RPD` : ''].filter(Boolean).join(' ');
const modelsKey = ids => Array.isArray(ids) ? [...ids].sort().join('\n') : null;

/** Same change already recorded: same provider, type and date, and the same models when both sides name them. */
export function isDuplicateEntry(entry, existing) {
  return existing.some(e => e?.provider_id === entry.provider_id && e.type === entry.type && e.date === entry.date &&
    (modelsKey(e.model_ids) === null || modelsKey(entry.model_ids) === null || modelsKey(e.model_ids) === modelsKey(entry.model_ids)));
}

function rateLimitChanges(oldP, newP) {
  const changes = [];
  for (const key of ['rpm', 'rpd']) {
    if ((oldP[key] ?? null) !== (newP[key] ?? null)) changes.push(`${key.toUpperCase()} ${limitText(oldP[key])} → ${limitText(newP[key])}`);
  }
  const oldModels = new Map((oldP.models ?? []).map(m => [m.id, m]));
  const modelIds = [];
  for (const m of newP.models ?? []) {
    const before = oldModels.get(m.id);
    if (!before) continue;
    const parts = ['rpm', 'rpd'].filter(key => (before[key] ?? null) !== (m[key] ?? null))
      .map(key => `${key.toUpperCase()} ${limitText(before[key])} → ${limitText(m[key])}`);
    if (parts.length) { modelIds.push(m.id); changes.push(`${m.name ?? m.id}: ${parts.join(', ')}`); }
  }
  return { changes, modelIds };
}

/**
 * Returns changelog entries describing how `newProviders` differs from `oldProviders`.
 * `existing` entries (e.g. the curated changelog) suppress duplicates.
 */
export function diffProviders(oldProviders, newProviders, { now = new Date(), revision = 'local', existing = [] } = {}) {
  const at = new Date(now);
  const timestamp = at.toISOString(), date = timestamp.slice(0, 10);
  const oldMap = new Map(oldProviders.map(p => [p.id, p]));
  const newMap = new Map(newProviders.map(p => [p.id, p]));
  let counter = 0;
  const entries = [];
  const push = (p, fields) => entries.push({ id: `cl-auto-${revision}-${counter++}`, timestamp, date, provider_id: p.id, provider_name: p.name, ...fields });

  for (const p of newProviders) {
    if (oldMap.has(p.id)) continue;
    if (p.status === 'archived') {
      push(p, { type: 'provider_added', title: `Listed ${p.name} as archived`,
        description: `${p.name} was added to the directory as archived and is not on the free API list.${p.archive_reason ? ` ${p.archive_reason}` : ''}` });
    } else {
      push(p, { type: 'provider_added', title: `Added ${p.name} provider`,
        description: p.description ? `Added ${p.name}. ${p.description}` : `Added ${p.name} to the free API list.` });
    }
  }

  for (const p of oldProviders) {
    if (!newMap.has(p.id)) push(p, { type: 'provider_removed', title: `Removed ${p.name} provider`, description: `${p.name} has been removed from the free API list.` });
  }

  for (const newP of newProviders) {
    const oldP = oldMap.get(newP.id);
    if (!oldP) continue;
    if (oldP.status !== newP.status) {
      const archived = newP.status === 'archived';
      push(newP, { type: 'status_change', old_status: oldP.status, new_status: newP.status,
        title: `${newP.name} ${archived ? 'archived from' : 'restored to'} the free API directory`,
        description: (archived ? newP.archive_reason : null) ?? `Catalog status changed from ${oldP.status} to ${newP.status}.` });
    }
    if (newP.status === 'archived') continue;

    const oldIds = new Set((oldP.models ?? []).map(m => m.id));
    const newIds = new Set((newP.models ?? []).map(m => m.id));
    const added = (newP.models ?? []).filter(m => !oldIds.has(m.id));
    const removed = (oldP.models ?? []).filter(m => !newIds.has(m.id));

    if (added.length === 1) {
      const [m] = added;
      push(newP, { type: 'model_added', model_ids: [m.id], title: `${newP.name} added model ${m.name ?? m.id}`,
        description: `${newP.name} added free model ${m.name ?? m.id}${m.context_window ? ` (${m.context_window})` : ''}${m.rpm ? `, ${m.rpm} RPM` : ''}${m.rpd ? `, ${m.rpd} RPD` : ''}.` });
    } else if (added.length > 1) {
      push(newP, { type: 'model_added', model_ids: added.map(m => m.id), title: `${newP.name} added ${added.length} free models`,
        description: `${newP.name} added ${added.length} free models: ${added.map(modelSummary).join(', ')}.` });
    }

    if (removed.length === 1) {
      const [m] = removed;
      push(newP, { type: 'model_removed', model_ids: [m.id], title: `${newP.name} removed model ${m.name ?? m.id}`,
        description: `${newP.name} removed free model ${m.name ?? m.id}.` });
    } else if (removed.length > 1) {
      push(newP, { type: 'model_removed', model_ids: removed.map(m => m.id), title: `${newP.name} removed ${removed.length} models`,
        description: `${newP.name} removed ${removed.length} free models: ${removed.map(m => m.name ?? m.id).join(', ')}.` });
    }

    const limits = rateLimitChanges(oldP, newP);
    if (limits.changes.length) {
      push(newP, { type: 'rate_limit_change', ...(limits.modelIds.length ? { model_ids: limits.modelIds } : {}),
        title: `${newP.name} rate limits changed`, description: `${limits.changes.join('; ')}.` });
    }
  }

  return entries.filter(entry => !isDuplicateEntry(entry, existing));
}

// ── Load providers ────────────────────────────────────────────────────────
function loadProvidersFromDir(absDir) {
  return readdirSync(absDir)
    .filter(f => f.endsWith('.json') && !f.startsWith('_'))
    .map(f => JSON.parse(readFileSync(resolve(absDir, f), 'utf8')));
}

/** Provider list at a git revision, or null when the revision has no provider data. */
function loadProvidersFromGitRev(rev) {
  let listing = '';
  try {
    listing = execFileSync('git', ['ls-tree', '-r', '--name-only', rev, '--', PROVIDERS_DIR_REL], { cwd: ROOT, encoding: 'utf8' });
  } catch {
    listing = '';
  }
  const dirFiles = listing.split('\n').map(s => s.trim()).filter(s => s.endsWith('.json') && !basename(s).startsWith('_'));
  if (dirFiles.length > 0) {
    return dirFiles.map(path => JSON.parse(execFileSync('git', ['show', `${rev}:${path}`], { cwd: ROOT, encoding: 'utf8' })));
  }
  // Fallback: rev predates the split — read the legacy single file.
  try {
    return JSON.parse(execFileSync('git', ['show', `${rev}:${LEGACY_FILE_REL}`], { cwd: ROOT, encoding: 'utf8' }));
  } catch {
    return null;
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────
async function main(args) {
  const flag = name => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
  const dryRun = args.includes('--dry-run');
  const oldDir = flag('--old');
  const baseRev = flag('--base') ?? 'HEAD~1';
  const workerUrl = flag('--worker-url') ?? process.env.WORKER_URL ?? '';
  // The secret is read from the environment only, so it never appears in process listings.
  const secret = process.env.REFRESH_SECRET ?? '';

  let oldProviders;
  if (oldDir) oldProviders = loadProvidersFromDir(resolve(oldDir));
  else if (/^0+$/.test(baseRev)) {
    console.log('[gen-changelog] Base revision is all zeros (new branch); nothing to compare, skipping.');
    return 0;
  } else {
    oldProviders = loadProvidersFromGitRev(baseRev);
    if (!oldProviders) {
      console.warn(`[gen-changelog] No provider data found at ${baseRev}; skipping instead of reporting every provider as new.`);
      return 0;
    }
  }
  const newProviders = loadProvidersFromDir(PROVIDERS_DIR_ABS);
  let existing = [];
  try { existing = JSON.parse(readFileSync(CHANGELOG_ABS, 'utf8')); } catch { existing = []; }
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const entries = diffProviders(oldProviders, newProviders, { revision, existing: Array.isArray(existing) ? existing : [] });

  if (entries.length === 0) {
    console.log('[gen-changelog] No changes detected.');
    return 0;
  }
  const errors = validateChangelog(entries);
  if (errors.length) {
    console.error(`[gen-changelog] Generated invalid entries:\n${errors.join('\n')}`);
    return 1;
  }

  console.log(`[gen-changelog] Detected ${entries.length} change(s):`);
  for (const e of entries) console.log(`  [${e.type}] ${e.title}`);

  if (dryRun) {
    console.log('\n[gen-changelog] Dry run — nothing written.');
    console.log(JSON.stringify(entries, null, 2));
    return 0;
  }
  if (!workerUrl || !secret) {
    console.error('[gen-changelog] WORKER_URL and REFRESH_SECRET environment variables are required. Use --dry-run to preview.');
    return 1;
  }

  const resp = await fetch(`${workerUrl}/api/changelog`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Refresh-Secret': secret },
    body: JSON.stringify(entries),
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    console.error(`[gen-changelog] Worker returned ${resp.status}: ${await resp.text()}`);
    return 1;
  }
  const result = await resp.json();
  console.log(`[gen-changelog] Pushed ${result.appended} entries to Worker KV.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
