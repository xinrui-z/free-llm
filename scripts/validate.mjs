#!/usr/bin/env node
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateProvider, validateChangelog, providerTimeChecks, sortProviders } from './lib/catalog-validation.mjs';
import { validateSources } from './catalog/sync.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isoTimestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const POLICY_LIMITS = ['daily_requests', 'monthly_requests', 'per_model_daily_requests', 'interval_minutes', 'max_per_run'];

/** Basic shape of a monitoring budget manifest (kept in the private checker repo); exact limits are enforced by the Worker. */
export function validateMonitoring(manifest, providerIds) {
  if (!object(manifest) || manifest.version !== 1 || !object(manifest.policies)) return ['monitoring.json: expected { version: 1, policies: {} }'];
  const errors = [];
  for (const [id, policy] of Object.entries(manifest.policies)) {
    if (!providerIds.has(id)) errors.push(`monitoring.json: unknown provider ${id}`);
    if (!object(policy) || typeof policy.enabled !== 'boolean' || POLICY_LIMITS.some(key => !Number.isInteger(policy[key]) || policy[key] < 1)) {
      errors.push(`monitoring.json: ${id} needs boolean enabled and positive integer ${POLICY_LIMITS.join(', ')}`);
    } else if (policy.per_model_daily_requests > policy.daily_requests) errors.push(`monitoring.json: ${id} per-model budget exceeds daily budget`);
  }
  return errors;
}

/** Basic shape of a catalog/state/<id>.json sync observation file (written by the sync job). */
export function validateStateFile(state, fileId, providerIds, now = Date.now()) {
  const label = `catalog/state/${fileId}.json`;
  if (!object(state)) return [`${label}: must be an object`];
  const errors = [];
  if (state.version !== 1) errors.push(`${label}: version must be 1`);
  if (state.provider_id !== fileId) errors.push(`${label}: provider_id must match the filename`);
  else if (!providerIds.has(fileId)) errors.push(`${label}: unknown provider ${fileId}`);
  if (!isoTimestamp(state.checked_at) || Date.parse(state.checked_at) > now + 300_000) errors.push(`${label}: checked_at must be a past ISO timestamp`);
  if (!object(state.missing)) errors.push(`${label}: missing must be an object`);
  if (!Array.isArray(state.candidates) || state.candidates.some(c => !object(c) || typeof c.id !== 'string')) errors.push(`${label}: candidates must be an array of { id }`);
  return errors;
}

/**
 * Validates the curated catalog in the repository. Errors block publication; warnings
 * (stale reviews, prices about to expire) are reported but do not fail the run.
 * Expired promotional prices are errors unless `expiredAsWarnings` is set, which tools that
 * must keep working past a deadline (bundle builds, sync and deploy gates) use.
 */
export function validateRepository({ root = ROOT, now = new Date(), expiredAsWarnings = false, monitoringFile = null } = {}) {
  const errors = [], warnings = [];
  const load = path => {
    try { return JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { errors.push(`${path.replace(root, '')}: ${e.message}`); return null; }
  };
  const directory = resolve(root, 'site/src/data/providers');
  const files = readdirSync(directory).filter(f => f.endsWith('.json') && !f.startsWith('_')).sort();
  const providers = [];
  for (const file of files) {
    const provider = load(resolve(directory, file));
    const fileErrors = validateProvider(provider, file.slice(0, -5), { now });
    const timed = fileErrors.length ? { errors: [], warnings: [] } : providerTimeChecks(provider, { now });
    errors.push(...[...fileErrors, ...(expiredAsWarnings ? [] : timed.errors)].map(error => `${file}: ${error}`));
    warnings.push(...[...(expiredAsWarnings ? timed.errors : []), ...timed.warnings].map(warning => `${file}: ${warning}`));
    if (provider) providers.push(provider);
  }
  const ids = new Set(files.map(f => f.slice(0, -5)));
  const order = load(resolve(directory, '_order.json'))?.order;
  if (!Array.isArray(order) || new Set(order).size !== order.length || order.length !== files.length || [...ids].some(id => !order.includes(id))) errors.push('_order.json must list every provider exactly once');
  const changelog = load(resolve(root, 'site/src/data/changelog.json'));
  errors.push(...validateChangelog(changelog, { providerIds: ids }).map(error => `changelog.json: ${error}`));
  try {
    for (const source of validateSources(load(resolve(root, 'catalog/sources.json')))) {
      if (!ids.has(source.provider_id)) errors.push(`Unknown source provider: ${source.provider_id}`);
    }
  } catch (e) { errors.push(`catalog/sources.json: ${e.message}`); }
  // Monitoring budgets are private. The private repo passes its manifest so its provider ids are checked too.
  if (monitoringFile) errors.push(...validateMonitoring(load(resolve(monitoringFile)), ids));
  const stateDir = resolve(root, 'catalog/state');
  if (existsSync(stateDir)) for (const file of readdirSync(stateDir).filter(f => f.endsWith('.json')).sort()) {
    errors.push(...validateStateFile(load(resolve(stateDir, file)), file.slice(0, -5), ids, new Date(now).getTime()));
  }
  return { errors, warnings, providers: sortProviders(providers, Array.isArray(order) ? order : []), changelog };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // --allow-expired (or CATALOG_ALLOW_EXPIRED=1, for `npm run check`): report expired promotional
  // prices without failing, used by the sync and deploy gates. PR validation keeps them as errors.
  const expiredAsWarnings = process.argv.includes('--allow-expired') || process.env.CATALOG_ALLOW_EXPIRED === '1';
  const { errors, warnings, providers, changelog } = validateRepository({ expiredAsWarnings });
  // In GitHub Actions, surface warnings as annotations so expiring prices are noticed.
  const prefix = process.env.GITHUB_ACTIONS === 'true' ? '::warning::' : 'warning: ';
  if (warnings.length) console.warn(warnings.map(w => `${prefix}${w}`).join('\n'));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Validated ${providers.length} providers and ${changelog.length} changelog entries${warnings.length ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})` : ''}`);
}
