// Shared display helpers for every public page. Pages must format limits, context windows, prices,
// latency and dates through these functions so the same value reads the same everywhere.
// Honesty rules: null/undefined RPM/TPM means "not disclosed" (never "unlimited", never a number);
// a missing or blank price is never 0; helpers return null for missing values so the caller renders
// <NotPublished/> (or a muted dash) instead of inventing one.

export const NOT_PUBLISHED = 'Not disclosed';
export const NOT_PUBLISHED_NOTE = 'The provider does not disclose this value.';
export const NO_CONTEXT_NOTE = 'No context window in the official catalog.';

// The four value states (design-system MASTER.md "Value states"). Never interchangeable:
//   Not disclosed — the provider does not publish the value (NOT_PUBLISHED above, <NotPublished/>).
//   Unknown       — we have no current observation (no fresh probe, missing data on our side).
//   Unavailable   — the data source, or the thing itself, cannot be reached right now.
//   Unlimited     — the provider explicitly documents no limit. Never inferred from null or a missing value.
export const VALUE_STATES = {
  unknown: { label: 'Unknown', note: 'No current observation is available for this value.' },
  unavailable: { label: 'Unavailable', note: 'The data source cannot be reached right now.' },
  unlimited: { label: 'Unlimited', note: 'The provider documents no limit for this value.' },
} as const;
export type ValueStateKind = keyof typeof VALUE_STATES;

// Convert a context-window label like "128K" / "1M" / "131,072" (or a plain
// number) into tokens so columns can sort numerically. Returns -1 when the
// value is missing or unparseable; catalog data may carry numbers or strings.
// K/M are decimal here (sorting only); use formatTokens() for display.
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

/** 30 → "30", 14400 → "14,400", 200000 → "200,000". Never lossy ("1K"). null/undefined/invalid → null. */
export function formatCount(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return n.toLocaleString('en-US');
}

export interface FormattedTokens {
  /** Short label: "128K", "1M", "1.02M". */
  text: string;
  /** Exact value for a title attribute: "131,072 tokens" or "128K tokens, as documented". */
  title: string;
}

/**
 * Context window for display. Raw token counts become K/M: exact binary sizes read 128K / 256K / 1M
 * (131072, 262144, 1048576); round decimal sizes stay decimal (256000 → 256K, 1000000 → 1M,
 * 1024000 → 1.02M). Labels that are already "128K" / "1M" pass through (uppercased).
 * Missing, blank or unparseable → null (render NotPublished / a muted dash).
 */
export function formatTokens(value: unknown): FormattedTokens | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+(?:\.\d+)?\s*[KM]$/i.test(s)) {
    const text = s.toUpperCase().replace(/\s/g, '');
    return { text, title: `${text} tokens, as documented` };
  }
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  let text: string;
  if (n % 1_048_576 === 0) text = `${n / 1_048_576}M`;
  else if (n % 1000 !== 0 && n % 1024 === 0 && n < 1_024_000) text = `${n / 1024}K`;
  else if (n >= 1e6) text = `${+(n / 1e6).toFixed(2)}M`;
  else if (n >= 1e3) {
    // Round before picking the unit so 999,500-999,999 reads "1M", not "1000K".
    const k = Math.round(n / 1e3);
    text = k >= 1000 ? `${+(n / 1e6).toFixed(2)}M` : `${k}K`;
  }
  else text = String(n);
  return { text, title: `${n.toLocaleString('en-US')} tokens` };
}

/** Largest context window across a provider (provider-level value and every model). Raw value or null. */
export function maxContext(p: { context_window?: unknown; models?: { context_window?: unknown }[] }): string | number | null {
  let best: unknown = null, bestN = -1;
  for (const v of [p.context_window, ...(p.models ?? []).map(m => m.context_window)]) {
    const n = contextToNumber(v);
    if (n > bestN) { bestN = n; best = v; }
  }
  return bestN > 0 ? best as string | number : null;
}

/** 420 → "420 ms", 1234 → "1.2 s". null/invalid → null. */
export function formatLatency(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  // Round before picking the unit so 999.6 reads "1.0 s", not "1000 ms".
  const r = Math.round(ms);
  return r < 1000 ? `${r} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** ISO date "2026-11-16" (from a date or a timestamp). Invalid/missing → null. Render in Inter, tabular-nums. */
export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** "just now", "4 min ago", "3 h ago", "2 d ago". Invalid/missing → null. */
export function formatRelative(value: string | number | null | undefined, now = Date.now()): string | null {
  if (value == null || value === '') return null;
  const t = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((now - t) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** First sentence of a provider note ("…caps that depend on purchase history."). Empty → ''. */
export function firstSentence(text: string | null | undefined): string {
  const s = String(text ?? '').trim();
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : s;
}

export interface Limits {
  rpm: number | null;
  tpm: number | null;
  /** True when at least one of rpm / tpm is a published number. */
  published: boolean;
  /** First sentence of quota_note ('' when there is none). */
  note: string;
}

/** Request limits of a provider or model. Never fills in a missing value. */
export function limitsOf(x: { rpm?: number | null; tpm?: number | null; quota_note?: string | null }): Limits {
  const rpm = typeof x.rpm === 'number' && Number.isFinite(x.rpm) ? x.rpm : null;
  const tpm = typeof x.tpm === 'number' && Number.isFinite(x.tpm) ? x.tpm : null;
  return { rpm, tpm, published: rpm != null || tpm != null, note: firstSentence(x.quota_note) };
}

/** Meta descriptions longer than this are cut in search results. */
export const META_DESCRIPTION_MAX = 158;

/** Shorten text to `max` characters at a word boundary, ending with "…". Shorter text is returned unchanged. */
export function clampText(text: string, max = META_DESCRIPTION_MAX): string {
  const s = text.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.—–-]+$/, '')}…`;
}

/**
 * Meta description for a provider page. Active: published limits first (same number format as the page),
 * then the catalog blurb, led by "<Name> free API" when the blurb names neither. Archived: a short notice
 * pointing to the alternatives the page lists (archive_reason stays in the page body). Always clamped.
 */
export function providerMetaDescription(
  p: { name: string; status?: string; description?: string | null; rpm?: number | null; tpm?: number | null },
  opts: { modelCount?: number; alternatives?: number } = {},
): string {
  if (p.status === 'archived') {
    const alts = opts.alternatives ?? 0;
    return clampText(`${p.name} no longer offers a recurring free API tier.${alts ? ` Compare ${alts} active free LLM API ${alts === 1 ? 'alternative' : 'alternatives'}.` : ''}`);
  }
  const L = limitsOf(p);
  const limits = [L.rpm != null && `${formatCount(L.rpm)} RPM`, L.tpm != null && `${formatCount(L.tpm)} TPM`].filter(Boolean).join(', ');
  const blurb = p.description?.trim();
  if (!blurb) {
    const n = opts.modelCount ?? 0;
    const models = n ? `${n} free ${n === 1 ? 'model' : 'models'}` : 'free models';
    return clampText(`${p.name} free API: ${limits ? `${limits}, ` : ''}${models}, base URL and an OpenAI-compatible quick start.`);
  }
  const named = blurb.toLowerCase().includes(p.name.toLowerCase()) && /\bfree\b/i.test(blurb);
  const lead = limits ? `${p.name} free tier: ${limits}. ` : named ? '' : `${p.name} free API: `;
  return clampText(lead + blurb);
}

/** One access conclusion: "Sign-up required" / "Sign-up + credit card required" [+ " · Not available in: X, Y"]. */
export function accessLine(p: { auth?: string; geo_restrictions?: string[] | null }): string {
  const base = p.auth === 'credit_card_required' ? 'Sign-up + credit card required' : 'Sign-up required';
  const geo = Array.isArray(p.geo_restrictions) ? p.geo_restrictions.filter(Boolean) : [];
  return geo.length ? `${base} · Not available in: ${geo.join(', ')}` : base;
}

/** Table cell form of accessLine: "Sign-up" or "Card". */
export function accessShort(p: { auth?: string }): string {
  return p.auth === 'credit_card_required' ? 'Card' : 'Sign-up';
}

/** "https://www.cerebras.ai/x" → "cerebras.ai". */
export function shortHost(url: string | null | undefined): string {
  try { return new URL(String(url)).host.replace(/^www\./, ''); } catch { return String(url ?? ''); }
}

/** True when any listed model accepts images. */
export function hasVision(p: { models?: { modalities?: string[] }[] }): boolean {
  return (p.models ?? []).some(m => Array.isArray(m.modalities) && m.modalities.includes('vision'));
}

/** Date a provider was archived: its provider_removed changelog entry, else last_verified. */
export function archiveDate(
  p: { id: string; last_verified?: string },
  changelog: { provider_id?: string; type?: string; date?: string }[] = [],
): string | null {
  const entry = changelog.find(e => e.provider_id === p.id && e.type === 'provider_removed');
  return formatDate(entry?.date ?? p.last_verified);
}

const CURRENCY_SYMBOLS: Record<string, string> = { USD: '$', CNY: '¥' };
const withCurrency = (amount: string, currency: string) => {
  const code = String(currency || 'USD').trim().toUpperCase();
  const symbol = CURRENCY_SYMBOLS[code];
  return symbol ? `${symbol}${amount}` : `${amount} ${code}`;
};

// Legacy compact price format, kept because tests/format.test.mjs pins it. New UI uses formatRate().
export function formatPrice(n: number, currency: string): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
  const amount = n === 0 ? '0' : n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n % 1 === 0 ? n.toFixed(0) : n.toFixed(2);
  return withCurrency(amount, currency);
}

/**
 * Per-1M-token price for display (prototype rule): 3 decimals below 1, 2 decimals from 1
 * ($0.075, $0.800, $1.50, $16.00); non-zero amounts below 0.001 keep 4 decimals so they never read
 * as $0.000. USD/CNY use their symbol, other currencies an ISO suffix ("1.50 EUR").
 * Missing / blank / invalid → null: never render a missing price as 0.
 */
export function formatRate(n: number | null | undefined, currency = 'USD'): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return null;
  // Four decimals when three would round the price (0.0375 must not read as 0.037).
  const amount = n >= 1 ? n.toFixed(2) : n > 0 && (n < 0.001 || Number(n.toFixed(3)) !== n) ? n.toFixed(4) : n.toFixed(3);
  return withCurrency(amount, currency);
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

/**
 * Suggested API key environment variable shown to users (code snippets, provider page, Tools YAML
 * `os.environ/<NAME>`, API key checklist). Derived from the public provider id only, so the static
 * build and the live (dynamic) catalog always print the same name:
 * "google-ai-studio" -> "GOOGLE_AI_STUDIO_API_KEY", "groq" -> "GROQ_API_KEY".
 *
 * Deliberately NOT the provider's `api_key_env`: that field is the checker's Cloudflare secret binding
 * name, kept out of the public catalog DTO, and it is an internal deployment detail, not a convention
 * users need to follow. Any variable name works for the user's own key.
 */
export function apiKeyEnvName(id: string): string {
  const stem = String(id ?? '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(?=\d)/, '_');
  return `${stem || 'PROVIDER'}_API_KEY`;
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

// Sitemap <lastmod> for a provider page: the newest date at which its shown content changed (policy review,
// catalog change, a source re-check or a price change). Each of these dates moves only when the content does.
export function providerLastmod(p: {
  last_verified?: unknown;
  catalog_checked_at?: unknown;
  sources?: readonly { checked_at?: unknown }[];
  models?: readonly { pricing?: { checked_at?: unknown } | null }[];
}): string | null {
  return latestDate([
    p.last_verified,
    p.catalog_checked_at,
    ...(p.sources ?? []).map(s => s?.checked_at),
    ...(p.models ?? []).map(m => m?.pricing?.checked_at),
  ]);
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

// Providers whose prices the daily Price sync workflow reads from their official
// pricing pages and applies automatically (the keys of pricePages in
// scripts/catalog/price-pages.mjs; a unit test keeps the two in step).
export const PRICE_PAGE_PROVIDERS: readonly string[] = ['cohere', 'sambanova', 'cerebras', 'groq', 'mistral', 'google-ai-studio', 'ollama-cloud'];

interface SyncedProviderLike {
  id?: unknown;
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

// True when a provider's prices are read daily from its official pricing page (see PRICE_PAGE_PROVIDERS).
export function isPricePageSynced(provider: SyncedProviderLike): boolean {
  return typeof provider.id === 'string' && PRICE_PAGE_PROVIDERS.includes(provider.id);
}

// Tokens whose brand casing title case would get wrong.
const NAME_TOKENS: Record<string, string> = {
  glm: 'GLM', minimax: 'MiniMax', mimo: 'MiMo', deepseek: 'DeepSeek', gpt: 'GPT', oss: 'OSS', lfm: 'LFM',
  ernie: 'ERNIE', qwen: 'Qwen', it: 'IT', vl: 'VL', ai: 'AI', api: 'API', llm: 'LLM',
};
const LOWER_WORDS = new Set(['for', 'of', 'and', 'with']);

/**
 * Readable name derived from a model ID, for catalog entries whose name is just the ID
 * (auto-discovered models carry no display name): "coding-glm-5.4-free" → "Coding GLM 5.4 Free",
 * "lfm-2.5-2.6b-free" → "LFM 2.5 2.6B Free", "kimi-for-coding-free" → "Kimi for Coding Free".
 */
export function nameFromId(id: string): string {
  const base = String(id ?? '').trim().replace(/^.*\//, '');
  return base.split(/[-_:\s]+/).filter(Boolean).map((word, i) => {
    const lower = word.toLowerCase();
    if (NAME_TOKENS[lower]) return NAME_TOKENS[lower];
    if (word !== lower) return word; // already cased upstream ("DeepSeek", "V3.1")
    if (/^[a-z]?\d/.test(word)) return word.toUpperCase(); // versions and sizes: m2.7, a1, 2.6b
    if (i > 0 && LOWER_WORDS.has(word)) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

/** Display name of a model: its catalog name, or one derived from the ID when the name is missing or just repeats the ID. */
export function modelDisplayName(m: { id: string; name?: string | null }): string {
  const name = typeof m.name === 'string' ? m.name.trim() : '';
  return name && name !== m.id ? name : nameFromId(m.id);
}
