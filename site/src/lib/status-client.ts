import { normalizeStatus, type StatusSnapshot } from './status';

let snapshot: StatusSnapshot | undefined;
let pending: Promise<void> | undefined;
let lastSuccess = 0;
const REFETCH_AFTER_MS = 60_000;
// Elements that render probe data. Pages without them do not poll the status API.
const STATUS_SELECTOR = '[data-live-status], [data-live-latency], [data-model-status], [data-probe-coverage], [data-live-uptime], .provider-status-dot, #refresh-btn, #last-checked-label, #last-checked';
const windowLabel = (ms = 2 * 3600_000) => ms % 3600_000 === 0 ? `${ms / 3600_000} hour${ms === 3600_000 ? '' : 's'}` : `${Math.round(ms / 60_000)} minutes`;
const listeners = new Set<(data: StatusSnapshot) => void>();
const colors = { active: 'bg-green-500/10 text-green-400 border-green-500/20', degraded: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', dead: 'bg-red-500/10 text-red-400 border-red-500/20', unknown: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };
const dots = { active: 'bg-green-500', degraded: 'bg-yellow-500', dead: 'bg-red-500', unknown: 'bg-slate-500' };

export function onStatus(listener: (data: StatusSnapshot) => void) {
  listeners.add(listener);
  if (snapshot) listener(snapshot);
}

function render(data: StatusSnapshot) {
  for (const p of data.providers) {
    const id = CSS.escape(p.id);
    document.querySelectorAll<HTMLElement>(`[data-live-status="${id}"]`).forEach(el => {
      const badge = document.createElement('span');
      badge.className = `inline-flex items-center gap-1.5 rounded-full font-mono font-semibold border ${el.dataset.badgeSize === 'lg' ? 'px-3 py-1 text-sm' : 'px-2 py-0.5 text-xs'} ${colors[p.status]}`;
      badge.title = `Probe status: ${p.status}${p.error ? ` (${p.error})` : ''}`;
      const dot = document.createElement('span');
      dot.className = 'w-1.5 h-1.5 rounded-full bg-current';
      badge.append(dot, document.createTextNode(p.status));
      el.replaceChildren(badge);
    });
    document.querySelectorAll<HTMLElement>(`[data-live-latency="${id}"]`).forEach(el => {
      el.textContent = p.latency_ms == null ? '—' : p.latency_ms >= 1000 ? `${(p.latency_ms / 1000).toFixed(1)}s` : `${p.latency_ms}ms`;
    });
    document.querySelectorAll<HTMLElement>(`[data-provider-id="${id}"]`).forEach(el => {
      el.dataset.status = p.status;
      el.dataset.latency = p.latency_ms == null ? '' : String(p.latency_ms);
      if (el.classList.contains('provider-status-dot')) {
        el.className = `provider-status-dot w-1.5 h-1.5 rounded-full flex-shrink-0 ${dots[p.status]}`;
        el.title = `Probe status: ${p.status}`;
      }
    });
    document.querySelectorAll<HTMLElement>(`[data-probe-coverage="${id}"]`).forEach(el => {
      el.textContent = p.coverage ? `${p.coverage.checked} of ${p.coverage.total} listed models checked in the last ${windowLabel(p.fresh_ms)}; ${p.coverage.healthy} responded successfully.` : 'Model-level monitoring is not available yet.';
    });
  }
  document.querySelectorAll<HTMLElement>('[data-model-status]').forEach(el => {
    const m = data.models?.find(m => m.provider_id === el.dataset.modelProvider && m.model_id === el.dataset.modelId);
    const status = m?.status ?? 'unknown';
    const badge = document.createElement('span');
    badge.className = `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-mono border ${colors[status]}`;
    badge.textContent = status;
    badge.title = m?.error === 'not_monitored' ? 'This model is not monitored' : m?.checked_at ? `Last model probe: ${new Date(m.checked_at).toLocaleString()}${m.error ? ` (${m.error})` : ''}` : 'This model has not been checked';
    el.replaceChildren(badge);
  });
  listeners.forEach(listener => listener(data));
}

export function refreshStatus(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    const root = document.documentElement;
    const ids = (root.dataset.providerIds ?? '').split(',').filter(Boolean);
    const worker = (import.meta.env.PUBLIC_STATUS_WORKER_URL ?? '').replace(/\/$/, '');
    const button = document.getElementById('refresh-btn') as HTMLButtonElement | null;
    const label = document.getElementById('last-checked-label') ?? document.getElementById('last-checked');
    if (button) button.disabled = true;
    document.getElementById('refresh-icon')?.classList.add('animate-spin');
    try {
      if (!worker) throw new Error('Live monitoring is not configured');
      const response = await fetch(`${worker}/api/status`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Status request failed (${response.status})`);
      const raw = await response.json();
      if (!Array.isArray(raw?.providers)) throw new Error('Invalid status response');
      snapshot = normalizeStatus(raw, ids);
      lastSuccess = Date.now();
      if (label) label.textContent = snapshot.last_checked
        ? `Last checked: ${new Date(snapshot.last_checked).toLocaleString()}`
        : 'Monitoring data is stale — status unknown';
    } catch {
      snapshot = normalizeStatus(snapshot, ids);
      if (label) label.textContent = worker
        ? snapshot.last_checked ? 'Refresh failed — showing the last recent check' : 'Live status unavailable — status unknown'
        : 'Live monitoring is not configured';
    } finally {
      label?.classList.remove('hidden');
      if (button) button.disabled = !worker;
      document.getElementById('refresh-icon')?.classList.remove('animate-spin');
      render(snapshot ?? normalizeStatus(null, ids));
    }
  })().finally(() => { pending = undefined; });
  return pending;
}

export function startStatus() {
  if (!document.querySelector(STATUS_SELECTOR)) return;
  void refreshStatus();
  document.getElementById('refresh-btn')?.addEventListener('click', () => void refreshStatus());
  window.setInterval(() => { if (!document.hidden) void refreshStatus(); }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSuccess >= REFETCH_AFTER_MS) void refreshStatus();
  });
}
