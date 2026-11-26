export type HealthStatus = 'active' | 'degraded' | 'dead' | 'unknown';
export interface ProbeResult {
  id: string;
  status: HealthStatus;
  latency_ms: number | null;
  checked_at?: string;
  error?: string;
  // Freshness window applied to this provider (milliseconds).
  fresh_ms?: number;
  history_90d?: HealthStatus[];
  coverage?: { total: number; checked: number; healthy: number };
  /** False when a usable snapshot has no entry at all for this provider (it is not probed). */
  monitored?: boolean;
}

/**
 * What a probe result means for a reader, derived only from the checker's own status and error text.
 * HTTP 429 (or a rate-limit message) is "rate_limited", never an outage: it reflects the monitoring account's
 * quota, not the service. Auth errors and missing models are likewise not outages. Anything unrecognised stays
 * "unknown"; nothing is guessed.
 */
export type ProbeDetail = 'operational' | 'degraded' | 'rate_limited' | 'auth_failed' | 'model_unavailable' | 'service_unavailable' | 'unknown' | 'not_monitored';
export const DETAIL_WORDS: Record<ProbeDetail, string> = {
  operational: 'Operational',
  degraded: 'Degraded',
  rate_limited: 'Rate limited',
  auth_failed: 'Auth failed',
  model_unavailable: 'Model unavailable',
  service_unavailable: 'Service unavailable',
  unknown: 'Unknown',
  not_monitored: 'Not monitored',
};
export const DETAIL_NOTES: Record<ProbeDetail, string> = {
  operational: 'The latest scheduled probe succeeded.',
  degraded: 'The latest probes succeeded only partly or slowly.',
  rate_limited: "The monitoring account hit a rate limit or quota (HTTP 429/402). This is not an outage; your own account's limits apply to you.",
  auth_failed: "The monitoring account's key was rejected (HTTP 401/403). This says nothing about the service for other accounts.",
  model_unavailable: 'The probed model was not found or not served (HTTP 404). Other models may still work.',
  service_unavailable: 'Probes failed with server errors or timeouts within the freshness window.',
  unknown: 'No usable probe result within the freshness window.',
  not_monitored: 'This provider is not probed by the monitoring account.',
};
/** Details that describe the monitoring account's access, never the service's health. */
export const NOT_AN_OUTAGE: readonly ProbeDetail[] = ['rate_limited', 'auth_failed', 'model_unavailable'];

export function probeDetail(p: { status?: HealthStatus; error?: string | null; monitored?: boolean } | undefined): ProbeDetail {
  if (!p || p.monitored === false || p.error === 'not_monitored') return 'not_monitored';
  const error = typeof p.error === 'string' ? p.error : '';
  // The checker's own short codes ("quota", "auth") as well as raw HTTP text.
  if (/^quota$|\b429\b|rate[\s_-]?limit|too many requests/i.test(error)) return 'rate_limited';
  if (/^auth$|\b40[13]\b|unauthori[sz]ed|forbidden|invalid[\s_-]?(api[\s_-]?)?key|authentication/i.test(error)) return 'auth_failed';
  if (/^(model_)?not_found$|\b404\b|model[\s_-]?not[\s_-]?found|no such model|model[\s_-]?(is[\s_-]?)?(unavailable|not[\s_-]?supported|does not exist)/i.test(error)) return 'model_unavailable';
  if (p.status === 'active') return 'operational';
  if (p.status === 'degraded') return 'degraded';
  if (p.status === 'dead') return 'service_unavailable';
  return 'unknown';
}

/**
 * The checker reports errors per model, not per provider. When a provider's own entry carries no error, the
 * newest fresh model probe error of that provider explains an "unknown" provider status (e.g. "quota").
 * Only errors from probes inside the freshness window are used (normalizeStatus marks older ones
 * "not_checked_recently"); housekeeping codes such as "stale" or "not_checked" explain nothing.
 */
const NO_EXPLANATION = new Set(['stale', 'not_checked', 'not_checked_recently', 'not_monitored']);
export function providerProbeError(p: ProbeResult, models: ModelProbe[] = []): string | undefined {
  if (p.error) return p.error;
  if (p.status !== 'unknown') return undefined;
  const latest = models
    .filter(m => m.provider_id === p.id && m.error && !NO_EXPLANATION.has(m.error) && m.checked_at)
    .sort((a, b) => Date.parse(b.checked_at!) - Date.parse(a.checked_at!))[0];
  return latest?.error;
}
export interface ModelProbe {
  provider_id: string;
  model_id: string;
  status: HealthStatus;
  latency_ms: number | null;
  checked_at?: string;
  error?: string;
}
export interface StatusSnapshot {
  active: number;
  degraded: number;
  dead: number;
  unknown: number;
  total: number;
  last_checked: string | null;
  providers: ProbeResult[];
  models?: ModelProbe[];
}
export const HEALTH_STATUSES: HealthStatus[] = ['active', 'degraded', 'dead', 'unknown'];
export const MAX_STATUS_AGE = 2 * 60 * 60 * 1000;
const MIN_FRESH_MS = 15 * 60 * 1000;
const MAX_FRESH_MS = 48 * 60 * 60 * 1000;

// The worker may publish a per-provider freshness window (`fresh_ms`) that follows its probe spacing.
export function freshWindow(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_FRESH_MS && value <= MAX_FRESH_MS ? value : MAX_STATUS_AGE;
}

// Catalog membership never implies a successful health check.
export function normalizeStatus(input: unknown, ids: string[], now = Date.now()): StatusSnapshot {
  const data = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const entries = Array.isArray(data.providers) ? data.providers : [];
  const entry = (id: string) => entries.find(p => p && p.id === id);
  const windows = new Map(ids.map(id => [id, freshWindow(entry(id)?.fresh_ms)]));
  const recent = (time: number, window: number) => Number.isFinite(time) && time <= now + 60_000 && now - time <= window;
  const checked = typeof data.last_checked === 'string' ? Date.parse(data.last_checked) : NaN;
  // The snapshot as a whole is usable while its newest check is within the widest provider window.
  const fresh = recent(checked, Math.max(MAX_STATUS_AGE, ...windows.values()));
  const providers: ProbeResult[] = ids.map(id => {
    const p = entry(id), window = windows.get(id)!;
    const probeTime = p?.checked_at === undefined ? checked : Date.parse(p.checked_at);
    const probeFresh = fresh && recent(probeTime, window);
    const error = probeFresh && typeof p?.error === 'string' ? p.error : undefined;
    const reported = probeFresh && HEALTH_STATUSES.includes(p?.status) ? p.status as HealthStatus : 'unknown';
    // Quota, auth and missing-model errors describe the monitoring account, not the service: never count them
    // as degraded or down (counts, dot colours and the "Issues" filter all read `status`).
    const status = reported !== 'active' && error && NOT_AN_OUTAGE.includes(probeDetail({ status: reported, error })) ? 'unknown' : reported;
    return {
      id, status,
      // A previously normalised snapshot keeps its flag (the client re-normalises after a failed poll).
      monitored: !fresh || (!!p && p.monitored !== false),
      latency_ms: status !== 'unknown' && typeof p?.latency_ms === 'number' && Number.isFinite(p.latency_ms) && p.latency_ms >= 0 ? p.latency_ms : null,
      checked_at: probeFresh ? new Date(probeTime).toISOString() : undefined,
      // An error from a probe outside the freshness window says nothing about now.
      error,
      fresh_ms: window,
      coverage: p?.coverage && ['total','checked','healthy'].every(k => Number.isInteger(p.coverage[k]) && p.coverage[k] >= 0) && p.coverage.healthy <= p.coverage.checked && p.coverage.checked <= p.coverage.total
        ? { total: p.coverage.total, checked: probeFresh ? p.coverage.checked : 0, healthy: probeFresh ? p.coverage.healthy : 0 } : undefined,
      // History has no date anchors in the legacy API. Only use a fresh snapshot.
      history_90d: fresh && Array.isArray(p?.history_90d)
        ? p.history_90d.slice(-90).map((s: unknown) => HEALTH_STATUSES.includes(s as HealthStatus) ? s as HealthStatus : 'unknown')
        : undefined,
    };
  });
  return {
    active: providers.filter(p => p.status === 'active').length,
    degraded: providers.filter(p => p.status === 'degraded').length,
    dead: providers.filter(p => p.status === 'dead').length,
    unknown: providers.filter(p => p.status === 'unknown').length,
    total: providers.length,
    last_checked: fresh ? new Date(checked).toISOString() : null,
    providers,
    models: (Array.isArray(data.models) ? data.models : []).filter(m => m && ids.includes(m.provider_id) && typeof m.model_id === 'string').map(m => {
      const time = Date.parse(m.checked_at);
      const current = fresh && recent(time, windows.get(m.provider_id)!);
      const status = current && HEALTH_STATUSES.includes(m.status) ? m.status as HealthStatus : 'unknown';
      return { provider_id: m.provider_id, model_id: m.model_id, status,
        latency_ms: status !== 'unknown' && typeof m.latency_ms === 'number' && Number.isFinite(m.latency_ms) && m.latency_ms >= 0 ? m.latency_ms : null,
        checked_at: Number.isFinite(time) ? new Date(time).toISOString() : undefined,
        // 'not_monitored' (no probe will ever reach this model) is kept distinct from a missed check.
        error: m.error === 'not_monitored' ? 'not_monitored' : current && typeof m.error === 'string' ? m.error : 'not_checked_recently' };
    }),
  };
}

// This is a ratio of fully healthy observed days, not a time-based SLA.
export function summarizeHistory(history: HealthStatus[]) {
  const days = history.slice(-90);
  const observed = days.filter(s => s !== 'unknown').length;
  const healthy = days.filter(s => s === 'active').length;
  return { observed, healthy, percent: observed ? healthy / observed * 100 : null };
}

export function compareQuota(a: number | null | undefined, b: number | null | undefined) {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return b - a;
}

export function formatQuota(value: number | null | undefined) {
  return value == null ? 'Not disclosed' : `${value.toLocaleString('en-US')}/d`;
}
