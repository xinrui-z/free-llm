import fallback from '../data/changelog.json';
export interface ChangeEntry { id: string; date: string; provider_id: string; provider_name?: string; type: string; title: string; description?: string; }

export async function loadChangelog(limit = 200): Promise<ChangeEntry[]> {
  const worker = (import.meta.env.PUBLIC_STATUS_WORKER_URL ?? '').replace(/\/$/, '');
  if (worker) {
    try {
      const response = await fetch(`${worker}/api/changelog?limit=${limit}`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error('Request failed');
      const data: unknown = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid changelog');
      return data.filter(e => e && typeof e.title === 'string' && typeof e.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && typeof e.provider_id === 'string' && typeof e.type === 'string').slice(0, limit);
    } catch { /* The checked-in changelog remains available offline. */ }
  }
  return [...fallback].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

export function renderRecentChanges(container: HTMLElement, entries: ChangeEntry[]) {
  container.replaceChildren();
  for (const entry of entries) {
    const row = document.createElement('p');
    row.className = 'text-sm text-slate-400 py-2';
    row.textContent = `${entry.date} · ${entry.title}`;
    container.append(row);
  }
  if (!entries.length) container.textContent = 'No changes recorded yet';
}

export function renderChangelog(container: HTMLElement, entries: ChangeEntry[]) {
  container.replaceChildren();
  for (const entry of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    const row = document.createElement('article');
    row.className = 'changelog-entry border-l-2 border-slate-700 pl-5 py-3 mb-3';
    const meta = document.createElement('p');
    meta.className = 'text-xs text-slate-400 mb-1';
    meta.textContent = `${entry.date} · ${entry.provider_name ?? entry.provider_id} · ${entry.type.replaceAll('_', ' ')}`;
    const title = document.createElement('h2');
    title.className = 'text-sm font-semibold text-slate-200';
    title.textContent = entry.title;
    const description = document.createElement('p');
    description.className = 'text-sm text-slate-400 mt-1';
    description.textContent = typeof entry.description === 'string' ? entry.description : '';
    row.append(meta, title, description);
    container.append(row);
  }
  if (!entries.length) container.textContent = 'No changes match these filters';
}
