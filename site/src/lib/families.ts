// Model family landing pages (/models/<family>/). A page exists only when the catalog has enough real data to
// make it useful: at least FAMILY_MIN_PROVIDERS providers or FAMILY_MIN_LISTINGS free listings of that family.
// Families are the explicit, reviewed entries in MODEL_FAMILIES (stable URLs); auto vendor groups never get a page.
// Membership is by the family's ID matcher; models are never merged into one "canonical" model by name similarity:
// each provider offering stays its own row with its own ID, limits and context window.
import { classifyModels, MODEL_FAMILIES, type ModelFamily } from '../data/model-families.ts';
import { compareByTpm } from '../components/provider-table.ts';
import { limitsOf } from './format.ts';

export const FAMILY_MIN_PROVIDERS = 2;
export const FAMILY_MIN_LISTINGS = 3;

interface FamilyModel { id: string; name?: string; status?: string | null; context_window?: unknown; rpm?: number | null; tpm?: number | null }
interface FamilyProvider { id: string; name: string; status: string; rpm?: number | null; tpm?: number | null; models: FamilyModel[] }

export interface FamilyPage<P extends FamilyProvider> {
  family: ModelFamily;
  entries: { provider: P; models: P['models'][number][] }[];
  listings: number;
  providers: number;
}

/** Eligible family pages for the active providers, in MODEL_FAMILIES order. */
export function familyPages<P extends FamilyProvider>(providers: readonly P[]): FamilyPage<P>[] {
  const { families } = classifyModels(providers.filter(p => p.status === 'active'));
  const explicit = new Set(MODEL_FAMILIES.map(f => f.id));
  const order = new Map(providers.map((p, i) => [p.id, i]));
  return families
    .filter(({ family }) => explicit.has(family.id) && !family.auto)
    .map(({ family, entries }) => ({
      family,
      // Providers with published limits first (TPM, then RPM), then catalog order: the same rule as the directory.
      entries: [...entries].sort((a, b) => {
        const A = limitsOf(a.provider), B = limitsOf(b.provider);
        return Number(B.published) - Number(A.published)
          || compareByTpm({ tpm: A.tpm, rpm: A.rpm, order: order.get(a.provider.id) ?? 0 }, { tpm: B.tpm, rpm: B.rpm, order: order.get(b.provider.id) ?? 0 });
      }) as FamilyPage<P>['entries'],
      listings: entries.reduce((n, e) => n + e.models.length, 0),
      providers: entries.length,
    }))
    .filter(f => f.providers >= FAMILY_MIN_PROVIDERS || f.listings >= FAMILY_MIN_LISTINGS);
}

export const familyPath = (id: string) => `/models/${encodeURIComponent(id)}/`;
