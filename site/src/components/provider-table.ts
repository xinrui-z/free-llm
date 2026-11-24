// Client + server helpers for ProviderTable.astro. Import on the client from a page script:
//   import { arrangeProviderTable } from '../components/provider-table';
export type ProviderSort = 'rpd' | 'name' | 'models' | 'latency';

export const GROUPS = {
  published: { key: 'published', label: 'Published daily limit' },
  unpublished: {
    key: 'unpublished',
    label: 'Limits set per account or model',
    help: "These providers don't publish fixed daily request limits.",
    helpMd: 'Hover or focus “Not published” for their terms.',
    helpSm: "Each card shows the provider's own note.",
  },
} as const;

export const SORT_CAPTIONS: Record<ProviderSort, string> = {
  rpd: 'Sorted by published daily limit',
  name: 'Sorted by name',
  models: 'Sorted by number of free models',
  latency: 'Sorted by last probe latency',
};

interface SortKey { rpd: number | null; rpm: number | null; order: number }
/** RPD desc, then RPM desc, then catalog order. Missing values sort last. */
export const compareByRpd = (a: SortKey, b: SortKey) =>
  (b.rpd ?? -1) - (a.rpd ?? -1) || (b.rpm ?? -1) - (a.rpm ?? -1) || a.order - b.order;

const num = (v: string | undefined) => (v === undefined || v === '' ? null : Number(v));
const key = (el: HTMLElement): SortKey => ({ rpd: num(el.dataset.rpd), rpm: num(el.dataset.rpm), order: Number(el.dataset.order) });

function comparator(sort: ProviderSort) {
  if (sort === 'name') return (a: HTMLElement, b: HTMLElement) => (a.dataset.name ?? '').localeCompare(b.dataset.name ?? '');
  if (sort === 'models') return (a: HTMLElement, b: HTMLElement) => Number(b.dataset.models) - Number(a.dataset.models) || key(a).order - key(b).order;
  // data-latency is written by status-client.ts on every [data-provider-id]; '' = no value (sorts last).
  if (sort === 'latency') return (a: HTMLElement, b: HTMLElement) =>
    (num(a.dataset.latency) ?? Infinity) - (num(b.dataset.latency) ?? Infinity) || key(a).order - key(b).order;
  return (a: HTMLElement, b: HTMLElement) => compareByRpd(key(a), key(b));
}

/**
 * Filter, sort and (for sort "rpd" on a grouped table) regroup the desktop rows and mobile cards together.
 * `match(row)` decides visibility from the row's data-* attributes. Returns the number of visible providers.
 */
export function arrangeProviderTable(root: HTMLElement, opts: { match?: (row: HTMLElement) => boolean; sort?: ProviderSort } = {}): number {
  const sort = opts.sort ?? 'rpd';
  const grouped = root.dataset.grouped === 'true' && sort === 'rpd';
  let visible = 0;
  for (const container of root.querySelectorAll<HTMLElement>('[data-pt-body], [data-pt-cards]')) {
    const rows = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-pt-row]'));
    const headers = new Map(Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-pt-group]')).map(h => [h.dataset.ptGroup!, h]));
    let shown = 0;
    for (const row of rows) {
      const ok = opts.match ? opts.match(row) : true;
      row.hidden = !ok;
      if (ok) shown++;
    }
    visible = shown;
    const sorted = rows.slice().sort(comparator(sort));
    if (grouped) {
      const pub = sorted.filter(r => r.dataset.rpd !== '');
      const rest = rows.filter(r => r.dataset.rpd === '').sort((a, b) => key(a).order - key(b).order);
      const parts: [HTMLElement | undefined, HTMLElement[]][] = [[headers.get('published'), pub], [headers.get('unpublished'), rest]];
      for (const [header, list] of parts) {
        const n = list.filter(r => !r.hidden).length;
        if (header) {
          header.hidden = n === 0;
          const count = header.querySelector('[data-pt-group-count]');
          if (count) count.textContent = String(n);
          container.append(header);
        }
        container.append(...list);
      }
    } else {
      headers.forEach(h => { h.hidden = true; });
      container.append(...sorted);
    }
  }
  return visible;
}
