// Free-tier limit rows for the provider page. One row per metric, in a fixed order, so a reader can see at a
// glance which limits the provider discloses and which it does not. Rules:
//   - A value comes only from the structured `limits` array or the provider-wide headline `rpm` / `tpm`.
//   - The headline values have no recorded scope, so they are shown as "Scope not specified".
//   - A metric with no value is "Not disclosed": never 0, never unlimited, never derived from another metric
//     (a daily cap is not turned into a per-minute rate or the reverse).
import type { ProviderLimit } from '../data/providers';

export type LimitMetric = ProviderLimit['metric'];
export type LimitScope = ProviderLimit['scope'];

export const LIMIT_LABELS: Record<LimitMetric, { short: string; long: string }> = {
  rpm: { short: 'RPM', long: 'Requests per minute' },
  tpm: { short: 'TPM', long: 'Tokens per minute' },
  rpd: { short: 'RPD', long: 'Requests per day' },
  tpd: { short: 'TPD', long: 'Tokens per day' },
  requests_per_month: { short: 'Req/month', long: 'Requests per month' },
  tokens_per_month: { short: 'Tokens/month', long: 'Tokens per month' },
  concurrent_requests: { short: 'Concurrency', long: 'Concurrent requests' },
};

export const SCOPE_LABELS: Record<LimitScope, { label: string; note: string }> = {
  provider: { label: 'Whole free tier', note: 'One value for every free-tier account and model.' },
  account: { label: 'Per account', note: 'Applies per account, organization or project; may differ by account tier.' },
  model: { label: 'Per model', note: 'Each listed model has its own counter.' },
  key: { label: 'Per API key', note: 'Applies to each API key.' },
};

/** Metrics always shown, disclosed or not. Others appear only when the provider discloses them. */
const CORE: LimitMetric[] = ['rpm', 'tpm', 'rpd', 'tpd'];
const ORDER: LimitMetric[] = ['rpm', 'tpm', 'rpd', 'tpd', 'requests_per_month', 'tokens_per_month', 'concurrent_requests'];

export interface LimitRow {
  metric: LimitMetric;
  value: number | null;
  scope: LimitScope | null;
  models?: string[];
  note?: string;
  source_url?: string;
  checked_at?: string;
}

interface LimitSource {
  rpm?: number | null;
  tpm?: number | null;
  limits?: readonly Partial<ProviderLimit>[] | null;
  models?: readonly { id: string }[] | null;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

export function limitRows(p: LimitSource): LimitRow[] {
  const listed = new Set((p.models ?? []).map(m => m.id));
  // A per-model limit names only models still listed; a stale ID is dropped, and a limit whose IDs are all gone is skipped.
  const structured = (Array.isArray(p.limits) ? p.limits : [])
    .filter((l): l is ProviderLimit => !!l && ORDER.includes(l.metric as LimitMetric) && isNumber(l.value))
    .map(l => (Array.isArray(l.models) && p.models ? { ...l, models: l.models.filter(id => listed.has(id)) } : l))
    .filter(l => !Array.isArray(l.models) || l.models.length > 0);
  const rows: LimitRow[] = [];
  for (const metric of ORDER) {
    const own = structured.filter(l => l.metric === metric);
    if (own.length) {
      for (const l of own) rows.push({ metric, value: l.value, scope: l.scope ?? null, models: l.models, note: l.note, source_url: l.source_url, checked_at: l.checked_at });
      continue;
    }
    const headline = metric === 'rpm' ? p.rpm : metric === 'tpm' ? p.tpm : undefined;
    if (isNumber(headline)) rows.push({ metric, value: headline, scope: null });
    // Without structured limits (e.g. a live catalog whose public API does not serve them yet) only RPM/TPM are
    // known to be missing; daily limits may well be published in the provider's terms, so they are not
    // claimed as "Not disclosed".
    else if (metric === 'rpm' || metric === 'tpm' || (structured.length > 0 && CORE.includes(metric))) rows.push({ metric, value: null, scope: null });
  }
  return rows;
}

/** True when the provider records at least one structured limit (with scope and source). */
export const hasStructuredLimits = (p: LimitSource) => Array.isArray(p.limits) && p.limits.length > 0;
