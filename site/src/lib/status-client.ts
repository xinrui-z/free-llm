// Progressive live status. Pages render complete without the status API; everything below only
// fills in hooks once a snapshot arrives. All API text is written with textContent (never innerHTML).
// Contract: /tmp/site-redesign/foundation.md ("Live status").
import { DETAIL_NOTES, DETAIL_WORDS, normalizeStatus, probeDetail, providerProbeError, type HealthStatus, type ProbeResult, type StatusSnapshot } from './status';
import { formatLatency, formatRelative } from './format';

/** Reader-facing detail of a provider: its own error, else the newest fresh error of one of its models. */
const providerDetail = (p: ProbeResult | undefined, data: StatusSnapshot | undefined) =>
  p ? probeDetail({ ...p, error: providerProbeError(p, data?.models) }) : probeDetail(undefined);

/** live: fresh snapshot. stale: the API answered but its newest check is too old. unavailable: no usable answer. */
export type LiveState = 'live' | 'stale' | 'unavailable';
export interface StatusInfo {
  state: LiveState;
  /** False when PUBLIC_STATUS_WORKER_URL is not set for this build. */
  configured: boolean;
  /** True once at least one request finished (success or failure). */
  attempted: boolean;
  /** Newest check time ever seen from the API (ISO), even if stale; null = never. */
  lastSeen: string | null;
  /** Live and at least one provider has a latency value. */
  hasLatency: boolean;
}

export const STATUS_WORDS: Record<HealthStatus, string> = { active: 'Operational', degraded: 'Degraded', dead: 'Service unavailable', unknown: 'Unknown' };
const COUNT_WORDS: Record<HealthStatus, string> = { active: 'up', degraded: 'degraded', dead: 'unavailable', unknown: 'unknown' };
const ORDER: HealthStatus[] = ['active', 'degraded', 'dead', 'unknown'];
const UNAVAILABLE_TEXT = 'Live health checks are unavailable. Showing documented limits from official sources.';

let snapshot: StatusSnapshot | undefined;
let info: StatusInfo = { state: 'unavailable', configured: true, attempted: false, lastSeen: null, hasLatency: false };
let pending: Promise<void> | undefined;
let lastSuccess = 0;
let started = false;
const REFETCH_AFTER_MS = 60_000;
const POLL_MS = 5 * 60_000;
// Elements that render probe data. Pages without them do not poll the status API.
const STATUS_SELECTOR = '[data-status-notice], [data-status-dot], [data-live-status], [data-live-latency], [data-model-status], [data-probe-coverage], [data-live-only]';
const listeners = new Set<(data: StatusSnapshot, info: StatusInfo) => void>();

export const windowLabel = (ms = 2 * 3600_000) => ms % 3600_000 === 0 ? `${ms / 3600_000} hour${ms === 3600_000 ? '' : 's'}` : `${Math.round(ms / 60_000)} minutes`;

/** Called after every refresh (and immediately if a snapshot already exists). */
export function onStatus(listener: (data: StatusSnapshot, info: StatusInfo) => void) {
  listeners.add(listener);
  if (snapshot) listener(snapshot, info);
}
export const getStatusInfo = (): StatusInfo => info;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** 8px status dot. Only "active" may pulse, and only where the caller asks. */
export function statusDot(status: HealthStatus, opts: { pulse?: boolean; title?: string } = {}) {
  const dot = el('span', `dot d-${status}${opts.pulse && status === 'active' ? ' pulse' : ''}`);
  if (opts.title) { dot.title = opts.title; dot.setAttribute('role', 'img'); dot.setAttribute('aria-label', opts.title); }
  else dot.setAttribute('aria-hidden', 'true');
  return dot;
}

/** Dot + word ("Operational"); the "unknown" word uses --status-unknown-text, the dot stays gray. */
export function statusWord(status: HealthStatus, label = STATUS_WORDS[status]) {
  const word = el('span', `live-word${status === 'unknown' ? ' st-unknown' : ''}`);
  word.append(statusDot(status), document.createTextNode(label));
  return word;
}

function renderNotice(node: HTMLElement, data: StatusSnapshot | undefined) {
  const dotSlot = node.querySelector<HTMLElement>('[data-sn-dot]');
  const text = node.querySelector<HTMLElement>('[data-sn-text]');
  const right = node.querySelector<HTMLElement>('[data-sn-right]');
  if (!text) return;
  const providerId = node.dataset.statusProvider;
  const p = providerId ? data?.providers.find(x => x.id === providerId) : undefined;
  dotSlot?.replaceChildren();
  if (right) right.textContent = '';
  if (info.state === 'live' && data) {
    if (providerId) {
      const status = p?.status ?? 'unknown';
      const detail = providerDetail(p, data);
      dotSlot?.append(statusDot(status, { pulse: true }));
      const word = el('span', status === 'unknown' ? 'st-unknown' : '', DETAIL_WORDS[detail]);
      word.title = DETAIL_NOTES[detail];
      const latency = formatLatency(p?.latency_ms);
      const note = detail === 'not_monitored' ? 'this provider is not probed'
        : detail === 'unknown' ? `no successful probe in the last ${windowLabel(p?.fresh_ms)}`
        : status === 'unknown' ? DETAIL_NOTES[detail].replace(/\.$/, '').replace(/^./, c => c.toLowerCase())
        : latency ? 'last probe ' : 'last probe failed';
      text.replaceChildren('Health checks · ', word, ` · ${note}`);
      if (status !== 'unknown' && latency) text.append(el('span', 'num', latency));
      const at = formatRelative(p?.checked_at ?? data.last_checked);
      if (right && at) right.textContent = `checked ${at}`;
    } else {
      const parts: Node[] = [document.createTextNode('Health checks · ')];
      for (const s of ORDER) {
        const n = data[s];
        if (!n) continue;
        const g = el('span', 'sn-g');
        g.append(statusDot(s, { pulse: true }), el('span', 'num', String(n)), ' ', el('span', s === 'unknown' ? 'st-unknown' : '', COUNT_WORDS[s]));
        parts.push(g);
      }
      text.replaceChildren(...parts);
      const at = formatRelative(data.last_checked);
      if (right && at) right.textContent = `checked ${at}`;
    }
    return;
  }
  dotSlot?.append(statusDot('unknown'));
  if (info.state === 'stale') {
    const ago = formatRelative(info.lastSeen);
    text.textContent = `Health data is out of date${ago ? ` (last check ${ago})` : ''}. Status is shown as unknown.`;
    return;
  }
  text.textContent = UNAVAILABLE_TEXT;
  if (info.attempted) text.append(el('span', 'muted', ` · Last successful check: ${formatRelative(info.lastSeen) ?? 'never'}`));
}

function render(data: StatusSnapshot) {
  const live = info.state === 'live';
  const root = document.documentElement;
  root.dataset.live = info.state;
  root.toggleAttribute('data-has-latency', info.hasLatency);
  document.querySelectorAll<HTMLElement>('[data-status-notice]').forEach(node => renderNotice(node, data));
  for (const p of data.providers) {
    const id = CSS.escape(p.id);
    const detail = providerDetail(p, data);
    const word = DETAIL_WORDS[detail];
    const lastError = providerProbeError(p, data.models);
    document.querySelectorAll<HTMLElement>(`[data-status-dot="${id}"]`).forEach(node => {
      node.replaceChildren(...(live ? [statusDot(p.status, { title: `Health: ${word}` })] : []));
    });
    document.querySelectorAll<HTMLElement>(`[data-live-status="${id}"]`).forEach(node => {
      node.replaceChildren(...(live ? [statusWord(p.status, word)] : []));
      if (live) node.title = `${DETAIL_NOTES[detail]}${lastError ? ` Last probe: ${lastError}` : ''}`; else node.removeAttribute('title');
    });
    document.querySelectorAll<HTMLElement>(`[data-live-latency="${id}"]`).forEach(node => {
      const latency = live ? formatLatency(p.latency_ms) : null;
      if (latency) node.replaceChildren(el('span', 'num', latency));
      else if (live) {
        // No successful probe in the freshness window: our observation is missing, so this is "Unknown"
        // (MASTER.md value states), never "Not disclosed" or a bare dash.
        const unknown = el('span', 'vs vs-unknown', 'Unknown');
        unknown.title = `No successful probe in the last ${windowLabel(p.fresh_ms)}`;
        node.replaceChildren(unknown);
      } else node.replaceChildren();
    });
    document.querySelectorAll<HTMLElement>(`[data-provider-id="${id}"]`).forEach(node => {
      node.dataset.status = live ? p.status : 'unknown';
      node.dataset.latency = live && p.latency_ms != null ? String(p.latency_ms) : '';
    });
    document.querySelectorAll<HTMLElement>(`[data-probe-coverage="${id}"]`).forEach(node => {
      node.textContent = p.coverage
        ? `${p.coverage.checked} of ${p.coverage.total} listed models checked in the last ${windowLabel(p.fresh_ms)}; ${p.coverage.healthy} responded successfully.`
        : 'Model-level monitoring is not available yet.';
    });
  }
  document.querySelectorAll<HTMLElement>('[data-model-status]').forEach(node => {
    if (!live) { node.replaceChildren(); return; }
    const m = data.models?.find(m => m.provider_id === node.dataset.modelProvider && m.model_id === node.dataset.modelId);
    const status = m?.status ?? 'unknown';
    const detail = m ? probeDetail({ status: m.status, error: m.error === 'not_checked_recently' ? undefined : m.error }) : 'unknown';
    const title = detail === 'not_monitored' ? 'This model is not monitored'
      : status !== 'unknown' || detail !== 'unknown' ? `Health: ${DETAIL_WORDS[detail]}${m?.checked_at ? ` · checked ${formatRelative(m.checked_at) ?? ''}` : ''}`
      : 'Not checked recently';
    node.replaceChildren(statusDot(status, { title }));
  });
  listeners.forEach(listener => listener(data, info));
}

const providerIds = () => (document.documentElement.dataset.providerIds ?? '').split(',').filter(Boolean);
const recentTime = (value: unknown) => {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(t) && t <= Date.now() + 60_000 ? t : NaN;
};
const newer = (a: string | null, t: number) => Number.isFinite(t) && (!a || t > Date.parse(a)) ? new Date(t).toISOString() : a;

function settle(next: StatusSnapshot, state: LiveState) {
  snapshot = next;
  const live = state === 'live';
  info = { ...info, state, attempted: true, hasLatency: live && next.providers.some(p => p.latency_ms != null) };
}

export function refreshStatus(): Promise<void> {
  if (pending) return pending;
  pending = (async () => {
    const ids = providerIds();
    const worker = (import.meta.env.PUBLIC_STATUS_WORKER_URL ?? '').replace(/\/$/, '');
    info = { ...info, configured: !!worker };
    try {
      if (!worker) throw new Error('Live monitoring is not configured');
      const response = await fetch(`${worker}/api/status`, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Status request failed (${response.status})`);
      const raw = await response.json();
      if (!Array.isArray(raw?.providers)) throw new Error('Invalid status response');
      const next = normalizeStatus(raw, ids);
      info = { ...info, lastSeen: newer(info.lastSeen, recentTime(raw.last_checked)) };
      lastSuccess = Date.now();
      // normalizeStatus drops last_checked when the snapshot is older than the freshness window.
      settle(next, next.last_checked ? 'live' : info.lastSeen ? 'stale' : 'unavailable');
    } catch {
      // Keep a previous snapshot only while it is still fresh; anything older reads as unknown.
      const next = normalizeStatus(snapshot, ids);
      settle(next, next.last_checked ? 'live' : 'unavailable');
    } finally {
      render(snapshot ?? normalizeStatus(null, ids));
    }
  })().finally(() => { pending = undefined; });
  return pending;
}

/** Started once by Layout.astro. Polls every 5 minutes while visible; re-renders relative times every minute. */
export function startStatus() {
  if (started) return;
  started = true;
  document.documentElement.dataset.live = 'unavailable';
  if (!document.querySelector(STATUS_SELECTOR)) return;
  void refreshStatus();
  window.setInterval(() => { if (!document.hidden) void refreshStatus(); }, POLL_MS);
  window.setInterval(() => {
    if (!document.hidden) document.querySelectorAll<HTMLElement>('[data-status-notice]').forEach(node => renderNotice(node, snapshot));
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastSuccess >= REFETCH_AFTER_MS) void refreshStatus();
  });
}
