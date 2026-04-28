// Aggregates per-provider JSON files in this directory into a single sorted
// array. Edit individual provider files (e.g. `aihubmix.json`); display order
// is controlled by `_order.json`. Providers not listed in `_order.json` fall
// back to alphabetical order at the end.

import orderData from './_order.json';

export interface ProviderModel {
  id: string;
  name: string;
  context_window?: string;
  modalities?: string[];
  rpm?: number | null;
  rpd?: number | null;
  status?: string;
  [key: string]: unknown;
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
  rpd?: number | null;
  context_window?: string;
  auth: string;
  tags?: string[];
  top_models: string[];
  models: ProviderModel[];
  last_verified?: string;
  geo_restrictions?: string[] | null;
  api_key_env?: string | null;
  [key: string]: unknown;
}

const modules = import.meta.glob<{ default: Provider }>('./*.json', {
  eager: true,
  import: 'default',
});

const order: string[] = (orderData as { order: string[] }).order ?? [];
const orderIndex = new Map(order.map((id, i) => [id, i]));

const all: Provider[] = Object.entries(modules)
  .filter(([path]) => !path.endsWith('/_order.json'))
  .map(([, mod]) => mod as unknown as Provider);

all.sort((a, b) => {
  const ai = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
  const bi = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;
  if (ai !== bi) return ai - bi;
  return a.id.localeCompare(b.id);
});

export const providers: Provider[] = all;
export default providers;
