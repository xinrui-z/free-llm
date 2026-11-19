export const REGISTRY_URL = 'https://models.dev/api.json';
export function publicHTTPS(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && !u.hash &&
      u.hostname.includes('.') && !u.hostname.includes(':') && !/^[\d.]+$/.test(u.hostname) && !u.hostname.endsWith('.localhost') && !u.hostname.endsWith('.local');
  } catch { return false; }
}
// The www. prefix is the only host normalization: other subdomains can be separate APIs.
const origin = url => { try { const u = new URL(url); u.hostname = u.hostname.replace(/^www\./, ''); return u.origin; } catch { return ''; } };

// Third-party metadata creates candidates only. No discovered URL is fetched or sent a key.
// Existing providers are matched by API origin (or ID) only: a shared website or docs host
// does not make two APIs the same provider. Every skipped registry entry is recorded with a reason.
export function discoverProvidersReport(raw, existing) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Object.keys(raw).length) throw new Error('Invalid provider registry');
  const byId = new Map(existing.map(p => [p.id, p]));
  // An active provider wins a shared API origin, so a live API never becomes a reactivation candidate.
  const byOrigin = new Map();
  for (const p of existing) {
    const key = origin(p.base_url);
    if (key && (!byOrigin.has(key) || p.status === 'active')) byOrigin.set(key, p);
  }
  const candidates = [], filtered = [];
  for (const [id, p] of Object.entries(raw)) {
    if (!p || typeof p !== 'object' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || typeof p.name !== 'string' || !p.models || typeof p.models !== 'object' || Array.isArray(p.models)) {
      filtered.push({ provider_id: id, reason: 'invalid registry entry' });
      continue;
    }
    if (!publicHTTPS(p.api)) { filtered.push({ provider_id: id, reason: 'API is not a public HTTPS URL' }); continue; }
    const match = byId.get(id) ?? byOrigin.get(origin(p.api));
    if (match && match.status !== 'archived') {
      filtered.push({ provider_id: id, reason: 'already in catalog', existing_provider_id: match.id });
      continue;
    }
    const hints = Object.entries(p.models).filter(([,m]) => m && m.cost?.input === 0 && m.cost?.output === 0).map(([modelId]) => modelId);
    if (!hints.length) { filtered.push({ provider_id: id, reason: 'no zero-price models' }); continue; }
    const candidate = { id:`models-dev:${id}`, provider_id:id, name:p.name, api_url:p.api,
      documentation_url:publicHTTPS(p.doc) ? p.doc : null, source_url:REGISTRY_URL,
      model_hints:hints.sort(), reason:'Third-party zero-price metadata; verify official recurring free policy before onboarding' };
    if (match) Object.assign(candidate, { kind: 'reactivation', existing_provider_id: match.id,
      reason: `Possible reactivation of archived provider ${match.id}; verify official recurring free policy before restoring it manually` });
    candidates.push(candidate);
  }
  return { candidates: candidates.sort((a,b)=>a.id.localeCompare(b.id)), filtered: filtered.sort((a,b)=>a.provider_id.localeCompare(b.provider_id)) };
}

export function discoverProviders(raw, existing) {
  return discoverProvidersReport(raw, existing).candidates;
}
