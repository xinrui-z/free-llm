// View model for /changelog, shared by the server template and the client re-render (live entries), so
// both produce the same structure. Browser-safe: no Node or Astro imports. All strings stay plain text;
// the callers render them with {expr} (Astro) or textContent (DOM).
// Files in src/pages that start with "_" are not routes.

export interface ChangeEntry {
  id?: string;
  date: string;
  provider_id: string;
  provider_name?: string;
  type: string;
  title: string;
  description?: unknown;
}

/** What the page knows about each provider in the current catalog. */
export interface ProviderRef { name: string; archived: boolean; archivedOn: string | null }
export type ProviderIndex = Record<string, ProviderRef>;

/** A run of title text; `href` marks a provider link. */
export interface TextPart { text: string; href?: string }

export interface Item {
  key: string;
  kind: string;
  tag: string;
  /** Show the 6px red dot in the tag (archive events only). */
  archivedTag: boolean;
  title: TextPart[];
  /** " · Provider archived 2026-11-16" on historical entries of archived providers. */
  suffix: string | null;
  old: boolean;
  detail: string | null;
  models: { shown: string[]; rest: string[] } | null;
}
export interface Day { date: string; items: Item[] }
export interface Chip { kind: string; label: string; count: number }
export interface View { days: Day[]; chips: Chip[]; total: number; last: string | null; signature: string }

/**
 * Entry types the catalog validator accepts (scripts/lib/catalog-validation.mjs validateChangelog). Entries
 * stay typed as `string`: the live checker may serve a type this build does not know yet, which renders as a
 * generic change with a humanized label (as text).
 */
export const CHANGE_TYPES = ['model_added', 'model_removed', 'provider_added', 'provider_removed', 'status_change', 'rate_limit_change', 'outage', 'recovery', 'degraded', 'catalog_reviewed'] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const REVIEW = 'catalog_reviewed' satisfies ChangeType;
// Display order of types: inside a date and in the chip row. Unknown types follow, alphabetically, before reviews.
const ORDER = ['provider_removed', 'provider_added', 'model_added', 'model_removed', 'rate_limit_change', 'outage', 'degraded', 'recovery', 'status_change'];
const LABEL: Record<ChangeType, string> = {
  provider_removed: 'Archived',
  provider_added: 'Provider added',
  model_added: 'Models added',
  model_removed: 'Models removed',
  rate_limit_change: 'Limits changed',
  outage: 'Outage',
  degraded: 'Degraded',
  recovery: 'Recovery',
  status_change: 'Status change',
  [REVIEW]: 'Documentation review',
};
const TAG: Record<string, string> = { [REVIEW]: 'Reviewed' };
const MODELS_SHOWN = 3;
const REVIEW_NOTE = 'Model IDs, limits and source links re-checked against official docs. A documentation review does not replace live API probes.';

const humanize = (type: string) => {
  const t = type.replaceAll('_', ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : 'Other';
};
export const kindLabel = (kind: string) => (Object.hasOwn(LABEL, kind) ? LABEL[kind as ChangeType] : humanize(kind));
const tagLabel = (kind: string) => (Object.hasOwn(TAG, kind) ? TAG[kind] : kindLabel(kind));
const rank = (kind: string) => {
  if (kind === REVIEW) return ORDER.length + 1;
  const i = ORDER.indexOf(kind);
  return i === -1 ? ORDER.length : i;
};
const byKind = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);

// Curated documentation reviews published before `catalog_reviewed` existed: retyped in changelog.json,
// but a live checker deployed from an older checkout still serves these ids as `model_added`.
const LEGACY_REVIEW_ID = /^catalog-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/;
const LEGACY_REVIEW_TITLE = / catalog and free-tier documentation refreshed$/;

/** Display kind of an entry. The `type` field decides; the only exception is the legacy review copy above. */
export function kindOf(e: Pick<ChangeEntry, 'type' | 'title' | 'id'>): string {
  if (e.type === 'model_added' && typeof e.id === 'string' && LEGACY_REVIEW_ID.test(e.id) && LEGACY_REVIEW_TITLE.test(e.title)) return REVIEW;
  return e.type;
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const providerName = (e: ChangeEntry, providers: ProviderIndex) => e.provider_name || providers[e.provider_id]?.name || e.provider_id;
const href = (id: string, providers: ProviderIndex) => (providers[id] ? `/providers/${encodeURIComponent(id)}/` : undefined);

/** Title with the provider name turned into a link to its page (when the page exists). */
function linkTitle(e: ChangeEntry, providers: ProviderIndex): TextPart[] {
  const title = text(e.title);
  const name = providerName(e, providers);
  const link = href(e.provider_id, providers);
  const at = link && name ? title.indexOf(name) : -1;
  if (at === -1) return [{ text: title }];
  return [
    ...(at > 0 ? [{ text: title.slice(0, at) }] : []),
    { text: name, href: link },
    ...(at + name.length < title.length ? [{ text: title.slice(at + name.length) }] : []),
  ];
}

/** "AIHubMix added 19 free models: A (1M), B (128K), …" → ["A (1M)", "B (128K)", …]. */
function modelList(description: string): string[] | null {
  const m = description.match(/free models?: (.*)$/s);
  if (!m) return null;
  const list = m[1].trim().replace(/\.$/, '').split(/,\s(?![^()]*\))/).map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

function entryItem(e: ChangeEntry, kind: string, providers: ProviderIndex, index: number): Item {
  const p = providers[e.provider_id];
  const description = text(e.description).trim();
  const old = !!(p?.archived && p.archivedOn && kind !== 'provider_removed' && e.date < p.archivedOn);
  let detail: string | null = description || null;
  let models: Item['models'] = null;
  if (kind === 'model_added') {
    const list = modelList(description);
    if (list) { models = { shown: list.slice(0, MODELS_SHOWN), rest: list.slice(MODELS_SHOWN) }; detail = null; }
  } else if (kind === 'provider_added') {
    // "Added Groq. High-speed…" repeats the title; keep the sentence after it.
    const rest = description.replace(/^Added [^.]+\.\s*/, '');
    detail = rest || null;
  }
  return {
    key: e.id || `${e.date}-${e.provider_id}-${e.type}-${index}`,
    kind,
    tag: tagLabel(kind),
    archivedTag: kind === 'provider_removed',
    title: linkTitle(e, providers),
    suffix: old ? `· Provider archived ${p!.archivedOn}` : null,
    old,
    detail,
    models,
  };
}

function reviewItem(date: string, es: ChangeEntry[], providers: ProviderIndex): Item {
  const title: TextPart[] = [{ text: es.length === 1 ? 'Documentation reviewed for ' : `Documentation reviewed for ${es.length} providers: ` }];
  es.forEach((e, i) => {
    if (i) title.push({ text: ', ' });
    title.push({ text: providerName(e, providers), href: href(e.provider_id, providers) });
  });
  return { key: `${date}-${REVIEW}`, kind: REVIEW, tag: tagLabel(REVIEW), archivedTag: false, title, suffix: null, old: false, detail: REVIEW_NOTE, models: null };
}

export function buildView(entries: ChangeEntry[], providers: ProviderIndex): View {
  const valid = entries.filter(e => e && typeof e.date === 'string' && typeof e.title === 'string' && typeof e.type === 'string');
  const counts = new Map<string, number>();
  const byDate = new Map<string, { e: ChangeEntry; kind: string; i: number }[]>();
  valid.forEach((e, i) => {
    const kind = kindOf(e);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date)!.push({ e, kind, i });
  });
  const dates = [...byDate.keys()].sort().reverse();
  const days: Day[] = dates.map(date => {
    const list = byDate.get(date)!;
    const kinds = [...new Set(list.map(x => x.kind))].sort(byKind);
    const items: Item[] = [];
    for (const kind of kinds) {
      const group = list.filter(x => x.kind === kind);
      if (kind === REVIEW) items.push(reviewItem(date, group.map(x => x.e), providers));
      else for (const x of group) items.push(entryItem(x.e, kind, providers, x.i));
    }
    return { date, items };
  });
  const chips = [...counts.keys()].sort(byKind).map(kind => ({ kind, label: kindLabel(kind), count: counts.get(kind)! }));
  return { days, chips, total: valid.length, last: dates[0] ?? null, signature: signatureOf(valid) };
}

/** Short fingerprint of the entry list; the client skips re-rendering when live data matches the server render. */
export function signatureOf(entries: ChangeEntry[]): string {
  const s = entries.map(e => `${e.id ?? ''}|${e.date}|${e.type}|${e.provider_id}|${e.title}|${text(e.description)}`).sort().join('\n');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${entries.length}-${(h >>> 0).toString(36)}`;
}
