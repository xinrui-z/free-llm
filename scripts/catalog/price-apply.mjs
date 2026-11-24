// Turns price-check results into catalog edits. Used in two places:
//   - scripts/check-prices.mjs --write: applies a day's official-page prices to the repository JSON.
//   - the private checker: copies those reviewed prices from `main` into its live catalog (mergePricing).
// Only pricing data is ever touched: models[].pricing, paid_models, pricing_note and the pricing-page source.
// Nothing is removed: models missing from a page, unrecognised prices and blocked pages are left for a maintainer.

const clone = value => structuredClone(value);
const sameJSON = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// A new paid-only entry for a model priced on an official page but not yet catalogued. The page gives only the ID
// and its text token price; the site derives a display name from an ID-only name.
export function candidateEntry(candidate, page, date) {
  return {
    id: candidate.id, name: candidate.id, modalities: ['text'], rpm: null, tpm: null, status: 'active',
    pricing: { input_per_million: candidate.input_per_million, output_per_million: candidate.output_per_million, currency: 'USD',
      source_url: page.page_url, checked_at: date, ...(candidate.valid_until ? { valid_until: candidate.valid_until } : {}) },
  };
}

// Applies one provider's check result (from checkPrices) to its catalog entry. Returns { provider, applied } where
// applied lists each edit, or null when nothing changes. `result.candidates` must already exclude ignored models.
export function applyPriceResult(provider, result, page, date) {
  if (!result || result.status === 'blocked') return null;
  const next = clone(provider), applied = [];
  const entries = () => [...(next.models ?? []), ...(next.paid_models ?? [])];
  for (const change of result.changed ?? []) {
    const m = entries().find(e => e.id === change.id);
    if (!m?.pricing) continue;
    const before = { input_per_million: m.pricing.input_per_million, output_per_million: m.pricing.output_per_million, valid_until: m.pricing.valid_until ?? null };
    for (const key of ['input_per_million', 'output_per_million']) if (change.fields[key]) m.pricing[key] = change.fields[key].page;
    if (change.fields.valid_until) {
      if (change.fields.valid_until.page) m.pricing.valid_until = change.fields.valid_until.page;
      else delete m.pricing.valid_until;
    }
    m.pricing.source_url = page.page_url;
    m.pricing.checked_at = date;
    applied.push({ kind: 'price', provider_id: provider.id, model_id: m.id, before,
      after: { input_per_million: m.pricing.input_per_million, output_per_million: m.pricing.output_per_million, valid_until: m.pricing.valid_until ?? null } });
  }
  // A moved pricing page is a citation fix, not a new price: checked_at stays.
  for (const drift of result.source_url ?? []) {
    const m = entries().find(e => e.id === drift.id);
    if (!m?.pricing || m.pricing.source_url === page.page_url) continue;
    applied.push({ kind: 'source_url', provider_id: provider.id, model_id: m.id, before: m.pricing.source_url ?? null, after: page.page_url });
    m.pricing.source_url = page.page_url;
  }
  const known = new Set(entries().map(e => e.id));
  for (const candidate of result.candidates ?? []) {
    if (known.has(candidate.id)) continue;
    (next.paid_models ??= []).push(candidateEntry(candidate, page, date));
    known.add(candidate.id);
    applied.push({ kind: 'paid_model_added', provider_id: provider.id, model_id: candidate.id,
      after: { input_per_million: candidate.input_per_million, output_per_million: candidate.output_per_million, valid_until: candidate.valid_until ?? null } });
  }
  return applied.length ? { provider: next, applied } : null;
}

// Copies reviewed pricing from the repository's provider JSON (`repo`) into a live catalog entry (`live`).
// Every other field of `live` is kept, so edits made in the live catalog survive. Returns { provider, changes } or null.
export function mergePricing(live, repo) {
  if (!live || !repo || live.id !== repo.id) return null;
  const next = clone(live), changes = [];
  const repoEntries = new Map([...(repo.models ?? []), ...(repo.paid_models ?? [])].map(m => [m.id, m]));
  for (const key of ['models', 'paid_models']) {
    for (const m of next[key] ?? []) {
      const reviewed = repoEntries.get(m.id)?.pricing;
      if (!reviewed || sameJSON(m.pricing, reviewed)) continue;
      changes.push({ kind: 'pricing', model_id: m.id, before: m.pricing ?? null, after: reviewed });
      m.pricing = clone(reviewed);
    }
  }
  const liveIds = new Set([...(next.models ?? []), ...(next.paid_models ?? [])].map(m => m.id));
  for (const m of repo.paid_models ?? []) {
    if (liveIds.has(m.id) || !m.pricing) continue;
    (next.paid_models ??= []).push(clone(m));
    liveIds.add(m.id);
    changes.push({ kind: 'paid_model_added', model_id: m.id, after: m.pricing });
  }
  if (typeof repo.pricing_note === 'string' && repo.pricing_note.trim() && repo.pricing_note !== next.pricing_note) {
    changes.push({ kind: 'pricing_note', before: next.pricing_note ?? null, after: repo.pricing_note });
    next.pricing_note = repo.pricing_note;
  }
  // Cite each pricing page the merged prices use, taking the label from the repository.
  const cited = new Set([...(next.models ?? []), ...(next.paid_models ?? [])].map(m => m.pricing?.source_url).filter(Boolean));
  for (const source of repo.sources ?? []) {
    if (!cited.has(source?.url) || (next.sources ?? []).some(s => s?.url === source.url)) continue;
    (next.sources ??= []).push(clone(source));
    changes.push({ kind: 'source_added', after: source.url });
  }
  return changes.length ? { provider: next, changes } : null;
}
