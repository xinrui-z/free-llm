// Shared display helpers for catalog pages.

// Convert a context-window label like "128K" / "1M" / "131,072" (or a plain
// number) into tokens so columns can sort numerically. Returns -1 when the
// value is missing or unparseable; catalog data may carry numbers or strings.
export function contextToNumber(label: unknown): number {
  if (label == null) return -1;
  if (typeof label === 'number') return Number.isFinite(label) && label >= 0 ? label : -1;
  const m = String(label).trim().replace(/,/g, '').match(/^(\d+(?:\.\d+)?)\s*([KM])?$/i);
  if (!m) return -1;
  const n = parseFloat(m[1]);
  const unit = m[2]?.toUpperCase();
  if (unit === 'M') return n * 1_000_000;
  if (unit === 'K') return n * 1_000;
  return n;
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', CNY: '¥' };

// Format a per-1M-token price. USD and CNY use their symbol; any other
// currency is shown with its ISO code as a suffix so it is never mistaken
// for dollars.
export function formatPrice(n: number, currency: string): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const code = String(currency || 'USD').trim().toUpperCase();
  const amount = n === 0 ? '0' : n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${amount}` : `${amount} ${code}`;
}

// Quote a value for POSIX shells: wrap in single quotes and escape embedded
// single quotes, so catalog URLs/ids can never break out of a snippet.
export function shellQuote(value: unknown): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// Emit a YAML scalar as a double-quoted string. JSON strings are valid YAML
// double-quoted scalars, so colons, '#' and quotes stay literal.
export function yamlString(value: unknown): string {
  return JSON.stringify(String(value));
}

const DAY_MS = 86_400_000;

function toTime(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim()) return Date.parse(value.trim());
  return NaN;
}

// Whole days elapsed from `date` to `now` (dates like "2026-11-16" are UTC
// midnight). Returns null when either value is missing or unparseable; a date
// in the future yields a negative number.
export function daysSince(date: unknown, now: unknown = Date.now()): number | null {
  const from = toTime(date);
  const to = toTime(now);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.floor((to - from) / DAY_MS);
}

// True when `date` is more than `days` days before `now`. A missing or
// unparseable date counts as stale: its freshness cannot be vouched for.
export function isStale(date: unknown, now: unknown = Date.now(), days = 30): boolean {
  const age = daysSince(date, now);
  return age === null || age > days;
}

// Newest valid date among `dates`, as YYYY-MM-DD; null when none parse.
export function latestDate(dates: readonly unknown[]): string | null {
  const times = dates.map(toTime).filter(Number.isFinite);
  return times.length ? new Date(Math.max(...times)).toISOString().slice(0, 10) : null;
}

// Oldest and newest valid dates among `dates`, as YYYY-MM-DD; null when none parse.
export function dateRange(dates: readonly unknown[]): { oldest: string; newest: string } | null {
  const times = dates.map(toTime).filter(Number.isFinite);
  if (!times.length) return null;
  const day = (t: number) => new Date(t).toISOString().slice(0, 10);
  return { oldest: day(Math.min(...times)), newest: day(Math.max(...times)) };
}

// Label the catalog sync job (scripts/catalog/sync.mjs) gives the live API
// source it writes into a provider's `sources`.
export const LIVE_CATALOG_SOURCE_LABEL = 'Live model catalog and token prices';

interface SyncedProviderLike {
  catalog_checked_at?: unknown;
  sources?: readonly { label?: unknown; url?: unknown; checked_at?: unknown }[];
}

// The live API source a provider's catalog (and its tracked prices) is synced
// from, or null when the provider is maintained by hand. This is decided by
// provenance, never by comparing dates: the sync job only advances
// catalog_checked_at and a price's checked_at when something changes, so an
// unchanged price is still auto-synced however old its date is.
export function liveCatalogSource(provider: SyncedProviderLike): { url?: string; checkedAt?: string } | null {
  const source = provider.sources?.find(s => s?.label === LIVE_CATALOG_SOURCE_LABEL);
  if (source) {
    return {
      url: typeof source.url === 'string' ? source.url : undefined,
      checkedAt: typeof source.checked_at === 'string' ? source.checked_at : typeof provider.catalog_checked_at === 'string' ? provider.catalog_checked_at : undefined,
    };
  }
  const catalog = provider.catalog_checked_at;
  if (typeof catalog === 'string' && Number.isFinite(toTime(catalog))) return { checkedAt: catalog };
  return null;
}

// True when a provider's prices come from the catalog sync job.
export function isAutoSyncedPricing(provider: SyncedProviderLike): boolean {
  return liveCatalogSource(provider) !== null;
}
