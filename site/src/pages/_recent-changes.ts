// "Recent changes" on the directory (/). Shared by the server render (bundled changelog) and the client
// re-render (changelog API via lib/changelog-client). Pure data: callers render every string as text.
// The underscore prefix keeps this file out of Astro routing.
import { kindOf, REVIEW, type ChangeType } from './changelog/_changelog-view';

export interface RecentEntry { id?: string; date: string; provider_id: string; provider_name?: string; type: string; title: string }
/** A run of text, or a provider name to link to /providers/ID (`href` is null when the provider is unknown). */
export type RecentPart = string | { name: string; href: string | null };
export interface RecentItem { type: string; tag: string; archived: boolean; parts: RecentPart[] }
export interface RecentDay { date: string; items: RecentItem[] }

// Every known type has a row; any other type renders as a generic "Update" (still text only).
const KINDS: Record<ChangeType, { tag: string; summary: (n: number) => string }> = {
  provider_removed: { tag: 'Archived', summary: n => `${n} providers archived: ` },
  provider_added: { tag: 'Added', summary: n => `${n} providers added: ` },
  rate_limit_change: { tag: 'Limits', summary: () => 'Rate limits changed for ' },
  model_removed: { tag: 'Removed', summary: () => 'Free models removed for ' },
  model_added: { tag: 'Models', summary: () => 'Free models added for ' },
  [REVIEW]: { tag: 'Reviewed', summary: n => `Documentation reviewed for ${n} providers: ` },
  status_change: { tag: 'Status', summary: () => 'Status changed for ' },
  outage: { tag: 'Outage', summary: () => 'Outage reported for ' },
  degraded: { tag: 'Degraded', summary: () => 'Degraded service reported for ' },
  recovery: { tag: 'Recovered', summary: () => 'Recovered: ' },
};
const ORDER = Object.keys(KINDS);

/**
 * Up to `limit` items, newest date first. Same-day events of one kind merge into one line with linked
 * provider names. A single event keeps its own title, with the provider name linked where it appears.
 */
export function recentChanges(entries: RecentEntry[], providers: { id: string; name: string }[], limit = 5): RecentDay[] {
  const known = new Map(providers.map(p => [p.id, p.name]));
  const link = (e: RecentEntry) => ({
    name: known.get(e.provider_id) ?? e.provider_name ?? e.provider_id,
    href: known.has(e.provider_id) ? `/providers/${encodeURIComponent(e.provider_id)}/` : null,
  });
  const byDate = new Map<string, RecentEntry[]>();
  for (const e of entries) {
    if (!e || typeof e.date !== 'string' || typeof e.title !== 'string' || typeof e.type !== 'string') continue;
    byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  }
  const days: RecentDay[] = [];
  let count = 0;
  for (const date of [...byDate.keys()].sort().reverse()) {
    const list = byDate.get(date)!;
    const kinds = [...new Set(list.map(kindOf))].sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
    const items: RecentItem[] = [];
    for (const kind of kinds) {
      if (count >= limit) break;
      const group = list.filter(e => kindOf(e) === kind);
      const def = Object.hasOwn(KINDS, kind) ? KINDS[kind as ChangeType] : { tag: 'Update', summary: () => 'Updated: ' };
      let parts: RecentPart[];
      if (group.length === 1) {
        const p = link(group[0]);
        const title = group[0].title;
        const at = p.href ? title.indexOf(p.name) : -1;
        parts = at < 0 ? [title] : [title.slice(0, at), p, title.slice(at + p.name.length)].filter(x => x !== '');
      } else {
        parts = [def.summary(group.length)];
        group.forEach((e, i) => { if (i) parts.push(', '); parts.push(link(e)); });
      }
      items.push({ type: kind, tag: def.tag, archived: kind === 'provider_removed', parts });
      count++;
    }
    if (items.length) days.push({ date, items });
    if (count >= limit) break;
  }
  return days;
}
