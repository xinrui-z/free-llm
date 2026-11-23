const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validTimestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const httpsURL = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; } };
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const strings = value => Array.isArray(value) && value.every(v => typeof v === 'string' && v.trim());
const DAY = 86_400_000;
const isoDay = ms => new Date(ms).toISOString().slice(0, 10);
const nowMs = now => {
  const ms = now === undefined ? Date.now() : new Date(now).getTime();
  if (!Number.isFinite(ms)) throw new TypeError('now must be a valid date');
  return ms;
};
// One day of grace so a reviewer in a timezone ahead of UTC can record their local date.
const future = (value, ms) => validDate(value) && value > isoDay(ms + DAY);

// Text the site renders; numbers or objects here crash or garble pages.
const PROVIDER_TEXT = ['description', 'context_window', 'quota_note', 'catalog_note', 'archive_reason', 'pricing_note'];
const MODEL_TEXT = ['context_window', 'description'];
export const STALE_REVIEW_DAYS = 90;
export const PRICE_EXPIRY_WARNING_DAYS = 30;

/** Sorts providers by `_order.json` IDs; unlisted providers follow alphabetically. Returns a new array. */
export function sortProviders(providers, order = []) {
  const index = new Map(order.map((id, i) => [id, i]));
  const rank = p => index.get(p.id) ?? Number.MAX_SAFE_INTEGER;
  return [...providers].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
}

/**
 * Display order of one provider's models: IDs pinned in `order` (the provider's `model_order`) first, in
 * that order, then every other model in array order (upstream API order for synced providers). Unknown and
 * repeated pins are ignored, so a stale pin can never break a page. Returns a new array.
 * @template {{ id: string }} T
 * @param {T[]} models
 * @param {unknown} [order]
 * @returns {T[]}
 */
export function sortModels(models, order) {
  const list = Array.isArray(models) ? [...models] : [];
  if (!Array.isArray(order) || !order.length) return list;
  const byId = new Map();
  for (const m of list) if (m && !byId.has(m.id)) byId.set(m.id, m);
  const pinned = new Set();
  for (const id of order) if (byId.has(id)) pinned.add(byId.get(id));
  return [...pinned, ...list.filter(m => !pinned.has(m))];
}

/**
 * Structural validation; returns errors. Safe to run on published data at read time because
 * nothing here can start failing merely because time passes (see providerTimeChecks for that).
 * Call as validateProvider(p), validateProvider(p, expectedId) or validateProvider(p, expectedId?, { now }).
 */
export function validateProvider(p, expectedId, options) {
  if (object(expectedId)) [options, expectedId] = [expectedId, undefined];
  expectedId ??= p?.id;
  const ms = nowMs(options?.now);
  const errors = [];
  if (!object(p)) return ['provider must be an object'];
  const require = (condition, message) => { if (!condition) errors.push(message); };
  const notFuture = (value, label) => require(!future(value, ms), `${label} must not be in the future`);
  require(typeof p.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.id) && p.id === expectedId, 'id must be a slug matching the filename');
  require(typeof p.name === 'string' && p.name.trim(), 'name is required');
  require(httpsURL(p.base_url) && !p.base_url.endsWith('/') && !/[{}]|%7[bd]/i.test(p.base_url), 'base_url must be HTTPS without a trailing slash or template placeholders');
  for (const key of ['signup_url', 'website_url', 'logo']) if (p[key] != null) require(httpsURL(p[key]), `${key} must be an HTTPS URL`);
  require(['active', 'archived'].includes(p.status), 'invalid catalog status');
  require(['required', 'optional', 'none', 'credit_card_required'].includes(p.auth), 'invalid auth mode');
  require(validDate(p.last_verified), 'last_verified must be a real YYYY-MM-DD date');
  notFuture(p.last_verified, 'last_verified');
  if (p.catalog_checked_at !== undefined) {
    require(validDate(p.catalog_checked_at), 'catalog_checked_at must be a real YYYY-MM-DD date');
    notFuture(p.catalog_checked_at, 'catalog_checked_at');
  }
  if (p.api_key_env != null) require(typeof p.api_key_env === 'string' && /^[A-Z][A-Z0-9_]*$/.test(p.api_key_env), 'invalid API key environment variable');
  for (const key of ['rpm', 'rpd', 'latency_ms']) if (p[key] != null) require(nonnegative(p[key]), `${key} must be nonnegative or null`);
  for (const key of PROVIDER_TEXT) if (p[key] != null) require(typeof p[key] === 'string', `${key} must be a string`);
  for (const key of ['tags', 'geo_restrictions']) if (p[key] != null) require(strings(p[key]), `${key} must be an array of strings`);
  require(strings(p.top_models) && p.top_models.length > 0 && p.top_models.length <= 5, 'top_models must contain 1–5 model IDs');
  if (Array.isArray(p.top_models)) require(new Set(p.top_models).size === p.top_models.length, 'top_models must not repeat a model');
  const idsByKey = {};
  for (const key of ['models', 'paid_models']) {
    if (key === 'paid_models' && p[key] === undefined) continue;
    require(Array.isArray(p[key]) && p[key].length > 0, `${key} must be a nonempty array`);
    const ids = idsByKey[key] = new Set();
    for (const m of Array.isArray(p[key]) ? p[key] : []) {
      if (!object(m)) { errors.push(`${key} entries must be objects`); continue; }
      require(typeof m.id === 'string' && m.id.trim() && !ids.has(m.id), `${key}: model IDs must be nonempty and unique`);
      ids.add(m.id);
      require(typeof m.name === 'string' && m.name.trim(), `${m.id}: model name is required`);
      require(['active', 'deprecated'].includes(m.status), `${m.id}: invalid model status`);
      for (const field of ['rpm', 'rpd']) if (m[field] != null) require(nonnegative(m[field]), `${m.id}: ${field} must be nonnegative or null`);
      for (const field of MODEL_TEXT) if (m[field] != null) require(typeof m[field] === 'string', `${m.id}: ${field} must be a string`);
      if (m.modalities != null) require(strings(m.modalities), `${m.id}: modalities must be an array of strings`);
      if (m.pricing != null) {
        const price = m.pricing;
        require(object(price) && nonnegative(price.input_per_million) && nonnegative(price.output_per_million) && /^[A-Z]{3}$/.test(price.currency), `${m.id}: invalid per-million-token pricing`);
        require(object(price) && httpsURL(price.source_url) && validDate(price.checked_at), `${m.id}: pricing needs an HTTPS source and checked_at date`);
        if (object(price)) {
          notFuture(price.checked_at, `${m.id}: pricing checked_at`);
          if (price.valid_until !== undefined) {
            require(validDate(price.valid_until), `${m.id}: pricing valid_until must be a real YYYY-MM-DD date`);
            if (validDate(price.checked_at)) require(!(price.valid_until < price.checked_at), `${m.id}: pricing valid_until precedes checked_at`);
          }
        }
      }
    }
  }
  if (idsByKey.models && idsByKey.paid_models) for (const id of idsByKey.paid_models) require(!idsByKey.models.has(id), `${id}: listed in both models and paid_models`);
  if (Array.isArray(p.models) && Array.isArray(p.top_models)) for (const id of p.top_models) require(p.models.some(m => m?.id === id && m.status !== 'deprecated'), `top model ${id} must reference an active model`);
  // Pins naming a model that is no longer listed are deliberately allowed: rendering ignores them and writers
  // prune them, so a stale pin can never take a provider off the live site.
  if (p.model_order !== undefined) {
    require(strings(p.model_order), 'model_order must be an array of nonempty model IDs');
    if (Array.isArray(p.model_order)) require(new Set(p.model_order).size === p.model_order.length, 'model_order must not repeat a model');
  }
  // sources is optional (the operator attests recurring free access at review time); when present it must be valid.
  if (p.sources !== undefined) {
    require(Array.isArray(p.sources) && p.sources.length > 0, 'sources must be a nonempty array when present');
    for (const s of Array.isArray(p.sources) ? p.sources : []) {
      require(object(s) && httpsURL(s.url) && typeof s.label === 'string' && s.label.trim() && validDate(s.checked_at), 'sources need an HTTPS URL, label and checked_at date');
      if (object(s)) notFuture(s.checked_at, `source ${s.url} checked_at`);
    }
  }
  return errors;
}

/**
 * Checks that start failing as time passes: expired promotional prices (errors), prices expiring
 * soon and stale policy reviews (warnings). Run by CI/CLI tooling, deliberately not by
 * validateProvider, so published catalogs keep loading after a deadline is missed.
 */
export function providerTimeChecks(p, { now } = {}) {
  const errors = [], warnings = [];
  if (!object(p)) return { errors, warnings };
  const ms = nowMs(now), today = isoDay(ms), warnFrom = isoDay(ms + PRICE_EXPIRY_WARNING_DAYS * DAY);
  for (const key of ['models', 'paid_models']) for (const m of Array.isArray(p[key]) ? p[key] : []) {
    const until = m?.pricing?.valid_until;
    if (!validDate(until)) continue;
    if (until < today) errors.push(`${m.id}: pricing expired on ${until}; update or remove it`);
    else if (until <= warnFrom) warnings.push(`${m.id}: pricing expires on ${until}`);
  }
  if (p.status === 'active' && validDate(p.last_verified) && p.last_verified < isoDay(ms - STALE_REVIEW_DAYS * DAY)) {
    warnings.push(`last_verified ${p.last_verified} is more than ${STALE_REVIEW_DAYS} days old; re-review the provider policy`);
  }
  return { errors, warnings };
}

// Providers deleted from the catalog whose changelog history is kept. Add an ID here when
// removing a provider file that changelog.json still mentions.
export const REMOVED_PROVIDER_IDS = Object.freeze([]);

/**
 * Call as validateChangelog(entries) or validateChangelog(entries, { providerIds }); provider IDs
 * are only checked against the catalog (plus REMOVED_PROVIDER_IDS) when providerIds is given.
 */
export function validateChangelog(entries, { providerIds, removedProviderIds = REMOVED_PROVIDER_IDS } = {}) {
  if (!Array.isArray(entries)) return ['changelog must be an array'];
  const errors = [], ids = new Set();
  const known = providerIds ? new Set([...providerIds, ...removedProviderIds]) : null;
  const types = ['model_added', 'model_removed', 'provider_added', 'provider_removed', 'status_change', 'rate_limit_change', 'outage', 'recovery', 'degraded'];
  entries.forEach((e, i) => {
    if (!object(e)) { errors.push(`entry ${i} must be an object`); return; }
    if (typeof e.id !== 'string' || !e.id || ids.has(e.id)) errors.push(`entry ${i}: invalid or duplicate ID`);
    ids.add(e.id);
    if (!validDate(e.date)) errors.push(`entry ${i}: invalid date`);
    if (e.timestamp != null && !validTimestamp(e.timestamp)) errors.push(`entry ${i}: timestamp must be null or an ISO date-time`);
    if (typeof e.provider_id !== 'string' || !/^[a-z0-9-]+$/.test(e.provider_id)) errors.push(`entry ${i}: invalid provider ID`);
    else if (known && !known.has(e.provider_id)) errors.push(`entry ${i}: unknown provider ${e.provider_id} (list removed providers in REMOVED_PROVIDER_IDS)`);
    if (!types.includes(e.type)) errors.push(`entry ${i}: invalid type`);
    if (typeof e.title !== 'string' || !e.title.trim()) errors.push(`entry ${i}: title is required`);
    for (const key of ['provider_name', 'description']) if (e[key] != null && typeof e[key] !== 'string') errors.push(`entry ${i}: ${key} must be text`);
    if (e.model_ids != null && !strings(e.model_ids)) errors.push(`entry ${i}: model_ids must be an array of strings`);
  });
  return errors;
}
