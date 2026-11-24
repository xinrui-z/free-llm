#!/usr/bin/env node
// Price drift report: compares catalogued per-token prices with the official pricing pages of providers
// that have no price API (see scripts/catalog/price-pages.mjs). It never writes catalog or state files;
// it writes a JSON and Markdown report so a maintainer (or the scheduled workflow's issue) can act on it.
//
//   node scripts/check-prices.mjs                         # compare against site/src/data/providers/*.json
//   node scripts/check-prices.mjs --catalog-url URL       # compare against a live /api/catalog
//   node scripts/check-prices.mjs --provider groq --from page.md --date 2026-11-24   # offline replay
//
// Exit status: 0 = every tracked price matches and no new model awaits review; 1 = drift, a blocked source or
// unreviewed candidates; 2 = the check could not run (usage error, invalid ignore list, unreadable catalog).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { pricePages, comparePrices } from './catalog/price-pages.mjs';
import { fetchCatalog, fetchText } from './catalog/fetch.mjs';
import { validDate } from './lib/catalog-validation.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

async function loadProviders({ root, ids, catalogUrl, fetchImpl }) {
  if (!catalogUrl) {
    return { source: 'repository', providers: ids.map(id => JSON.parse(readFileSync(resolve(root, `site/src/data/providers/${id}.json`), 'utf8'))) };
  }
  const url = new URL('/api/catalog', catalogUrl);
  if (url.protocol !== 'https:') throw new Error('--catalog-url must be an https URL');
  const catalog = await fetchCatalog(url.href, fetchImpl);
  if (!Array.isArray(catalog?.providers) || !catalog.providers.length) throw new Error('Catalog API returned no providers');
  return { source: 'live', revision: catalog.revision ?? null, providers: catalog.providers };
}

// Reviewed exclusions: { providers: { <provider id>: { <model id>: "reason" } } }. Missing file = no exclusions.
export function loadIgnored(root) {
  let raw;
  try { raw = readFileSync(resolve(root, 'catalog/price-candidates-ignore.json'), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !data.providers || typeof data.providers !== 'object' || Array.isArray(data.providers)) throw new Error('Invalid catalog/price-candidates-ignore.json');
  for (const [id, models] of Object.entries(data.providers)) {
    if (!Object.hasOwn(pricePages, id)) throw new Error(`price-candidates-ignore.json: no pricing page parser for ${id}`);
    if (!models || typeof models !== 'object' || Array.isArray(models) || Object.values(models).some(r => typeof r !== 'string' || !r.trim())) {
      throw new Error(`price-candidates-ignore.json: ${id} must map model IDs to a nonempty reason`);
    }
  }
  return data.providers;
}

// A paste-ready catalog entry. Name, modalities, context window and limits are not on pricing pages,
// so the maintainer fills them in; status starts as active.
export function candidateEntry(candidate, page, date) {
  return {
    id: candidate.id, name: candidate.id, modalities: ['text'], rpm: null, tpm: null, status: 'active',
    pricing: { input_per_million: candidate.input_per_million, output_per_million: candidate.output_per_million, currency: 'USD',
      source_url: page.page_url, checked_at: date, ...(candidate.valid_until ? { valid_until: candidate.valid_until } : {}) },
  };
}

export async function checkPrices({ root = ROOT, providerId, from, date = new Date().toISOString().slice(0, 10), catalogUrl, fetchImpl } = {}) {
  const ids = providerId ? [providerId] : Object.keys(pricePages);
  if (ids.some(id => !Object.hasOwn(pricePages, id))) throw new Error(`No pricing page parser for ${providerId}; known: ${Object.keys(pricePages).join(', ')}`);
  if (from && ids.length !== 1) throw new Error('--from requires --provider');
  const ignoredBy = loadIgnored(root);
  const { source, revision, providers } = await loadProviders({ root, ids, catalogUrl, fetchImpl });
  // Providers are checked concurrently, so the run takes as long as the slowest page rather than their sum.
  const results = await Promise.all(ids.map(async id => {
    const page = pricePages[id];
    const provider = providers.find(p => p?.id === id);
    if (!provider) return { provider_id: id, status: 'blocked', error: 'Provider is not in the catalog', page_url: page.page_url };
    try {
      const text = from ? readFileSync(resolve(from), 'utf8') : (await Promise.all(page.urls.map(url =>
        fetchText(url, fetchImpl, undefined, { accept: page.contentTypes.join(', '), contentTypes: page.contentTypes, label: `Pricing page ${url}` })))).join('\n');
      const parsed = page.parse(text, { date });
      const { candidates: all, ...diff } = comparePrices(provider, parsed, page);
      const ignore = ignoredBy[id] ?? {};
      const candidates = all.filter(c => !Object.hasOwn(ignore, c.id)).map(c => ({ ...c, entry: candidateEntry(c, page, date) }));
      const drift = diff.changed.length || diff.unpriced.length || diff.missing.length || diff.source_url.length;
      return { provider_id: id, provider_status: provider.status, status: drift ? 'drift' : 'ok', page_url: page.page_url, fetched_urls: from ? [] : page.urls,
        page_sha256: createHash('sha256').update(text).digest('hex'), page_models: parsed.rows.size, ...diff,
        candidates, ignored: all.filter(c => Object.hasOwn(ignore, c.id)).map(c => c.id) };
    } catch (error) {
      return { provider_id: id, status: 'blocked', error: error.message, page_url: page.page_url };
    }
  }));
  const candidates = results.reduce((n, r) => n + (r.candidates?.length ?? 0), 0);
  return { version: 1, checked_on: date, catalog: source, ...(revision ? { catalog_revision: revision } : {}), replay: !!from,
    attention: results.some(r => r.status !== 'ok'), candidates, providers: results };
}

const fmt = n => n == null ? '—' : `$${n}`;

export function renderMarkdown(report) {
  // The catalog URL comes from a repository secret in CI, so reports (posted to a public issue) never contain it.
  const out = [`Checked on ${report.checked_on} against ${report.catalog === 'live' ? 'the live catalog API' : 'the repository JSON'}${report.catalog_revision ? ` (revision \`${report.catalog_revision}\`)` : ''}.`, ''];
  out.push('| Provider | Result | Tracked | Matching | Changed | Not parsed | Missing | New models |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of report.providers) {
    const label = { ok: '✅ matches', drift: '⚠️ drift', blocked: '⛔ blocked' }[r.status];
    out.push(r.status === 'blocked'
      ? `| [${r.provider_id}](${r.page_url}) | ${label} | | | | | | |`
      : `| [${r.provider_id}](${r.page_url})${r.provider_status === 'archived' ? ' (archived)' : ''} | ${label} | ${r.tracked} | ${r.matched} | ${r.changed.length} | ${r.unpriced.length} | ${r.missing.length} | ${r.candidates.length} |`);
  }
  for (const r of report.providers) {
    if (r.status === 'ok') continue;
    out.push('', `### ${r.provider_id}`, '');
    if (r.status === 'blocked') { out.push(`The pricing page could not be read or parsed: ${r.error}. The parser fails closed when the page layout changes; update \`scripts/catalog/price-pages.mjs\`.`); continue; }
    for (const c of r.changed) {
      const parts = Object.entries(c.fields).map(([k, v]) => k === 'valid_until' ? `valid_until ${v.catalog ?? 'none'} → ${v.page ?? 'none'}` : `${k.replace('_per_million', '')} ${fmt(v.catalog)} → ${fmt(v.page)}`);
      out.push(`- **${c.id}**: ${parts.join(', ')}`);
    }
    for (const u of r.unpriced) out.push(`- **${u.id}**: price not recognised on the page (${u.reason}); review manually.`);
    for (const id of r.missing) out.push(`- **${id}**: not listed on the pricing page.`);
    if (r.source_url.length) out.push(`- ${r.source_url.length} model(s) cite \`${r.source_url[0].catalog}\`; the pricing page is now \`${r.source_url[0].expected}\`.`);
  }
  if (report.candidates) {
    out.push('', '## New model candidates', '',
      'Priced on an official pricing page but not in the catalog. Nothing is added automatically: review each one, then either add it (complete `name`, `modalities` and `context_window`, and confirm free-tier access and limits for `models`, or add it to `paid_models` if it is paid-only), or list it with a reason in `catalog/price-candidates-ignore.json` so it is not proposed again.', '');
    for (const r of report.providers) {
      if (!r.candidates?.length) continue;
      out.push(`<details><summary><strong>${r.provider_id}</strong>: ${r.candidates.length} candidate(s) — ${r.candidates.map(c => `${c.id} (${fmt(c.input_per_million)} / ${fmt(c.output_per_million)}${c.valid_until ? ` until ${c.valid_until}` : ''})`).join(', ')}</summary>`, '',
        `Source: ${r.page_url}`, '', '```json', r.candidates.map(c => JSON.stringify(c.entry, null, 2)).join(',\n'), '```', '', '</details>', '');
    }
  }
  out.push('', 'Prices are compared as standard paid-tier text input/output rates per 1M tokens; cached, batch, off-peak and audio rates are ignored. This report never changes the catalog.');
  return out.join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), { root = ROOT, fetchImpl, log = console.log, error = console.error } = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options: {
      provider: { type: 'string' }, from: { type: 'string' }, date: { type: 'string' },
      'catalog-url': { type: 'string' }, 'report-dir': { type: 'string' },
    } }));
    if (values.date && !values.from) throw new Error('--date is only valid with --from');
    if (values.date && !validDate(values.date)) throw new Error('--date must be YYYY-MM-DD');
  } catch (e) { error(e.message); return 2; }
  let report;
  try {
    report = await checkPrices({ root, providerId: values.provider, from: values.from, date: values.date, catalogUrl: values['catalog-url'], fetchImpl });
  } catch (e) { error(e.message); return 2; }
  const dir = resolve(root, values['report-dir'] ?? '.catalog-reports/prices');
  mkdirSync(dir, { recursive: true });
  const markdown = renderMarkdown(report);
  writeFileSync(resolve(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(resolve(dir, 'report.md'), markdown);
  log(markdown);
  return report.attention || report.candidates ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
