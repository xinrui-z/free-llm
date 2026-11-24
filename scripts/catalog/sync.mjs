import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { validateProvider, validDate, sortModels } from '../lib/catalog-validation.mjs';
import { adapters } from './adapters.mjs';

export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const httpsURL = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } };

export function validateSources(manifest) {
  if (manifest?.version !== 1 || !Array.isArray(manifest.sources) || !manifest.sources.length) throw new Error('Invalid source manifest');
  const ids = new Set();
  for (const s of manifest.sources) {
    if (!s || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.provider_id) || ids.has(s.provider_id) ||
        typeof s.enabled !== 'boolean' || !Object.hasOwn(adapters, s.adapter)) throw new Error('Invalid or duplicate source');
    ids.add(s.provider_id);
    if (['openrouter', 'zenmux'].includes(s.adapter) && (s.provider_id !== s.adapter ||
        !Number.isInteger(s.removal_confirmations) || s.removal_confirmations < 2 ||
        !Number.isFinite(s.removal_interval_hours) || s.removal_interval_hours < 1 ||
        !Number.isFinite(s.max_removal_fraction) || s.max_removal_fraction <= 0 || s.max_removal_fraction > 0.5 ||
        !Number.isInteger(s.max_additions) || s.max_additions < 1)) throw new Error('Invalid priced catalog sync policy');
    if (s.adapter === 'openai-discovery' && (!httpsURL(s.url) || !httpsURL(s.policy_url) ||
        !(s.candidate_match === 'all' && s.candidate_suffix === undefined ||
          s.candidate_match === undefined && typeof s.candidate_suffix === 'string' && !!s.candidate_suffix))) throw new Error('Invalid discovery source');
  }
  return manifest.sources;
}

function validateState(state, providerId, now) {
  if (!state) return;
  if (state.version !== 1 || state.provider_id !== providerId || !timestamp(state.checked_at) ||
      Date.parse(state.checked_at) > now || !state.missing || typeof state.missing !== 'object' || Array.isArray(state.missing) ||
      !Array.isArray(state.candidates)) throw new Error('Invalid or future sync state');
  for (const entry of Object.values(state.missing)) {
    if (!Number.isInteger(entry.count) || entry.count < 1 || !timestamp(entry.first_seen_at) || !timestamp(entry.last_counted_at) ||
        Date.parse(entry.first_seen_at) > Date.parse(entry.last_counted_at) || Date.parse(entry.last_counted_at) > now) throw new Error('Invalid removal observation');
  }
}

function diffModels(before = [], after = []) {
  const old = new Map(before.map(m => [m.id, m])), next = new Map(after.map(m => [m.id, m]));
  const updated = after.filter(m => old.has(m.id) && !isDeepStrictEqual(old.get(m.id), m));
  return {
    added: after.filter(m => !old.has(m.id)).map(m => m.id),
    removed: before.filter(m => !next.has(m.id)).map(m => m.id),
    updated: updated.map(m => m.id),
    changes: updated.map(m => ({ id: m.id, fields: Object.fromEntries(
      [...new Set([...Object.keys(old.get(m.id)), ...Object.keys(m)])]
        .filter(key => !isDeepStrictEqual(old.get(m.id)[key], m[key]))
        .map(key => [key, { before: old.get(m.id)[key] ?? null, after: m[key] ?? null }]),
    ) })),
  };
}

// Only these fields carry removal evidence or review queues. checked_at and source_hash describe
// the latest observation and change on every run, so they never justify rewriting state on their own.
const materialState = s => s && { version: s.version, provider_id: s.provider_id, source_url: s.source_url, policy_hash: s.policy_hash, missing: s.missing, candidates: s.candidates };
const settleState = (previous, next) => isDeepStrictEqual(materialState(previous), materialState(next)) ? previous : next;
const withoutDate = pricing => pricing && { ...pricing, checked_at: null };
const PRICE_KEYS = ['input_per_million', 'output_per_million', 'currency'];

// Models listed upstream follow the upstream listing order. Catalogued models absent upstream (awaiting removal
// confirmation, or never removed by discovery) keep their previous relative order at the end.
function upstreamOrder(models, upstreamIds) {
  const index = new Map(upstreamIds.map((id, i) => [id, i]));
  return [...models.filter(m => index.has(m.id)).sort((a, b) => index.get(a.id) - index.get(b.id)), ...models.filter(m => !index.has(m.id))];
}
// Whether models present on both sides changed relative order; additions and removals are reported separately.
function reordered(before = [], after = []) {
  const ids = list => list.map(m => m.id), afterIds = new Set(ids(after)), beforeIds = new Set(ids(before));
  return !isDeepStrictEqual(ids(before).filter(id => afterIds.has(id)), ids(after).filter(id => beforeIds.has(id)));
}
// Pins for models that are no longer listed are dropped, and an empty pin list is omitted.
function pruneModelOrder(provider) {
  if (provider.model_order === undefined) return;
  const ids = new Set(provider.models.map(m => m.id)), order = provider.model_order.filter(id => ids.has(id));
  if (order.length) provider.model_order = order;
  else delete provider.model_order;
}

export function planSync({ provider, raw, source, state, observedAt = new Date().toISOString() }) {
  const date = observedAt.slice(0, 10), now = Date.parse(observedAt);
  if (!validDate(date) || !Number.isFinite(now)) throw new Error('Invalid observation time');
  const errors = validateProvider(provider, source.provider_id);
  if (errors.length) throw new Error(errors.join('; '));
  if (provider.status !== 'active') throw new Error('Archived providers require manual reactivation');
  validateState(state, provider.id, now);
  const normalized = adapters[source.adapter].normalize(raw, provider, source, date);
  const policyHash = hash(source), previousState = state;
  // Observations from a different endpoint or rule set cannot confirm removals.
  if (state?.source_url !== normalized.source_url || state?.policy_hash !== policyHash) state = undefined;
  const nextState = { version: 1, provider_id: provider.id, checked_at: observedAt, source_url: normalized.source_url, policy_hash: policyHash, source_hash: hash(raw), missing: {}, candidates: [] };
  const report = { provider_id: provider.id, mode: normalized.kind, observed_at: observedAt, source_url: normalized.source_url, source_hash: nextState.source_hash };
  if (normalized.kind === 'discovery') {
    nextState.candidates = normalized.candidates.map(c => ({ ...c, first_seen_at: state?.candidates.find(old => old.id === c.id)?.first_seen_at ?? observedAt }));
    const settled = settleState(previousState, nextState);
    // Discovery never adds or removes models (missing_upstream is surfaced for manual review instead); it only
    // keeps the catalogued models in upstream order. Sources, catalog_checked_at and every other field stay as
    // reviewed: a reorder is presentation, and discovery has not verified the listing's free eligibility.
    const ordered = { ...provider, models: upstreamOrder(provider.models, normalized.order) };
    pruneModelOrder(ordered);
    const next = isDeepStrictEqual(provider, ordered) ? provider : ordered;
    if (next !== provider) {
      const nextErrors = validateProvider(next);
      if (nextErrors.length) throw new Error(nextErrors.join('; '));
    }
    return { provider: next, state: settled, report: { ...report, catalog_changed: next !== provider, state_changed: settled !== previousState,
      reordered: reordered(provider.models, next.models),
      candidates: nextState.candidates, missing: normalized.missing, missing_upstream: normalized.missing } };
  }

  const next = structuredClone(provider);
  function reconcile(key, incoming) {
    const old = provider[key] ?? [], byId = new Map(incoming.map(m => [m.id, m]));
    const absent = old.filter(m => !byId.has(m.id));
    const additions = incoming.filter(m => !old.some(o => o.id === m.id));
    // Check the raw diff before confirmations so a truncated response cannot accumulate removals.
    if (old.length && absent.length / old.length > source.max_removal_fraction) throw new Error(`${key}: unusually large removal (${absent.length}/${old.length}); review source and update the curated baseline`);
    if (additions.length > source.max_additions) throw new Error(`${key}: unusually large addition (${additions.length}); review source`);
    const listed = new Map(), retained = [];
    for (const previous of old) {
      const found = byId.get(previous.id);
      if (found) {
        // Limits, editorial fields and explicit deprecations remain manually owned.
        const merged = { ...previous, ...found, status: previous.status };
        if (previous.pricing && found.pricing) {
          // Manually maintained pricing fields (such as valid_until) survive the merge, but a promotion's
          // end date belongs to the price it was recorded for and is dropped when the price changes.
          const pricing = { ...previous.pricing, ...found.pricing };
          if (PRICE_KEYS.some(k => !isDeepStrictEqual(previous.pricing[k], found.pricing[k]))) delete pricing.valid_until;
          // A price's checked_at records when that price was last established, not every observation.
          merged.pricing = isDeepStrictEqual(withoutDate(previous.pricing), withoutDate(pricing)) ? previous.pricing : pricing;
        }
        if (Object.hasOwn(previous, 'rpm')) merged.rpm = previous.rpm;
        if (Object.hasOwn(previous, 'rpd')) merged.rpd = previous.rpd;
        listed.set(previous.id, merged);
      } else if (key === 'models' && normalized.ineligible.includes(previous.id)) {
        // Positive billing evidence revokes free eligibility immediately.
        continue;
      } else {
        const stateKey = `${key}/${previous.id}`;
        const prior = state?.missing[stateKey];
        const elapsed = !prior || now - Date.parse(prior.last_counted_at) >= source.removal_interval_hours * 3600_000;
        const observation = prior ? { ...prior } : { count: 0, first_seen_at: observedAt, last_counted_at: observedAt };
        if (elapsed) { observation.count++; observation.last_counted_at = observedAt; }
        if (observation.count < source.removal_confirmations) {
          nextState.missing[stateKey] = observation;
          retained.push(previous);
        }
      }
    }
    // Everything listed upstream, additions included, follows the upstream order; models awaiting removal
    // confirmation keep their previous relative order at the end.
    return [...incoming.map(m => listed.get(m.id) ?? m), ...retained];
  }
  next.models = reconcile('models', normalized.models);
  const paid = reconcile('paid_models', normalized.paid_models);
  if (paid.length) next.paid_models = paid;
  else delete next.paid_models;
  pruneModelOrder(next);
  const active = next.models.filter(m => m.status === 'active');
  next.top_models = provider.top_models.filter(id => active.some(m => m.id === id));
  // Vacated recommendation slots are filled in display order, so pinned models are preferred.
  for (const m of sortModels(active, next.model_order)) {
    if (next.top_models.length >= Math.min(provider.top_models.length, 5)) break;
    if (!next.top_models.includes(m.id)) next.top_models.push(m.id);
  }
  // Only claim a current maximum when no retained model is awaiting removal confirmation.
  if (!Object.keys(nextState.missing).some(key => key.startsWith('models/'))) {
    next.context_window = String(Math.max(...active.map(m => Number(m.context_window))));
  }
  // Observation dates alone are not catalog changes: they are stamped only together with a material
  // change, or when the live source has never been recorded. The report keeps the exact observation time.
  const live = { label: 'Live model catalog and token prices', url: normalized.source_url };
  const recorded = provider.sources?.find(s => s.url === live.url);
  if (!isDeepStrictEqual(provider, next) || !provider.catalog_checked_at || recorded?.label !== live.label) {
    next.catalog_checked_at = date;
    next.sources = [...(provider.sources ?? []).filter(s => s.url !== live.url), { ...live, checked_at: date }];
  }
  // last_verified covers reviewed policy, not the fact that an API request succeeded.
  const nextErrors = validateProvider(next);
  if (nextErrors.length) throw new Error(nextErrors.join('; '));
  const settled = settleState(previousState, nextState);
  const missingUpstream = [...new Set(Object.keys(nextState.missing).map(key => key.slice(key.indexOf('/') + 1)))].sort();
  return { provider: next, state: settled, report: {
    ...report, catalog_changed: !isDeepStrictEqual(provider, next), state_changed: settled !== previousState,
    reordered: reordered(provider.models, next.models) || reordered(provider.paid_models, next.paid_models),
    models: diffModels(provider.models, next.models), paid_models: diffModels(provider.paid_models, next.paid_models),
    pending_removals: Object.keys(nextState.missing),
    missing_upstream: missingUpstream,
    revoked_free_eligibility: provider.models.filter(m => normalized.ineligible.includes(m.id)).map(m => m.id),
    quarantined: normalized.quarantined ?? [],
  } };
}
