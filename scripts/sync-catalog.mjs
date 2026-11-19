#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { adapters } from './catalog/adapters.mjs';
import { fetchCatalog } from './catalog/fetch.mjs';
export { fetchCatalog } from './catalog/fetch.mjs';
import { planSync, validateSources } from './catalog/sync.mjs';
import { validDate } from './lib/catalog-validation.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const encode = value => JSON.stringify(value, null, 2) + '\n';
const read = path => JSON.parse(readFileSync(path, 'utf8'));

function atomicWrite(path, text) {
  if (existsSync(path) && readFileSync(path, 'utf8') === text) return;
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, path);
}


// Saved state can be newer than an offline replay's observation time. A replay is a diff against
// the current catalog, so it ignores such state rather than failing or rewinding it.
function stateNewerThan(state, observedAt) {
  const at = Date.parse(observedAt), later = value => !Number.isFinite(Date.parse(value)) || Date.parse(value) > at;
  return later(state?.checked_at) || Object.values(state?.missing ?? {}).some(entry => later(entry?.last_counted_at));
}

export async function syncCatalog({ root = ROOT, providerId, from, write = false, observedAt = new Date().toISOString(), reportDir = resolve(root, '.catalog-reports'), fetchImpl } = {}) {
  const sources = validateSources(read(resolve(root, 'catalog/sources.json')));
  const selected = sources.filter(s => s.enabled && (!providerId || s.provider_id === providerId));
  if (!selected.length) throw new Error('No enabled source matches the requested provider');
  if (from && selected.length !== 1) throw new Error('--from requires exactly one selected provider');
  // A replayed file is not a live observation: it cannot confirm removals or advance saved state.
  if (from && write) throw new Error('Offline replay (--from) is preview-only; it never writes catalog or state');
  const reports = [], plans = [];
  mkdirSync(reportDir, { recursive: true });
  // Fetch and validate all selected sources before changing any catalog or state file.
  for (const source of selected) {
    try {
      const providerPath = resolve(root, `site/src/data/providers/${source.provider_id}.json`);
      const statePath = resolve(root, `catalog/state/${source.provider_id}.json`);
      const beforeProvider = readFileSync(providerPath, 'utf8');
      const beforeState = existsSync(statePath) ? readFileSync(statePath, 'utf8') : null;
      const raw = from ? read(resolve(from)) : await fetchCatalog(adapters[source.adapter].url(source), fetchImpl);
      atomicWrite(resolve(reportDir, `${source.provider_id}.raw.json`), encode(raw));
      let state = beforeState ? JSON.parse(beforeState) : undefined;
      const stateIgnored = !!(from && state && stateNewerThan(state, observedAt));
      if (stateIgnored) state = undefined;
      const plan = planSync({ provider: JSON.parse(beforeProvider), raw, source, state, observedAt });
      reports.push({ ...plan.report, status: 'ok', ...(from ? { replay: true, state_ignored: stateIgnored } : {}) });
      plans.push({ ...plan, providerPath, statePath, beforeProvider, beforeState });
    } catch (error) {
      reports.push({ provider_id: source.provider_id, status: 'blocked', error: error.message });
    }
  }
  const blocked = reports.some(r => r.status === 'blocked');
  const report = { version: 1, observed_at: observedAt, write_requested: write, applied: false, blocked, providers: reports };
  report.missing_upstream = reports.filter(r => r.missing_upstream?.length).map(r => ({ provider_id: r.provider_id, models: r.missing_upstream }));
  if (write && !blocked) {
    // Detect concurrent human edits rather than overwrite a changed baseline.
    const conflicts = plans.filter(plan => {
      const currentState = existsSync(plan.statePath) ? readFileSync(plan.statePath, 'utf8') : null;
      return readFileSync(plan.providerPath, 'utf8') !== plan.beforeProvider || currentState !== plan.beforeState;
    });
    if (conflicts.length) {
      report.conflict = `Catalog/state changed during sync (${conflicts.map(p => p.report.provider_id).join(', ')}); rerun against the new baseline`;
      atomicWrite(resolve(reportDir, 'report.json'), encode(report));
      throw new Error(report.conflict);
    }
    // Unchanged plans are skipped entirely so a quiet run leaves no diff to commit.
    report.written = [];
    for (const plan of plans) {
      if (plan.report.catalog_changed) { atomicWrite(plan.providerPath, encode(plan.provider)); report.written.push(relative(root, plan.providerPath)); }
      if (plan.report.state_changed) { atomicWrite(plan.statePath, encode(plan.state)); report.written.push(relative(root, plan.statePath)); }
    }
    report.applied = true;
  }
  atomicWrite(resolve(reportDir, 'report.json'), encode(report));
  return report;
}

export async function main(args = process.argv.slice(2), options = {}) {
  const { values } = parseArgs({ args, strict: true, options: {
    provider: { type: 'string' }, from: { type: 'string' }, date: { type: 'string' },
    write: { type: 'boolean', default: false }, 'report-dir': { type: 'string' },
    list: { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/sync-catalog.mjs [--provider ID] [--write] [--from FILE [--date YYYY-MM-DD]] [--report-dir DIR] [--list]\nDefaults to preview. --write saves validated catalog changes and observation state when they materially change.\n--from replays a saved response as a preview-only diff; --date (not in the future) sets its observation date.');
    return 0;
  }
  if (values.list) {
    const sources = validateSources(read(resolve(options.root ?? ROOT, 'catalog/sources.json')));
    for (const s of sources) console.log(`${s.provider_id}: ${s.adapter} (${s.enabled ? 'enabled' : 'disabled'})`);
    return 0;
  }
  if (values.date && !validDate(values.date)) throw new Error('Invalid --date');
  if (values.date && !values.from) throw new Error('--date is only valid with --from (offline replay)');
  if (values.date && values.date > new Date().toISOString().slice(0, 10)) throw new Error('Invalid --date: future observation dates are not allowed');
  const report = await syncCatalog({
    ...options, providerId: values.provider, from: values.from, write: values.write,
    ...(values.date ? { observedAt: `${values.date}T00:00:00.000Z` } : {}),
    ...(values['report-dir'] ? { reportDir: resolve(values['report-dir']) } : {}),
  });
  const annotate = (message, provider) => {
    // GitHub Actions turns these lines into run annotations; locally they are ordinary warnings.
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Catalog sync (${provider})::${message.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
    else console.warn(`WARNING ${provider}: ${message}`);
  };
  for (const p of report.providers) {
    if (p.status === 'blocked') console.error(`${p.provider_id}: BLOCKED — ${p.error}`);
    else if (p.mode === 'discovery') console.log(`${p.provider_id}: ${p.candidates.length} candidates need policy verification; ${p.missing.length} known models missing`);
    else console.log(`${p.provider_id}: free +${p.models.added.length}/-${p.models.removed.length}/~${p.models.updated.length}; paid +${p.paid_models.added.length}/-${p.paid_models.removed.length}/~${p.paid_models.updated.length}; ${p.pending_removals.length} pending removals`);
    if (p.missing_upstream?.length) annotate(`${p.missing_upstream.length} catalogued model(s) missing upstream (${p.mode === 'discovery' ? 'not removed automatically; review and remove manually if confirmed' : 'retained until removal is confirmed'}): ${p.missing_upstream.join(', ')}`, p.provider_id);
    if (p.quarantined?.length) annotate(`${p.quarantined.length} new upstream entr${p.quarantined.length === 1 ? 'y' : 'ies'} quarantined for review: ${p.quarantined.map(q => q.id).join(', ')}`, p.provider_id);
  }
  const missingTotal = report.missing_upstream.reduce((n, p) => n + p.models.length, 0);
  if (missingTotal) console.log(`Attention: ${missingTotal} catalogued model(s) missing upstream (see warnings above; exit status unaffected).`);
  console.log(report.blocked ? 'No catalog or observation state was written.'
    : report.applied ? (report.written.length ? `Saved: ${report.written.join(', ')}` : 'No material changes; nothing written.')
    : 'Preview only; pass --write to apply.');
  console.log(`Report: ${resolve(values['report-dir'] ?? options.reportDir ?? resolve(options.root ?? ROOT, '.catalog-reports'), 'report.json')}`);
  return report.blocked ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
