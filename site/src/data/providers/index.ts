// Aggregates per-provider JSON files in this directory into a single sorted
// array. Edit individual provider files (e.g. `aihubmix.json`); display order
// is controlled by `_order.json`. Providers not listed in `_order.json` fall
// back to alphabetical order at the end.

import orderData from './_order.json';
import { sortProviders } from '../../../../scripts/lib/catalog-validation.mjs';

export interface ModelPricing {
  input_per_million: number;
  output_per_million: number;
  currency: string;
  source_url?: string;
  checked_at?: string;
  // Last day (YYYY-MM-DD) a promotional price applies; validation fails after it.
  valid_until?: string;
}

export interface ProviderModel {
  id: string;
  name: string;
  context_window?: string;
  // Largest completion length the provider documents for this model ("8K", "65536"). Absent = not disclosed.
  max_output_tokens?: string;
  modalities?: string[];
  // Documented capability flags only (true / false). Absent = not disclosed; never inferred from names.
  capabilities?: { reasoning?: boolean; tool_calling?: boolean; structured_output?: boolean };
  rpm?: number | null;
  tpm?: number | null;
  status?: string;
  // Present only when this model has a public, per-token paid rate. Absent/null
  // means free-only or no publicly disclosed per-token price (e.g. subscription
  // or compute-time billing — see the provider's `pricing_note`).
  pricing?: ModelPricing | null;
  [key: string]: unknown;
}

/** One published free-tier limit with its scope (see LIMIT_SCOPES in scripts/lib/catalog-validation.mjs). */
export interface ProviderLimit {
  metric: 'rpm' | 'tpm' | 'rpd' | 'tpd' | 'requests_per_month' | 'tokens_per_month' | 'concurrent_requests';
  value: number;
  scope: 'provider' | 'account' | 'model' | 'key';
  /** Only these model IDs (scope "model"); absent = every listed model. */
  models?: string[];
  note?: string;
  source_url: string;
  checked_at: string;
}

export interface Provider {
  id: string;
  name: string;
  description?: string;
  base_url: string;
  signup_url?: string;
  website_url?: string;
  logo?: string;
  status: 'active' | 'archived';
  latency_ms?: number | null;
  rpm?: number | null;
  tpm?: number | null;
  context_window?: string;
  auth: string;
  tags?: string[];
  top_models: string[];
  models: ProviderModel[];
  // Curated flagship paid-catalog entries for providers whose tracked `models`
  // are distinct free-tier SKUs (e.g. "-free"/":free" suffixed ids) with no
  // direct paid counterpart by the same id. Only consumed by the /pricing
  // page — never by the free-tier status/family-browser pages.
  paid_models?: ProviderModel[];
  // Optional manual display order: these model IDs are shown first, in this order, and the
  // rest follow in `models` array order (upstream API order for synced providers). Unknown
  // IDs are ignored when rendering; see sortModels.
  model_order?: string[];
  last_verified?: string;
  // Machine catalog observation, independent of the human policy review date.
  catalog_checked_at?: string;
  archive_reason?: string;
  quota_note?: string;
  catalog_note?: string;
  sources?: { label: string; url: string; checked_at: string }[];
  // Structured free-tier limits with scope; optional. rpm/tpm above stay the provider-wide headline values.
  limits?: ProviderLimit[];
  geo_restrictions?: string[] | null;
  api_key_env?: string | null;
  // Human-readable caveat for providers whose paid tier doesn't fit a clean
  // per-million-token rate (subscription billing, compute-time billing, etc.)
  pricing_note?: string | null;
  [key: string]: unknown;
}

const modules = import.meta.glob<{ default: Provider }>('./*.json', {
  eager: true,
  import: 'default',
});

const order: string[] = (orderData as { order: string[] }).order ?? [];

const all: Provider[] = sortProviders(Object.entries(modules)
  .filter(([path]) => !path.endsWith('/_order.json'))
  .map(([, mod]) => mod as unknown as Provider), order);

export const providers: Provider[] = all;
export default providers;
