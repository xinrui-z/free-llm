// Adapters own endpoint and protocol semantics. They never write catalog files.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/models';
const ZENMUX_URL = 'https://zenmux.ai/api/v1/models';
const modelId = value => typeof value === 'string' && /^[A-Za-z0-9_.:/@+()~-]+$/.test(value);

export function completeModelList(raw) {
  if (!raw || !Array.isArray(raw.data) || !raw.data.length) throw new Error('Empty or invalid model catalog');
  if (raw.has_more || raw.next || raw.next_page || raw.links?.next ||
      (raw.total_count != null && raw.total_count !== raw.data.length)) {
    throw new Error('Incomplete/paginated catalog; refusing to infer removals');
  }
  const ids = new Set();
  for (const m of raw.data) {
    if (!m || !modelId(m.id) || ids.has(m.id)) throw new Error('Invalid or duplicate model ID');
    ids.add(m.id);
  }
  return raw.data;
}

// Number(null), Number('') and Number(false) are zero, but are not price evidence.
export function price(value) {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value))) {
    throw new Error('Missing or invalid token price');
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || (n === 0 && typeof value === 'string' && /[1-9]/.test(value.split(/[eE]/)[0]))) throw new Error('Invalid token price');
  return n;
}

function normalizeModel(m) {
  const modalities = values => Array.isArray(values) && values.length > 0 && values.every(v => typeof v === 'string' && v.trim());
  if (typeof m.name !== 'string' || !m.name.trim() || !Number.isSafeInteger(m.context_length) || m.context_length <= 0 ||
      !modalities(m.architecture?.input_modalities) || !modalities(m.architecture?.output_modalities)) {
    throw new Error(`Invalid model metadata: ${m.id}`);
  }
  return {
    id: m.id, name: m.name, context_window: String(m.context_length),
    modalities: ['text', ...(m.architecture.input_modalities.includes('image') ? ['vision'] : [])],
    status: 'active',
  };
}

// Malformed metadata or prices for a model already in the catalog block the source, because
// publishing would rest on unknown data. A malformed new entry is set aside for review instead,
// so one bad upstream row cannot freeze updates to every tracked model.
function quarantine(provider, id, quarantined, parse) {
  try { return parse(); }
  catch (error) {
    if ([...(provider?.models ?? []), ...(provider?.paid_models ?? [])].some(m => m.id === id)) throw error;
    quarantined.push({ id, reason: error.message });
    return null;
  }
}

export const adapters = {
  zenmux: {
    url: () => ZENMUX_URL,
    normalize(raw, provider) {
      const all = completeModelList(raw), models = [], ineligible = [], quarantined = [];
      for (const m of all.filter(m => m.id.endsWith('-free'))) {
        const parsed = quarantine(provider, m.id, quarantined, () => {
          const prices = m.pricings;
          if (!prices || !Array.isArray(prices.prompt) || !prices.prompt.length || !Array.isArray(prices.completion) || !prices.completion.length) throw new Error(`Missing ZenMux token prices: ${m.id}`);
          const tiers = Object.entries(prices).flatMap(([key, entries]) => {
            if (!Array.isArray(entries) || !entries.length) throw new Error(`Invalid ZenMux pricing tiers: ${m.id}`);
            return entries.map(entry => {
              if (!entry || entry.currency !== 'USD' || !['perMTokens','perCount'].includes(entry.unit) ||
                  (['prompt','completion'].includes(key) && entry.unit !== 'perMTokens')) throw new Error(`Unknown ZenMux billing unit: ${m.id}`);
              return price(entry.value);
            });
          });
          const normalized = normalizeModel({ ...m, name: m.display_name, architecture: { input_modalities: m.input_modalities, output_modalities: m.output_modalities } });
          return { normalized, free: tiers.every(n => n === 0) };
        });
        if (!parsed) continue;
        if (!parsed.free || !m.output_modalities.includes('text')) { ineligible.push(m.id); continue; }
        models.push({ ...parsed.normalized, rpm: null, rpd: null });
      }
      if (!models.length) throw new Error('No eligible ZenMux free text models; review catalog');
      return { kind: 'catalog', models, paid_models: [], ineligible, quarantined, source_url: ZENMUX_URL };
    },
  },
  openrouter: {
    url: () => OPENROUTER_URL,
    normalize(raw, provider, _source, date) {
      const all = completeModelList(raw);
      const models = [], ineligible = [], quarantined = [];
      for (const m of all.filter(m => m.id.endsWith(':free'))) {
        const parsed = quarantine(provider, m.id, quarantined, () => {
          const input = price(m.pricing?.prompt), output = price(m.pricing?.completion);
          const normalized = normalizeModel(m);
          // Unexpected additional billing fields require review, even on a :free ID.
          const extraCost = Object.entries(m.pricing).some(([key, value]) =>
            !['prompt', 'completion'].includes(key) && price(value) !== 0);
          return { normalized, free: input === 0 && output === 0 && !extraCost };
        });
        if (!parsed) continue;
        if (!parsed.free || !m.architecture.output_modalities.includes('text')) {
          ineligible.push(m.id);
          continue;
        }
        models.push({ ...parsed.normalized, rpm: null, rpd: null });
      }
      if (!models.length) throw new Error('No eligible free text models; refusing to erase the catalog');
      // Tracked paid models are listed in upstream order, like the free selection.
      const tracked = new Set((provider.paid_models ?? []).map(m => m.id)), paid = [];
      for (const m of all) {
        if (!tracked.has(m.id)) continue;
        paid.push({
          ...normalizeModel(m),
          pricing: {
            input_per_million: Number((price(m.pricing?.prompt) * 1e6).toFixed(6)),
            output_per_million: Number((price(m.pricing?.completion) * 1e6).toFixed(6)),
            currency: 'USD', source_url: OPENROUTER_URL, checked_at: date,
          },
        });
      }
      return { kind: 'catalog', models, paid_models: paid, ineligible, quarantined, source_url: OPENROUTER_URL };
    },
  },
  'openai-discovery': {
    url: source => source.url,
    normalize(raw, provider, source) {
      const all = completeModelList(raw);
      const known = new Set(provider.models.map(m => m.id));
      const seen = new Set(all.map(m => m.id));
      return {
        kind: 'discovery', source_url: source.url,
        // Upstream listing order; planSync uses it only to order the already-catalogued models.
        order: all.map(m => m.id),
        candidates: all.filter(m => (source.candidate_match === 'all' || m.id.endsWith(source.candidate_suffix)) && !known.has(m.id)).map(m => ({
          id: m.id, reason: 'Recurring free eligibility requires official evidence',
          source_url: source.url, policy_url: source.policy_url,
        })).sort((a, b) => a.id.localeCompare(b.id)),
        missing: provider.models.filter(m => !seen.has(m.id)).map(m => m.id).sort(),
      };
    },
  },
};
