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
