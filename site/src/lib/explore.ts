// Home page "Explore" dimensions. Every row is computed from catalog fields by a rule that is printed next to it,
// so a reader can check it. No row uses a subjective label ("best", "fastest", "most reliable"): rankings only
// exist where the data has a number to rank by, and providers without that number are never ranked.
// Explicit .ts extensions: this module also runs directly under Node in tests/capabilities.test.mjs.
import { contextToNumber, formatCount, formatTokens, limitsOf } from './format.ts';
import { CODING_TOKENS, hasCapability, type CapabilityKey } from './capabilities.ts';
import { compareByTpm } from '../components/provider-table.ts';

/** "Long context" threshold, in tokens (a documented context window of at least this many tokens). */
export const LONG_CONTEXT_TOKENS = 256_000;

interface ExploreModel { id: string; name?: string | null; status?: string | null; context_window?: unknown; modalities?: string[] | null; capabilities?: Record<string, unknown> | null }
interface ExploreProvider { id: string; name: string; status: string; rpm?: number | null; tpm?: number | null; tags?: string[] | null; models: ExploreModel[] }

export interface ExploreLeader { label: string; value: string; href: string }
export interface ExploreRow {
  key: string;
  label: string;
  /** The selection rule, shown verbatim. */
  rule: string;
  /** Number of matches, with its unit. null = computed in the browser from live data. */
  count: number | null;
  unit: string;
  /** Up to three matches in rule order; empty when the rule has no ranking. */
  leaders: ExploreLeader[];
  href: string;
  /** Rendered only with a fresh monitoring snapshot. */
  live?: boolean;
}

const listable = (m: ExploreModel) => m.status !== 'deprecated' && !/prompt[-_]?guard/i.test(m.id);
const providerHref = (p: ExploreProvider) => `/providers/${encodeURIComponent(p.id)}/`;
const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;

/** Providers ranked by how many of their listed models match, ties in catalog order. */
function byMatches(active: ExploreProvider[], pick: (m: ExploreModel) => boolean, unit: string): ExploreLeader[] {
  return active
    .map((p, order) => ({ p, order, n: p.models.filter(m => listable(m) && pick(m)).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || a.order - b.order)
    .slice(0, 3)
    .map(x => ({ label: x.p.name, value: plural(x.n, unit), href: providerHref(x.p) }));
}

const countModels = (active: ExploreProvider[], pick: (m: ExploreModel) => boolean) =>
  active.reduce((n, p) => n + p.models.filter(m => listable(m) && pick(m)).length, 0);

const capRow = (active: ExploreProvider[], key: CapabilityKey, label: string, rule: string, cap: string): ExploreRow => ({
  key, label, rule,
  count: countModels(active, m => hasCapability(m, key)),
  unit: 'model listings',
  leaders: byMatches(active, m => hasCapability(m, key), 'model'),
  href: `/models/?cap=${cap}`,
});

/** The explore table for the active providers, in catalog order. Archived providers must not be passed in. */
export function exploreRows(providers: ExploreProvider[]): ExploreRow[] {
  const active = providers.filter(p => p.status === 'active');

  const mostModels: ExploreRow = {
    key: 'most-models',
    label: 'Most free models',
    rule: 'Active free models each provider lists (deprecated and safety-classifier models excluded).',
    count: countModels(active, () => true),
    unit: 'model listings',
    leaders: byMatches(active, () => true, 'model'),
    href: '/?sort=models#dir-h',
  };

  const published = active.map((p, order) => ({ p, order, L: limitsOf(p) })).filter(x => x.L.published);
  const rateLimits: ExploreRow = {
    key: 'rate-limits',
    label: 'Highest published rate limits',
    rule: 'Headline tokens per minute, then requests per minute, as published. Scope differs by provider (per model, per key …; see each provider page). Providers that publish neither are not ranked.',
    count: published.length,
    unit: published.length === 1 ? 'provider publishes limits' : 'providers publish limits',
    leaders: published
      .sort((a, b) => compareByTpm({ tpm: a.L.tpm, rpm: a.L.rpm, order: a.order }, { tpm: b.L.tpm, rpm: b.L.rpm, order: b.order }))
      .slice(0, 3)
      .map(({ p, L }) => ({
        label: p.name,
        value: [L.tpm != null && `${formatCount(L.tpm)} TPM`, L.rpm != null && `${formatCount(L.rpm)} RPM`].filter(Boolean).join(' · '),
        href: providerHref(p),
      })),
    href: '/?pub=1#dir-h',
  };

  const longModels = active
    .flatMap((p, order) => p.models.filter(listable).map(m => ({ p, m, order, n: contextToNumber(m.context_window) })))
    .filter(x => x.n >= LONG_CONTEXT_TOKENS);
  const longContext: ExploreRow = {
    key: 'long-context',
    label: 'Long context',
    rule: `Documented context window of at least ${LONG_CONTEXT_TOKENS / 1000}K tokens. Models without a documented window are not counted.`,
    count: longModels.length,
    unit: 'model listings',
    leaders: longModels
      .sort((a, b) => b.n - a.n || a.order - b.order)
      .slice(0, 3)
      .map(x => ({ label: `${x.m.id.split('/').pop()} · ${x.p.name}`, value: formatTokens(x.m.context_window)?.text ?? '', href: providerHref(x.p) })),
    href: '/models/?long=1',
  };

  const oai = active.filter(p => (p.tags ?? []).includes('openai-compatible'));
  const openai: ExploreRow = {
    key: 'openai-compatible',
    label: 'OpenAI-compatible',
    rule: 'Provider documents an OpenAI-compatible chat completions endpoint at its base URL. Not ranked.',
    count: oai.length,
    unit: `of ${active.length} providers`,
    leaders: [],
    href: '/?oai=1#dir-h',
  };

  const availability: ExploreRow = {
    key: 'availability',
    label: 'API availability',
    rule: 'Latest scheduled probe succeeded within its freshness window. Shown only while monitoring data is current.',
    count: null,
    unit: 'providers operational',
    leaders: [],
    href: '/?st=up#dir-h',
    live: true,
  };

  return [
    mostModels,
    rateLimits,
    capRow(active, 'coding', 'Coding models', `Catalog lists code as a model capability, or the model name contains ${CODING_TOKENS.join(', ')} (name hint, not verified).`, 'coding'),
    longContext,
    capRow(active, 'vision', 'Vision input', "Provider's model catalog lists image input.", 'vision'),
    capRow(active, 'reasoning', 'Reasoning models', 'Documented reasoning flag, or a reasoning name such as thinking, R1 or Z1 (name hint, not verified).', 'reasoning'),
    openai,
    availability,
  ];
}
